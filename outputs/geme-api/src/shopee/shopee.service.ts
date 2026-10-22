import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopeeSyncQueue } from "./shopee.queue.js";
import { decryptShopeeToken, encryptShopeeToken, ShopeeApiError, ShopeeClient, shopeeConfig, shopeeSafeConfig, type ShopeeOrderDetail } from "./shopee.client.js";
import { chunk, createShopeeState, orderStatusCanAdvance, parseShopeeAmount, shopeeTokenExpiry, unixSecondsDate, validateShopeeCursor, validateShopeeOrderDetails, validateShopeeOrderListPage } from "./shopee.contract.js";

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

function requiredTokenExpiry(value: unknown, now: Date) {
  const expiry = shopeeTokenExpiry(value, now.getTime());
  if (!expiry) throw new ShopeeApiError("SHOPEE_TOKEN_EXPIRY_INVALID", false);
  return expiry;
}

function optionalTokenExpiry(value: unknown, now: Date) {
  if (value === undefined || value === null || value === "") return null;
  const expiry = shopeeTokenExpiry(value, now.getTime());
  if (!expiry) throw new ShopeeApiError("SHOPEE_TOKEN_EXPIRY_INVALID", false);
  return expiry;
}

function toIsoSeconds(seconds: number) { return new Date(seconds * 1000); }

@Injectable()
export class ShopeeService {
  private readonly logger = new Logger(ShopeeService.name);
  private readonly client: ShopeeClient;

  constructor(private readonly prisma: PrismaService, private readonly queue: ShopeeSyncQueue) {
    this.client = new ShopeeClient(async (input, init) => {
      await this.queue.waitForApiSlot();
      return fetch(input, init);
    });
  }

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
      ...shopeeSafeConfig(config),
      missingConfiguration: config.missing,
      invalidConfiguration: config.invalid,
      connections,
      queue: await this.queue.summary(),
      readOnlyNotice: "Bản tích hợp chỉ đọc đơn Shopee; không sửa giá/tồn, không tạo vận đơn, không trừ tồn GEME và không đồng bộ sang POS365.",
    };
  }

  async startAuthorization(actor: AdminIdentity) {
    const config = shopeeConfig();
    if (!config.enabled) throw new ServiceUnavailableException("Tích hợp Shopee đang tắt. Đặt SHOPEE_ENABLED=true để bật.");
    if (config.configurationStatus !== "ready") throw new ServiceUnavailableException(`Cấu hình Shopee cần sửa: ${[...config.missing, ...config.invalid].join(", ") || "không xác định"}.`);
    const { value, hash } = createShopeeState();
    await this.prisma.shopeeOAuthState.create({ data: { stateHash: hash, adminId: actor.id, environment: config.environment, partnerId: config.partnerId, expiresAt: new Date(Date.now() + 10 * 60_000) } });
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
    const oauthState = await this.prisma.shopeeOAuthState.findUnique({ where: { stateHash }, select: { adminId: true, environment: true, partnerId: true, admin: { select: { isActive: true, role: true } } } });
    if (!oauthState) throw new ConflictException("Không xác định được admin đã bắt đầu kết nối Shopee.");
    if (!oauthState.admin.isActive || oauthState.admin.role === "CONTENT_EDITOR") throw new ForbiddenException("Admin mở kết nối không còn quyền quản trị hoạt động.");
    const config = shopeeConfig();
    if (!config.enabled || config.configurationStatus !== "ready" || oauthState.environment !== config.environment || oauthState.partnerId !== config.partnerId) throw new ConflictException("Ứng dụng hoặc môi trường Shopee đã thay đổi trong lúc cấp quyền. Hãy bắt đầu lại.");

    let result: Awaited<ReturnType<ShopeeClient["exchangeAuthorizationCode"]>>;
    try { result = await this.client.exchangeAuthorizationCode(code, shopId); }
    catch (error) { this.logger.warn(JSON.stringify({ event: "shopee.oauth.exchange_failed", code: safeCode(error) })); throw error; }
    if (typeof result.access_token !== "string" || !result.access_token.trim() || typeof result.refresh_token !== "string" || !result.refresh_token.trim()) throw new ServiceUnavailableException("Shopee không trả về đủ access token và refresh token.");
    if (result.shop_id != null && String(result.shop_id) !== shopId) throw new ConflictException("Shop ID từ Shopee không khớp callback.");
    const nowAt = new Date();
    const accessTokenExpiresAt = requiredTokenExpiry(result.expire_in, nowAt);
    const refreshTokenExpiresAt = optionalTokenExpiry(result.refresh_token_expire_in, nowAt);
    const connection = await this.prisma.shopeeConnection.upsert({
      where: { environment_shopId: { environment: oauthState.environment, shopId } },
      create: {
        environment: oauthState.environment, partnerId: oauthState.partnerId, shopId, shopName: null, status: "ACTIVE",
        accessTokenCiphertext: encryptShopeeToken(result.access_token), refreshTokenCiphertext: encryptShopeeToken(result.refresh_token),
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        createdByAdminId: oauthState.adminId,
      },
      update: {
        status: "ACTIVE", partnerId: oauthState.partnerId, disconnectedAt: null, lastErrorCode: null,
        accessTokenCiphertext: encryptShopeeToken(result.access_token), refreshTokenCiphertext: encryptShopeeToken(result.refresh_token),
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        refreshLeaseUntil: null,
      },
      select: { id: true, shopId: true, status: true },
    });
    this.logger.log(JSON.stringify({ event: "shopee.oauth.connected", connectionId: connection.id, environment: oauthState.environment }));
    return connection;
  }

  async callbackReturnUrl(result: "connected" | "error" | "denied"): Promise<string | null> {
    const config = shopeeConfig();
    let target: URL;
    try { target = new URL(config.adminReturnUrl); } catch { return null; }
    if (target.username || target.password || target.hash || (config.environment === "production" && target.protocol !== "https:")) return null;
    target.searchParams.set("shopee", result);
    return target.toString();
  }

  async consumeAuthorizationDenial(stateInput: unknown) {
    const config = shopeeConfig();
    const state = typeof stateInput === "string" ? stateInput.slice(0, 256) : "";
    if (!state) return false;
    const stateHash = createHash("sha256").update(state).digest("hex");
    const now = new Date();
    const result = await this.prisma.shopeeOAuthState.updateMany({ where: { stateHash, consumedAt: null, expiresAt: { gt: now }, environment: config.environment, partnerId: config.partnerId }, data: { consumedAt: now } });
    if (result.count !== 1) return false;
    const row = await this.prisma.shopeeOAuthState.findUnique({ where: { stateHash }, select: { admin: { select: { isActive: true, role: true } } } });
    return Boolean(row?.admin.isActive && row.admin.role !== "CONTENT_EDITOR");
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
    const config = shopeeConfig();
    if (!config.configured) throw new ServiceUnavailableException("Shopee đang tắt hoặc cấu hình chưa hợp lệ.");
    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true, environment: true, partnerId: true } });
    if (!connection || connection.status !== "ACTIVE" || connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new NotFoundException("Shop Shopee chưa kết nối với ứng dụng/môi trường hiện tại.");
    return this.queue.enqueue(connectionId, actor.id);
  }

  async retrySyncRun(runId: string, actor: AdminIdentity) {
    if (!UUID.test(runId)) throw new BadRequestException("ID tác vụ không hợp lệ.");
    const config = shopeeConfig();
    if (!config.configured) throw new ServiceUnavailableException("Shopee đang tắt hoặc cấu hình chưa hợp lệ.");
    const run = await this.prisma.shopeeSyncRun.findUnique({ where: { id: runId }, select: { id: true, connectionId: true, status: true, connection: { select: { environment: true, partnerId: true, status: true } } } });
    if (!run) throw new NotFoundException("Không tìm thấy lịch sử đồng bộ.");
    if (run.status !== "FAILED") throw new ConflictException("Chỉ có thể thử lại tác vụ đồng bộ thất bại.");
    if (run.connection.status !== "ACTIVE" || run.connection.environment !== config.environment || run.connection.partnerId !== config.partnerId) throw new ConflictException("Shop không còn thuộc ứng dụng/môi trường Shopee đang cấu hình.");
    return this.queue.enqueue(run.connectionId, actor.id, run.id);
  }

  async syncHistory(query: { limit?: string; connectionId?: string; environment?: string } = {}) {
    const limitInput = query.limit;
    const limit = Math.max(1, Math.min(100, Number(limitInput) || 30));
    if (query.connectionId && !UUID.test(query.connectionId)) throw new BadRequestException("ID shop không hợp lệ.");
    if (query.environment && !["sandbox", "production"].includes(query.environment)) throw new BadRequestException("Môi trường Shopee không hợp lệ.");
    return this.prisma.shopeeSyncRun.findMany({
      where: { ...(query.connectionId ? { connectionId: query.connectionId } : {}), ...(query.environment ? { connection: { environment: query.environment } } : {}) },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { connection: { select: { shopId: true, shopName: true, environment: true } } },
    });
  }

  async listOrders(query: { page?: string; limit?: string; status?: string; q?: string; from?: string; to?: string; connectionId?: string; environment?: string; shopId?: string }) {
    const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const where: Prisma.ShopeeImportedOrderWhereInput = {};
    if (query.connectionId) {
      if (!UUID.test(query.connectionId)) throw new BadRequestException("ID shop không hợp lệ.");
      where.connectionId = query.connectionId;
    }
    if (query.environment && !["sandbox", "production"].includes(query.environment)) throw new BadRequestException("Môi trường Shopee không hợp lệ.");
    if (query.environment || query.shopId) where.connection = { ...(query.environment ? { environment: query.environment } : {}), ...(query.shopId ? { shopId: query.shopId.slice(0, 40) } : {}) };
    const status = query.status?.trim();
    if (status) where.status = status.slice(0, 40);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new BadRequestException("Khoảng ngày không hợp lệ.");
    if (from && to && from > to) throw new BadRequestException("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
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
    const config = shopeeConfig();
    if (!connection || connection.status !== "ACTIVE") {
      await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "SHOPEE_CONNECTION_INACTIVE" } });
      return;
    }
    if (!config.configured || connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new Error(config.enabled ? "SHOPEE_CONNECTION_INCOMPATIBLE" : "SHOPEE_DISABLED");
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
        const seenCursors = new Set<string>();
        let pages = 0;
        let more = true;
        while (more) {
          const latest = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { status: true, environment: true, partnerId: true } });
          if (latest?.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
          if (latest.environment !== config.environment || latest.partnerId !== config.partnerId) throw new Error("SHOPEE_CONNECTION_INCOMPATIBLE");
          let page: Awaited<ReturnType<ShopeeClient["getOrderList"]>>;
          try { page = await this.client.getOrderList({ accessToken, shopId: connection.shopId, from, to, ...(nextCursor ? { cursor: nextCursor } : {}) }); }
          catch (error) { if (error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED") await this.markReauthIfTokenStillCurrent(connectionId, accessToken); throw error; }
          const parsedPage = validateShopeeOrderListPage(page);
          if (!parsedPage.ok) throw new ShopeeApiError(parsedPage.code, false);
          orderSns.push(...parsedPage.value.orderSns);
          more = parsedPage.value.more;
          const cursor = parsedPage.value.cursor;
          if (!validateShopeeCursor(more, cursor, nextCursor, seenCursors)) throw new ShopeeApiError("SHOPEE_CURSOR_DID_NOT_ADVANCE", false);
          if (more) seenCursors.add(cursor);
          nextCursor = more ? cursor : undefined;
          pages++;
          if (pages > 10_000) throw new ShopeeApiError("SHOPEE_PAGINATION_LIMIT", false);
        }
        for (const orderBatch of chunk([...new Set(orderSns)], 50)) {
          if (signal?.aborted) throw new Error("SHOPEE_SYNC_CANCELLED");
          accessToken = await this.ensureAccessToken(connectionId);
          let detailResponse: Awaited<ReturnType<ShopeeClient["getOrderDetails"]>>;
          try { detailResponse = await this.client.getOrderDetails({ accessToken, shopId: connection.shopId, orderSnList: orderBatch }); }
          catch (error) { if (error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED") await this.markReauthIfTokenStillCurrent(connectionId, accessToken); throw error; }
          const validation = validateShopeeOrderDetails(detailResponse.order_list, orderBatch);
          if (!validation.ok) throw new ShopeeApiError(validation.code, validation.code === "SHOPEE_ORDER_DETAIL_MISSING");
          const details = validation.value as unknown as ShopeeOrderDetail[];
          ordersRead += details.length;
          for (const detail of details) {
            const result = await this.upsertOrder(connectionId, detail);
            if (result === "created") ordersCreated++;
            if (result === "updated") ordersUpdated++;
          }
          await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { ordersRead, ordersCreated, ordersUpdated } });
        }
        // Cursor advances only after every page and all details in the whole time window succeeded.
        await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, OR: [{ syncCursorAt: null }, { syncCursorAt: { lt: toIsoSeconds(to) } }] }, data: { syncCursorAt: toIsoSeconds(to) } });
        from = to + 1;
      }
      await this.prisma.$transaction([
        this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: "SUCCEEDED", ordersRead, ordersCreated, ordersUpdated, finishedAt: new Date(), errorCode: null } }),
        this.prisma.shopeeConnection.update({ where: { id: connectionId }, data: { lastSyncCompletedAt: new Date(), lastErrorCode: null } }),
      ]);
      this.logger.log(JSON.stringify({ event: "shopee.sync.succeeded", connectionId, runId, ordersRead, ordersCreated, ordersUpdated }));
    } catch (error) {
      const code = safeCode(error);
      const cancelled = ["SHOPEE_CONNECTION_INACTIVE", "SHOPEE_CONNECTION_INCOMPATIBLE", "SHOPEE_SYNC_CANCELLED", "SHOPEE_DISABLED"].includes(code);
      await this.prisma.shopeeSyncRun.update({ where: { id: runId }, data: { status: cancelled ? "CANCELLED" : "RETRYING", ordersRead, ordersCreated, ordersUpdated, errorCode: code, ...(cancelled ? { finishedAt: new Date() } : {}) } });
      this.logger.warn(JSON.stringify({ event: "shopee.sync.attempt_failed", connectionId, runId, code, ordersRead }));
      throw error;
    }
  }

  private async ensureAccessToken(connectionId: string) {
    const config = shopeeConfig();
    if (!config.configured) throw new Error(config.enabled ? "SHOPEE_CONFIGURATION_INVALID" : "SHOPEE_DISABLED");
    let connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
    if (connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new Error("SHOPEE_CONNECTION_INCOMPATIBLE");
    if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decryptShopeeToken(connection.accessTokenCiphertext);
    if (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt.getTime() <= Date.now()) {
      await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, accessTokenCiphertext: connection.accessTokenCiphertext, refreshTokenCiphertext: connection.refreshTokenCiphertext }, data: { status: "REAUTH_REQUIRED", lastErrorCode: "SHOPEE_REFRESH_TOKEN_EXPIRED" } });
      throw new ShopeeApiError("SHOPEE_REAUTH_REQUIRED", false);
    }

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const lease = await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, refreshTokenCiphertext: connection.refreshTokenCiphertext, OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }] }, data: { refreshLeaseUntil: leaseUntil } });
    if (lease.count !== 1) {
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
        if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
        if (connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new Error("SHOPEE_CONNECTION_INCOMPATIBLE");
        if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decryptShopeeToken(connection.accessTokenCiphertext);
      }
      throw new ShopeeApiError("SHOPEE_TOKEN_REFRESH_BUSY", true);
    }

    try {
      connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId } });
      if (!connection || connection.status !== "ACTIVE") throw new Error("SHOPEE_CONNECTION_INACTIVE");
      if (connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new Error("SHOPEE_CONNECTION_INCOMPATIBLE");
      if (connection.refreshLeaseUntil?.getTime() !== leaseUntil.getTime()) throw new ShopeeApiError("SHOPEE_TOKEN_REFRESH_BUSY", true);
      const refreshToken = decryptShopeeToken(connection.refreshTokenCiphertext);
      const rotated = await this.client.refreshAccessToken(refreshToken, connection.shopId);
      if (typeof rotated.access_token !== "string" || !rotated.access_token.trim() || typeof rotated.refresh_token !== "string" || !rotated.refresh_token.trim()) throw new Error("SHOPEE_TOKEN_RESPONSE_INVALID");
      const refreshedAt = new Date();
      const accessTokenExpiresAt = requiredTokenExpiry(rotated.expire_in, refreshedAt);
      const refreshTokenExpiresAt = optionalTokenExpiry(rotated.refresh_token_expire_in, refreshedAt);
      // Persist both rotated credentials in one transaction before returning the new access token.
      await this.prisma.$transaction(async (tx) => {
        const update = await tx.shopeeConnection.updateMany({ where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, refreshLeaseUntil: leaseUntil }, data: { accessTokenCiphertext: encryptShopeeToken(rotated.access_token!), refreshTokenCiphertext: encryptShopeeToken(rotated.refresh_token!), accessTokenExpiresAt, refreshTokenExpiresAt, refreshLeaseUntil: null } });
        if (update.count !== 1) throw new Error("SHOPEE_TOKEN_ROTATION_SAVE_FAILED");
      });
      return rotated.access_token;
    } catch (error) {
      if (error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED") {
        await this.prisma.shopeeConnection.updateMany({
          where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, refreshLeaseUntil: leaseUntil },
          data: { status: "REAUTH_REQUIRED", lastErrorCode: error.code, refreshLeaseUntil: null },
        }).catch(() => undefined);
      } else {
        await this.prisma.shopeeConnection.updateMany({ where: { id: connectionId, refreshLeaseUntil: leaseUntil }, data: { refreshLeaseUntil: null } }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async markReauthIfTokenStillCurrent(connectionId: string, rejectedAccessToken: string) {
    const config = shopeeConfig();
    const current = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { status: true, environment: true, partnerId: true, accessTokenCiphertext: true } });
    if (!current || current.status !== "ACTIVE" || current.environment !== config.environment || current.partnerId !== config.partnerId) return;
    let storedAccessToken: string;
    try { storedAccessToken = decryptShopeeToken(current.accessTokenCiphertext); } catch { return; }
    if (storedAccessToken !== rejectedAccessToken) return;
    await this.prisma.shopeeConnection.updateMany({
      where: { id: connectionId, status: "ACTIVE", environment: config.environment, partnerId: config.partnerId, accessTokenCiphertext: current.accessTokenCiphertext },
      data: { status: "REAUTH_REQUIRED", lastErrorCode: "SHOPEE_REAUTH_REQUIRED" },
    });
  }

  private async upsertOrder(connectionId: string, detail: ShopeeOrderDetail): Promise<"created" | "updated" | "ignored"> {
    const orderSn = typeof detail.order_sn === "string" ? detail.order_sn.trim() : "";
    const createdAt = unixSecondsDate(detail.create_time);
    const updatedAt = unixSecondsDate(detail.update_time);
    if (!orderSn || !detail.order_status || !createdAt || !updatedAt || !Array.isArray(detail.item_list) || detail.item_list.length === 0) throw new ShopeeApiError("SHOPEE_ORDER_DETAIL_INCOMPLETE", false);
    const payTime = unixSecondsDate(detail.pay_time);
    const address = asRecord(detail.recipient_address);
    if (detail.recipient_address !== undefined && detail.recipient_address !== null && !address) throw new ShopeeApiError("SHOPEE_ORDER_ADDRESS_INVALID", false);
    const itemInputs = detail.item_list.map((item) => {
      const itemId = item.item_id == null ? "" : String(item.item_id).trim();
      const modelId = item.model_id == null ? "" : String(item.model_id).trim();
      const quantity = Number(item.model_quantity_purchased);
      if (!itemId || !/^\d+$/.test(itemId) || (modelId && !/^\d+$/.test(modelId)) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) throw new ShopeeApiError("SHOPEE_ORDER_ITEM_INVALID", false);
      return { item, itemId, modelId, quantity };
    });
    return this.prisma.$transaction(async (tx) => {
      const unique = { connectionId_orderSn: { connectionId, orderSn } };
      const existing = await tx.shopeeImportedOrder.findUnique({ where: unique, select: { id: true, status: true, shopeeUpdatedAt: true } });
      if (existing && !orderStatusCanAdvance(existing.shopeeUpdatedAt, updatedAt)) return "ignored";
      const getAmount = (value: unknown): number | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null || value === "") return null;
        const parsed = parseShopeeAmount(value);
        if (parsed === null) throw new ShopeeApiError("SHOPEE_ORDER_AMOUNT_INVALID", false);
        return parsed;
      };
      const status = detail.order_status.slice(0, 40);
      const data = {
        status,
        createTime: createdAt,
        shopeeUpdatedAt: updatedAt,
        ...(detail.currency !== undefined ? { currency: typeof detail.currency === "string" ? detail.currency.slice(0, 12) : null } : {}),
        ...(detail.total_amount !== undefined ? { totalAmount: getAmount(detail.total_amount) } : {}),
        ...(detail.estimated_shipping_fee !== undefined ? { estimatedShippingFee: getAmount(detail.estimated_shipping_fee) } : {}),
        ...(detail.actual_shipping_fee !== undefined ? { actualShippingFee: getAmount(detail.actual_shipping_fee) } : {}),
        ...(detail.cod !== undefined ? { cod: typeof detail.cod === "boolean" ? detail.cod : null } : {}),
        ...(detail.payment_method !== undefined ? { paymentMethod: typeof detail.payment_method === "string" ? detail.payment_method.slice(0, 100) : null } : {}),
        ...(detail.shipping_carrier !== undefined ? { shippingCarrier: typeof detail.shipping_carrier === "string" ? detail.shipping_carrier.slice(0, 120) : null } : {}),
        ...(detail.pay_time !== undefined ? { payTime } : {}),
        ...(detail.recipient_address !== undefined ? { recipientAddress: address ? address as Prisma.InputJsonValue : Prisma.DbNull } : {}),
        ...(detail.message_to_seller !== undefined ? { messageToSeller: typeof detail.message_to_seller === "string" ? detail.message_to_seller.slice(0, 4000) : null } : {}),
      };
      let orderId: string;
      if (existing) {
        const updated = await tx.shopeeImportedOrder.updateMany({ where: { id: existing.id, shopeeUpdatedAt: { lt: updatedAt } }, data });
        if (updated.count !== 1) return "ignored";
        orderId = existing.id;
      } else {
        const created = await tx.shopeeImportedOrder.create({ data: { ...data, connectionId, orderSn } });
        orderId = created.id;
      }
      if (!existing || existing.status !== status) {
        await tx.shopeeOrderStatusHistory.createMany({ data: [{ orderId, status, shopeeUpdatedAt: updatedAt }], skipDuplicates: true });
      }
      if (existing) await tx.shopeeImportedOrderItem.deleteMany({ where: { orderId } });
      const itemRows: Prisma.ShopeeImportedOrderItemCreateManyInput[] = [];
      for (const { item, itemId, modelId, quantity } of itemInputs) {
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
        const rawItemName = typeof item.item_name === "string" ? item.item_name.trim() : typeof item.model_name === "string" ? item.model_name.trim() : "";
        if (!rawItemName) throw new ShopeeApiError("SHOPEE_ORDER_ITEM_NAME_MISSING", false);
        const originalPrice = getAmount(item.model_original_price);
        const discountedPrice = getAmount(item.model_discounted_price);
        itemRows.push({
          orderId, itemId, modelId, itemName: rawItemName.slice(0, 255),
          itemSku: item.item_sku?.slice(0, 120) || null, modelSku: item.model_sku?.slice(0, 120) || null,
          quantity,
          unitPrice: originalPrice ?? null, variationDiscountedPrice: discountedPrice ?? null,
          modelOriginalPrice: originalPrice ?? null, modelDiscountedPrice: discountedPrice ?? null,
          currency: typeof detail.currency === "string" ? detail.currency.slice(0, 12) : null,
          mappingId: appliedMapping?.id ?? null, mappedSku: appliedMapping?.sku ?? null, mappedProductId: appliedMapping?.productId ?? null, mappedVariantId: appliedMapping?.variantId ?? null,
        });
      }
      if (itemRows.length) await tx.shopeeImportedOrderItem.createMany({ data: itemRows });
      return existing ? "updated" : "created";
    });
  }
}
