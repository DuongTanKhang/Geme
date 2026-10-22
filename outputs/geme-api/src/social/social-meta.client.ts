import { createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type MetaPage = { id: string; name: string; accessToken: string; instagram?: { id: string; username?: string } | null };
export type MetaPublishResult = { containerId?: string; mediaId: string; permalink?: string | null };
export type MetaReconciliationResult = { decision: "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "UNRESOLVED"; remoteId: string | null; permalink: string | null; publishedAt: Date | null; code: string };

export class MetaRequestError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly unknownOutcome = false, readonly reauthRequired = false) {
    super(code);
  }
}

export function socialMetaConfig() {
  const appId = process.env.SOCIAL_META_APP_ID?.trim() || "";
  const appSecret = process.env.SOCIAL_META_APP_SECRET || "";
  const redirectUri = process.env.SOCIAL_META_REDIRECT_URI?.trim() || "";
  const graphVersion = process.env.SOCIAL_META_GRAPH_API_VERSION?.trim() || "";
  const returnUrl = process.env.SOCIAL_META_ADMIN_RETURN_URL?.trim() || "";
  const configured = Boolean(appId && appSecret && redirectUri && /^v\d+\.0$/.test(graphVersion) && returnUrl);
  if (!configured) return { configured: false as const, appId, appSecret, redirectUri, graphVersion, returnUrl };
  const callback = new URL(redirectUri);
  const adminReturn = new URL(returnUrl);
  if (process.env.NODE_ENV === "production" && (callback.protocol !== "https:" || adminReturn.protocol !== "https:")) {
    throw new Error("Meta OAuth and admin return URLs must use HTTPS in production.");
  }
  const allowedOrigins = new Set((process.env.SOCIAL_META_ADMIN_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (process.env.NODE_ENV === "production" && !allowedOrigins.size) throw new Error("SOCIAL_META_ADMIN_ORIGINS is required in production.");
  if (allowedOrigins.size && !allowedOrigins.has(adminReturn.origin)) throw new Error("SOCIAL_META_ADMIN_RETURN_URL origin is not in SOCIAL_META_ADMIN_ORIGINS.");
  return { configured: true as const, appId, appSecret, redirectUri, graphVersion, returnUrl };
}

function encryptionKey() {
  const value = process.env.SOCIAL_META_ENCRYPTION_KEY?.trim() || "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("SOCIAL_META_ENCRYPTION_KEY must be a base64 encoded 32-byte key.");
  return key;
}

export function encryptMetaToken(token: string) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptMetaToken(value: string) {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("META_TOKEN_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

type GraphErrorBody = { error?: { code?: number; error_subcode?: number; type?: string; is_transient?: boolean } };
type GraphData<T> = T & { error?: GraphErrorBody["error"] };

export class SocialMetaClient {
  private readonly config = socialMetaConfig();
  private graph(path: string) { return `https://graph.facebook.com/${this.config.graphVersion}/${path.replace(/^\//, "")}`; }

  authorizationUrl(state: string) {
    if (!this.config.configured) throw new Error("SOCIAL_META_NOT_CONFIGURED");
    const url = new URL(`https://www.facebook.com/${this.config.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"].join(","));
    return url.toString();
  }

  async completeOAuth(code: string) {
    if (!this.config.configured) throw new Error("SOCIAL_META_NOT_CONFIGURED");
    const short = await this.oauthToken({ code, redirect_uri: this.config.redirectUri });
    const long = await this.oauthToken({ grant_type: "fb_exchange_token", fb_exchange_token: short.access_token });
    const profile = await this.graphGet<{ id: string; name?: string }>("me", long.access_token, { fields: "id,name" });
    const pageResult = await this.graphGet<{ data: Array<{ id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }> }>("me/accounts", long.access_token, {
      fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100",
    });
    const permissions = await this.graphGet<{ data: Array<{ permission: string; status: string }> }>("me/permissions", long.access_token);
    return {
      metaUserId: profile.id,
      displayName: (profile.name || "Meta account").slice(0, 180),
      userToken: long.access_token,
      userTokenExpiresAt: long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000) : null,
      scopes: (permissions.data || []).filter((item) => item.status === "granted").map((item) => item.permission).filter((item) => ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"].includes(item)),
      pages: (pageResult.data || []).filter((page) => page.id && page.access_token).map((page) => ({ id: page.id, name: (page.name || "Facebook Page").slice(0, 180), accessToken: page.access_token!, instagram: page.instagram_business_account || null })) as MetaPage[],
    };
  }

  async publishFacebook(input: { pageId: string; token: string; caption: string; linkUrl: string | null; imageUrl: string | null }): Promise<MetaPublishResult> {
    if (input.imageUrl) {
      const data = await this.graphPost<{ id?: string; post_id?: string }>(`${input.pageId}/photos`, input.token, {
        url: input.imageUrl, caption: input.linkUrl ? `${input.caption}\n\n${input.linkUrl}` : input.caption, published: "true",
      }, true);
      if (!data.id && !data.post_id) throw new MetaRequestError("META_PUBLISH_RESPONSE_INVALID", false, true);
      return { mediaId: data.post_id || data.id! };
    }
    const data = await this.graphPost<{ id?: string }>(`${input.pageId}/feed`, input.token, {
      message: input.caption, ...(input.linkUrl ? { link: input.linkUrl } : {}),
    }, true);
    if (!data.id) throw new MetaRequestError("META_PUBLISH_RESPONSE_INVALID", false, true);
    return { mediaId: data.id };
  }

  async publishInstagram(input: { instagramId: string; token: string; caption: string; imageUrl: string; onContainerCreated?: (containerId: string) => Promise<void> }): Promise<MetaPublishResult> {
    const container = await this.graphPost<{ id?: string }>(`${input.instagramId}/media`, input.token, { image_url: input.imageUrl, caption: input.caption });
    if (!container.id) throw new MetaRequestError("META_CONTAINER_RESPONSE_INVALID", false);
    const containerId = container.id;
    await input.onContainerCreated?.(containerId);
    let finished = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await this.graphGet<{ id: string; status_code?: string; status?: string }>(containerId, input.token, { fields: "id,status_code,status" });
      if (status.status_code === "FINISHED") { finished = true; break; }
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new MetaRequestError("META_IG_CONTAINER_NOT_READY", false);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!finished) throw new MetaRequestError("META_IG_CONTAINER_PROCESSING", true);
    const published = await this.graphPost<{ id?: string }>(`${input.instagramId}/media_publish`, input.token, { creation_id: containerId }, true);
    if (!published.id) throw new MetaRequestError("META_PUBLISH_RESPONSE_INVALID", false, true);
    return { containerId, mediaId: published.id };
  }

  async permalink(mediaId: string, token: string) {
    const result = await this.graphGet<{ permalink?: string }>(mediaId, token, { fields: "permalink" });
    return result.permalink || null;
  }

  async reconcileFacebook(input: { pageId: string; token: string; mediaId: string | null }): Promise<MetaReconciliationResult> {
    if (!input.mediaId) return { decision: "UNRESOLVED", remoteId: null, permalink: null, publishedAt: null, code: "REMOTE_ID_MISSING" };
    try {
      const result = await this.graphGet<{ id?: string; from?: { id?: string }; permalink_url?: string; created_time?: string }>(input.mediaId, input.token, { fields: "id,from{id},permalink_url,created_time" });
      if (result.id !== input.mediaId || result.from?.id !== input.pageId) return { decision: "UNRESOLVED", remoteId: result.id || null, permalink: null, publishedAt: null, code: "META_TARGET_MISMATCH" };
      return { decision: "CONFIRMED_PUBLISHED", remoteId: result.id, permalink: result.permalink_url || null, publishedAt: result.created_time && Number.isFinite(Date.parse(result.created_time)) ? new Date(result.created_time) : null, code: "META_POST_CONFIRMED" };
    } catch (error) {
      return { decision: "UNRESOLVED", remoteId: input.mediaId, permalink: null, publishedAt: null, code: error instanceof MetaRequestError ? error.code : "META_VERIFY_FAILED" };
    }
  }

  async reconcileInstagram(input: { instagramId: string; token: string; containerId: string | null; mediaId: string | null }): Promise<MetaReconciliationResult> {
    if (!input.containerId && !input.mediaId) return { decision: "UNRESOLVED", remoteId: null, permalink: null, publishedAt: null, code: "REMOTE_ID_MISSING" };
    try {
      const account = await this.graphGet<{ id?: string }>(input.instagramId, input.token, { fields: "id" });
      if (account.id !== input.instagramId) return { decision: "UNRESOLVED", remoteId: null, permalink: null, publishedAt: null, code: "META_TARGET_MISMATCH" };
      if (input.mediaId) {
        const media = await this.graphGet<{ id?: string; owner?: { id?: string }; permalink?: string; timestamp?: string }>(input.mediaId, input.token, { fields: "id,owner,permalink,timestamp" });
        if (media.id === input.mediaId && media.owner?.id === input.instagramId) return { decision: "CONFIRMED_PUBLISHED", remoteId: media.id, permalink: media.permalink || null, publishedAt: media.timestamp && Number.isFinite(Date.parse(media.timestamp)) ? new Date(media.timestamp) : null, code: "META_MEDIA_CONFIRMED" };
        return { decision: "UNRESOLVED", remoteId: media.id || input.mediaId, permalink: null, publishedAt: null, code: "META_TARGET_MISMATCH" };
      }
      const status = await this.graphGet<{ id?: string; status_code?: string; status?: string }>(input.containerId!, input.token, { fields: "id,status_code,status" });
      if (status.id !== input.containerId) return { decision: "UNRESOLVED", remoteId: status.id || null, permalink: null, publishedAt: null, code: "META_CONTAINER_MISMATCH" };
      if (status.status_code === "PUBLISHED") return { decision: "CONFIRMED_PUBLISHED", remoteId: status.id, permalink: null, publishedAt: null, code: "META_CONTAINER_PUBLISHED" };
      if (["FINISHED", "ERROR", "EXPIRED"].includes(status.status_code || "")) return { decision: "CONFIRMED_NOT_PUBLISHED", remoteId: status.id, permalink: null, publishedAt: null, code: `META_CONTAINER_${status.status_code}` };
      return { decision: "UNRESOLVED", remoteId: status.id, permalink: null, publishedAt: null, code: "META_CONTAINER_STATUS_UNRESOLVED" };
    } catch (error) {
      return { decision: "UNRESOLVED", remoteId: input.mediaId || input.containerId, permalink: null, publishedAt: null, code: error instanceof MetaRequestError ? error.code : "META_VERIFY_FAILED" };
    }
  }

  private async oauthToken(parameters: Record<string, string>) {
    const url = new URL(this.graph("oauth/access_token"));
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("client_secret", this.config.appSecret);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return this.request<{ access_token: string; expires_in?: number }>(url, undefined, false);
  }

  private async graphGet<T>(path: string, token: string, parameters: Record<string, string> = {}) {
    const url = new URL(this.graph(path));
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return this.request<T>(url, token, false);
  }

  private async graphPost<T>(path: string, token: string, parameters: Record<string, string>, publishing = false) {
    const url = new URL(this.graph(path));
    const body = new URLSearchParams(parameters);
    return this.request<T>(url, token, true, body, publishing);
  }

  private async request<T>(url: URL, token?: string, post = false, body?: URLSearchParams, publishing = false): Promise<T> {
    try {
      const response = await fetch(url, {
        method: post ? "POST" : "GET",
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(body ? { body } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const result = await response.json().catch(() => ({})) as GraphData<T>;
      if (!response.ok || result.error) {
        const error = result.error;
        const code = typeof error?.code === "number" ? `META_GRAPH_${error.code}` : `META_HTTP_${response.status}`;
        const reauthRequired = error?.code === 190;
        const ambiguousPublish = publishing && response.status >= 500;
        const retryable = response.status === 429 || (response.status >= 500 && !publishing) || error?.is_transient === true;
        throw new MetaRequestError(code, retryable && !reauthRequired && !ambiguousPublish, ambiguousPublish, reauthRequired);
      }
      return result;
    } catch (error) {
      if (error instanceof MetaRequestError) throw error;
      const name = error instanceof Error ? error.name : "";
      // Once media_publish or a Page publish request was sent, a transport timeout
      // is ambiguous. Never repeat it automatically as Meta may already have posted.
      throw new MetaRequestError(name === "TimeoutError" || name === "AbortError" ? "META_REQUEST_TIMEOUT" : "META_NETWORK_UNAVAILABLE", false, publishing);
    }
  }
}
