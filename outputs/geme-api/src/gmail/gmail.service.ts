import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { AdminPermissionService } from "../admin-auth/admin-permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { decryptGmailToken, encryptGmailToken, GmailClient, GmailProviderError, gmailAuthorizationUrl, gmailCallbackReturnUrl, gmailConfig, gmailEncryptionKeyConfigured, GMAIL_MODIFY_SCOPE } from "./gmail.client.js";

type GmailHeader = { name?: unknown; value?: unknown };
type GmailPart = { mimeType?: unknown; filename?: unknown; body?: { data?: unknown; size?: unknown; attachmentId?: unknown }; parts?: GmailPart[] };
type GmailMessageResource = { id?: unknown; threadId?: unknown; labelIds?: unknown; snippet?: unknown; internalDate?: unknown; payload?: GmailPart & { headers?: GmailHeader[] } };
type GmailConnectionRecord = { id: string; email: string; status: string; refreshTokenCiphertext: string; scopes: string[] };

const UUID_OR_GMAIL_ID = /^[A-Za-z0-9_-]{1,220}$/;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_BODY_LENGTH = 100_000;
const FOLDER_LABELS: Record<string, string[]> = { inbox: ["INBOX"], starred: ["STARRED"], sent: ["SENT"], drafts: ["DRAFT"], trash: ["TRASH"], spam: ["SPAM"] };

function safeProviderCode(error: unknown) {
  if (error instanceof GmailProviderError) return error.code;
  const candidate = error instanceof Error ? error.name : "GMAIL_OPERATION_FAILED";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(candidate) ? candidate.toUpperCase() : "GMAIL_OPERATION_FAILED";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  const header = headers?.find((entry) => typeof entry.name === "string" && entry.name.toLowerCase() === name.toLowerCase());
  return typeof header?.value === "string" ? header.value.slice(0, 2_000) : "";
}

function decodeBase64Url(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try { return Buffer.from(value, "base64url").toString("utf8").replace(/\0/g, "").slice(0, MAX_BODY_LENGTH); }
  catch { return ""; }
}

function htmlToPlainText(value: string) {
  return value.replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Math.min(0x10ffff, Number(number))))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_LENGTH);
}

function getBodyParts(part: GmailPart | undefined, result: { text: string; html: string; attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> }) {
  if (!part) return;
  const mimeType = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
  const filename = typeof part.filename === "string" ? part.filename.slice(0, 240) : "";
  const body = part.body || {};
  if (filename && typeof body.attachmentId === "string") result.attachments.push({ filename, mimeType: mimeType || "application/octet-stream", size: Number(body.size) || 0, attachmentId: body.attachmentId.slice(0, 300) });
  else if (mimeType === "text/plain" && !result.text && typeof body.data === "string") result.text = decodeBase64Url(body.data);
  else if (mimeType === "text/html" && !result.html && typeof body.data === "string") result.html = decodeBase64Url(body.data);
  for (const child of part.parts || []) getBodyParts(child, result);
}

function messageSummary(message: GmailMessageResource) {
  const labels = Array.isArray(message.labelIds) ? message.labelIds.filter((label): label is string => typeof label === "string") : [];
  const headers = message.payload?.headers;
  return {
    id: typeof message.id === "string" ? message.id : "",
    threadId: typeof message.threadId === "string" ? message.threadId : "",
    labelIds: labels,
    snippet: typeof message.snippet === "string" ? message.snippet.slice(0, 600) : "",
    internalDate: typeof message.internalDate === "string" && /^\d+$/.test(message.internalDate) ? new Date(Number(message.internalDate)).toISOString() : null,
    from: headerValue(headers, "From"), to: headerValue(headers, "To"), subject: headerValue(headers, "Subject") || "(không có tiêu đề)",
    date: headerValue(headers, "Date"), isUnread: labels.includes("UNREAD"), isStarred: labels.includes("STARRED"), hasAttachment: hasAttachment(message.payload),
  };
}

function hasAttachment(part: GmailPart | undefined): boolean {
  return Boolean(part && ((typeof part.filename === "string" && part.filename.length > 0) || (part.parts || []).some((child) => hasAttachment(child))));
}

function parseRecipients(value: unknown, label: string) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,\n]/) : [];
  if (values.length > 20) throw new BadRequestException(`Tối đa 20 địa chỉ người nhận cho trường ${label}.`);
  const recipients = [...new Set(values.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean))];
  if (recipients.some((address) => address.length > 320 || !ADDRESS.test(address))) throw new BadRequestException(`Địa chỉ email trong trường ${label} không hợp lệ.`);
  return recipients;
}

function cleanText(value: unknown, label: string, maxLength: number, required = false) {
  if (typeof value !== "string") {
    if (required) throw new BadRequestException(`${label} là bắt buộc.`);
    return "";
  }
  const text = value.replace(/\0/g, "").trim();
  if (required && !text) throw new BadRequestException(`${label} là bắt buộc.`);
  if (text.length > maxLength) throw new BadRequestException(`${label} vượt quá ${maxLength} ký tự.`);
  return text;
}

function encodedSubject(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string) { return value.match(/.{1,76}/g)?.join("\r\n") || ""; }

function buildRawMessage(from: string, input: unknown) {
  const body = record(input);
  const to = parseRecipients(body.to, "To");
  const cc = parseRecipients(body.cc, "Cc");
  const bcc = parseRecipients(body.bcc, "Bcc");
  if (to.length + cc.length + bcc.length === 0) throw new BadRequestException("Cần ít nhất một địa chỉ người nhận.");
  if (to.length + cc.length + bcc.length > 20) throw new BadRequestException("Tổng số địa chỉ người nhận tối đa là 20.");
  const subject = cleanText(body.subject, "Tiêu đề", 998, true).replace(/[\r\n]/g, " ");
  const text = cleanText(body.body, "Nội dung thư", MAX_BODY_LENGTH, true);
  const headers = [`From: ${from}`, `To: ${to.join(", ")}`, ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []), ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []), `Subject: ${encodedSubject(subject)}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  const inReplyTo = typeof body.inReplyTo === "string" && /^<[^<>\r\n]{1,300}>$/.test(body.inReplyTo) ? body.inReplyTo : "";
  const references = typeof body.references === "string" ? body.references.split(/\s+/).filter((item) => /^<[^<>\r\n]{1,300}>$/.test(item)).slice(-20).join(" ") : "";
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  const encodedBody = wrapBase64(Buffer.from(text, "utf8").toString("base64"));
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${encodedBody}`, "utf8").toString("base64url");
  const threadId = typeof body.threadId === "string" && UUID_OR_GMAIL_ID.test(body.threadId) ? body.threadId : undefined;
  return { raw, ...(threadId ? { threadId } : {}) };
}

function runLimited<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await work(items[index]);
    }
  })).then(() => results);
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  private readonly client = new GmailClient();
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly refreshes = new Map<string, Promise<string>>();

  constructor(private readonly prisma: PrismaService, private readonly permissions: AdminPermissionService) {}

  async status() {
    const config = gmailConfig();
    const connection = await this.prisma.gmailConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, select: { id: true, email: true, status: true, scopes: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" } });
    return { configured: config.configured, missingConfiguration: config.missing, invalidConfiguration: config.invalid, encryptionConfigured: gmailEncryptionKeyConfigured(), redirectUri: config.redirectUri || null, requiredScopes: [GMAIL_MODIFY_SCOPE], connection: connection || null };
  }

  async startAuthorization(actor: AdminIdentity) {
    const config = gmailConfig();
    if (!config.configured) throw new ServiceUnavailableException(`Cấu hình Gmail chưa đủ: ${[...config.missing, ...config.invalid].join(", ")}.`);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const hash = createHash("sha256").update(state).digest("hex");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const now = new Date();
    await this.prisma.gmailOAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] } });
    await this.prisma.gmailOAuthState.create({ data: { stateHash: hash, adminId: actor.id, codeVerifier: verifier, expiresAt: new Date(now.getTime() + 10 * 60_000) } });
    this.logger.log(JSON.stringify({ event: "gmail.oauth.started", adminId: actor.id }));
    return { authorizationUrl: gmailAuthorizationUrl(config, state, challenge), expiresInSeconds: 600 };
  }

  async consumeAuthorizationDenial(stateInput: unknown) {
    const stateHash = this.hashState(stateInput);
    if (!stateHash) return false;
    const now = new Date();
    const consumed = await this.prisma.gmailOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) return false;
    const row = await this.prisma.gmailOAuthState.findUnique({ where: { stateHash }, select: { admin: { select: { isActive: true, role: true } } } });
    return Boolean(row?.admin.isActive && row.admin.role !== "CONTENT_EDITOR");
  }

  async completeAuthorization(stateInput: unknown, codeInput: unknown) {
    const stateHash = this.hashState(stateInput);
    const code = typeof codeInput === "string" ? codeInput.slice(0, 4096) : "";
    if (!stateHash || !code) throw new BadRequestException("Google OAuth callback thiếu code hoặc state hợp lệ.");
    const now = new Date();
    const consumed = await this.prisma.gmailOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new ConflictException("Yêu cầu kết nối Gmail đã hết hạn hoặc đã được dùng. Hãy bắt đầu kết nối lại.");
    const oauthState = await this.prisma.gmailOAuthState.findUnique({ where: { stateHash }, select: { adminId: true, codeVerifier: true, admin: { select: { isActive: true, role: true, email: true, displayName: true } } } });
    if (!oauthState) throw new ConflictException("Không xác định được admin đã khởi tạo kết nối Gmail.");
    if (!oauthState.admin.isActive) throw new ForbiddenException("Admin mở kết nối Gmail không còn hoạt động.");
    const callbackPermissions = await this.permissions.getEffectivePermissions({ id: oauthState.adminId, email: oauthState.admin.email, displayName: oauthState.admin.displayName, role: oauthState.admin.role });
    if (!callbackPermissions.includes("settings.manage")) throw new ForbiddenException("Admin mở kết nối Gmail không còn quyền quản lý Cài đặt.");
    const config = gmailConfig();
    if (!config.configured) throw new ConflictException("Cấu hình Gmail đã thay đổi trong lúc cấp quyền. Hãy kiểm tra cấu hình máy chủ rồi kết nối lại.");

    let token: Awaited<ReturnType<GmailClient["exchangeAuthorizationCode"]>>;
    try { token = await this.client.exchangeAuthorizationCode(code, oauthState.codeVerifier, config); }
    catch (error) { this.logger.warn(JSON.stringify({ event: "gmail.oauth.exchange_failed", code: safeProviderCode(error) })); throw this.mapProviderError(error, "Không đổi được mã OAuth Gmail."); }
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    if (!accessToken) throw new ServiceUnavailableException("Google không trả access token Gmail hợp lệ.");
    const grantedScopes = typeof token.scope === "string" ? token.scope.split(/\s+/).filter(Boolean) : [GMAIL_MODIFY_SCOPE];
    if (!grantedScopes.includes(GMAIL_MODIFY_SCOPE)) throw new ConflictException("Google chưa cấp quyền Gmail cần thiết. Hãy cấp quyền đọc, soạn và quản lý thư rồi thử lại.");
    let profile: Awaited<ReturnType<GmailClient["getProfile"]>>;
    try { profile = await this.client.getProfile(accessToken); }
    catch (error) { this.logger.warn(JSON.stringify({ event: "gmail.oauth.profile_failed", code: safeProviderCode(error) })); throw this.mapProviderError(error, "Không đọc được hồ sơ hộp thư Gmail."); }
    const email = typeof profile.emailAddress === "string" ? profile.emailAddress.trim().toLowerCase().slice(0, 320) : "";
    if (!ADDRESS.test(email)) throw new ConflictException("Gmail API không trả địa chỉ hộp thư hợp lệ.");

    const prior = await this.prisma.gmailConnection.findUnique({ where: { email }, select: { id: true, refreshTokenCiphertext: true } });
    const returnedRefreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
    const refreshToken = returnedRefreshToken || (prior?.refreshTokenCiphertext ? decryptGmailToken(prior.refreshTokenCiphertext) : "");
    if (!refreshToken) throw new ConflictException("Google không trả refresh token. Hãy thu hồi quyền GEME trong tài khoản Google rồi kết nối lại để cấp quyền ngoại tuyến.");

    await this.prisma.gmailConnection.updateMany({ where: { status: { not: "DISCONNECTED" }, email: { not: email } }, data: { status: "DISCONNECTED", refreshTokenCiphertext: "", disconnectedAt: now, lastErrorCode: null } });
    const connection = await this.prisma.gmailConnection.upsert({
      where: { email },
      create: { email, status: "ACTIVE", refreshTokenCiphertext: encryptGmailToken(refreshToken), scopes: grantedScopes, createdByAdminId: oauthState.adminId, disconnectedAt: null, lastErrorCode: null },
      update: { status: "ACTIVE", refreshTokenCiphertext: encryptGmailToken(refreshToken), scopes: grantedScopes, disconnectedAt: null, lastErrorCode: null },
      select: { id: true, email: true, status: true },
    });
    this.accessTokens.delete(connection.id);
    await this.recordAudit("gmail.connection.connected", oauthState.adminId, connection.id);
    this.logger.log(JSON.stringify({ event: "gmail.oauth.connected", adminId: oauthState.adminId, connectionId: connection.id }));
    return connection;
  }

  async callbackReturnUrl(outcome: "connected" | "error" | "denied") {
    return gmailCallbackReturnUrl(outcome);
  }

  async disconnect(actor: AdminIdentity) {
    const connection = await this.prisma.gmailConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, select: { id: true, email: true }, orderBy: { updatedAt: "desc" } });
    if (!connection) return { disconnected: true };
    await this.prisma.gmailConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", refreshTokenCiphertext: "", disconnectedAt: new Date(), lastErrorCode: null } });
    this.accessTokens.delete(connection.id);
    await this.recordAudit("gmail.connection.disconnected", actor.id, connection.id);
    this.logger.log(JSON.stringify({ event: "gmail.connection.disconnected", adminId: actor.id, connectionId: connection.id }));
    return { disconnected: true };
  }

  async labels() {
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest<{ labels?: Array<Record<string, unknown>> }>(accessToken, "/labels");
      return { labels: (result.labels || []).map((label) => ({ id: String(label.id || ""), name: String(label.name || ""), type: String(label.type || "user"), messagesTotal: Number(label.messagesTotal) || 0, messagesUnread: Number(label.messagesUnread) || 0 })).filter((label) => label.id && label.name) };
    } catch (error) { throw this.mapProviderError(error, "Không tải được nhãn Gmail.", connection); }
  }

  async listMessages(input: { folder?: unknown; q?: unknown; pageToken?: unknown; maxResults?: unknown; labelId?: unknown }) {
    const folder = typeof input.folder === "string" ? input.folder.trim().toLowerCase() : "inbox";
    if (!(folder in FOLDER_LABELS) && folder !== "all" && folder !== "label") throw new BadRequestException("Thư mục Gmail không hợp lệ.");
    const q = cleanText(input.q, "Từ khóa tìm kiếm", 250);
    const pageToken = cleanText(input.pageToken, "Mã trang", 2_000);
    const maxResults = input.maxResults === undefined ? 25 : Number(input.maxResults);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new BadRequestException("Số thư mỗi trang phải từ 1 đến 50.");
    const labelId = typeof input.labelId === "string" ? input.labelId.trim().slice(0, 200) : "";
    if (folder === "label" && !labelId) throw new BadRequestException("Thiếu mã nhãn Gmail.");
    const labelIds = folder === "label" ? [labelId] : FOLDER_LABELS[folder] || [];
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (q) params.set("q", q);
    if (pageToken) params.set("pageToken", pageToken);
    if (labelIds.length) labelIds.forEach((label) => params.append("labelIds", label));
    if (folder === "trash" || folder === "spam") params.set("includeSpamTrash", "true");
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest<{ messages?: Array<{ id?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(accessToken, `/messages?${params.toString()}`);
      const ids = (result.messages || []).map((message) => message.id).filter((id): id is string => Boolean(id && UUID_OR_GMAIL_ID.test(id)));
      const summaries = await runLimited(ids, 6, async (id) => {
        const details = await this.client.apiRequest<GmailMessageResource>(accessToken, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
        return messageSummary(details);
      });
      return { messages: summaries, nextPageToken: typeof result.nextPageToken === "string" ? result.nextPageToken : null, resultSizeEstimate: Number(result.resultSizeEstimate) || summaries.length };
    } catch (error) { throw this.mapProviderError(error, "Không tải được danh sách thư Gmail.", connection); }
  }

  async getMessage(idInput: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const message = await this.client.apiRequest<GmailMessageResource>(accessToken, `/messages/${encodeURIComponent(id)}?format=full`);
      const summary = messageSummary(message);
      const bodies = { text: "", html: "", attachments: [] as Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> };
      getBodyParts(message.payload, bodies);
      return { ...summary, bodyText: bodies.text || htmlToPlainText(bodies.html), attachments: bodies.attachments };
    } catch (error) { throw this.mapProviderError(error, "Không mở được thư Gmail.", connection); }
  }

  async modifyMessage(actor: AdminIdentity, idInput: unknown, input: unknown) {
    const id = this.validateGmailId(idInput);
    const body = record(input);
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];
    if (typeof body.isRead === "boolean") (body.isRead ? removeLabelIds : addLabelIds).push("UNREAD");
    if (typeof body.isStarred === "boolean") (body.isStarred ? addLabelIds : removeLabelIds).push("STARRED");
    if (!addLabelIds.length && !removeLabelIds.length) throw new BadRequestException("Cần chỉ định isRead hoặc isStarred.");
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest(accessToken, `/messages/${encodeURIComponent(id)}/modify`, "POST", { addLabelIds, removeLabelIds });
      await this.recordAudit("gmail.message.labels_updated", actor.id, connection.id);
      return messageSummary(result as GmailMessageResource);
    } catch (error) { throw this.mapProviderError(error, "Không cập nhật được thư Gmail.", connection); }
  }

  async trashMessage(actor: AdminIdentity, idInput: unknown, restore = false) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest(accessToken, `/messages/${encodeURIComponent(id)}/${restore ? "untrash" : "trash"}`, "POST", {});
      await this.recordAudit(restore ? "gmail.message.restored" : "gmail.message.trashed", actor.id, connection.id);
      return messageSummary(result as GmailMessageResource);
    } catch (error) { throw this.mapProviderError(error, restore ? "Không khôi phục được thư Gmail." : "Không chuyển được thư vào thùng rác.", connection); }
  }

  async archiveMessage(actor: AdminIdentity, idInput: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest(accessToken, `/messages/${encodeURIComponent(id)}/modify`, "POST", { removeLabelIds: ["INBOX"] });
      await this.recordAudit("gmail.message.archived", actor.id, connection.id);
      return messageSummary(result as GmailMessageResource);
    } catch (error) { throw this.mapProviderError(error, "Không lưu trữ được thư Gmail.", connection); }
  }

  async sendMessage(actor: AdminIdentity, input: unknown) {
    const { connection, accessToken } = await this.authorizedConnection();
    const rawMessage = buildRawMessage(connection.email, input);
    try {
      const result = await this.client.apiRequest<{ id?: string; threadId?: string; labelIds?: string[] }>(accessToken, "/messages/send", "POST", rawMessage);
      await this.recordAudit("gmail.message.sent", actor.id, connection.id);
      this.logger.log(JSON.stringify({ event: "gmail.message.sent", adminId: actor.id, connectionId: connection.id }));
      return { id: result.id || null, threadId: result.threadId || null, sent: true };
    } catch (error) { throw this.mapProviderError(error, "Không gửi được thư Gmail.", connection); }
  }

  async createDraft(actor: AdminIdentity, input: unknown) {
    const { connection, accessToken } = await this.authorizedConnection();
    const rawMessage = buildRawMessage(connection.email, input);
    try {
      const result = await this.client.apiRequest<{ id?: string; message?: GmailMessageResource }>(accessToken, "/drafts", "POST", { message: rawMessage });
      await this.recordAudit("gmail.draft.created", actor.id, connection.id);
      return { id: result.id || null, message: result.message ? messageSummary(result.message) : null };
    } catch (error) { throw this.mapProviderError(error, "Không lưu được thư nháp Gmail.", connection); }
  }

  async updateDraft(actor: AdminIdentity, idInput: unknown, input: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    const rawMessage = buildRawMessage(connection.email, input);
    try {
      const result = await this.client.apiRequest<{ id?: string; message?: GmailMessageResource }>(accessToken, `/drafts/${encodeURIComponent(id)}`, "PUT", { id, message: rawMessage });
      await this.recordAudit("gmail.draft.updated", actor.id, connection.id);
      return { draftId: result.id || id, message: result.message ? messageSummary(result.message) : null };
    } catch (error) { throw this.mapProviderError(error, "Không cập nhật được thư nháp Gmail.", connection); }
  }

  async listDrafts(input: { q?: unknown; pageToken?: unknown; maxResults?: unknown }) {
    const q = cleanText(input.q, "Từ khóa tìm kiếm", 250);
    const pageToken = cleanText(input.pageToken, "Mã trang", 2_000);
    const maxResults = input.maxResults === undefined ? 25 : Number(input.maxResults);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new BadRequestException("Số thư nháp mỗi trang phải từ 1 đến 50.");
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (q) params.set("q", q);
    if (pageToken) params.set("pageToken", pageToken);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest<{ drafts?: Array<{ id?: string; message?: { id?: string } }>; nextPageToken?: string; resultSizeEstimate?: number }>(accessToken, `/drafts?${params.toString()}`);
      const items = (result.drafts || []).filter((draft) => typeof draft.id === "string" && UUID_OR_GMAIL_ID.test(draft.id) && typeof draft.message?.id === "string" && UUID_OR_GMAIL_ID.test(draft.message.id));
      const drafts = await runLimited(items, 6, async (draft) => {
        const message = await this.client.apiRequest<GmailMessageResource>(accessToken, `/messages/${encodeURIComponent(draft.message!.id!)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
        return { draftId: draft.id, ...messageSummary(message) };
      });
      return { drafts, nextPageToken: typeof result.nextPageToken === "string" ? result.nextPageToken : null, resultSizeEstimate: Number(result.resultSizeEstimate) || drafts.length };
    } catch (error) { throw this.mapProviderError(error, "Không tải được thư nháp Gmail.", connection); }
  }

  async getDraft(idInput: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const draft = await this.client.apiRequest<{ id?: string; message?: GmailMessageResource }>(accessToken, `/drafts/${encodeURIComponent(id)}?format=full`);
      if (!draft.message) throw new NotFoundException("Không tìm thấy nội dung thư nháp Gmail.");
      const summary = messageSummary(draft.message);
      const bodies = { text: "", html: "", attachments: [] as Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> };
      getBodyParts(draft.message.payload, bodies);
      return { draftId: draft.id || id, ...summary, bodyText: bodies.text || htmlToPlainText(bodies.html), attachments: bodies.attachments };
    } catch (error) { throw this.mapProviderError(error, "Không mở được thư nháp Gmail.", connection); }
  }

  async sendDraft(actor: AdminIdentity, idInput: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      const result = await this.client.apiRequest<{ id?: string; threadId?: string }>(accessToken, "/drafts/send", "POST", { id });
      await this.recordAudit("gmail.draft.sent", actor.id, connection.id);
      this.logger.log(JSON.stringify({ event: "gmail.draft.sent", adminId: actor.id, connectionId: connection.id }));
      return { id: result.id || null, threadId: result.threadId || null, sent: true };
    } catch (error) { throw this.mapProviderError(error, "Không gửi được thư nháp Gmail.", connection); }
  }

  async deleteDraft(actor: AdminIdentity, idInput: unknown) {
    const id = this.validateGmailId(idInput);
    const { connection, accessToken } = await this.authorizedConnection();
    try {
      await this.client.apiRequest(accessToken, `/drafts/${encodeURIComponent(id)}`, "DELETE");
      await this.recordAudit("gmail.draft.deleted", actor.id, connection.id);
      return { deleted: true };
    } catch (error) { throw this.mapProviderError(error, "Không xóa được thư nháp Gmail.", connection); }
  }

  private hashState(input: unknown) {
    const state = typeof input === "string" ? input.slice(0, 256) : "";
    return state ? createHash("sha256").update(state).digest("hex") : "";
  }

  private validateGmailId(input: unknown) {
    const id = typeof input === "string" ? input.trim() : "";
    if (!UUID_OR_GMAIL_ID.test(id)) throw new BadRequestException("Mã thư Gmail không hợp lệ.");
    return id;
  }

  private async authorizedConnection(): Promise<{ connection: GmailConnectionRecord; accessToken: string }> {
    const connection = await this.prisma.gmailConnection.findFirst({ where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, select: { id: true, email: true, status: true, refreshTokenCiphertext: true, scopes: true } });
    if (!connection) throw new ServiceUnavailableException("Chưa kết nối hộp thư Gmail. Vào mục Gmail và bấm Kết nối.");
    if (!connection.scopes.includes(GMAIL_MODIFY_SCOPE)) throw new ServiceUnavailableException("Gmail chưa được cấp quyền đọc và quản lý thư. Hãy kết nối lại để cấp đúng quyền.");
    return { connection, accessToken: await this.accessTokenFor(connection) };
  }

  private async accessTokenFor(connection: GmailConnectionRecord) {
    const cached = this.accessTokens.get(connection.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const existing = this.refreshes.get(connection.id);
    if (existing) return existing;
    const work = this.refreshAccessToken(connection).finally(() => this.refreshes.delete(connection.id));
    this.refreshes.set(connection.id, work);
    return work;
  }

  private async refreshAccessToken(connection: GmailConnectionRecord) {
    const config = gmailConfig();
    if (!config.configured) throw new ServiceUnavailableException(`Gmail cần cấu hình máy chủ: ${[...config.missing, ...config.invalid].join(", ")}.`);
    let response: Awaited<ReturnType<GmailClient["refreshAccessToken"]>>;
    try { response = await this.client.refreshAccessToken(decryptGmailToken(connection.refreshTokenCiphertext), config); }
    catch (error) {
      const code = safeProviderCode(error);
      if (code === "INVALID_GRANT") await this.prisma.gmailConnection.update({ where: { id: connection.id }, data: { status: "REAUTH_REQUIRED", lastErrorCode: code } }).catch(() => undefined);
      this.logger.warn(JSON.stringify({ event: "gmail.token.refresh_failed", connectionId: connection.id, code }));
      throw this.mapProviderError(error, "Không làm mới được phiên truy cập Gmail.", connection);
    }
    const token = typeof response.access_token === "string" ? response.access_token : "";
    const expiresIn = Number(response.expires_in);
    if (!token || !Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 86_400) throw new ServiceUnavailableException("Google không trả access token hoặc thời hạn hợp lệ cho Gmail.");
    if (typeof response.refresh_token === "string" && response.refresh_token) {
      await this.prisma.gmailConnection.update({ where: { id: connection.id }, data: { refreshTokenCiphertext: encryptGmailToken(response.refresh_token), status: "ACTIVE", lastErrorCode: null } });
    }
    this.accessTokens.set(connection.id, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  private mapProviderError(error: unknown, fallback: string, connection?: { id: string }) {
    if (!(error instanceof GmailProviderError)) return error;
    if (error.code === "INVALID_GRANT" || error.status === 401) {
      if (connection) void this.prisma.gmailConnection.update({ where: { id: connection.id }, data: { status: "REAUTH_REQUIRED", lastErrorCode: error.code } }).catch(() => undefined);
      return new ServiceUnavailableException("Gmail cần cấp quyền lại. Hãy vào mục Gmail và chọn Kết nối lại.");
    }
    if (error.status === 403) return new ForbiddenException("Google từ chối thao tác Gmail. Kiểm tra scope đã cấp và trạng thái Gmail API trong Google Cloud.");
    if (error.status === 404) return new NotFoundException("Không tìm thấy thư hoặc nháp Gmail.");
    if (error.status === 400) return new BadRequestException("Gmail API từ chối dữ liệu yêu cầu. Kiểm tra email người nhận, nội dung thư hoặc mã thư.");
    if (error.retryable || error.status >= 500) return new ServiceUnavailableException("Gmail API đang bận hoặc không truy cập được. Thử lại sau ít phút.");
    this.logger.warn(JSON.stringify({ event: "gmail.provider.request_failed", code: error.code, status: error.status }));
    return new ServiceUnavailableException(fallback);
  }

  private async recordAudit(action: string, adminId: string, connectionId: string) {
    await this.prisma.auditLog.create({ data: { adminId, action, entityType: "gmail_connection", entityId: connectionId, after: { provider: "gmail" } satisfies Prisma.InputJsonValue } }).catch(() => {
      this.logger.warn(JSON.stringify({ event: "gmail.audit.write_failed", action, adminId, connectionId }));
    });
  }
}
