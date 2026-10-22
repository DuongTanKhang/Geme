import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopeeSyncQueue } from "./shopee.queue.js";
import { decryptShopeeToken, encryptShopeeToken, encryptionKeyConfigured, ShopeeApiError, ShopeeClient, shopeeConfig, type ShopeeOrderDetail } from "./shopee.client.js";
import { chunk, createShopeeState, orderStatusCanAdvance, parseShopeeAmount, unixSecondsDate } from "./shopee.contract.js";

const CURSOR_OVERLAP_SECONDS = 300;
const MAX_TIME_RANGE_SECONDS = 14 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeCode(error: unknown) {
  if (error instanceof ShopeeApiError) return error.code;
  const raw = error instanceof Error ? error.message : "SHOPEE_SYNC_FAILED";
  return /^[A-Z0-9_]{3,80}$/.test(raw) ? raw : "SHOPEE_SYNC_FAILED";
}

function toIsoSeconds(seconds: number) { return new Date(seconds * 1000); }

@Injectable()
export class ShopeeService {
  private readonly logger = new Logger(ShopeeService.name);
  private readonly client = new ShopeeClient();

  constructor(private readonly prisma: PrismaService, private readonly queue: ShopeeSyncQueue) {}

  async status() {
    const config = shopeeConfig();
    const connections = await this.prisma.shopeeConnection.findMany({
      select: {
        id: true, environment: true, shopId: true, shopName: true, status: true,
        syncCursorAt: true, lastSyncStartedAt: true, lastSyncCompletedAt: true, lastErrorCode: true, createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return {
      configured: config.configured,
      partnerConfigured: Boolean(config.partnerId && config.partnerKey),
      encryptionConfigured: encryptionKeyConfigured(),
      environment: config.environment,
      redirectUri: config.redirectUri || null,
      initialSyncDays: config.initialSyncDays,
      pollIntervalMinutes: config.pollIntervalMinutes,
      connections,
      queue: await this.queue.summary().catch(() => ({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 })),
      readOnlyNotice: "Bản tích hợp chỉ đọc đơn Shopee; không sửa giá/tồn, không tạo vận đơn, không trừ tồn GEME và không đồng bộ sang POS365.",
    };
  }

  async startAuthorization(actor: AdminIdentity) {
    const config = shopeeConfig();
    if (!config.configured) throw new ServiceUnavailableException("Cần cấu hình SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_REDIRECT_URI và SHOPEE_TOKEN_ENCRYPTION_KEY ở backend.");
    let callback: URL;
    try { callback = new URL(config.redirectUri); } catch { throw new ServiceUnavailableException("SHOPEE_REDIRECT_URI không hợp lệ."); }
    if (callback.protocol !== "https:" && process.env.NODE_ENV === "production") throw new ServiceUnavailableException("SHOPEE_REDIRECT_URI phải dùng HTTPS trên production.");
    if (callback.pathname !== "/api/v1/shopee/callback") throw new ServiceUnavailableException("Callback phải trỏ chính xác đến /api/v1/shopee/callback.");
    const { value, hash } = createShopeeState();
    await this.prisma.shopeeOAuthState.create({ data: { stateHash: hash, adminId: actor.id, environment: config.environment, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    const staleConsumedAt = new Date(Date.now() - 24 * 60 * 60_000);
    await this.prisma.shopeeOAuthState.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { lt: staleConsumedAt } }] } });
    return { authorizationUrl: this.client.authorizationUrl(value), expiresInSeconds: 600 };
  }

  async completeAuthorization(stateInput: unknown, codeInput: unknown, shopIdInput: unknown) {
    const state = typeof stateInput === "string" ? stateInput.slice(0, 256) : "";
    const code = typeof codeInput === "string" ? codeInput.slice(0, 4096) : "";
    const shopId = typeof shopIdInput === "string" || typeof shopIdInput === "number" ? String(shopIdInput).slice(0, 40) : "";
    if (!state || !code || !/^\d{1,40}$/.test(shopId)) throw new BadRequestException("Shopee callback thiếu mã xác thực, shop_id hoặc state hợp lệ.");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const now = new Date();
    const consumed = await this.prisma.shopeeOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new ConflictException("Shopee state đã hết hạn hoặc đã được dùng. Hãy bắt đầu kết nối lại.");
    const oauthState = await this.prisma.shopeeOAuthState.findUnique({ where: { stateHash }, select: { adminId: true, environment: true, admin: { select: { isActive: true, role: true } } } });
    if (!oauthState) throw new ConflictException("Không xác định được admin đã bắt đầu kết nối Shopee.");
    if (!oauthState.admin.isActive || oauthState.admin.role === "CONTENT_EDITOR") throw new ForbiddenException("Admin mở kết nối không còn quyền quản trị hoạt động.");
    if (oauthState.environment !== shopeeConfig().environment) throw new ConflictException("Môi trường Shopee đã thay đổi trong lúc cấp quyền. Hãy bắt đầu lại.");

    let result: Awaited<ReturnType<ShopeeClient["exchangeAuthorizationCode"]>>;
    try { result = await this.client.exchangeAuthorizationCode(code, shopId); }
    catch (error) { this.logger.warn(JSON.stringify({ event: "shopee.oauth.exchange_failed", code: safeCode(error) })); throw error; }
    if (!result.access_token || !result.refresh_token) throw new ServiceUnavailableException("Shopee không trả về đủ access token và refresh token.");
    if (result.shop_id != null && String(result.shop_id) !== shopId) throw new ConflictException("Shop ID từ Shopee không khớp callback.");
    const nowAt = new Date();
    const connection = await this.prisma.shopeeConnection.upsert({
      where: { environment_shopId: { environment: oauthState.environment, shopId } },
      create: {
        environment: oauthState.environment, shopId, shopName: `Shopee Shop ${shopId}`, status: "ACTIVE",
        accessTokenCiphertext: encryptShopeeToken(result.access_token), refreshTokenCiphertext: encryptShopeeToken(result.refresh_token),
        accessTokenExpiresAt: new Date(nowAt.getTime() + Math.max(60, Number(result.expire_in) || 14_400) * 1000),
        refreshTokenExpiresAt: new Date(nowAt.getTime() + Math.max(60, Number(result.refresh_token_expire_in) || 2_592_000) * 1000),
        createdByAdminId: oauthState.adminId,
      },
      update: {
        status: "ACTIVE", disconnectedAt: null, lastErrorCode: null,
        accessTokenCiphertext: encryptShopeeToken(result.access_token), refreshTokenCiphertext: encryptShopeeToken(result.refresh_token),
        accessTokenExpiresAt: new Date(nowAt.getTime() + Math.max(60, Number(result.expire_in) || 14_400) * 1000),
        refreshTokenExpiresAt: new Date(nowAt.getTime() + Math.max(60, Number(result.refresh_token_expire_in) || 2_592_000) * 1000),
        refreshLeaseUntil: null,
      },
      select: { id: true, shopId: true, status: true },
    });
    this.logger.log(JSON.stringify({ event: "shopee.oauth.connected", connectionId: connection.id, environment: oauthState.environment }));
    return connection;
  }

  async callbackReturnUrl(result: "connected" | "error" | "denied") {
    const configured = shopeeConfig().adminReturnUrl;
    let target: URL;
    try { target = new URL(configured); } catch { target = new URL("/", "http://localhost:3001"); }
    target.searchParams.set("shopee", result);
    return target.toString();
  }

  async disconnect(connectionId: string) {
    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true } });
    if (!connection) throw new NotFoundException("Không tìm thấy kết nối Shopee.");
    if (connection.status === "DISCONNECTED") return { disconnected: true };
    await this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { status: "DISCONNECTED", disconnectedAt: new Date(), accessTokenCiphertext: "", refreshTokenCiphertext: "", refreshLeaseUntil: null, lastErrorCode: null } });
    this.logger.log(JSON.stringify({ event: "shopee.connection.disconnected", connectionId }));
    return { disconnected: true, localOnly: true };
  }

  async enqueueSync(connectionId: string, actor: AdminIdentity) {
    if (!UUID.test(connectionId)) throw new BadRequestException("ID kết nối không hợp lệ.");
    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true } });
    if (!connection || connection.status !== "ACTIVE") throw new NotFoundException("Không tìm thấy shop Shopee đang kết nối.");
    return this.queue.enqueue(connectionId, actor.id);
  }

  async retrySyncRun(runId: string, actor: AdminIdentity) {
    if (!UUID.test(runId)) throw new BadRequestException("ID tác vụ không hợp lệ.");
    const run = await this.prisma.shopeeSyncRun.findUnique({ where: { id: runId }, select: { id: true, connectionId: true, status: true } });
    if (!run) throw new NotFoundException("Không tìm thấy lịch sử đồng bộ.");
    if (run.status !== "FAILED") throw new ConflictException("Chỉ có thể thử lại tác vụ đồng bộ thất bại.");
    return this.queue.enqueue(run.connectionId, actor.id, run.id);
  }

  async syncHistory(limitInput?: string) {
    const limit = Math.max(1, Math.min(100, Number(limitInput) || 30));
    return this.prisma.shopeeSyncRun.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { connection: { select: { shopId: true, shopName: true, environment: true } } },
    });
  }

  async listOrders(query: { page?: string; limit?: string; status?: string; q?: string; from?: string; to?: string }) {
    const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const where: Prisma.ShopeeImportedOrderWhereInput = {};
    const status = query.status?.trim();
    if (status) where.status = status.slice(0, 40);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new BadRequestException("Khoảng ngày không hợp lệ.");
    if (from || to) where.createTime = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const q = query.q?.trim().slice(0, 120);
    if (q) where.OR = [
      { orderSn: { contains: q, mode: "insensitive" } },
      { items: { some: { OR: [{ itemName: { contains: q, mode: "insensitive" } }, { itemSku: { contains: q, mode: "insensitive" } }, { modelSku: { contains: q, mode: "insensitive" } }, { mappedSku: { contains: q, mode: "insensitive" } }] } } },
    ];
    const [total, items] = await Promise.all([
      this.prisma.shopeeImportedOrder.count({ where }),
      this.prisma.shopeeImportedOrder.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: [{ createTime: "desc" }, { id: "desc" }],
        select: { id: true, orderSn: true, status: true, currency: true, totalAmount: true, estimatedShippingFee: true, actualShippingFee: true, paymentMethod: true, shippingCarrier: true, createTime: true, shopeeUpdatedAt: true, payTime: true, recipientAddress: true, messageToSeller: true, connection: { select: { shopId: true, shopName: true, environment: true } }, items: { select: { id: true, itemId: true, modelId: true, itemName: true, itemSku: true, modelSku: true, quantity: true, unitPrice: true, variationDiscountedPrice: true, currency: true, mappedSku: true, mappedProductId: true, mappedVariantId: true } } },
      }),
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
  }

  async getOrder(id: string) {
    if (!UUID.test(id)) throw new BadRequestException("ID đơn không hợp lệ.");
    const order = await this.prisma.shopeeImportedOrder.findUnique({ where: { id }, include: { connection: { select: { shopId: true, shopName: true, environment: true } }, items: true, statusHistory: { orderBy: { observedAt: "desc" } } } });
    if (!order) throw new NotFoundException("Không tìm thấy đơn Shopee.");
    return order;
  }

  async unmatchedItems(limitInput?: string) {
    const limit = Math.max(1, Math.min(100, Number(limitInput) || 50));
    const rows = await this.prisma.shopeeImportedOrderItem.findMany({
      where: { mappedSku: null, order: { connection: { status: "ACTIVE" } } },
      distinct: ["itemId", "modelId", "orderId"],
      orderBy: { createdAt: "desc" }, take: Math.min(limit * 10, 1000),
      select: { id: true, itemId: true, modelId: true, itemName: true, itemSku: true, modelSku: true, order: { select: { orderSn: true, connectionId: true, connection: { select: { shopId: true } } } } },
    });
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.order.connectionId}:${row.itemId}:${row.modelId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit).map((row) => ({ ...row, connectionId: row.order.connectionId, shopId: row.order.connection.shopId }));
  }

  async searchCatalog(searchInput?: string) {
    const search = searchInput?.trim().slice(0, 80) || "";
    const where: Prisma.ProductWhereInput = { status: { not: "ARCHIVED" } };
    if (search) where.OR = [{ sku: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }, { variants: { some: { sku: { contains: search, mode: "insensitive" } } } }];
    const products = await this.prisma.product.findMany({ where, take: 50, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], select: { id: true, sku: true, name: true, status: true, variants: { where: { sku: { not: null } }, select: { id: true, sku: true, quality: true, shape: true, beadSize: true }, orderBy: { sortOrder: "asc" } } } });
    return products.flatMap((product) => [
      { productId: product.id, variantId: null, sku: product.sku, label: `${product.name} · ${product.sku}`, status: product.status },
      ...product.variants.filter((variant) => variant.sku).map((variant) => ({ productId: product.id, variantId: variant.id, sku: variant.sku!, label: `${product.name} · ${variant.quality}${variant.shape ? ` · ${variant.shape}` : ""}${variant.beadSize ? ` · ${variant.beadSize}` : ""} · ${variant.sku}`, status: product.status })),
    ]);
  }

  async mapItem(itemId: string, input: unknown) {
    if (!UUID.test(itemId)) throw new BadRequestException("ID dòng sản phẩm Shopee không hợp lệ.");
    const body = asRecord(input);
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
    const productId = typeof body?.productId === "string" ? body.productId : "";
    const variantId = typeof body?.variantId === "string" && body.variantId ? body.variantId : null;
    if (!UUID.test(connectionId) || !UUID.test(productId) || (variantId && !UUID.test(variantId))) throw new BadRequestException("Chọn một sản phẩm/biến thể GEME hợp lệ.");
    const row = await this.prisma.shopeeImportedOrderItem.findUnique({ where: { id: itemId }, select: { id: true, itemId: true, modelId: true, order: { select: { connectionId: true } } } });
    if (!row || row.order.connectionId !== connectionId) throw new NotFoundException("Không tìm thấy mặt hàng thuộc shop Shopee này.");
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, sku: true, status: true } });
    if (!product || product.status === "ARCHIVED") throw new BadRequestException("Sản phẩm GEME không còn khả dụng để ghép.");
    let sku = product.sku;
    if (variantId) {
      const variant = await this.prisma.productPriceVariant.findUnique({ where: { id: variantId }, select: { id: true, productId: true, sku: true } });
      if (!variant || variant.productId !== product.id || !variant.sku) throw new BadRequestException("Biến thể không thuộc sản phẩm đã chọn hoặc chưa có SKU.");
      sku = variant.sku;
    }
    const mapping = await this.prisma.shopeeItemMapping.upsert({
      where: { connectionId_itemId_modelId: { connectionId, itemId: row.itemId, modelId: row.modelId } },
      create: { connectionId, itemId: row.itemId, modelId: row.modelId, productId: product.id, variantId, sku },
      update: { productId: product.id, variantId, sku },
      select: { id: true, sku: true, productId: true, variantId: true },
    });
    await this.prisma.shopeeImportedOrderItem.updateMany({ where: { itemId: row.itemId, modelId: row.modelId, order: { connectionId } }, data: { mappingId: mapping.id, mappedSku: mapping.sku, mappedProductId: mapping.productId, mappedVariantId: mapping.variantId } });
    return mapping;
  }

  // Worker-only entry point; never called by website checkout, POS365 or shipping services.
  async processSync(connectionId: string, runId: string, signal?: AbortSignal) {
    const run = await this.prisma.shopeeSyncRun.findUnique({ where: { id: runId }, select: { id: true, connectionId: true } });
    if (!run || run.connectionId !== connectionId) throw new Error("SHOPEE_SYNC_RUN_NOT_FOUND");
    const startedAt = new Date();
    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.status !== "ACTIVE") {
      await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "SHOPEE_CONNECTION_INACTIVE" } });
      return;
    }
    await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt, finishedAt: null, errorCode: null } });
    await this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { lastSyncStartedAt: startedAt, lastErrorCode: null } });
    let ordersRead = 0;
    let ordersCreated = 0;
    let ordersUpdated = 0;
    try {
      let accessToken = await this.ensureAccessToken(connectionId);
      const startSeconds = connection.syncCursorAt
        ? Math.max(1, Math.floor(connection.syncCursorAt.getTime() / 1000) - CURSOR_OVERLAP_SECONDS)
        : Math.max(1, Math.floor(Date.now() / 1000) - shopeeConfig().initialSyncDays * 86_400);
      const endSeconds = Math.floor(Date.now() / 1000);
      await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { fromTime: toIsoSeconds(startSeconds), toTime: toIsoSeconds(endSeconds) } });
      let from = startSeconds;
      while (from <= endSeconds) {
        if (signal?.aborted) throw new Error("SHOPEE_SYNC_CANCELLED");
        const to = Math.min(endSeconds, from + MAX_TIME_RANGE_SECONDS - 1);
        const orderSns: string[] = [];
        let nextCursor: string | undefined;
        let pages = 0;
        do {
          const latest = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { status: true } });
          if (latest?.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
          const page = await this.client.getOrderList({ accessToken, shopId: connection.shopId, from, to, ...(nextCursor ? { cursor: nextCursor } : {}) });
          for (const item of page.order_list ?? []) if (item.order_sn) orderSns.push(String(item.order_sn));
          if (page.more && !page.next_cursor) throw new ShopeeApiError("SHOPEE_CURSOR_MISSING", true);
          nextCursor = page.more ? page.next_cursor : undefined;
          pages++;
          if (pages > 10_000) throw new Error("SHOPEE_PAGINATION_LIMIT");
        } while (nextCursor);
        for (const orderBatch of chunk([...new Set(orderSns)], 50)) {
          if (signal?.aborted) throw new Error("SHOPEE_SYNC_CANCELLED");
          accessToken = await this.ensureAccessToken(connectionId);
          const detailResponse = await this.client.getOrderDetails({ accessToken, shopId: connection.shopId, orderSnList: orderBatch });
          const details = detailResponse.order_list ?? [];
          ordersRead += details.length;
          for (const detail of details) {
            const result = await this.upsertOrder(connectionId, detail);
            if (result === "created") ordersCreated++;
            if (result === "updated") ordersUpdated++;
          }
          await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { ordersRead, ordersCreated, ordersUpdated } });
        }
        // Cursor advances only after every page and all details in the whole time window succeeded.
        await this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { syncCursorAt: toIsoSeconds(to) } });
        from = to + 1;
      }
      await this.prisma.$transaction([
        this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "SUCCEEDED", ordersRead, ordersCreated, ordersUpdated, finishedAt: new Date(), errorCode: null } }),
        this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { lastSyncCompletedAt: new Date(), lastErrorCode: null } }),
      ]);
      this.logger.log(JSON.stringify({ event: "shopee.sync.succeeded", connectionId, runId, ordersRead, ordersCreated, ordersUpdated }));
    } catch (error) {
      const code = safeCode(error);
      if (code === "SHOPEE_REAUTH_REQUIRED") await this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { status: "REAUTH_REQUIRED", lastErrorCode: code } });
      await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "RETRYING", ordersRead, ordersCreated, ordersUpdated, errorCode: code } });
      this.logger.warn(JSON.stringify({ event: "shopee.sync.attempt_failed", connectionId, runId, code, ordersRead }));
      throw error;
    }
  }

  private async ensureAccessToken(connectionId: string) {
    let connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
    if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decryptShopeeToken(connection.accessTokenCiphertext);

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const lease = await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }] }, data: { refreshLeaseUntil: leaseUntil } });
    if (lease.count !== 1) {
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
        if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
        if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decryptShopeeToken(connection.accessTokenCiphertext);
      }
      throw new ShopeeApiError("SHOPEE_TOKEN_REFRESH_BUSY", true);
    }

    try {
      connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
      if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
      const refreshToken = decryptShopeeToken(connection.refreshTokenCiphertext);
      const rotated = await this.client.refreshAccessToken(refreshToken, connection.shopId);
      if (!rotated.access_token || !rotated.refresh_token) throw new Error("SHOPEE_TOKEN_RESPONSE_INVALID");
      const refreshedAt = new Date();
      const accessTokenExpiresAt = new Date(refreshedAt.getTime() + Math.max(60, Number(rotated.expire_in) || 14_400) * 1000);
      const refreshTokenExpiresAt = new Date(refreshedAt.getTime() + Math.max(60, Number(rotated.refresh_token_expire_in) || 2_592_000) * 1000);
      // Persist both rotated credentials in one transaction before returning the new access token.
      await this.prisma.$transaction(async (tx) => {
        const update = await tx.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", refreshLeaseUntil: leaseUntil }, data: { accessTokenCiphertext: encryptShopeeToken(rotated.access_token!), refreshTokenCiphertext: encryptShopeeToken(rotated.refresh_token!), accessTokenExpiresAt, refreshTokenExpiresAt, refreshLeaseUntil: null } });
        if (update.count !== 1) throw new Error("SHOPEE_TOKEN_ROTATION_SAVE_FAILED");
      });
      return rotated.access_token;
    } catch (error) {
      await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, refreshLeaseUntil: leaseUntil }, data: { refreshLeaseUntil: null } }).catch(() => undefined);
      if (error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED") await this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { status: "REAUTH_REQUIRED", lastErrorCode: error.code } });
      throw error;
    }
  }

  private async upsertOrder(connectionId: string, detail: ShopeeOrderDetail): Promise<"created" | "updated" | "ignored"> {
    if (!detail.order_sn || !detail.order_status) return "ignored";
    const createdAt = unixSecondsDate(detail.create_time) ?? new Date();
    const updatedAt = unixSecondsDate(detail.update_time) ?? createdAt;
    const payTime = unixSecondsDate(detail.pay_time);
    const address = asRecord(detail.recipient_address);
    return this.prisma.$transaction(async (tx) => {
      const unique = { connectionId_orderSn: { connectionId, orderSn: detail.order_sn } };
      const existing = await tx.shopeeImportedOrder.findUnique({ where: unique, select: { id: true, status: true, shopeeUpdatedAt: true } });
      if (existing && !orderStatusCanAdvance(existing.shopeeUpdatedAt, updatedAt)) return "ignored";
      const data = {
        status: detail.order_status.slice(0, 40), currency: typeof detail.currency === "string" ? detail.currency.slice(0, 12) : null,
        totalAmount: parseShopeeAmount(detail.total_amount), estimatedShippingFee: parseShopeeAmount(detail.estimated_shipping_fee), actualShippingFee: parseShopeeAmount(detail.actual_shipping_fee),
        cod: typeof detail.cod === "boolean" ? detail.cod : null,
        paymentMethod: typeof detail.payment_method === "string" ? detail.payment_method.slice(0, 100) : null,
        shippingCarrier: typeof detail.shipping_carrier === "string" ? detail.shipping_carrier.slice(0, 120) : null,
        createTime: createdAt, shopeeUpdatedAt: updatedAt, payTime,
        recipientAddress: address ? address as Prisma.InputJsonValue : Prisma.DbNull,
        messageToSeller: typeof detail.message_to_seller === "string" ? detail.message_to_seller.slice(0, 4000) : null,
      };
      const order = existing
        ? await tx.shopeeImportedOrder.update({ where: { id: existing.id }, data })
        : await tx.shopeeImportedOrder.create({ data: { ...data, connectionId, orderSn: detail.order_sn } });
      if (!existing || existing.status !== data.status) {
        await tx.shopeeOrderStatusHistory.createMany({ data: [{ orderId: order.id, status: data.status, shopeeUpdatedAt: updatedAt }], skipDuplicates: true });
      }
      if (existing) await tx.shopeeImportedOrderItem.deleteMany({ where: { orderId: order.id } });
      const itemRows: Prisma.ShopeeImportedOrderItemCreateManyInput[] = [];
      for (const item of detail.item_list ?? []) {
        const itemId = item.item_id == null ? "" : String(item.item_id);
        const modelId = item.model_id == null ? "" : String(item.model_id);
        if (!itemId) continue;
        const mapping = await tx.shopeeItemMapping.findUnique({ where: { connectionId_itemId_modelId: { connectionId, itemId, modelId } }, select: { id: true, sku: true, productId: true, variantId: true } });
        const skuCandidates = [...new Set([item.model_sku, item.item_sku].filter((sku): sku is string => Boolean(sku?.trim())).map((sku) => sku.trim()))];
        let appliedMapping = mapping;
        if (!appliedMapping && skuCandidates.length) {
          const matches: Array<{ productId: string; variantId: string | null; sku: string }> = [];
          for (const sku of skuCandidates) {
            const [product, variants] = await Promise.all([
              tx.product.findMany({ where: { sku }, select: { id: true, sku: true }, take: 2 }),
              tx.productPriceVariant.findMany({ where: { sku }, select: { id: true, productId: true, sku: true }, take: 2 }),
            ]);
            matches.push(...product.map((match) => ({ productId: match.id, variantId: null, sku: match.sku })));
            matches.push(...variants.map((match) => ({ productId: match.productId, variantId: match.id, sku: match.sku || sku })));
          }
          const distinctMatches = [...new Map(matches.map((match) => [`${match.productId}:${match.variantId ?? ""}`, match])).values()];
          if (distinctMatches.length === 1) {
            const match = distinctMatches[0]!;
            appliedMapping = await tx.shopeeItemMapping.upsert({
              where: { connectionId_itemId_modelId: { connectionId, itemId, modelId } },
              create: { connectionId, itemId, modelId, productId: match.productId, variantId: match.variantId, sku: match.sku },
              update: {}, select: { id: true, sku: true, productId: true, variantId: true },
            });
          }
        }
        const itemName = (item.item_name || item.model_name || `Sản phẩm Shopee ${itemId}`).slice(0, 255);
        itemRows.push({
          orderId: order.id, itemId, modelId, itemName,
          itemSku: item.item_sku?.slice(0, 120) || null, modelSku: item.model_sku?.slice(0, 120) || null,
          quantity: Math.max(0, Math.min(1_000_000, Number(item.model_quantity_purchased) || 0)),
          unitPrice: parseShopeeAmount(item.item_price), variationDiscountedPrice: parseShopeeAmount(item.variation_discounted_price), currency: data.currency,
          mappingId: appliedMapping?.id ?? null, mappedSku: appliedMapping?.sku ?? null, mappedProductId: appliedMapping?.productId ?? null, mappedVariantId: appliedMapping?.variantId ?? null,
        });
      }
      if (itemRows.length) await tx.shopeeImportedOrderItem.createMany({ data: itemRows });
      return existing ? "updated" : "created";
    });
  }
}
