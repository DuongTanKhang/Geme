import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MediaAssetsService } from "../media/media-assets.service.js";
import { SocialPublishQueue } from "./social.queue.js";
import { aggregateSocialStatus, approvedSnapshotHash, normalizeSocialTargets, parseHoChiMinhSchedule, safeGEMEUrl, socialCommerceSnapshot, socialCommerceSnapshotHash, socialPayloadHash, unknownRetryEligible, type SocialPlatformName, type SocialTargetInput } from "./social.contract.js";
import { decryptMetaToken, encryptMetaToken, MetaRequestError, SocialMetaClient, socialMetaConfig } from "./social-meta.client.js";
import { loadActiveStorePromotions } from "../commerce/checkout-pricing.js";

const requiredScopes = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly meta = new SocialMetaClient();

  constructor(private readonly prisma: PrismaService, private readonly media: MediaAssetsService, private readonly queue: SocialPublishQueue) {}

  async status() {
    const [connections, counts] = await Promise.all([
      this.prisma.socialConnection.findMany({ where: { status: { not: "DISCONNECTED" } }, select: { id: true, displayName: true, status: true, scopes: true, accounts: { where: { active: true }, select: { id: true, platform: true, remoteAccountId: true, displayName: true, username: true, linkedPageId: true, selected: true } } }, orderBy: { updatedAt: "desc" } }),
      this.prisma.socialPost.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((item) => [item.status, item._count._all]));
    return {
      configured: socialMetaConfig().configured && this.encryptionConfigured(),
      metaConfigured: socialMetaConfig().configured,
      encryptionConfigured: this.encryptionConfigured(),
      permissionsRequired: requiredScopes,
      accounts: connections.flatMap((connection) => connection.accounts.map((account) => ({ ...account, connectionId: connection.id, connectionName: connection.displayName, connectionStatus: connection.status, scopes: connection.scopes, missingScopes: (account.platform === "INSTAGRAM" ? requiredScopes : requiredScopes.slice(0, 3)).filter((scope) => !connection.scopes.includes(scope)) }))),
      metrics: { drafts: byStatus.DRAFT || 0, scheduled: byStatus.SCHEDULED || 0, published: byStatus.PUBLISHED || 0, partial: byStatus.PARTIAL || 0, failed: byStatus.FAILED || 0, unknown: byStatus.UNKNOWN || 0 },
    };
  }

  async startOAuth(actor: AdminIdentity) {
    const config = socialMetaConfig();
    if (!config.configured) throw new ServiceUnavailableException("Meta OAuth chưa cấu hình đầy đủ ở server.");
    try { encryptMetaToken("configuration-check"); } catch { throw new ServiceUnavailableException("SOCIAL_META_ENCRYPTION_KEY chưa cấu hình đúng (cần khóa base64 32 byte). "); }
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    await this.prisma.socialOAuthState.create({ data: { stateHash, adminId: actor.id, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    await this.prisma.socialOAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] } });
    return { authorizationUrl: this.meta.authorizationUrl(state), expiresInSeconds: 600 };
  }

  async completeOAuth(stateInput: unknown, codeInput: unknown) {
    const state = typeof stateInput === "string" ? stateInput.slice(0, 256) : "";
    const code = typeof codeInput === "string" ? codeInput.slice(0, 4096) : "";
    if (!state || !code) throw new BadRequestException("Meta OAuth callback thiếu mã xác thực hoặc state.");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const now = new Date();
    const consumed = await this.prisma.socialOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new ConflictException("Meta OAuth state đã hết hạn hoặc đã được sử dụng. Hãy bắt đầu kết nối lại.");
    const oauthState = await this.prisma.socialOAuthState.findUnique({ where: { stateHash }, select: { adminId: true, admin: { select: { isActive: true, role: true } } } });
    if (!oauthState) throw new ConflictException("Không xác định được admin đã khởi tạo Meta OAuth.");
    if (!oauthState.admin.isActive || oauthState.admin.role === "CONTENT_EDITOR") throw new ConflictException("Admin đã khởi tạo kết nối không còn quyền quản trị hoạt động.");
    const result = await this.meta.completeOAuth(code);
    const missing = requiredScopes.filter((scope) => !result.scopes.includes(scope));
    if (!result.pages.length) throw new ConflictException("Tài khoản Meta chưa cấp quyền truy cập Facebook Page nào. Kiểm tra quyền và Page được chọn trong hộp thoại Meta.");
    const current = await this.prisma.socialConnection.findFirst({ where: { metaUserId: result.metaUserId, status: { not: "DISCONNECTED" } } });
    const connection = current
      ? await this.prisma.socialConnection.update({ where: { id: current.id }, data: { displayName: result.displayName, userTokenCiphertext: encryptMetaToken(result.userToken), userTokenExpiresAt: result.userTokenExpiresAt, scopes: result.scopes, status: "ACTIVE", disconnectedAt: null } })
      : await this.prisma.socialConnection.create({ data: { metaUserId: result.metaUserId, displayName: result.displayName, userTokenCiphertext: encryptMetaToken(result.userToken), userTokenExpiresAt: result.userTokenExpiresAt, scopes: result.scopes, createdByAdminId: oauthState.adminId } });
    await this.prisma.socialAccount.updateMany({ where: { connectionId: connection.id }, data: { active: false, selected: false } });
    for (const page of result.pages) {
      await this.prisma.socialAccount.upsert({
        where: { platform_remoteAccountId: { platform: "FACEBOOK_PAGE", remoteAccountId: page.id } },
        create: { connectionId: connection.id, platform: "FACEBOOK_PAGE", remoteAccountId: page.id, displayName: page.name, linkedPageId: page.id, accessTokenCiphertext: encryptMetaToken(page.accessToken), active: true },
        update: { connectionId: connection.id, displayName: page.name, linkedPageId: page.id, accessTokenCiphertext: encryptMetaToken(page.accessToken), active: true },
      });
      if (page.instagram?.id) {
        await this.prisma.socialAccount.upsert({
          where: { platform_remoteAccountId: { platform: "INSTAGRAM", remoteAccountId: page.instagram.id } },
          create: { connectionId: connection.id, platform: "INSTAGRAM", remoteAccountId: page.instagram.id, displayName: page.instagram.username ? `@${page.instagram.username}` : `Instagram ${page.instagram.id}`, username: page.instagram.username || null, linkedPageId: page.id, accessTokenCiphertext: encryptMetaToken(page.accessToken), active: true },
          update: { connectionId: connection.id, displayName: page.instagram.username ? `@${page.instagram.username}` : `Instagram ${page.instagram.id}`, username: page.instagram.username || null, linkedPageId: page.id, accessTokenCiphertext: encryptMetaToken(page.accessToken), active: true },
        });
      }
    }
    this.log("oauth.completed", oauthState.adminId, connection.id, { pageCount: result.pages.length, instagramCount: result.pages.filter((page) => page.instagram).length, missingPermissionCount: missing.length });
    return { connected: true, connectionId: connection.id, accountCount: result.pages.length + result.pages.filter((page) => page.instagram).length, missingPermissions: missing };
  }

  async oauthReturnUrl(outcome: "success" | "error") {
    const config = socialMetaConfig();
    if (!config.configured) return "/";
    const url = new URL(config.returnUrl);
    url.searchParams.set("socialMeta", outcome);
    return url.toString();
  }

  async selectAccounts(actor: AdminIdentity, accountIdsInput: unknown) {
    if (!Array.isArray(accountIdsInput) || accountIdsInput.length > 30 || accountIdsInput.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Danh sách tài khoản không hợp lệ.");
    const ids = [...new Set(accountIdsInput as string[])];
    const accounts = await this.prisma.socialAccount.findMany({ where: { id: { in: ids }, active: true, connection: { status: "ACTIVE" } }, select: { id: true } });
    if (accounts.length !== ids.length) throw new ConflictException("Một số tài khoản đã ngắt kết nối hoặc không còn khả dụng. Tải lại danh sách.");
    await this.prisma.$transaction([
      this.prisma.socialAccount.updateMany({ where: { active: true }, data: { selected: false } }),
      ...(ids.length ? [this.prisma.socialAccount.updateMany({ where: { id: { in: ids } }, data: { selected: true } })] : []),
    ]);
    this.log("accounts.selected", actor.id, "selection", { count: ids.length });
    return this.accounts();
  }

  async accounts() {
    return this.prisma.socialAccount.findMany({ where: { active: true, connection: { status: "ACTIVE" } }, select: { id: true, platform: true, remoteAccountId: true, displayName: true, username: true, linkedPageId: true, selected: true, connectionId: true, connection: { select: { displayName: true, status: true, scopes: true, userTokenExpiresAt: true } } }, orderBy: [{ platform: "asc" }, { displayName: "asc" }] });
  }

  async disconnect(actor: AdminIdentity, connectionId: string) {
    const connection = await this.prisma.socialConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true } });
    if (!connection) throw new NotFoundException("Không tìm thấy kết nối Meta.");
    await this.prisma.$transaction([
      this.prisma.socialConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", disconnectedAt: new Date(), userTokenCiphertext: "DISCONNECTED" } }),
      this.prisma.socialAccount.updateMany({ where: { connectionId }, data: { active: false, selected: false, accessTokenCiphertext: "DISCONNECTED" } }),
    ]);
    this.log("connection.disconnected", actor.id, connectionId, {});
    return { disconnected: true };
  }

  async products(searchInput?: string) {
    const search = typeof searchInput === "string" ? searchInput.trim().slice(0, 100) : "";
    const products = await this.prisma.product.findMany({
      where: { status: "ACTIVE", OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }], ...(search ? { AND: [{ OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] }] } : {}) },
      select: { id: true, sku: true, name: true, slug: true, price: true, originalPrice: true, stock: true, kind: true, category: { select: { name: true, status: true, pricingMode: true } }, gemstoneType: { select: { name: true, status: true } }, materialOption: { select: { name: true, active: true } }, variants: { select: { id: true, sku: true, optionKey: true, quality: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, originalPrice: true, stock: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, mediaAssets: { where: { tag: "PRODUCT_IMAGE", approvedAt: { not: null }, mediaAsset: { is: { isPrivate: false, storageProvider: "r2", objectKey: { not: null } } } }, select: { mediaAssetId: true, mediaAsset: { select: { id: true, filename: true, alt: true, mimeType: true, size: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } } }, orderBy: { createdAt: "desc" }, take: 12 } },
      orderBy: [{ isNew: "desc" }, { updatedAt: "desc" }], take: 50,
    });
    const promotions = await loadActiveStorePromotions(this.prisma);
    return products.map((product) => ({ id: product.id, sku: product.sku, name: product.name, slug: product.slug, productUrl: this.productUrl(product.slug), price: Number(product.price), stock: product.stock, hasVariants: product.variants.length > 0, variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, label: [variant.optionKey, variant.quality, variant.beadSize, variant.carat ? `${variant.carat} ct` : null, variant.gemstoneQuality].filter(Boolean).join(" · "), price: Number(variant.price), currentSalePrice: socialCommerceSnapshot(product, variant, promotions).saleUnitPrice, stock: variant.stock })), currentSalePrice: socialCommerceSnapshot(product, null, promotions).saleUnitPrice, category: product.category?.status === "ACTIVE" ? product.category.name : null, gemstone: product.gemstoneType?.status === "ACTIVE" ? product.gemstoneType.name : null, material: product.materialOption?.active ? product.materialOption.name : null, images: product.mediaAssets.map((link) => ({ id: link.mediaAssetId, filename: link.mediaAsset.filename, alt: link.mediaAsset.alt, mimeType: link.mediaAsset.mimeType, size: link.mediaAsset.size, url: this.media.publicDeliveryUrl({ ...link.mediaAsset, data: null, createdAt: new Date(), updatedAt: new Date() } as never) })).filter((image) => Boolean(image.url)) }));
  }

  async marketingDrafts() {
    return this.prisma.aiMarketingDraft.findMany({ where: { status: { in: ["DRAFT", "APPROVED"] } }, select: { id: true, status: true, channel: true, objective: true, title: true, caption: true, body: true, callToAction: true, hashtags: true, sourceProductIds: true, sourceFacts: true, factWarnings: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 50 });
  }

  async listPosts(statusInput?: string, searchInput?: string, limitInput?: string, cursorInput?: string) {
    const allowed = ["DRAFT", "APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "UNKNOWN", "CANCELLED"];
    if (statusInput && !allowed.includes(statusInput)) throw new BadRequestException("Bộ lọc trạng thái không hợp lệ.");
    const search = typeof searchInput === "string" ? searchInput.trim().slice(0, 100) : "";
    const limit = Math.max(1, Math.min(100, Number.parseInt(limitInput || "25", 10) || 25));
    const cursor = cursorInput ? this.decodePostCursor(cursorInput) : null;
    const where: Prisma.SocialPostWhereInput = {
      ...(statusInput ? { status: statusInput as never } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { targets: { some: { caption: { contains: search, mode: "insensitive" } } } }, { sourceProduct: { is: { sku: { contains: search, mode: "insensitive" } } } }] } : {}),
      ...(cursor ? { AND: [{ OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] }] } : {}),
    };
    const posts = await this.prisma.socialPost.findMany({ where, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: { orderBy: { startedAt: "desc" }, take: 5 } }, orderBy: { createdAt: "asc" } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit + 1 });
    const hasMore = posts.length > limit;
    const items = posts.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map((post) => this.safePost(post)), nextCursor: hasMore && last ? this.encodePostCursor(last.updatedAt, last.id) : null, hasMore };
  }

  async calendar(fromInput?: string, toInput?: string, statusInput?: string) {
    if (!fromInput || !toInput || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(fromInput) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(toInput)) throw new BadRequestException("Khoảng thời gian lịch cần ISO 8601 UTC.");
    const from = new Date(fromInput || "");
    const to = new Date(toInput || "");
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 93 * 86400_000) throw new BadRequestException("Khoảng thời gian lịch đăng không hợp lệ (tối đa 93 ngày).");
    const allowed = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "UNKNOWN"];
    if (statusInput && !allowed.includes(statusInput)) throw new BadRequestException("Bộ lọc lịch đăng không hợp lệ.");
    const targets = await this.prisma.socialPostTarget.findMany({
      where: { status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "UNKNOWN"] }, OR: [
        { status: { in: ["SCHEDULED", "PUBLISHING"] }, scheduledAt: { gte: from, lt: to } },
        { status: "PUBLISHED", publishedAt: { gte: from, lt: to } },
        { status: { in: ["FAILED", "UNKNOWN"] }, attempts: { some: { startedAt: { gte: from, lt: to } } } },
      ] }, select: { postId: true }, distinct: ["postId"], take: 250,
    });
    if (!targets.length) return [];
    const posts = await this.prisma.socialPost.findMany({ where: { id: { in: targets.map((target) => target.postId) } }, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: { orderBy: { startedAt: "desc" }, take: 10 } }, orderBy: { createdAt: "asc" } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
    return posts.filter((post) => !statusInput || post.status === statusInput).map((post) => this.safePost(post));
  }

  async getPost(id: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: { orderBy: { startedAt: "desc" }, take: 20 }, reconciliations: { include: { admin: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 20 } }, orderBy: { createdAt: "asc" } } } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    const safe = this.safePost(post);
    let commerceCurrent: Record<string, unknown> | null = null;
    if (post.sourceProductId) {
      try { commerceCurrent = await this.commerceSnapshot(this.prisma, post.sourceProductId, post.sourceProductVariantId); } catch { commerceCurrent = null; }
    }
    return { ...safe, commerceCurrent, commerceChanged: Boolean(post.approvedCommerceSnapshotHash && commerceCurrent && post.approvedCommerceSnapshotHash !== socialCommerceSnapshotHash(commerceCurrent)) };
  }

  async createPost(actor: AdminIdentity, body: unknown) {
    const input = this.normalizePostBody(body);
    const created = await this.prisma.$transaction(async (tx) => {
      const productId = this.optionalUuid(input.sourceProductId, "Sản phẩm");
      const variantId = this.optionalUuid(input.sourceProductVariantId, "Biến thể");
      const product = productId ? await this.validateSourceProduct(tx, productId, variantId) : null;
      if (variantId && !productId) throw new BadRequestException("Chọn sản phẩm trước khi chọn biến thể.");
      const context = await this.validateTargets(tx, this.resolveProductLinks(input.targets, product));
      const marketingDraftId = this.optionalUuid(input.sourceMarketingDraftId, "Bản nháp Marketing");
      if (marketingDraftId) {
        const draft = await tx.aiMarketingDraft.findUnique({ where: { id: marketingDraftId }, select: { id: true, status: true } });
        if (!draft || !["DRAFT", "APPROVED"].includes(draft.status)) throw new ConflictException("Bản nháp Marketing chưa sẵn sàng để dùng.");
      }
      const post = await tx.socialPost.create({ data: { title: input.title, createdByAdminId: actor.id, updatedByAdminId: actor.id, sourceProductId: productId, sourceProductVariantId: variantId, sourceMarketingDraftId: marketingDraftId, targets: { create: context.map((target) => ({ ...target })) } }, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: true } } } });
      return post;
    });
    this.log("post.created", actor.id, created.id, { targets: created.targets.length, hasProduct: Boolean(created.sourceProductId), hasMarketingDraft: Boolean(created.sourceMarketingDraftId) });
    return this.safePost(created);
  }

  async updatePost(actor: AdminIdentity, id: string, body: unknown) {
    const input = this.normalizePostBody(body);
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: true } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (!["DRAFT", "FAILED"].includes(post.status) || post.targets.some((target) => ["PUBLISHED", "PUBLISHING", "UNKNOWN"].includes(target.status))) throw new ConflictException("Chỉ được sửa bản nháp hoặc bài thất bại chưa có kết quả đăng không xác định.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const productId = this.optionalUuid(input.sourceProductId, "Sản phẩm");
      const variantId = this.optionalUuid(input.sourceProductVariantId, "Biến thể");
      const product = productId ? await this.validateSourceProduct(tx, productId, variantId) : null;
      if (variantId && !productId) throw new BadRequestException("Chọn sản phẩm trước khi chọn biến thể.");
      const context = await this.validateTargets(tx, this.resolveProductLinks(input.targets, product));
      const marketingDraftId = this.optionalUuid(input.sourceMarketingDraftId, "Bản nháp Marketing");
      if (marketingDraftId) {
        const draft = await tx.aiMarketingDraft.findUnique({ where: { id: marketingDraftId }, select: { id: true, status: true } });
        if (!draft || !["DRAFT", "APPROVED"].includes(draft.status)) throw new ConflictException("Bản nháp Marketing chưa sẵn sàng để dùng.");
      }
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, status: post.status }, data: { title: input.title, sourceProductId: productId, sourceProductVariantId: variantId, sourceMarketingDraftId: marketingDraftId, revision: { increment: 1 }, approvedRevision: null, approvedSnapshotHash: null, approvedCommerceSnapshot: Prisma.DbNull, approvedCommerceSnapshotHash: null, approvedAt: null, approvedByAdminId: null, approvedSnapshot: Prisma.DbNull, status: "DRAFT", lastErrorCode: null, updatedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Bản nháp vừa được cập nhật. Tải lại trước khi sửa tiếp.");
      const existing = await tx.socialPostTarget.findMany({ where: { postId: id }, include: { attempts: { select: { id: true } }, reconciliations: { select: { id: true } } } });
      const matched = new Set<string>();
      for (const target of context) {
        const old = existing.find((candidate) => !matched.has(candidate.id) && candidate.accountId === target.accountId && candidate.platform === target.platform);
        if (!old) { await tx.socialPostTarget.create({ data: { ...target, postId: id } }); continue; }
        matched.add(old.id);
        await tx.socialPostTarget.update({ where: { id: old.id }, data: { ...target, status: "DRAFT", approvedRevision: null, approvedPayloadHash: null, scheduledAt: null, nextAttemptAt: null, publishRequestedAt: null, remoteContainerId: null, remoteMediaId: null, permalink: null, publishedAt: null, reconciliationClaimedAt: null, reconciliationClaimedByAdminId: null, lastErrorCode: null } });
      }
      for (const old of existing.filter((candidate) => !matched.has(candidate.id))) {
        if (old.attempts.length || old.reconciliations.length) await tx.socialPostTarget.update({ where: { id: old.id }, data: { status: "CANCELLED", approvedRevision: null, approvedPayloadHash: null, scheduledAt: null, nextAttemptAt: null, publishRequestedAt: null } });
        else await tx.socialPostTarget.delete({ where: { id: old.id } });
      }
      return tx.socialPost.findUniqueOrThrow({ where: { id }, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: true } } } });
    });
    this.log("post.updated", actor.id, id, { revision: updated.revision, targets: updated.targets.length });
    return this.safePost(updated);
  }

  async approvePost(actor: AdminIdentity, id: string, body: unknown) {
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const scheduledAt = parseHoChiMinhSchedule(input.scheduledAt);
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: { include: { account: true, mediaAsset: true } } } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (!["DRAFT", "FAILED"].includes(post.status)) throw new ConflictException("Nội dung hiện không ở trạng thái có thể duyệt.");
    if (post.targets.some((target) => !target.accountId || !target.account || !target.account.active || !target.account.selected)) throw new ConflictException("Chọn rõ ràng và kết nối tài khoản đích trước khi duyệt.");
    if (post.sourceProductId) {
      const source = await this.validateSourceProduct(this.prisma, post.sourceProductId, post.sourceProductVariantId);
      if (source.variants.length && !post.sourceProductVariantId) throw new ConflictException("Sản phẩm có nhiều biến thể. Chọn đúng biến thể cần quảng bá trước khi duyệt.");
      if (post.sourceProductVariantId && source.variants.find((variant) => variant.id === post.sourceProductVariantId)?.stock <= 0) throw new ConflictException("Biến thể được chọn hiện đã hết hàng. Chọn một biến thể còn hàng trước khi duyệt.");
      if (input.commerceReviewed !== true) throw new ConflictException("Rà soát giá bán/khuyến mãi hiện tại và nội dung caption, rồi xác nhận trước khi duyệt.");
    }
    for (const target of post.targets) await this.validateTargetMedia(target.platform, target.mediaAsset);
    const snapshots = post.targets.map((target) => ({ accountId: target.accountId!, platform: target.platform, caption: target.caption, linkUrl: target.linkUrl, linkSource: target.linkSource, mediaAssetId: target.mediaAssetId }));
    const snapshotHash = approvedSnapshotHash(snapshots);
    const status = scheduledAt ? "SCHEDULED" : "APPROVED";
    const updated = await this.prisma.$transaction(async (tx) => {
      const commerceSnapshot = post.sourceProductId ? await this.commerceSnapshot(tx, post.sourceProductId, post.sourceProductVariantId) : null;
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, status: { in: ["DRAFT", "FAILED"] } }, data: { status, approvedRevision: post.revision, approvedSnapshotHash: snapshotHash, approvedSnapshot: snapshots as unknown as Prisma.InputJsonValue, approvedCommerceSnapshot: commerceSnapshot ? commerceSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull, approvedCommerceSnapshotHash: commerceSnapshot ? socialCommerceSnapshotHash(commerceSnapshot) : null, approvedAt: new Date(), approvedByAdminId: actor.id, updatedByAdminId: actor.id, lastErrorCode: null } });
      if (claimed.count !== 1) throw new ConflictException("Nội dung vừa được sửa hoặc duyệt. Tải lại trước khi tiếp tục.");
      for (const target of post.targets) {
        const updatedTarget = await tx.socialPostTarget.updateMany({ where: { id: target.id, status: { in: ["DRAFT", "FAILED"] } }, data: { status, approvedRevision: post.revision, approvedPayloadHash: socialPayloadHash({ accountId: target.accountId, platform: target.platform, caption: target.caption, linkUrl: target.linkUrl, linkSource: target.linkSource, mediaAssetId: target.mediaAssetId }), scheduledAt, publishRequestedAt: scheduledAt, nextAttemptAt: scheduledAt, lastErrorCode: null } });
        if (updatedTarget.count !== 1) throw new ConflictException("Một kênh vừa được cập nhật. Tải lại bản nháp.");
      }
      return tx.socialPost.findUniqueOrThrow({ where: { id }, include: { sourceProduct: { select: { id: true, sku: true, name: true, slug: true } }, targets: { include: { account: { select: { id: true, platform: true, displayName: true, username: true, active: true } }, mediaAsset: { select: { id: true, filename: true, alt: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true } }, attempts: true } } } });
    });
    if (scheduledAt) await this.enqueueTargets(updated.targets, updated.revision);
    this.log("post.approved", actor.id, id, { revision: post.revision, scheduled: Boolean(scheduledAt), targetCount: post.targets.length });
    return this.safePost(updated);
  }

  async publishNow(actor: AdminIdentity, id: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: true } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (post.status !== "APPROVED" || post.approvedRevision !== post.revision) throw new ConflictException("Duyệt nội dung hiện hành trước khi đăng ngay.");
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, approvedRevision: post.revision, status: "APPROVED" }, data: { status: "SCHEDULED", updatedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Bài đăng vừa được cập nhật. Tải lại trước khi đăng.");
      await tx.socialPostTarget.updateMany({ where: { postId: id, status: "APPROVED" }, data: { status: "SCHEDULED", scheduledAt: now, nextAttemptAt: now, publishRequestedAt: now } });
      return tx.socialPost.findUniqueOrThrow({ where: { id }, include: { targets: true } });
    });
    await this.enqueueTargets(updated.targets, updated.revision);
    this.log("post.publish_requested", actor.id, id, { revision: post.revision, targets: updated.targets.length });
    return this.getPost(id);
  }

  async retryFailed(actor: AdminIdentity, id: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: true } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (post.targets.some((target) => target.status === "UNKNOWN")) throw new ConflictException("Bài có kênh UNKNOWN. Đối soát từng kênh trước khi thử lại bất kỳ kênh nào.");
    const failed = post.targets.filter((target) => target.status === "FAILED" && target.approvedRevision === post.revision);
    if (!failed.length) throw new ConflictException("Không có kênh thất bại nào có thể thử lại. Kết quả UNKNOWN cần được kiểm tra thủ công trước.");
    if (failed.some((target) => ["SOCIAL_PRICE_CHANGED_AFTER_APPROVAL", "SOCIAL_PRICE_REVIEW_REQUIRED", "SOCIAL_PRODUCT_VARIANT_UNAVAILABLE"].includes(target.lastErrorCode || ""))) throw new ConflictException("Dữ kiện sản phẩm/giá đã thay đổi. Chỉnh sửa và duyệt lại revision trước khi gửi tiếp.");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, approvedRevision: post.revision, status: { in: ["FAILED", "PARTIAL"] } }, data: { status: "SCHEDULED", lastErrorCode: null, updatedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Bài đăng vừa thay đổi. Tải lại trước khi thử lại.");
      const updated = await tx.socialPostTarget.updateMany({ where: { id: { in: failed.map((target) => target.id) }, status: "FAILED", approvedRevision: post.revision }, data: { status: "SCHEDULED", scheduledAt: now, nextAttemptAt: now, publishRequestedAt: now, lastErrorCode: null } });
      if (updated.count !== failed.length) throw new ConflictException("Một số kênh vừa được cập nhật. Tải lại trạng thái.");
    });
    await this.enqueueTargets(failed.map((target) => ({ ...target, status: "SCHEDULED", nextAttemptAt: now })), post.revision);
    this.log("post.failed_targets_retried", actor.id, id, { failedTargetCount: failed.length });
    return this.getPost(id);
  }

  async verifyUnknownTarget(actor: AdminIdentity, postId: string, targetId: string) {
    const target = await this.claimUnknownTarget(actor, postId, targetId);
    const account = target.account;
    if (!account) throw new ConflictException("Tài khoản đích không còn tồn tại.");
    let result: { decision: "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "UNRESOLVED"; remoteId: string | null; permalink: string | null; publishedAt: Date | null; code: string };
    try {
      const token = decryptMetaToken(account.accessTokenCiphertext);
      result = target.platform === "INSTAGRAM"
        ? await this.meta.reconcileInstagram({ instagramId: account.remoteAccountId, token, containerId: target.remoteContainerId, mediaId: target.remoteMediaId })
        : await this.meta.reconcileFacebook({ pageId: account.remoteAccountId, token, mediaId: target.remoteMediaId });
    } catch (error) {
      result = { decision: "UNRESOLVED", remoteId: target.remoteMediaId || target.remoteContainerId, permalink: null, publishedAt: null, code: error instanceof MetaRequestError ? error.code : "META_VERIFY_FAILED" };
    }
    await this.finishReconciliation(target, actor, { ...result, source: "META_API", notes: null, evidenceReference: null });
    this.log("target.meta_reconciled", actor.id, targetId, { decision: result.decision, code: result.code, revision: target.post.revision });
    return this.getPost(postId);
  }

  async recordManualReconciliation(actor: AdminIdentity, postId: string, targetId: string, body: unknown) {
    const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const decision = row.decision;
    if (!["CONFIRMED_PUBLISHED", "CONFIRMED_NOT_PUBLISHED", "UNRESOLVED"].includes(String(decision))) throw new BadRequestException("Chọn kết quả đối soát hợp lệ.");
    const notes = typeof row.notes === "string" ? row.notes.trim() : "";
    const evidenceReference = typeof row.evidenceReference === "string" ? row.evidenceReference.trim() : "";
    if (notes.length < 5 || notes.length > 1200 || /<\/?[a-z][^>]*>/i.test(notes)) throw new BadRequestException("Ghi chú đối soát cần từ 5 đến 1.200 ký tự.");
    if (evidenceReference.length > 2000 || /<\/?[a-z][^>]*>/i.test(evidenceReference)) throw new BadRequestException("Thông tin tham chiếu bằng chứng tối đa 2.000 ký tự.");
    if (decision === "CONFIRMED_PUBLISHED" && !evidenceReference) throw new BadRequestException("Ghi lại nơi đã kiểm tra bài Meta trước khi xác nhận đã đăng.");
    const publishedAt = row.publishedAt == null || row.publishedAt === "" ? null : new Date(String(row.publishedAt));
    if (publishedAt && !Number.isFinite(publishedAt.getTime())) throw new BadRequestException("Thời gian đăng báo cáo không hợp lệ.");
    const target = await this.claimUnknownTarget(actor, postId, targetId);
    await this.finishReconciliation(target, actor, { decision: decision as "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "UNRESOLVED", remoteId: target.remoteMediaId || target.remoteContainerId, permalink: null, publishedAt, code: "MANUAL_RECONCILIATION", source: "MANUAL", notes, evidenceReference });
    this.log("target.manually_reconciled", actor.id, targetId, { decision, revision: target.post.revision });
    return this.getPost(postId);
  }

  async retryUnknownTarget(actor: AdminIdentity, postId: string, targetId: string, body: unknown) {
    const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (row.acknowledgeDuplicateRisk !== true) throw new BadRequestException("Cần xác nhận rõ nguy cơ bài bị đăng trùng trước khi tạo lần thử mới.");
    const now = new Date();
    const staleClaim = new Date(now.getTime() - 5 * 60_000);
    const queued = await this.prisma.$transaction(async (tx) => {
      const target = await tx.socialPostTarget.findUnique({ where: { id: targetId }, include: { post: true, reconciliations: { orderBy: { createdAt: "desc" }, take: 1 } } });
      if (!target || target.postId !== postId) throw new NotFoundException("Không tìm thấy kênh đăng cần đối soát.");
      if (target.reconciliationClaimedAt && target.reconciliationClaimedAt > staleClaim) throw new ConflictException("Một admin khác đang đối soát kênh này.");
      const latest = target.reconciliations[0];
      if (!unknownRetryEligible({ targetStatus: target.status, postRevision: target.post.revision, targetApprovedRevision: target.approvedRevision, postApprovedRevision: target.post.approvedRevision, latestDecision: latest?.decision || null, acknowledgeDuplicateRisk: true })) throw new ConflictException("Đối soát kênh trước. Chỉ kết quả chưa đăng hoặc chưa thể xác minh mới được xin thử lại.");
      const claim = await tx.socialPostTarget.updateMany({ where: { id: targetId, status: "UNKNOWN", approvedRevision: target.post.revision, OR: [{ reconciliationClaimedAt: null }, { reconciliationClaimedAt: { lt: staleClaim } }] }, data: { reconciliationClaimedAt: now, reconciliationClaimedByAdminId: actor.id } });
      if (claim.count !== 1) throw new ConflictException("Kênh vừa được một admin khác nhận xử lý.");
      const latestRevision = await tx.socialPost.findUnique({ where: { id: postId }, select: { revision: true, approvedRevision: true } });
      if (!latestRevision || latestRevision.revision !== target.post.revision || latestRevision.approvedRevision !== target.post.revision) throw new ConflictException("Bài đã thay đổi revision. Tải lại và duyệt lại trước khi thử.");
      await tx.socialTargetReconciliation.create({ data: { targetId, adminId: actor.id, revision: target.post.revision, decision: "RETRY_AUTHORIZED", source: "MANUAL", remoteIdQueried: target.remoteMediaId || target.remoteContainerId, resultCode: "DUPLICATE_RISK_ACKNOWLEDGED", notes: "Admin xác nhận rõ nguy cơ đăng trùng; không thay đổi caption đã duyệt." } });
      const updated = await tx.socialPostTarget.updateMany({ where: { id: targetId, status: "UNKNOWN", reconciliationClaimedByAdminId: actor.id }, data: { status: "SCHEDULED", scheduledAt: now, nextAttemptAt: now, publishRequestedAt: now, lastErrorCode: null, reconciliationClaimedAt: null, reconciliationClaimedByAdminId: null } });
      if (updated.count !== 1) throw new ConflictException("Kênh vừa thay đổi. Không tạo lần thử mới.");
      await tx.socialPost.update({ where: { id: postId }, data: { status: "SCHEDULED", lastErrorCode: null, updatedByAdminId: actor.id } });
      return { id: targetId, approvedRevision: target.post.revision, nextAttemptAt: now };
    });
    await this.queue.enqueue(queued.id, queued.approvedRevision, queued.nextAttemptAt);
    this.log("target.unknown_retry_authorized", actor.id, targetId, { postId, revision: queued.approvedRevision });
    return this.getPost(postId);
  }

  private async claimUnknownTarget(actor: AdminIdentity, postId: string, targetId: string) {
    const now = new Date();
    const staleClaim = new Date(now.getTime() - 5 * 60_000);
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.socialPostTarget.findUnique({ where: { id: targetId }, include: { post: true, account: { include: { connection: true } } } });
      if (!target || target.postId !== postId) throw new NotFoundException("Không tìm thấy kênh đăng cần đối soát.");
      if (target.status !== "UNKNOWN" || target.approvedRevision !== target.post.revision || target.post.approvedRevision !== target.post.revision) throw new ConflictException("Chỉ đối soát được kết quả UNKNOWN của revision đã duyệt.");
      if (!target.account || !target.account.active || target.account.accessTokenCiphertext === "DISCONNECTED" || target.account.connection.status !== "ACTIVE") throw new ConflictException("Tài khoản Meta không còn kết nối; ghi nhận kết quả kiểm tra thủ công.");
      const claimed = await tx.socialPostTarget.updateMany({ where: { id: targetId, status: "UNKNOWN", approvedRevision: target.post.revision, OR: [{ reconciliationClaimedAt: null }, { reconciliationClaimedAt: { lt: staleClaim } }] }, data: { reconciliationClaimedAt: now, reconciliationClaimedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Một admin khác đang đối soát kênh này. Tải lại sau.");
      return target;
    });
  }

  private async finishReconciliation(target: any, actor: AdminIdentity, result: { decision: "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "UNRESOLVED"; remoteId: string | null; permalink: string | null; publishedAt: Date | null; code: string; source: "META_API" | "MANUAL"; notes: string | null; evidenceReference: string | null }) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.socialPostTarget.findUnique({ where: { id: target.id }, include: { post: { select: { revision: true } } } });
      if (!current || current.status !== "UNKNOWN" || current.reconciliationClaimedByAdminId !== actor.id || current.approvedRevision !== target.post.revision || current.post.revision !== target.post.revision) throw new ConflictException("Kênh/revision vừa thay đổi; kết quả kiểm tra không được ghi đè.");
      await tx.socialTargetReconciliation.create({ data: { targetId: current.id, adminId: actor.id, revision: current.approvedRevision!, decision: result.decision, source: result.source, remoteIdQueried: result.remoteId, resultCode: result.code.slice(0, 80), notes: result.notes, evidenceReference: result.evidenceReference, publishedAtReported: result.publishedAt } });
      const confirmedMediaId = target.platform === "FACEBOOK_PAGE" || result.code === "META_MEDIA_CONFIRMED" ? result.remoteId : current.remoteMediaId;
      await tx.socialPostTarget.update({ where: { id: current.id }, data: { status: result.decision === "CONFIRMED_PUBLISHED" ? "PUBLISHED" : "UNKNOWN", ...(result.decision === "CONFIRMED_PUBLISHED" ? { publishedAt: result.publishedAt || new Date(), ...(result.source === "META_API" && result.permalink ? { permalink: result.permalink } : {}), ...(confirmedMediaId ? { remoteMediaId: confirmedMediaId } : {}) } : { lastErrorCode: result.code.slice(0, 80) }), publishRequestedAt: null, nextAttemptAt: null, reconciliationClaimedAt: null, reconciliationClaimedByAdminId: null } });
      const targets = await tx.socialPostTarget.findMany({ where: { postId: target.postId }, select: { status: true } });
      await tx.socialPost.update({ where: { id: target.postId }, data: { status: aggregateSocialStatus(targets.map((item) => item.status)) as never, lastErrorCode: result.decision === "UNRESOLVED" ? result.code.slice(0, 80) : null } });
    });
  }

  async cancel(actor: AdminIdentity, id: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: true } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (post.targets.some((target) => ["PUBLISHING", "UNKNOWN"].includes(target.status))) throw new ConflictException("Bài đang đăng hoặc chưa xác định kết quả bên Meta; không thể hủy an toàn.");
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, status: { in: ["DRAFT", "APPROVED", "SCHEDULED", "PARTIAL", "FAILED"] } }, data: { revision: { increment: 1 }, updatedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Nội dung vừa được cập nhật hoặc bắt đầu đăng. Tải lại trạng thái trước khi hủy.");
      await tx.socialPostTarget.updateMany({ where: { postId: id, status: { in: ["DRAFT", "APPROVED", "SCHEDULED", "FAILED"] } }, data: { status: "CANCELLED", publishRequestedAt: null, nextAttemptAt: null } });
      const targets = await tx.socialPostTarget.findMany({ where: { postId: id }, select: { status: true } });
      await tx.socialPost.update({ where: { id }, data: { status: aggregateSocialStatus(targets.map((target) => target.status)) as never, approvedRevision: null, approvedSnapshotHash: null, approvedCommerceSnapshot: Prisma.DbNull, approvedCommerceSnapshotHash: null, approvedAt: null, approvedByAdminId: null, approvedSnapshot: Prisma.DbNull } });
    });
    this.log("post.cancelled", actor.id, id, { revision: post.revision + 1 });
    return this.getPost(id);
  }

  async reschedule(actor: AdminIdentity, id: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id }, include: { targets: { select: { id: true, status: true } } } });
    if (!post) throw new NotFoundException("Không tìm thấy nội dung mạng xã hội.");
    if (post.status !== "SCHEDULED" || post.targets.some((target) => target.status !== "SCHEDULED")) throw new ConflictException("Chỉ đổi lịch khi tất cả kênh vẫn đang chờ đăng.");
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.socialPost.updateMany({ where: { id, revision: post.revision, status: "SCHEDULED" }, data: { revision: { increment: 1 }, status: "DRAFT", approvedRevision: null, approvedSnapshotHash: null, approvedCommerceSnapshot: Prisma.DbNull, approvedCommerceSnapshotHash: null, approvedAt: null, approvedByAdminId: null, approvedSnapshot: Prisma.DbNull, updatedByAdminId: actor.id } });
      if (claimed.count !== 1) throw new ConflictException("Lịch đăng vừa chạy hoặc đã thay đổi. Tải lại trước khi sửa.");
      await tx.socialPostTarget.updateMany({ where: { postId: id, status: "SCHEDULED" }, data: { status: "DRAFT", approvedRevision: null, approvedPayloadHash: null, scheduledAt: null, nextAttemptAt: null, publishRequestedAt: null } });
    });
    this.log("post.reschedule_invalidated_approval", actor.id, id, { revision: post.revision + 1 });
    return this.getPost(id);
  }

  private normalizePostBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Nội dung bài đăng không hợp lệ.");
    const row = body as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 180) : "";
    if (!title) throw new BadRequestException("Cần nhập tiêu đề nội bộ.");
    return { title, targets: normalizeSocialTargets(row.targets), sourceProductId: row.sourceProductId, sourceProductVariantId: row.sourceProductVariantId, sourceMarketingDraftId: row.sourceMarketingDraftId };
  }

  private encodePostCursor(updatedAt: Date, id: string) {
    return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), "utf8").toString("base64url");
  }

  private decodePostCursor(value: string) {
    if (value.length > 512) throw new BadRequestException("Con trỏ trang không hợp lệ.");
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
      const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt) : new Date(NaN);
      if (!Number.isFinite(updatedAt.getTime()) || typeof parsed.id !== "string" || !UUID.test(parsed.id)) throw new Error("invalid cursor");
      return { updatedAt, id: parsed.id };
    } catch { throw new BadRequestException("Con trỏ trang không hợp lệ. Hãy tải lại danh sách."); }
  }

  private productUrl(slug: string) {
    const configured = process.env.GEME_SITE_URL?.trim();
    if (!configured) throw new ServiceUnavailableException("GEME_SITE_URL chưa được cấu hình trên API.");
    let base: URL;
    try { base = new URL(configured); } catch { throw new ServiceUnavailableException("GEME_SITE_URL chưa hợp lệ."); }
    if (base.protocol !== "https:") throw new ServiceUnavailableException("GEME_SITE_URL phải dùng HTTPS.");
    return new URL(`/san-pham/${encodeURIComponent(slug)}`, base).toString();
  }

  private resolveProductLinks(targets: SocialTargetInput[], product: { slug: string } | null) {
    return targets.map((target) => {
      if (target.linkSource === "PRODUCT") {
        if (!product) throw new BadRequestException("Liên kết tự sinh cần gắn với một sản phẩm GEME.");
        return { ...target, linkUrl: this.productUrl(product.slug) };
      }
      return target.linkSource === "NONE" ? { ...target, linkUrl: null } : target;
    });
  }

  private async commerceSnapshot(client: any, productId: string, variantId: string | null) {
    const product = await client.product.findUnique({ where: { id: productId }, select: { id: true, sku: true, name: true, price: true, originalPrice: true, kind: true, categoryId: true, gemstoneTypeId: true, category: { select: { pricingMode: true } }, variants: { select: { id: true, sku: true, price: true, originalPrice: true, carat: true, stock: true } } } });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm nguồn.");
    const variant = variantId ? product.variants.find((item: { id: string }) => item.id === variantId) : null;
    if (variantId && !variant) throw new ConflictException("Biến thể đã chọn không còn thuộc sản phẩm.");
    if (product.variants.length && !variant) throw new ConflictException("Cần chọn biến thể cụ thể để lưu giá được duyệt.");
    const promotions = await loadActiveStorePromotions(client);
    return socialCommerceSnapshot(product, variant, promotions);
  }

  private optionalUuid(value: unknown, label: string) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} không hợp lệ.`);
    return value;
  }

  private async validateTargets(tx: Prisma.TransactionClient, targets: SocialTargetInput[]) {
    const result: Array<SocialTargetInput> = [];
    for (const target of targets) {
      const account = target.accountId ? await tx.socialAccount.findUnique({ where: { id: target.accountId }, select: { id: true, platform: true, active: true, selected: true, connection: { select: { status: true } } } }) : null;
      if (target.accountId && (!account || !account.active || !account.selected || account.connection.status !== "ACTIVE")) throw new ConflictException("Tài khoản đã chọn phải đang kết nối và được chọn trong mục Tài khoản.");
      if (account && account.platform !== target.platform) throw new BadRequestException("Kênh bài đăng không khớp với tài khoản đã chọn.");
      await this.validateTargetMedia(target.platform, target.mediaAssetId ? await tx.mediaAsset.findUnique({ where: { id: target.mediaAssetId } }) : null);
      result.push(target);
    }
    return result;
  }

  private async validateTargetMedia(platform: string, asset: { id: string; isPrivate: boolean; storageProvider: string; objectKey: string | null; mimeType?: string; size?: number } | null) {
    if (!asset) {
      if (platform === "INSTAGRAM") throw new BadRequestException("Instagram cần một ảnh sản phẩm đã duyệt.");
      return;
    }
    if (asset.isPrivate || asset.storageProvider !== "r2" || !asset.objectKey || !this.media.publicDeliveryUrl({ ...asset, sourceKey: null } as never)) throw new BadRequestException("Ảnh cần nằm trên CDN R2 công khai để Meta tải, không dùng URL tùy ý hoặc ảnh gốc riêng tư.");
    if (asset.mimeType && !["image/jpeg", "image/png"].includes(asset.mimeType)) throw new BadRequestException("Meta chỉ nhận ảnh JPEG hoặc PNG cho luồng đăng này.");
    if (platform === "INSTAGRAM" && asset.mimeType !== "image/jpeg") throw new BadRequestException("Instagram yêu cầu ảnh JPEG đã duyệt.");
    if (platform === "INSTAGRAM" && typeof asset.size === "number" && asset.size > 8 * 1024 * 1024) throw new BadRequestException("Ảnh Instagram phải nhỏ hơn hoặc bằng 8 MB.");
    const approvedOutput = await this.prisma.aiImageItem.findFirst({ where: { status: "APPROVED", qcStatus: "PASS", publishedAssetId: asset.id }, select: { id: true } });
    const approvedProductImage = await this.prisma.productMediaAsset.findFirst({ where: { mediaAssetId: asset.id, tag: "PRODUCT_IMAGE", approvedAt: { not: null } }, select: { id: true } });
    if (!approvedOutput && !approvedProductImage) throw new BadRequestException("Chỉ được đăng ảnh sản phẩm đã được duyệt và QC.");
  }

  private async validateSourceProduct(tx: any, productId: string, variantId: string | null = null) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, slug: true, status: true, stock: true, price: true, originalPrice: true, kind: true, categoryId: true, gemstoneTypeId: true, category: { select: { pricingMode: true } }, variants: { select: { id: true, sku: true, optionKey: true, quality: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, originalPrice: true, stock: true } } } });
    if (!product || product.status !== "ACTIVE" || !(product.stock > 0 || product.variants.some((variant) => variant.stock > 0))) throw new ConflictException("Sản phẩm nguồn phải đang hoạt động và còn hàng.");
    if (variantId && !product.variants.some((variant) => variant.id === variantId)) throw new ConflictException("Biến thể đã chọn không còn thuộc sản phẩm.");
    return product;
  }

  private async enqueueTargets(targets: Array<{ id: string; status: string; approvedRevision: number | null; nextAttemptAt?: Date | null }>, revision: number) {
    for (const target of targets) if (target.status === "SCHEDULED" && target.approvedRevision === revision) await this.queue.enqueue(target.id, revision, target.nextAttemptAt || new Date());
  }

  private safePost<T extends { targets: Array<Record<string, any>> }>(post: T) {
    return { ...post, targets: post.targets.map((target) => ({ ...target, previewUrl: target.mediaAsset ? this.media.publicDeliveryUrl({ ...target.mediaAsset, size: 0, data: null, createdAt: new Date(), updatedAt: new Date() } as never) : null, account: target.account ? { id: target.account.id, platform: target.account.platform, displayName: target.account.displayName, username: target.account.username, active: target.account.active } : undefined })) };
  }

  private encryptionConfigured() {
    const key = Buffer.from(process.env.SOCIAL_META_ENCRYPTION_KEY?.trim() || "", "base64");
    return key.length === 32;
  }

  private log(event: string, adminId: string, entityId: string, metadata: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event: `social.${event}`, adminId, entityId, ...metadata }));
    void this.prisma.auditLog.create({ data: { adminId, action: `SOCIAL_${event.replaceAll(".", "_").toUpperCase()}`.slice(0, 80), entityType: "SOCIAL", entityId: entityId.slice(0, 80), after: metadata as Prisma.InputJsonValue } }).catch(() => undefined);
  }
}
