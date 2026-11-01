import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type Pos365Status = {
  configured: boolean;
  storeConfigured: boolean;
  credentialsConfigured: boolean;
  syncEnabled: boolean;
  branchIdConfigured: boolean;
  mediaPublicUrlConfigured: boolean;
};

type Pos365Result = {
  ok: boolean;
  code: "CONNECTED" | "NOT_CONFIGURED" | "INVALID_STORE_URL" | "AUTH_FAILED" | "SESSION_REJECTED" | "BRANCH_NOT_CONFIGURED" | "BRANCH_NOT_FOUND" | "API_ERROR";
  message: string;
  branchCount?: number;
  branchName?: string;
};

type Pos365Config = {
  rawBaseUrl: string;
  baseUrl: string | null;
  username: string;
  password: string;
  enabled: boolean;
  branchId: number | null;
};

type Pos365Record = Record<string, any>;
type Pos365ProductPriceSnapshot = {
  baseUrl: string;
  loadedAt: number;
  byCode: Map<string, Pos365Record[]>;
};

class Pos365HttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number | null) {
    super(message);
    this.name = "Pos365HttpError";
  }
}

class Pos365ImageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pos365ImageUrlError";
  }
}

const normalizedCode = (value: unknown) => String(value || "").trim().toLocaleUpperCase("en");
const posVariantSellPrice = (product: Pos365Record, variant: Pos365Record) => {
  const price = Number(variant.price) || 0;
  const mode = product.category?.pricingMode;
  return product.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(String(mode || ""))
    ? Math.round(price * Number(variant.carat || 0))
    : price;
};
const posVariantProductName = (productName: unknown, variant: Pos365Record | null | undefined) => {
  const name = String(productName || "").trim();
  const shape = ({ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" } as Record<string, string>)[String(variant?.shape || "").trim().toLocaleUpperCase("en")];
  const quality = String(variant?.quality || "").trim();
  const beadSize = String(variant?.beadSize || "").trim();
  if (!name || !shape || !quality || !beadSize) return name.slice(0, 180);
  return `${name} ${quality} Bản ${shape} Size ${beadSize}mm`.slice(0, 180);
};
const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

@Injectable()
export class Pos365Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Pos365Service.name);
  private syncTimer: NodeJS.Timeout | null = null;
  private processingQueue = false;
  private processingProductPriceQueue = false;
  private productPriceSyncQueueRequested = false;
  private processingProductStockQueue = false;
  private processingProductImageQueue = false;
  private productImageSyncQueueRequested = false;
  private readonly productImageSyncRequests = new Set<string>();
  private processingOrderQueue = false;
  private posRequestQueue: Promise<void> = Promise.resolve();
  private activePosRequests = 0;
  private posRequestNotBefore = 0;
  private posRateLimitStreak = 0;
  // POS365's tenant throttles overlapping requests even at one request/second.
  // Keep network concurrency at one; the product worker still prepares two
  // independent records per turn while the provider gate remains serialized.
  private readonly maxConcurrentPosRequests = 1;
  private readonly posRequestIntervalMs = 1000;
  private productPriceCatalogSnapshot: Pos365ProductPriceSnapshot | null = null;
  // A complete POS catalog scan is 25+ rate-limited requests. Keep the bulk
  // snapshot for the duration of a normal sync batch; changed SKUs are still
  // fetched with ProductImages immediately before each write, and the batch
  // receives a full read-only audit after it drains.
  private readonly productPriceCatalogSnapshotTtlMs = 30 * 60 * 1000;
  private readonly productPriceSyncRequests = new Set<string>();
  private cachedSession: { baseUrl: string; username: string; sessionId: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!this.isSyncEnabled()) return;
    this.syncTimer = setInterval(() => {
      void this.processPendingReceipts();
      void this.processPendingProductPrices();
      void this.processPendingProductStocks();
      void this.processPendingProductImages();
      void this.processPendingOrders();
    }, 15000);
    this.syncTimer.unref?.();
    void this.processPendingReceipts();
    // Requeue records failed by earlier pricebook/branch-price verifiers so
    // the corrected ProductSave path can write and verify the standard price.
    void this.prisma.product.updateMany({
      where: {
        pos365PriceSyncStatus: "RETRYING",
        OR: [
          { pos365PriceSyncError: { contains: "giá chi nhánh" } },
          { pos365PriceSyncError: { contains: "Bảng giá không tồn tại" } },
        ],
      },
      data: { pos365PriceSyncStatus: "PENDING", pos365PriceSyncNextAttemptAt: new Date(), pos365PriceSyncError: null },
    }).then(() => this.processPendingProductPrices()).catch((error) => this.logger.error(`Không thể đưa giá POS365 cần xác minh lại vào hàng đợi: ${this.safeErrorMessage(error)}`));
    void this.prisma.product.updateMany({
      where: { pos365StockSyncStatus: "DISABLED" },
      data: { pos365StockSyncStatus: "PENDING", pos365StockSyncNextAttemptAt: new Date(), pos365StockSyncError: null },
    }).then(() => this.processPendingProductStocks()).catch((error) => this.logger.error(`Không thể đưa tồn kho POS365 vào hàng đợi: ${this.safeErrorMessage(error)}`));
    void this.processPendingOrders();
    void this.processPendingProductStocks();
    void this.prisma.product.updateMany({
      where: { pos365ImageSyncStatus: "DISABLED" },
      data: { pos365ImageSyncStatus: "PENDING", pos365ImageSyncNextAttemptAt: new Date(), pos365ImageSyncError: null },
    }).then(() => this.processPendingProductImages()).catch((error) => this.logger.error(`Không thể đưa ảnh sản phẩm POS365 vào hàng đợi: ${this.safeErrorMessage(error)}`));
    void this.processPendingProductImages();
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  status(): Pos365Status {
    const config = this.readConfiguration();
    return {
      configured: Boolean(config.baseUrl && config.username && config.password),
      storeConfigured: Boolean(config.rawBaseUrl),
      credentialsConfigured: Boolean(config.username && config.password),
      syncEnabled: this.isSyncEnabled(),
      branchIdConfigured: config.branchId !== null,
      mediaPublicUrlConfigured: Boolean(process.env.MEDIA_PUBLIC_BASE_URL?.trim()),
    };
  }

  isSyncEnabled() {
    const config = this.readConfiguration();
    return Boolean(config.enabled && config.baseUrl && config.username && config.password && config.branchId);
  }

  async testConnection(): Promise<Pos365Result> {
    const config = this.readConfiguration();
    if (!config.rawBaseUrl || !config.username || !config.password) {
      return { ok: false, code: "NOT_CONFIGURED", message: "Chưa cấu hình host cửa hàng, tên đăng nhập và mật khẩu POS365 trên máy chủ GEME." };
    }
    if (!config.baseUrl) {
      return { ok: false, code: "INVALID_STORE_URL", message: "Host POS365 phải có dạng https://{mã-cửa-hàng}.pos365.vn." };
    }
    try {
      const sessionId = await this.authenticate(config);
      const branchPage = await this.requestJson(new URL("/api/branchs?format=json&$top=1000&$skip=0", config.baseUrl), sessionId);
      const branches = this.rows(branchPage);
      const count = Number((branchPage as Pos365Record)?.__count);
      if (config.branchId === null) {
        return { ok: false, code: "BRANCH_NOT_CONFIGURED", message: "Đăng nhập POS365 thành công nhưng chưa cấu hình chi nhánh nhận tồn kho." , ...(Number.isFinite(count) ? { branchCount: count } : { branchCount: branches.length }) };
      }
      const selected = branches.find((branch) => Number(branch.Id) === config.branchId);
      if (!selected) {
        return { ok: false, code: "BRANCH_NOT_FOUND", message: "Không tìm thấy chi nhánh POS365 đã cấu hình. Kiểm tra lại POS365_BRANCH_ID.", ...(Number.isFinite(count) ? { branchCount: count } : { branchCount: branches.length }) };
      }
      return {
        ok: true,
        code: "CONNECTED",
        message: this.isSyncEnabled()
          ? "Đã kết nối POS365. Phiếu nhập kho mới sẽ tự đồng bộ vào chi nhánh đã chọn."
          : "Đã đăng nhập POS365 và tìm thấy chi nhánh. Bật POS365_ENABLED để cho phép đồng bộ ghi dữ liệu.",
        ...(Number.isFinite(count) ? { branchCount: count } : { branchCount: branches.length }),
        branchName: String(selected.Name || ""),
      };
    } catch (error) {
      return { ok: false, code: "API_ERROR", message: this.safeErrorMessage(error) };
    }
  }

  /** One-time absolute stock snapshot sync. Receipts entered after this use PurchaseOrder instead. */
  async syncCurrentInventory() {
    const config = this.readConfiguration();
    if (!this.isSyncEnabled() || !config.baseUrl || !config.branchId) {
      throw new Error("POS365 chưa bật ghi dữ liệu hoặc chưa chọn chi nhánh.");
    }
    const sessionId = await this.authenticate(config);
    const products = await this.prisma.product.findMany({
      orderBy: { sku: "asc" },
      include: { category: { select: { pricingMode: true } }, variants: { orderBy: { sortOrder: "asc" } } },
    });
    const receiptCosts = await this.prisma.inventoryReceiptItem.findMany({
      orderBy: { createdAt: "desc" },
      select: { productSku: true, unitCost: true },
      take: 10000,
    });
    const costBySku = new Map<string, number>();
    for (const row of receiptCosts) if (!costBySku.has(normalizedCode(row.productSku))) costBySku.set(normalizedCode(row.productSku), Number(row.unitCost));

    const linesBySku = new Map<string, { sku: string; name: string; price: number; stock: number }>();
    for (const product of products) {
      const variants = product.variants || [];
      if (variants.length) {
        for (const variant of variants) {
          const sku = String(variant.sku || (variants.length === 1 ? product.sku : "")).trim();
          if (!sku) throw new Error(`Sản phẩm ${product.name} có biến thể thiếu SKU riêng; chưa thể đồng bộ tồn an toàn.`);
          const key = normalizedCode(sku);
          if (linesBySku.has(key)) throw new Error(`SKU ${sku} bị lặp giữa nhiều biến thể hoặc sản phẩm; chưa thể đồng bộ tồn an toàn.`);
          linesBySku.set(key, { sku, name: product.name, price: posVariantSellPrice(product, variant), stock: variant.stock });
        }
      } else {
        const key = normalizedCode(product.sku);
        if (!key || linesBySku.has(key)) throw new Error(`SKU ${product.sku || "(trống)"} bị thiếu hoặc bị lặp; chưa thể đồng bộ tồn an toàn.`);
        linesBySku.set(key, { sku: product.sku, name: product.name, price: Number(product.price) || 0, stock: product.stock });
      }
    }
    const targetLines = [...linesBySku.values()];
    if (!targetLines.length) return { ok: true, createdProducts: 0, stockLines: 0, targetUnits: 0, branchId: config.branchId, code: null };

    const catalog = await this.readProducts(config, sessionId);
    const createdProducts: string[] = [];
    for (const line of targetLines) {
      const existing = this.findProductByCode(catalog, line.sku);
      if (existing) continue;
      const created = await this.createProduct(config, sessionId, line.sku, line.name, line.price);
      catalog.push(created);
      createdProducts.push(line.sku);
    }

    // Re-read after product creation so every OnHand value is the actual POS count.
    const currentCatalog = await this.readProducts(config, sessionId);
    const details = targetLines.map((line) => {
      const remote = this.findProductByCode(currentCatalog, line.sku);
      if (!remote) throw new Error(`POS365 chưa trả về mặt hàng ${line.sku} sau khi tạo.`);
      const posOnHand = asNumber(remote.OnHand ?? remote.TotalOnHand);
      if (posOnHand === null) throw new Error(`Không đọc được tồn POS365 hiện tại của SKU ${line.sku}; chưa gửi phiếu kiểm kê.`);
      return {
        ProductId: Number(remote.Id),
        ActualCount: line.stock,
        OnHand: posOnHand,
        Cost: costBySku.get(normalizedCode(line.sku)) ?? 0,
      };
    });
    const code = `GEME-OPEN-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    const adjustmentDate = new Date().toISOString().slice(0, 19).replace("T", " ");
    await this.requestJson(new URL("/api/inventorycount", config.baseUrl), sessionId, {
      method: "POST",
      body: JSON.stringify({ InventoryCount: { Id: 0, Code: code, Status: 2, AdjustmentDate: adjustmentDate, BranchId: config.branchId, InventoryCountDetails: details } }),
    });

    const verifiedCatalog = await this.readProducts(config, sessionId);
    const mismatches = targetLines.flatMap((line) => {
      const remote = this.findProductByCode(verifiedCatalog, line.sku);
      const actual = asNumber(remote?.OnHand ?? remote?.TotalOnHand);
      return actual === line.stock ? [] : [{ sku: line.sku, expected: line.stock, actual }];
    });
    if (mismatches.length) throw new Error(`POS365 nhận phiếu kiểm kê ${code} nhưng còn ${mismatches.length} mã chưa khớp: ${mismatches.map((row) => row.sku).join(", ")}.`);
    await this.prisma.product.updateMany({
      where: { id: { in: products.map((product) => product.id) } },
      data: { pos365StockSyncStatus: "SYNCED", pos365StockSyncAttempts: 0, pos365StockSyncError: null, pos365StockSyncNextAttemptAt: null, pos365StockSyncedAt: new Date() },
    });
    return {
      ok: true,
      code,
      branchId: config.branchId,
      productCount: products.length,
      stockLines: targetLines.length,
      createdProducts: createdProducts.length,
      createdSkus: createdProducts,
      targetUnits: targetLines.reduce((sum, line) => sum + line.stock, 0),
      verified: targetLines.length,
    };
  }

  async syncReceiptNow(receiptId: string) {
    if (!this.isSyncEnabled()) return;
    await this.processPendingReceipts(receiptId);
  }

  async purchaseOrderExists(codeInput: string) {
    const config = this.readConfiguration();
    if (!config.baseUrl || !config.username || !config.password || !config.branchId) {
      throw new Error("POS365 chưa được cấu hình đủ thông tin để đối soát phiếu nhập.");
    }
    const code = String(codeInput || "").trim();
    if (!code) throw new Error("Thiếu mã phiếu POS365 để đối soát.");
    const sessionId = await this.authenticate(config);
    const purchaseOrder = await this.findPurchaseOrder(config, sessionId, code);
    if (!purchaseOrder) return false;
    const branchId = asNumber(purchaseOrder.BranchId);
    if (branchId !== null && branchId !== config.branchId) throw new Error(`Phiếu ${code} thuộc chi nhánh POS365 khác.`);
    return true;
  }

  async syncProductPricesNow(productId: string) {
    if (!this.isSyncEnabled()) return;
    // A direct product edit must compare against the latest POS value instead
    // of a catalog snapshot retained for bulk synchronization.
    this.productPriceCatalogSnapshot = null;
    await this.processPendingProductPrices(productId);
  }

  async productPriceSyncStatuses(productIds: string[]) {
    const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 500);
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, sku: true, pos365PriceSyncStatus: true, pos365PriceSyncError: true, pos365PriceSyncedAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      status: row.pos365PriceSyncStatus,
      error: row.pos365PriceSyncError,
      syncedAt: row.pos365PriceSyncedAt,
    }));
  }

  async queueProductImageSync(productId: string) {
    const enabled = this.isSyncEnabled();
    await this.prisma.product.updateMany({
      where: { id: productId },
      data: {
        pos365ImageSyncStatus: enabled ? "PENDING" : "DISABLED",
        pos365ImageSyncAttempts: 0,
        pos365ImageSyncLastAttemptAt: null,
        pos365ImageSyncNextAttemptAt: enabled ? new Date() : null,
        pos365ImageSyncedAt: null,
        pos365ImageSyncError: null,
      },
    });
    if (enabled) void this.processPendingProductImages(productId);
  }

  private async queueProductImageSyncIfNeeded(productId: string) {
    if (!this.isSyncEnabled()) return;
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        pos365ImageSyncStatus: true,
        images: { select: { id: true }, take: 1 },
        variants: { select: { imageUrls: true } },
      },
    });
    if (!product || (!product.images.length && !product.variants.some((variant) => Array.isArray(variant.imageUrls) && variant.imageUrls.length))) return;
    if (["PENDING", "RETRYING", "SYNCING", "SYNCED"].includes(String(product.pos365ImageSyncStatus || ""))) return;
    await this.queueProductImageSync(productId);
  }

  async queueAllProductImageSync() {
    if (!this.isSyncEnabled()) throw new BadRequestException("Cần bật đồng bộ POS365 trước khi đưa ảnh sản phẩm vào hàng đợi.");
    const candidates = await this.prisma.product.findMany({
      select: { id: true, images: { select: { id: true }, take: 1 }, variants: { select: { imageUrls: true } } },
    });
    const productIds = candidates.filter((product) => product.images.length > 0 || product.variants.some((variant) => Array.isArray(variant.imageUrls) && variant.imageUrls.length > 0)).map((product) => product.id);
    if (!productIds.length) return { queued: 0 };
    const queued = await this.prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: {
        pos365ImageSyncStatus: "PENDING", pos365ImageSyncAttempts: 0,
        pos365ImageSyncLastAttemptAt: null, pos365ImageSyncNextAttemptAt: new Date(),
        pos365ImageSyncedAt: null, pos365ImageSyncError: null,
      },
    });
    void this.processPendingProductImages();
    return { queued: queued.count };
  }

  async productImageSyncStatuses(productIds: string[]) {
    const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 500);
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, sku: true, pos365ImageSyncStatus: true, pos365ImageSyncError: true, pos365ImageSyncedAt: true },
    });
    return rows.map((row) => ({ id: row.id, sku: row.sku, status: row.pos365ImageSyncStatus, error: row.pos365ImageSyncError, syncedAt: row.pos365ImageSyncedAt }));
  }

  private async processPendingProductImages(onlyProductId?: string) {
    if (this.processingProductImageQueue || !this.isSyncEnabled()) {
      if (onlyProductId) this.productImageSyncRequests.add(onlyProductId);
      else this.productImageSyncQueueRequested = true;
      return;
    }
    this.processingProductImageQueue = true;
    let shouldDrainNextBatch = false;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
      await this.prisma.product.updateMany({
        where: { pos365ImageSyncStatus: "SYNCING", pos365ImageSyncLastAttemptAt: { lt: staleBefore } },
        data: { pos365ImageSyncStatus: "RETRYING", pos365ImageSyncNextAttemptAt: now },
      });
      const dueWhere: Pos365Record = {
        pos365ImageSyncStatus: { in: ["PENDING", "RETRYING"] },
        OR: [{ pos365ImageSyncNextAttemptAt: null }, { pos365ImageSyncNextAttemptAt: { lte: now } }],
      };
      if (onlyProductId) dueWhere.id = onlyProductId;
      const products = await this.prisma.product.findMany({ where: dueWhere, orderBy: [{ pos365ImageSyncNextAttemptAt: "asc" }, { updatedAt: "asc" }], take: 10, select: { id: true } });
      for (const row of products) {
        const claimedAt = new Date();
        const claim = await this.prisma.product.updateMany({
          where: { id: row.id, pos365ImageSyncStatus: { in: ["PENDING", "RETRYING"] }, OR: [{ pos365ImageSyncNextAttemptAt: null }, { pos365ImageSyncNextAttemptAt: { lte: claimedAt } }] },
          data: { pos365ImageSyncStatus: "SYNCING", pos365ImageSyncAttempts: { increment: 1 }, pos365ImageSyncLastAttemptAt: claimedAt, pos365ImageSyncNextAttemptAt: null },
        });
        if (!claim.count) continue;
        const product = await this.prisma.product.findUnique({ where: { id: row.id }, include: { images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] }, variants: { orderBy: { sortOrder: "asc" } } } });
        if (!product) continue;
        try {
          const result = await this.sendProductImages(product);
          await this.prisma.product.updateMany({
            where: { id: product.id, pos365ImageSyncStatus: "SYNCING", pos365ImageSyncLastAttemptAt: claimedAt },
            data: { pos365ImageSyncStatus: result === "SKIPPED" ? "SKIPPED" : "SYNCED", pos365ImageSyncError: null, pos365ImageSyncNextAttemptAt: null, pos365ImageSyncedAt: result === "SKIPPED" ? null : new Date() },
          });
        } catch (error) {
          const attempts = Number(product.pos365ImageSyncAttempts || 0) + 1;
          const needsPublicUrlConfiguration = error instanceof Pos365ImageUrlError;
          const delayMs = this.retryDelayMs(error, attempts);
          const message = this.safeErrorMessage(error).slice(0, 2000);
          await this.prisma.product.updateMany({
            where: { id: product.id, pos365ImageSyncStatus: "SYNCING", pos365ImageSyncLastAttemptAt: claimedAt },
            data: { pos365ImageSyncStatus: needsPublicUrlConfiguration ? "FAILED" : "RETRYING", pos365ImageSyncError: message, pos365ImageSyncNextAttemptAt: needsPublicUrlConfiguration ? null : new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Ảnh SKU ${product.sku} chưa đồng bộ POS365; ${needsPublicUrlConfiguration ? "cần cấu hình URL công khai" : "sẽ tự thử lại"}. ${message}`);
        }
      }
      if (!onlyProductId) {
        const nextNow = new Date();
        shouldDrainNextBatch = (await this.prisma.product.count({ where: { pos365ImageSyncStatus: { in: ["PENDING", "RETRYING"] }, OR: [{ pos365ImageSyncNextAttemptAt: null }, { pos365ImageSyncNextAttemptAt: { lte: nextNow } }] } })) > 0;
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi ảnh POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingProductImageQueue = false;
      const nextProductId = this.productImageSyncRequests.values().next().value as string | undefined;
      if (nextProductId) {
        this.productImageSyncRequests.delete(nextProductId);
        if (this.productImageSyncQueueRequested || shouldDrainNextBatch) this.productImageSyncQueueRequested = true;
        queueMicrotask(() => { void this.processPendingProductImages(nextProductId); });
      } else if (this.productImageSyncQueueRequested || shouldDrainNextBatch) {
        this.productImageSyncQueueRequested = false;
        queueMicrotask(() => { void this.processPendingProductImages(); });
      }
    }
  }

  private async processPendingProductStocks() {
    if (this.processingProductStockQueue || !this.isSyncEnabled()) return;
    this.processingProductStockQueue = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
      await this.prisma.product.updateMany({
        where: { pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: { lt: staleBefore } },
        data: { pos365StockSyncStatus: "RETRYING", pos365StockSyncNextAttemptAt: now },
      });
      const products = await this.prisma.product.findMany({
        where: {
          pos365StockSyncStatus: { in: ["PENDING", "RETRYING"] },
          OR: [{ pos365StockSyncNextAttemptAt: null }, { pos365StockSyncNextAttemptAt: { lte: now } }],
          inventoryReceiptItems: { none: { receipt: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } },
          orderItems: { none: { order: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } },
        },
        orderBy: [{ pos365StockSyncNextAttemptAt: "asc" }, { updatedAt: "asc" }],
        take: 20,
        select: { id: true },
      });
      const eligibleIds: string[] = [];
      for (const row of products) {
        const [pendingReceipts, pendingOrders] = await Promise.all([
          this.prisma.inventoryReceiptItem.count({ where: { productId: row.id, receipt: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } }),
          this.prisma.orderItem.count({ where: { productId: row.id, order: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } }),
        ]);
        if (pendingReceipts || pendingOrders) continue;
        eligibleIds.push(row.id);
      }
      if (!eligibleIds.length) return;

      // Claim one bounded batch so the POS catalog is read once for many SKUs,
      // instead of reloading every page once per product.
      const claimedAt = new Date();
      await this.prisma.product.updateMany({
        where: {
          id: { in: eligibleIds },
          pos365StockSyncStatus: { in: ["PENDING", "RETRYING"] },
          OR: [{ pos365StockSyncNextAttemptAt: null }, { pos365StockSyncNextAttemptAt: { lte: claimedAt } }],
        },
        data: { pos365StockSyncStatus: "SYNCING", pos365StockSyncAttempts: { increment: 1 }, pos365StockSyncLastAttemptAt: claimedAt, pos365StockSyncNextAttemptAt: null },
      });
      const claimed = await this.prisma.product.findMany({
        where: { id: { in: eligibleIds }, pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: claimedAt },
        select: { id: true, pos365StockSyncAttempts: true },
      });
      const claimedIds = claimed.map((product) => product.id);
      if (!claimedIds.length) return;
      try {
        await this.syncProductStockBatchByIds(claimedIds);
        await this.prisma.product.updateMany({
          where: { id: { in: claimedIds }, pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: claimedAt },
          data: { pos365StockSyncStatus: "SYNCED", pos365StockSyncError: null, pos365StockSyncNextAttemptAt: null, pos365StockSyncedAt: new Date() },
        });
      } catch (error) {
        const delayMs = Math.max(...claimed.map((product) => this.retryDelayMs(error, Number(product.pos365StockSyncAttempts || 1))));
        const message = this.safeErrorMessage(error).slice(0, 2000);
        await this.prisma.product.updateMany({
          where: { id: { in: claimedIds }, pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: claimedAt },
          data: { pos365StockSyncStatus: "RETRYING", pos365StockSyncError: message, pos365StockSyncNextAttemptAt: new Date(Date.now() + delayMs) },
        });
        this.logger.warn(`Chưa đồng bộ được tồn POS365 theo lô ${claimedIds.length} SKU; sẽ tự thử lại. ${message}`);
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi tồn kho POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingProductStockQueue = false;
    }
  }

  private async syncProductStockBatchByIds(productIds: string[]) {
    const config = this.readConfiguration();
    if (!this.isSyncEnabled() || !config.baseUrl || !config.branchId) throw new Error("POS365 chưa bật đồng bộ tồn hoặc chưa chọn chi nhánh.");
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: { select: { pricingMode: true } }, variants: { orderBy: { sortOrder: "asc" } } },
    });
    const targetLines = products.flatMap((product) => product.variants.length
      ? product.variants.map((variant) => ({ sku: String(variant.sku || "").trim(), name: product.name, price: posVariantSellPrice(product, variant), stock: variant.stock }))
      : [{ sku: String(product.sku || "").trim(), name: product.name, price: Number(product.price) || 0, stock: product.stock }]);
    if (!targetLines.length) return;
    const seen = new Set<string>();
    for (const line of targetLines) {
      const key = normalizedCode(line.sku);
      if (!key || seen.has(key)) throw new Error(`SKU biến thể của lô tồn bị thiếu hoặc trùng; tồn chưa được ghi sang POS365.`);
      seen.add(key);
    }
    const sessionId = await this.authenticate(config);
    let catalog = await this.readProducts(config, sessionId);
    for (const line of targetLines) {
      if (this.findProductByCode(catalog, line.sku)) continue;
      const existing = await this.findRemoteProductByCode(config, sessionId, line.sku);
      catalog.push(existing || await this.createProduct(config, sessionId, line.sku, line.name, line.price));
    }
    const details: Pos365Record[] = [];
    for (const line of targetLines) {
      const remote = this.findProductByCode(catalog, line.sku);
      if (!remote) throw new Error(`POS365 chưa có mặt hàng ${line.sku}.`);
      const onHand = asNumber(remote.OnHand ?? remote.TotalOnHand);
      if (onHand === null) throw new Error(`Không đọc được tồn POS365 hiện tại của ${line.sku}.`);
      details.push({ ProductId: Number(remote.Id), ActualCount: line.stock, OnHand: onHand, Cost: asNumber(remote.Cost ?? remote.AverageCost) ?? 0 });
    }
    if (details.every((detail, index) => detail.OnHand === targetLines[index].stock)) return;
    const code = `GEME-STK-BATCH-${Date.now()}`;
    await this.requestJson(new URL("/api/inventorycount", config.baseUrl), sessionId, {
      method: "POST",
      body: JSON.stringify({ InventoryCount: { Id: 0, Code: code, Status: 2, AdjustmentDate: new Date().toISOString().slice(0, 19).replace("T", " "), BranchId: config.branchId, InventoryCountDetails: details } }),
    });
    const verifiedCatalog = await this.readProducts(config, sessionId);
    const mismatches: { sku: string; expected: number; actual: number | null }[] = [];
    for (const line of targetLines) {
      const remote = this.findProductByCode(verifiedCatalog, line.sku);
      const actual = asNumber(remote?.OnHand ?? remote?.TotalOnHand);
      if (actual !== line.stock) mismatches.push({ sku: line.sku, expected: line.stock, actual });
    }
    if (mismatches.length) throw new Error(`POS365 còn tồn chưa khớp cho ${mismatches.map((line) => line.sku).join(", ")}.`);
  }

  /** Remove POS365 products that are linked to GEME inventory by their exact SKU/Code. */
  async deleteProductsBySku(skus: string[]) {
    const uniqueSkus = [...new Map(skus.map((sku) => [normalizedCode(sku), String(sku || "").trim()])).values()].filter(Boolean);
    if (!uniqueSkus.length) return { deleted: [], notFound: [] as string[] };
    const config = this.readConfiguration();
    if (!config.baseUrl || !config.username || !config.password) {
      throw new Error("Chưa cấu hình thông tin POS365; không thể xóa SKU đã liên kết an toàn.");
    }
    const sessionId = await this.authenticate(config);
    const catalog = await this.readProducts(config, sessionId);
    const deleted: string[] = [];
    const notFound: string[] = [];
    for (const sku of uniqueSkus) {
      const product = this.findProductByCode(catalog, sku);
      if (!product) {
        notFound.push(sku);
        continue;
      }
      const id = asNumber(product.Id);
      if (id === null || id <= 0) throw new Error(`POS365 không trả mã hàng hợp lệ cho SKU ${sku}.`);
      await this.requestJson(new URL(`/api/products/${id}?format=json`, config.baseUrl), sessionId, { method: "DELETE" });
      deleted.push(sku);
    }
    const verifiedCatalog = await this.readProducts(config, sessionId);
    const remaining = uniqueSkus.filter((sku) => this.findProductByCode(verifiedCatalog, sku));
    if (remaining.length) throw new Error(`POS365 chưa xóa được các SKU: ${remaining.join(", ")}.`);
    return { deleted, notFound };
  }

  /** Remove only stock receipts whose exact GEME-generated codes are supplied. */
  async deletePurchaseOrdersByCode(codes: string[]) {
    const uniqueCodes = [...new Set(codes.map((code) => String(code || "").trim()).filter(Boolean))];
    if (!uniqueCodes.length) return { deleted: [], notFound: [] as string[] };
    const config = this.readConfiguration();
    if (!config.baseUrl || !config.username || !config.password) {
      throw new Error("Chưa cấu hình thông tin POS365; không thể xóa phiếu nhập đã liên kết an toàn.");
    }
    const sessionId = await this.authenticate(config);
    const deleted: string[] = [];
    const notFound: string[] = [];
    for (const code of uniqueCodes) {
      const purchaseOrder = await this.findPurchaseOrder(config, sessionId, code);
      if (!purchaseOrder) {
        notFound.push(code);
        continue;
      }
      const id = asNumber(purchaseOrder.Id);
      if (id === null || id <= 0) throw new Error(`POS365 không trả mã phiếu hợp lệ cho chứng từ ${code}.`);
      await this.requestJson(new URL(`/api/orderstock/${id}`, config.baseUrl), sessionId, { method: "DELETE" });
      deleted.push(code);
    }
    for (const code of uniqueCodes) {
      if (await this.findPurchaseOrder(config, sessionId, code)) throw new Error(`POS365 chưa xóa được phiếu nhập ${code}.`);
    }
    return { deleted, notFound };
  }

  async queueAllProductPriceSync() {
    if (!this.isSyncEnabled()) throw new Error("POS365 chưa bật đồng bộ giá hoặc chưa chọn chi nhánh.");
    this.productPriceCatalogSnapshot = null;
    const products = await this.prisma.product.findMany({ include: { category: { select: { pricingMode: true } }, variants: true } });
    const now = new Date();
    let skippedWithoutPrice = 0;
    const eligibleIds: string[] = [];
    for (const product of products) {
      const prices = product.variants.length ? product.variants.map((variant) => Number(variant.price)) : [Number(product.price)];
      if (!prices.length || prices.some((price) => !Number.isFinite(price) || price <= 0)) {
        skippedWithoutPrice += 1;
        continue;
      }
      eligibleIds.push(product.id);
    }
    if (eligibleIds.length) {
      await this.prisma.product.updateMany({
        where: { id: { in: eligibleIds } },
        data: { pos365PriceSyncStatus: "PENDING", pos365PriceSyncNextAttemptAt: now, pos365PriceSyncError: null },
      });
      // Wait for the first real POS pass so this endpoint does not report a
      // successful queue operation while the user still sees no sync result.
      await this.processPendingProductPrices();
    }
    const finalRows = eligibleIds.length ? await this.prisma.product.findMany({
      where: { id: { in: eligibleIds } },
      select: { pos365PriceSyncStatus: true },
    }) : [];
    return {
      queued: eligibleIds.length,
      skippedWithoutPrice,
      synced: finalRows.filter((row) => row.pos365PriceSyncStatus === "SYNCED").length,
      syncing: finalRows.filter((row) => row.pos365PriceSyncStatus === "SYNCING").length,
      pending: finalRows.filter((row) => row.pos365PriceSyncStatus === "PENDING").length,
      retrying: finalRows.filter((row) => row.pos365PriceSyncStatus === "RETRYING").length,
    };
  }

  async queueUnsentOrders() {
    if (!this.isSyncEnabled()) throw new Error("POS365 chưa bật đồng bộ hoặc chưa chọn chi nhánh.");
    const queued = await this.prisma.order.updateMany({
      where: {
        status: { not: "CANCELLED" },
        OR: [
          { pos365SyncStatus: null },
          { pos365SyncStatus: { in: ["BLOCKED", "RETRYING"] } },
        ],
      },
      data: { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date(), pos365SyncError: null },
    });
    void this.processPendingOrders();
    return { queued: queued.count };
  }

  async queueOrderSync(orderId: string) {
    if (!this.isSyncEnabled()) return;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date(), pos365SyncError: null },
    });
    void this.processPendingOrders(orderId);
  }

  async syncQueueSummary() {
    const [receiptPending, receiptFailed, pricePending, priceFailed, stockPending, stockFailed, imagePending, imageFailed, imageSkipped, orderPending, orderFailed, syncedOrders] = await Promise.all([
      this.prisma.inventoryReceipt.count({ where: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.inventoryReceipt.count({ where: { pos365SyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365PriceSyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.product.count({ where: { pos365PriceSyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365StockSyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.product.count({ where: { pos365StockSyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365ImageSyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.product.count({ where: { pos365ImageSyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365ImageSyncStatus: "SKIPPED" } }),
      this.prisma.order.count({ where: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.order.count({ where: { pos365SyncStatus: "BLOCKED" } }),
      this.prisma.order.count({ where: { pos365SyncStatus: "SYNCED" } }),
    ]);
    return { receipts: { pending: receiptPending, failed: receiptFailed }, prices: { pending: pricePending, failed: priceFailed }, stocks: { pending: stockPending, failed: stockFailed }, images: { pending: imagePending, failed: imageFailed, skipped: imageSkipped }, orders: { pending: orderPending, blocked: orderFailed, synced: syncedOrders } };
  }

  private async processPendingOrders(onlyOrderId?: string) {
    if (this.processingOrderQueue || !this.isSyncEnabled()) return;
    this.processingOrderQueue = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
      await this.prisma.order.updateMany({
        where: { pos365SyncStatus: "SYNCING", pos365SyncLastAttemptAt: { lt: staleBefore } },
        data: { pos365SyncStatus: "RETRYING", pos365SyncNextAttemptAt: now },
      });
      const dueWhere: Pos365Record = {
        pos365SyncStatus: { in: ["PENDING", "RETRYING"] },
        OR: [{ pos365SyncNextAttemptAt: null }, { pos365SyncNextAttemptAt: { lte: now } }],
      };
      if (onlyOrderId) dueWhere.id = onlyOrderId;
      const orders = await this.prisma.order.findMany({
        where: dueWhere,
        orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }],
        take: onlyOrderId ? 1 : 5,
        select: { id: true },
      });
      for (const row of orders) {
        const claimedAt = new Date();
        const claim = await this.prisma.order.updateMany({
          where: {
            id: row.id,
            pos365SyncStatus: { in: ["PENDING", "RETRYING"] },
            OR: [{ pos365SyncNextAttemptAt: null }, { pos365SyncNextAttemptAt: { lte: claimedAt } }],
          },
          data: { pos365SyncStatus: "SYNCING", pos365SyncAttempts: { increment: 1 }, pos365SyncLastAttemptAt: claimedAt, pos365SyncNextAttemptAt: null },
        });
        if (!claim.count) continue;
        const order = await this.prisma.order.findUnique({ where: { id: row.id }, include: { items: true, payments: { orderBy: { createdAt: "asc" } }, customer: true } });
        if (!order) continue;
        try {
          const posOrderId = await this.sendOrder(order);
          await this.prisma.order.update({
            where: { id: order.id },
            data: { pos365SyncStatus: "SYNCED", pos365OrderId: posOrderId, pos365SyncError: null, pos365SyncNextAttemptAt: null, pos365SyncedAt: new Date() },
          });
        } catch (error) {
          const message = this.safeErrorMessage(error).slice(0, 2000);
          const needsConfiguration = message.startsWith("CONFIG_REQUIRED:");
          const attempts = Number(order.pos365SyncAttempts || 0) + 1;
          const delayMs = this.retryDelayMs(error, attempts);
          await this.prisma.order.update({
            where: { id: order.id },
            data: {
              pos365SyncStatus: needsConfiguration ? "BLOCKED" : "RETRYING",
              pos365SyncError: message.replace(/^CONFIG_REQUIRED:\s*/, ""),
              pos365SyncNextAttemptAt: needsConfiguration ? null : new Date(Date.now() + delayMs),
            },
          });
          this.logger.warn(`Đơn ${order.code} chưa đồng bộ POS365; ${needsConfiguration ? "cần cấu hình tài khoản thanh toán." : "sẽ tự thử lại."} ${message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi đơn POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingOrderQueue = false;
    }
  }

  private async sendOrder(order: Pos365Record): Promise<string | null> {
    const config = this.readConfiguration();
    if (!config.baseUrl || !config.branchId) throw new Error("Chưa cấu hình host hoặc chi nhánh POS365.");
    const sessionId = await this.authenticate(config);
    const existing = await this.findOrder(config, sessionId, String(order.code));

    if (order.status === "CANCELLED") {
      if (!existing) return null;
      const remoteId = asNumber(existing.Id);
      if (!remoteId) throw new Error(`POS365 không trả mã đơn hợp lệ cho ${order.code}.`);
      if (Number(existing.Status) !== 3) await this.requestJson(new URL(`/api/orders/${remoteId}/void`, config.baseUrl), sessionId, { method: "DELETE" });
      return String(remoteId);
    }

    const payment = order.payments?.[0];
    const isPaid = payment?.status === "PAID";
    const partnerId = isPaid && order.customer
      ? await this.upsertPartner(config, sessionId, order.customer)
      : null;
    let accountId: number | null = null;
    if (isPaid && payment.method !== "COD") {
      const configured = Number(process.env[`POS365_ACCOUNT_ID_${String(payment.method || "").toUpperCase()}`]);
      if (!Number.isSafeInteger(configured) || configured <= 0) {
        throw new Error(`CONFIG_REQUIRED: cài POS365_ACCOUNT_ID_${String(payment.method || "").toUpperCase()} trong cấu hình backend để ghi nhận thanh toán đơn ${order.code}.`);
      }
      accountId = configured;
    }

    const catalog = await this.readProducts(config, sessionId);
    const details: Pos365Record[] = [];
    for (const item of order.items || []) {
      const sku = String(item.productSku || "").trim();
      if (!sku) throw new Error(`Dòng hàng ${item.productName || "không tên"} thiếu SKU để ghép POS365.`);
      let remote = this.findProductByCode(catalog, sku);
      if (!remote) {
        remote = await this.createProduct(config, sessionId, sku, String(item.productName || sku), Number(item.unitPrice) || 0);
        catalog.push(remote);
      }
      details.push({ ProductId: Number(remote.Id), Code: sku, Name: String(item.productName || sku), Price: Math.round(Number(item.unitPrice) || 0), Quantity: Number(item.quantity) });
    }
    const remoteId = asNumber(existing?.Id) ?? 0;
    const status = order.status === "DELIVERED" ? 2 : 1;
    const payload = {
      Order: {
        Id: remoteId,
        Code: String(order.code),
        PurchaseDate: new Date(order.placedAt).toISOString().slice(0, 19).replace("T", " "),
        Status: status,
        BranchId: config.branchId,
        ...(partnerId ? { PartnerId: partnerId } : {}),
        Discount: Math.round((Number(order.discountAmount) || 0) + (Number(order.loyaltyDiscountAmount) || 0)),
        ExcessCash: 0,
        VAT: 0,
        ShippingCost: Math.round(Number(order.shippingFee) || 0),
        Total: Math.round(Number(order.totalAmount) || 0),
        TotalPayment: isPaid ? Math.min(Math.round(Number(payment.amount) || 0), Math.round(Number(order.totalAmount) || 0)) : 0,
        AccountId: accountId,
        OrderDetails: details,
      },
    };
    await this.requestJson(new URL("/api/orders", config.baseUrl), sessionId, { method: "POST", body: JSON.stringify(payload) });
    const accepted = await this.findOrder(config, sessionId, String(order.code));
    const acceptedId = asNumber(accepted?.Id);
    if (!accepted || acceptedId === null) throw new Error(`POS365 chưa xác nhận đơn ${order.code} sau khi ghi.`);
    if (Number(accepted.Status) !== status) throw new Error(`POS365 nhận đơn ${order.code} nhưng trạng thái chưa khớp.`);
    if (partnerId && asNumber(accepted.PartnerId) !== partnerId) throw new Error(`POS365 chưa gắn đúng hồ sơ khách cho đơn ${order.code}.`);
    return String(acceptedId);
  }

  private async upsertPartner(config: Pos365Config, sessionId: string, customer: Pos365Record) {
    const name = String(customer.name || "").trim();
    if (!name) throw new Error(`Hồ sơ khách hàng ${customer.id || ""} thiếu tên nên chưa thể đồng bộ POS365.`);
    const phone = String(customer.phone || "").trim();
    const email = String(customer.email || "").trim().toLowerCase();
    let existingId = asNumber(customer.pos365PartnerId);
    let existing: Pos365Record | null = null;
    if (existingId !== null && existingId > 0) {
      const found = await this.requestJson(new URL(`/api/partners/${existingId}`, config.baseUrl!), sessionId) as Pos365Record;
      existing = (found?.Partner || found) as Pos365Record;
      if (asNumber(existing?.Id) !== existingId) throw new Error(`POS365 không xác nhận hồ sơ khách ${name} đã lưu trước đó.`);
    } else {
      existing = await this.findPartner(config, sessionId, { phone, email });
      existingId = asNumber(existing?.Id);
    }

    const partner: Pos365Record = {
      Id: existingId ?? 0,
      Code: String(existing?.Code || ""),
      Type: 1,
      Name: name.slice(0, 160),
      Phone: phone || null,
      Email: email || null,
      Address: String(customer.defaultAddress || "").trim() || null,
    };
    let saved: Pos365Record | null = null;
    try {
      saved = await this.requestJson(new URL("/api/partners", config.baseUrl!), sessionId, {
        method: "POST",
        body: JSON.stringify({ Partner: partner }),
      }) as Pos365Record;
    } catch (error) {
      // If POS365 created the partner but the response was lost, find it by contact before retrying.
      if (existingId) throw error;
      existing = await this.findPartner(config, sessionId, { phone, email }).catch(() => null);
      if (!existing) throw error;
    }

    let partnerId = asNumber(saved?.Id ?? saved?.Partner?.Id ?? existing?.Id ?? existingId);
    if (partnerId === null || partnerId <= 0) {
      existing = await this.findPartner(config, sessionId, { phone, email });
      partnerId = asNumber(existing?.Id);
    }
    if (!Number.isSafeInteger(partnerId) || partnerId === null || partnerId <= 0) throw new Error(`POS365 chưa trả mã hồ sơ khách hàng ${name} sau khi lưu.`);
    const partnerIdText = String(partnerId);
    if (String(customer.pos365PartnerId || "") !== partnerIdText) {
      await this.prisma.customer.update({ where: { id: String(customer.id) }, data: { pos365PartnerId: partnerIdText } });
    }
    return partnerId;
  }

  private async findPartner(config: Pos365Config, sessionId: string, contact: { phone: string; email: string }) {
    const normalizePhone = (value: unknown) => {
      const digits = String(value || "").replace(/\D/g, "");
      return digits.startsWith("84") && digits.length >= 10 ? `0${digits.slice(2)}` : digits;
    };
    const searches: Array<{ field: "Phone" | "Email"; value: string; matches: (row: Pos365Record) => boolean }> = [];
    if (contact.phone) searches.push({ field: "Phone", value: contact.phone, matches: (row) => normalizePhone(row.Phone) === normalizePhone(contact.phone) });
    if (contact.email) searches.push({ field: "Email", value: contact.email, matches: (row) => String(row.Email || "").trim().toLowerCase() === contact.email.toLowerCase() });
    for (const search of searches) {
      const escaped = search.value.replace(/'/g, "''");
      const filter = encodeURIComponent(`Type eq 1 and ${search.field} eq '${escaped}'`);
      const page = await this.requestJson(new URL(`/api/partners?format=json&$top=100&$skip=0&$filter=${filter}`, config.baseUrl!), sessionId);
      const matches = this.rows(page).filter((row) => Number(row.Type) === 1 && search.matches(row));
      if (matches.length > 1) throw new Error(`POS365 có nhiều hồ sơ khách trùng ${search.field === "Phone" ? "số điện thoại" : "email"}; dừng để tránh gắn nhầm đơn.`);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  private async findOrder(config: Pos365Config, sessionId: string, code: string) {
    const filter = encodeURIComponent(`Code eq '${code.replace(/'/g, "''")}'`);
    const page = await this.requestJson(new URL(`/api/orders?format=json&$top=10&$skip=0&$filter=${filter}`, config.baseUrl!), sessionId);
    const matches = this.rows(page).filter((row) => String(row.Code || "") === code);
    if (matches.length > 1) throw new Error(`POS365 trả về nhiều đơn cùng mã ${code}; cần kiểm tra thủ công.`);
    return matches[0] || null;
  }

  async verifyOrderPayment(codeInput: string, expectedAmountInput: number) {
    if (!this.isSyncEnabled()) throw new BadRequestException("POS365 chưa được cấu hình để đối soát thanh toán.");
    const code = String(codeInput || "").trim();
    const expectedAmount = Number(expectedAmountInput);
    if (!code || !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) throw new BadRequestException("Mã đơn hoặc tổng tiền cần đối soát không hợp lệ.");

    const config = this.readConfiguration();
    const sessionId = await this.authenticate(config);
    const remote = await this.findOrder(config, sessionId, code);
    if (!remote) throw new ConflictException(`Không tìm thấy đơn ${code} trên POS365. Chưa ghi nhận đã thanh toán.`);
    if (String(remote.Code || "") !== code || Number(remote.BranchId) !== config.branchId) {
      throw new ConflictException(`Đơn ${code} trên POS365 không khớp mã đơn hoặc chi nhánh đã cấu hình.`);
    }
    if (Number(remote.Status) === 3) throw new ConflictException(`Đơn ${code} đã bị hủy trên POS365.`);
    const receivedAmount = Number(remote.TotalPayment);
    if (!Number.isSafeInteger(receivedAmount) || receivedAmount !== expectedAmount) {
      throw new ConflictException(`POS365 đang ghi nhận ${Number.isSafeInteger(receivedAmount) ? `${receivedAmount.toLocaleString("vi-VN")} ₫` : "không có số tiền hợp lệ"}; cần đúng ${expectedAmount.toLocaleString("vi-VN")} ₫. GEME chưa đánh dấu đã thanh toán.`);
    }
    return { orderCode: code, remoteOrderId: String(remote.Id), receivedAmount };
  }

  private async processPendingReceipts(onlyReceiptId?: string) {
    if (this.processingQueue || !this.isSyncEnabled()) return;
    this.processingQueue = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
      await this.prisma.inventoryReceipt.updateMany({
        where: { pos365SyncStatus: "SYNCING", pos365SyncLastAttemptAt: { lt: staleBefore } },
        data: { pos365SyncStatus: "RETRYING", pos365SyncNextAttemptAt: now },
      });
      const dueWhere: Pos365Record = {
        pos365SyncStatus: { in: ["PENDING", "RETRYING"] },
        OR: [{ pos365SyncNextAttemptAt: null }, { pos365SyncNextAttemptAt: { lte: now } }],
      };
      if (onlyReceiptId) dueWhere.id = onlyReceiptId;
      const receipts = await this.prisma.inventoryReceipt.findMany({
        where: dueWhere,
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
        take: onlyReceiptId ? 1 : 5,
        select: { id: true },
      });
      for (const row of receipts) {
        const claimedAt = new Date();
        const claim = await this.prisma.inventoryReceipt.updateMany({
          where: {
            id: row.id,
            pos365SyncStatus: { in: ["PENDING", "RETRYING"] },
            OR: [{ pos365SyncNextAttemptAt: null }, { pos365SyncNextAttemptAt: { lte: claimedAt } }],
          },
          data: { pos365SyncStatus: "SYNCING", pos365SyncAttempts: { increment: 1 }, pos365SyncLastAttemptAt: claimedAt, pos365SyncNextAttemptAt: null },
        });
        if (!claim.count) continue;
        const receipt = await this.prisma.inventoryReceipt.findUnique({
          where: { id: row.id },
          include: { items: { include: { product: { select: { name: true, price: true } }, variant: { select: { sku: true, quality: true, shape: true, beadSize: true, price: true } } } } },
        });
        if (!receipt) continue;
        try {
          const syncCode = await this.sendPurchaseReceipt(receipt);
          await this.prisma.inventoryReceipt.update({
            where: { id: receipt.id },
            data: { pos365SyncStatus: "SYNCED", pos365SyncCode: syncCode, pos365SyncError: null, pos365SyncNextAttemptAt: null, pos365SyncedAt: new Date() },
          });
          for (const productId of new Set(receipt.items.map((item) => item.productId).filter((id): id is string => typeof id === "string" && Boolean(id)))) {
            void this.queueProductImageSyncIfNeeded(productId).catch((error) => this.logger.warn("Không thể đưa ảnh SKU sau khi nhập kho vào hàng đợi POS365.", error));
          }
        } catch (error) {
          const attempts = Number(receipt.pos365SyncAttempts || 0) + 1;
          const delayMs = this.retryDelayMs(error, attempts);
          const message = this.safeErrorMessage(error).slice(0, 2000);
          await this.prisma.inventoryReceipt.update({
            where: { id: receipt.id },
            data: { pos365SyncStatus: "RETRYING", pos365SyncError: message, pos365SyncNextAttemptAt: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Phiếu ${receipt.receiptNo} chưa đồng bộ POS365; sẽ tự thử lại. ${message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi đồng bộ POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingQueue = false;
    }
  }

  private async processPendingProductPrices(onlyProductId?: string) {
    if (!this.isSyncEnabled()) return;
    if (this.processingProductPriceQueue) {
      if (onlyProductId) this.productPriceSyncRequests.add(onlyProductId);
      else this.productPriceSyncQueueRequested = true;
      return;
    }
    this.processingProductPriceQueue = true;
    let shouldDrainNextBatch = false;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 2 * 60 * 1000);
      await this.prisma.product.updateMany({
        where: { pos365PriceSyncStatus: "SYNCING", pos365PriceSyncLastAttemptAt: { lt: staleBefore } },
        data: { pos365PriceSyncStatus: "RETRYING", pos365PriceSyncNextAttemptAt: now },
      });
      const dueWhere: Pos365Record = {
        pos365PriceSyncStatus: { in: ["PENDING", "RETRYING"] },
        OR: [{ pos365PriceSyncNextAttemptAt: null }, { pos365PriceSyncNextAttemptAt: { lte: now } }],
        // Receipt sync creates missing POS products with their current prices.
        // Keep the price worker from racing that create and duplicating the SKU.
        inventoryReceiptItems: { none: { receipt: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } },
      };
      if (onlyProductId) dueWhere.id = onlyProductId;
      let priceCatalogSnapshot: Pos365ProductPriceSnapshot | null = null;
      if (!onlyProductId) {
        const cached = this.productPriceCatalogSnapshot;
        if (cached && cached.baseUrl === this.readConfiguration().baseUrl && Date.now() - cached.loadedAt < this.productPriceCatalogSnapshotTtlMs) {
          priceCatalogSnapshot = cached;
        } else {
          this.productPriceCatalogSnapshot = null;
          const dueCount = await this.prisma.product.count({ where: dueWhere });
          // A full POS catalog read is cheaper than a per-SKU lookup when a
          // substantial backlog is queued. Small/interactive edits continue
          // using exact SKU lookups so they remain fast and fresh.
          if (dueCount >= 25) {
            const config = this.readConfiguration();
            if (!config.baseUrl) throw new Error("Chưa cấu hình host POS365.");
            const sessionId = await this.authenticate(config);
            priceCatalogSnapshot = await this.loadProductPriceCatalogSnapshot(config, sessionId);
          }
        }
      }
      const products = await this.prisma.product.findMany({
        where: dueWhere,
        orderBy: { updatedAt: "asc" },
        // Keep two independent products in flight. POS requests are still
        // globally paced and bounded below, but network latency no longer
        // serializes every read/write/verify round trip.
        take: 2,
        select: { id: true },
      });
      const claimedProducts: { product: NonNullable<Awaited<ReturnType<typeof this.prisma.product.findUnique>>>; claimedAt: Date }[] = [];
      for (const row of products) {
        const claimedAt = new Date();
        const claim = await this.prisma.product.updateMany({
          where: {
            id: row.id,
            pos365PriceSyncStatus: { in: ["PENDING", "RETRYING"] },
            OR: [{ pos365PriceSyncNextAttemptAt: null }, { pos365PriceSyncNextAttemptAt: { lte: claimedAt } }],
          },
          data: {
            pos365PriceSyncStatus: "SYNCING",
            pos365PriceSyncAttempts: { increment: 1 },
            pos365PriceSyncLastAttemptAt: claimedAt,
            pos365PriceSyncNextAttemptAt: null,
          },
        });
        if (!claim.count) continue;
        const product = await this.prisma.product.findUnique({ where: { id: row.id }, include: { category: { select: { pricingMode: true } }, variants: { orderBy: { sortOrder: "asc" } } } });
        if (!product) continue;
        claimedProducts.push({ product, claimedAt });
      }
      await Promise.all(claimedProducts.map(async ({ product, claimedAt }) => {
        try {
          await this.sendProductPrices(product, priceCatalogSnapshot);
          void this.queueProductImageSyncIfNeeded(product.id).catch((error) => this.logger.warn("Không thể đưa ảnh SKU sau khi đồng bộ giá vào hàng đợi POS365.", error));
          // Do not overwrite a newer price edit that arrived while the POS call
          // was in flight. The edit resets the status/claim timestamp and must
          // remain pending for the next queue pass.
          await this.prisma.product.updateMany({
            where: { id: product.id, pos365PriceSyncStatus: "SYNCING", pos365PriceSyncLastAttemptAt: claimedAt },
            data: { pos365PriceSyncStatus: "SYNCED", pos365PriceSyncError: null, pos365PriceSyncNextAttemptAt: null, pos365PriceSyncedAt: new Date() },
          });
        } catch (error) {
          const attempts = Number(product.pos365PriceSyncAttempts || 0) + 1;
          const delayMs = this.retryDelayMs(error, attempts);
          const message = this.safeErrorMessage(error).slice(0, 2000);
          await this.prisma.product.updateMany({
            where: { id: product.id, pos365PriceSyncStatus: "SYNCING", pos365PriceSyncLastAttemptAt: claimedAt },
            data: { pos365PriceSyncStatus: "RETRYING", pos365PriceSyncError: message, pos365PriceSyncNextAttemptAt: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Giá SKU ${product.sku} chưa đồng bộ POS365; sẽ tự thử lại. ${message}`);
        }
      }));
      if (!onlyProductId) {
        const nextNow = new Date();
        shouldDrainNextBatch = (await this.prisma.product.count({
          where: {
            pos365PriceSyncStatus: { in: ["PENDING", "RETRYING"] },
            OR: [{ pos365PriceSyncNextAttemptAt: null }, { pos365PriceSyncNextAttemptAt: { lte: nextNow } }],
          },
        })) > 0;
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi đồng bộ giá POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingProductPriceQueue = false;
      const nextProductId = this.productPriceSyncRequests.values().next().value as string | undefined;
      if (nextProductId) {
        this.productPriceSyncRequests.delete(nextProductId);
        if (this.productPriceSyncQueueRequested || shouldDrainNextBatch) this.productPriceSyncQueueRequested = true;
        queueMicrotask(() => { void this.processPendingProductPrices(nextProductId); });
      } else if (this.productPriceSyncQueueRequested || shouldDrainNextBatch) {
        this.productPriceSyncQueueRequested = false;
        queueMicrotask(() => { void this.processPendingProductPrices(); });
      }
    }
  }

  private async publicProductImageUrl(value: unknown, sku: string): Promise<string> {
    const raw = String(value || "").trim();
    const mediaPath = raw.match(/^\/media\/([0-9a-f-]{36})\/?(?:[?#].*)?$/i);
    if (mediaPath) {
      const asset = await this.prisma.mediaAsset.findUnique({
        where: { id: mediaPath[1] },
        select: { isPrivate: true, storageProvider: true, objectKey: true },
      });
      if (!asset || asset.isPrivate || asset.storageProvider !== "r2" || !asset.objectKey) {
        throw new Pos365ImageUrlError(`Ảnh của SKU ${sku} chưa có object R2 công khai để chuyển sang POS365.`);
      }
      const publicBase = process.env.MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
      if (!publicBase) {
        throw new Pos365ImageUrlError("Thiếu MEDIA_PUBLIC_BASE_URL: cấu hình domain HTTPS của cổng ảnh công khai để POS365 truy cập ảnh.");
      }
      let baseUrl: URL;
      try { baseUrl = new URL(publicBase); } catch { throw new Pos365ImageUrlError("MEDIA_PUBLIC_BASE_URL chưa phải URL hợp lệ."); }
      if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.hostname === "localhost" || baseUrl.hostname.endsWith(".local") || baseUrl.hostname.endsWith(".internal")) {
        throw new Pos365ImageUrlError("MEDIA_PUBLIC_BASE_URL phải là domain HTTPS công khai của cổng ảnh.");
      }
      const encodedObjectKey = asset.objectKey.split("/").map((part) => encodeURIComponent(part)).join("/");
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/${encodedObjectKey}`;
      return baseUrl.toString();
    }
    let url: URL;
    try { url = new URL(raw); } catch { throw new Pos365ImageUrlError("Ảnh của SKU " + sku + " chưa có URL công khai hợp lệ."); }
    const host = url.hostname.toLocaleLowerCase("en");
    const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || privateIpv4 || host === "::1") {
      throw new Pos365ImageUrlError("Ảnh của SKU " + sku + " phải dùng URL HTTP/HTTPS công khai để POS365 truy cập.");
    }
    return url.toString();
  }

  private posProductImageRows(product: Pos365Record) {
    const field = Object.hasOwn(product, "ProductImages") ? product.ProductImages : product.productImages;
    if (field === undefined) throw new Error("POS365 chưa trả danh sách ảnh hiện tại; dừng đồng bộ để tránh tạo ảnh trùng hoặc xóa nhầm.");
    return Array.isArray(field) ? field as Pos365Record[] : [];
  }

  private async sendProductImages(product: Pos365Record): Promise<"SYNCED" | "SKIPPED"> {
    const config = this.readConfiguration();
    if (!config.baseUrl) throw new Error("Chưa cấu hình host POS365.");
    const gallery = (Array.isArray(product.images) ? product.images : []).map((image: Pos365Record) => String(image.url || "").trim()).filter(Boolean);
    const lines = product.variants?.length
      ? product.variants.map((variant: Pos365Record) => ({ sku: String(variant.sku || "").trim(), imageUrls: Array.isArray(variant.imageUrls) && variant.imageUrls.length ? variant.imageUrls : gallery }))
      : [{ sku: String(product.sku || "").trim(), imageUrls: gallery }];
    const preparedLines = await Promise.all(lines.map(async (line: Pos365Record) => ({
      ...line,
      imageUrls: [...new Set(await Promise.all((line.imageUrls as unknown[]).map((url: unknown) => this.publicProductImageUrl(url, line.sku))))],
    })));
    const sessionId = await this.authenticate(config);
    const missingSkus: string[] = [];
    let synced = 0;
    for (const line of preparedLines) {
      if (!line.sku) throw new Error("Sản phẩm " + product.sku + " có biến thể thiếu SKU; chưa đồng bộ ảnh.");
      const remote = await this.findRemoteProductByCode(config, sessionId, line.sku, true);
      if (!remote) { missingSkus.push(line.sku); continue; }
      if (normalizedCode(remote.Code) !== normalizedCode(line.sku)) throw new Error("SKU POS365 của mặt hàng " + line.sku + " không khớp; dừng để tránh gắn ảnh nhầm.");
      const remoteId = asNumber(remote.Id);
      if (!remoteId) throw new Error("POS365 không trả mã mặt hàng " + line.sku + " để gắn ảnh.");
      const currentImages = this.posProductImageRows(remote);
      const oldLinks = await this.prisma.pos365ProductImageSync.findMany({ where: { productId: product.id, sku: line.sku } });
      const managedIds = new Set(oldLinks.map((row) => row.pos365ImageId));
      const desiredUrls = line.imageUrls as string[];
      const available = [...currentImages];
      const selectedRemoteIds = new Set<string>();
      const desiredRows = desiredUrls.map((url, index) => {
        const matchIndex = available.findIndex((image) => String(image.ImageURL || image.imageUrl || "").trim() === url);
        const matched = matchIndex >= 0 ? available.splice(matchIndex, 1)[0] : null;
        const remoteImageId = matched ? String(matched.Id ?? matched.id ?? "").trim() : "";
        if (matched && !remoteImageId) throw new Error("POS365 trả ảnh không có mã để đồng bộ an toàn cho SKU " + line.sku + ".");
        if (remoteImageId) selectedRemoteIds.add(remoteImageId);
        const externalDefaultExists = currentImages.some((image) => {
          const id = String(image.Id ?? image.id ?? "").trim();
          return id && !managedIds.has(id) && !selectedRemoteIds.has(id) && Boolean(image.IsDefault ?? image.isDefault);
        });
        return {
          ...(matched || {}),
          Id: matched ? asNumber(matched.Id ?? matched.id) ?? 0 : 0,
          ProductId: remoteId,
          ImageURL: url,
          ThumbnailUrl: matched ? String(matched.ThumbnailUrl || matched.thumbnailUrl || url) : url,
          IsDefault: Boolean(matched?.IsDefault ?? matched?.isDefault) || (index === 0 && !externalDefaultExists),
        };
      });
      const retainedExternalImages = currentImages.filter((image) => {
        const id = String(image.Id ?? image.id ?? "").trim();
        if (!id) throw new Error("POS365 trả ảnh hiện tại không có mã; dừng để không làm mất ảnh của SKU " + line.sku + ".");
        return !managedIds.has(id) && !selectedRemoteIds.has(id);
      });
      const expectedExternalIds = retainedExternalImages.map((image) => String(image.Id ?? image.id));
      const expectedRemovedManagedIds = [...managedIds].filter((id) => !selectedRemoteIds.has(id));
      const productImages = [...desiredRows, ...retainedExternalImages];
      const expectedStandardPrice = asNumber(remote.Price) ?? 0;
      const expectedBranchPrice = asNumber(remote.PriceByBranch) ?? 0;
      const expectedCost = asNumber(remote.Cost) ?? 0;
      await this.requestJson(new URL("/api/products", config.baseUrl), sessionId, {
        method: "POST",
        body: JSON.stringify({ Product: {
          Id: remoteId,
          Code: String(remote.Code || line.sku),
          Name: String(remote.Name || product.name || line.sku).slice(0, 180),
          ProductType: asNumber(remote.ProductType) ?? 1,
          Price: Math.max(0, Math.round(expectedStandardPrice)),
          Cost: Math.max(0, expectedCost),
          Unit: String(remote.Unit || "Cái"),
          CategoryId: remote.CategoryId ?? null,
          ProductImages: productImages,
        }, PriceByBranch: Math.max(0, Math.round(expectedBranchPrice)) }),
      });
      const verified = await this.findRemoteProductByCode(config, sessionId, line.sku, true);
      if (!verified || asNumber(verified.Id) !== remoteId) throw new Error("POS365 chưa xác nhận lại đúng SKU " + line.sku + " sau khi lưu ảnh.");
      const standardPricePreserved = Math.round(Number(verified.Price) || 0) === Math.round(expectedStandardPrice);
      const branchPricePreserved = Math.round(Number(verified.PriceByBranch) || 0) === Math.round(expectedBranchPrice);
      const costPreserved = Math.abs((Number(verified.Cost) || 0) - expectedCost) < 0.01;
      if (!standardPricePreserved || !branchPricePreserved || !costPreserved) {
        throw new Error("POS365 chưa giữ nguyên giá bán, giá theo chi nhánh hoặc giá vốn của SKU " + line.sku + " khi lưu ảnh.");
      }
      const verifiedImages = this.posProductImageRows(verified);
      const savedUrls = verifiedImages.map((image) => String(image.ImageURL || image.imageUrl || "").trim()).filter(Boolean);
      const verifiedIds = new Set(verifiedImages.map((image) => String(image.Id ?? image.id ?? "").trim()).filter(Boolean));
      if (desiredUrls.some((url) => !savedUrls.includes(url))) throw new Error("POS365 chưa lưu đủ ảnh GEME của SKU " + line.sku + ".");
      if (expectedExternalIds.some((id) => !verifiedIds.has(id))) throw new Error("POS365 không giữ nguyên một ảnh có sẵn ngoài GEME của SKU " + line.sku + "; hệ thống dừng và sẽ thử lại.");
      if (expectedRemovedManagedIds.some((id) => verifiedIds.has(id))) throw new Error("POS365 chưa gỡ ảnh GEME đã bỏ khỏi SKU " + line.sku + ".");
      const links = desiredUrls.map((url) => {
        const saved = verifiedImages.find((image) => String(image.ImageURL || image.imageUrl || "").trim() === url);
        const pos365ImageId = String(saved?.Id ?? saved?.id ?? "").trim();
        if (!pos365ImageId) throw new Error("POS365 lưu ảnh nhưng không trả mã ảnh cho SKU " + line.sku + ".");
        return { productId: product.id, sku: line.sku, pos365ImageId, imageUrl: url };
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.pos365ProductImageSync.deleteMany({ where: { productId: product.id, sku: line.sku } });
        if (links.length) await tx.pos365ProductImageSync.createMany({ data: links, skipDuplicates: true });
      });
      synced++;
    }
    if (missingSkus.length && synced > 0) throw new Error("Chưa tìm thấy SKU trên POS365: " + missingSkus.join(", ") + ". Ảnh sẽ được thử lại sau khi SKU được đồng bộ.");
    if (missingSkus.length && synced === 0) return "SKIPPED";
    return synced ? "SYNCED" : "SKIPPED";
  }

  private async sendProductPrices(product: Pos365Record, snapshot: Pos365ProductPriceSnapshot | null = null) {
    const config = this.readConfiguration();
    if (!config.baseUrl) throw new Error("Chưa cấu hình host POS365.");
    const sessionId = await this.authenticate(config);
    const lines = product.variants?.length
      ? product.variants.map((variant: Pos365Record) => ({
          sku: String(variant.sku || (product.variants.length === 1 ? product.sku : "")).trim(),
          name: posVariantProductName(product.name || product.sku, variant),
          price: posVariantSellPrice(product, variant),
        }))
      : [{ sku: String(product.sku || "").trim(), name: String(product.name || product.sku).slice(0, 180), price: Math.round(Number(product.price) || 0) }];
    for (const line of lines) line.name = line.name.slice(0, 180);
    const uniqueLines = new Map<string, { sku: string; name: string; price: number }>();
    for (const line of lines) {
      if (!line.sku) throw new Error(`Biến thể của ${product.sku} chưa có SKU riêng; chưa thể đồng bộ giá theo từng biến thể.`);
      const key = normalizedCode(line.sku);
      const current = uniqueLines.get(key);
      if (current && current.price !== line.price) throw new Error(`SKU ${line.sku} đang gắn nhiều mức giá; cần cấp SKU riêng cho từng biến thể.`);
      if (!current) uniqueLines.set(key, line);
    }

    const changedLines: { line: { sku: string; name: string; price: number }; expectedImages: { id: string; url: string }[] | null; expectedBranchPrice: number | null; expectedCost: number | null }[] = [];
    for (const line of uniqueLines.values()) {
      const key = normalizedCode(line.sku);
      const cachedRows = snapshot?.byCode.get(key) || [];
      if (cachedRows.length > 1) throw new Error(`POS365 có nhiều mặt hàng dùng SKU ${line.sku}; dừng để tránh sửa nhầm.`);
      let existing = cachedRows[0] || null;
      let fetchedExact = false;
      if (!existing) {
        // A catalog snapshot can miss a SKU created by another POS workflow
        // after the snapshot was taken. Confirm only those misses directly.
        existing = await this.findRemoteProductByCode(config, sessionId, line.sku, true);
        fetchedExact = true;
        if (existing && snapshot) snapshot.byCode.set(key, [existing]);
      }
      if (!existing) {
        const created = await this.createProduct(config, sessionId, line.sku, line.name, line.price);
        if (snapshot) snapshot.byCode.set(key, [created]);
        changedLines.push({ line, expectedImages: null, expectedBranchPrice: line.price > 0 ? line.price : null, expectedCost: null });
      } else {
        let targetPrice = line.price > 0 ? line.price : Math.round(Number(existing.Price) || 0);
        let currentName = String(existing.Name || "").trim();
        let currentPrice = Math.round(Number(existing.Price) || 0);
        let currentBranchPrice = Math.round(Number(existing.PriceByBranch) || 0);
        let currentCost = Math.max(0, asNumber(existing.Cost) ?? 0);
        const branchPriceMatches = line.price <= 0 || currentBranchPrice === targetPrice;
        if (currentName !== line.name || currentPrice !== targetPrice || !branchPriceMatches) {
          if (!fetchedExact) {
            // Fetch the current product with its image collection immediately
            // before ProductSave. POS365 can replace omitted collections, so
            // the price writer must carry ProductImages through unchanged.
            existing = await this.findRemoteProductByCode(config, sessionId, line.sku, true);
            fetchedExact = true;
            if (!existing) throw new Error(`POS365 không còn tìm thấy SKU ${line.sku} trong lúc cập nhật giá.`);
            currentName = String(existing.Name || "").trim();
            currentPrice = Math.round(Number(existing.Price) || 0);
            currentBranchPrice = Math.round(Number(existing.PriceByBranch) || 0);
            currentCost = Math.max(0, asNumber(existing.Cost) ?? 0);
            targetPrice = line.price > 0 ? line.price : currentPrice;
            const freshBranchPriceMatches = line.price <= 0 || currentBranchPrice === targetPrice;
            if (currentName === line.name && currentPrice === targetPrice && freshBranchPriceMatches) {
              if (snapshot) snapshot.byCode.set(key, [existing]);
              continue;
            }
          }
          if (normalizedCode(existing.Code) !== normalizedCode(line.sku)) throw new Error(`SKU POS365 của mặt hàng ${line.sku} không khớp; dừng để tránh sửa nhầm mã.`);
          const currentImages = this.posProductImageRows(existing);
          const expectedImages = currentImages.map((image) => {
            const id = String(image.Id ?? image.id ?? "").trim();
            const url = String(image.ImageURL || image.imageUrl || "").trim();
            if (!id) throw new Error(`Ảnh POS365 của SKU ${line.sku} thiếu mã; dừng cập nhật giá để tránh làm mất ảnh.`);
            return { id, url };
          });
          const saved = await this.requestJson(new URL("/api/products", config.baseUrl), sessionId, {
            method: "POST",
            body: JSON.stringify({
              Product: {
                Id: Number(existing.Id),
                Code: String(existing.Code || line.sku),
                Name: String(line.name || existing.Name || line.sku).slice(0, 180),
                ProductType: asNumber(existing.ProductType) ?? 1,
                Price: targetPrice,
                Cost: currentCost,
                Unit: String(existing.Unit || "Cái"),
                CategoryId: existing.CategoryId ?? null,
                ProductImages: currentImages,
              },
              // POS365 ProductSave owns the standard list price and can also
              // set the branch selling price. Do not send this through the
              // custom pricebook import endpoint: the default “Giá niêm yết”
              // book is not a custom PriceBook record in every tenant.
              PriceByBranch: line.price > 0 ? targetPrice : currentBranchPrice,
            }),
          }) as Pos365Record;
          const savedId = asNumber(saved?.Id ?? saved?.Product?.Id);
          if (savedId !== null && savedId !== Number(existing.Id)) throw new Error(`POS365 trả về mã khác khi cập nhật giá SKU ${line.sku}.`);
          changedLines.push({ line, expectedImages, expectedBranchPrice: line.price > 0 ? targetPrice : null, expectedCost: currentCost });
        }
      }
    }

    const mismatches = [] as { sku: string; expectedName: string; actualName: string | null; expectedPrice: number | null; actualPrice: unknown; expectedBranchPrice: number | null; actualBranchPrice: unknown; expectedCost: number | null; actualCost: unknown }[];
    for (const { line, expectedImages, expectedBranchPrice, expectedCost } of changedLines) {
      const remote = await this.findRemoteProductByCode(config, sessionId, line.sku, expectedImages !== null);
      const nameMatches = String(remote?.Name || "").trim() === line.name;
      const priceMatches = line.price <= 0 || Math.round(Number(remote?.Price) || 0) === line.price;
      const branchPriceMatches = expectedBranchPrice === null || Math.round(Number(remote?.PriceByBranch) || 0) === expectedBranchPrice;
      const costMatches = expectedCost === null || Math.abs((Number(remote?.Cost) || 0) - expectedCost) < 0.01;
      if (!nameMatches || !priceMatches || !branchPriceMatches || !costMatches) mismatches.push({
        sku: line.sku,
        expectedName: line.name,
        actualName: remote?.Name ?? null,
        expectedPrice: line.price || null,
        actualPrice: remote?.Price ?? null,
        expectedBranchPrice,
        actualBranchPrice: remote?.PriceByBranch ?? null,
        expectedCost,
        actualCost: remote?.Cost ?? null,
      });
      if (expectedImages !== null) {
        const actualImages = this.posProductImageRows(remote || {});
        // POS365 can regenerate ProductImage IDs during ProductSave while
        // keeping the underlying image URL. Verify the stable URL and its
        // multiplicity; fall back to the ID only for legacy rows without URL.
        const actualUrlCounts = new Map<string, number>();
        const actualIds = new Set<string>();
        for (const image of actualImages) {
          const id = String(image.Id ?? image.id ?? "").trim();
          const url = String(image.ImageURL || image.imageUrl || "").trim();
          if (id) actualIds.add(id);
          if (url) actualUrlCounts.set(url, (actualUrlCounts.get(url) || 0) + 1);
        }
        const expectedUrlCounts = new Map<string, number>();
        for (const image of expectedImages) {
          if (image.url) expectedUrlCounts.set(image.url, (expectedUrlCounts.get(image.url) || 0) + 1);
        }
        const lostUrl = [...expectedUrlCounts.entries()].find(([url, count]) => (actualUrlCounts.get(url) || 0) < count);
        const lostLegacyImage = expectedImages.find((image) => !image.url && !actualIds.has(image.id));
        if (lostUrl || lostLegacyImage) {
          const lostImage = lostUrl?.[0] || lostLegacyImage?.id || "không rõ";
          throw new Error(`POS365 không giữ nguyên ảnh ${lostImage} của SKU ${line.sku} sau khi cập nhật giá; cần kiểm tra ảnh trước khi thử lại.`);
        }
      }
      if (snapshot && remote) snapshot.byCode.set(normalizedCode(line.sku), [remote]);
    }
    if (mismatches.length) {
      const details = mismatches.map((row) => `${row.sku}: giá chuẩn ${row.actualPrice ?? "—"}/${row.expectedPrice ?? "—"}, giá chi nhánh ${row.actualBranchPrice ?? "—"}/${row.expectedBranchPrice ?? "—"}, giá vốn ${row.actualCost ?? "—"}/${row.expectedCost ?? "—"}`).join("; ");
      throw new Error(`POS365 chưa lưu đúng tên, giá hoặc giữ nguyên giá vốn cho SKU: ${details}.`);
    }
  }

  private async sendPurchaseReceipt(receipt: Pos365Record) {
    const config = this.readConfiguration();
    if (!config.baseUrl || !config.branchId) throw new Error("Chưa cấu hình host hoặc chi nhánh POS365.");
    const sessionId = await this.authenticate(config);
    const catalog = await this.readProducts(config, sessionId);
    const details: Pos365Record[] = [];
    for (const item of receipt.items || []) {
      const sku = String(item.productSku || item.variant?.sku || "").trim();
      if (!sku) throw new Error(`Dòng hàng ${item.productName || "không tên"} thiếu SKU để ghép POS365.`);
      const productName = posVariantProductName(item.product?.name || item.productName || sku, item.variant);
      const salePrice = Number(item.variant?.price ?? item.product?.price) || 0;
      let remote = this.findProductByCode(catalog, sku);
      if (!remote) remote = await this.findRemoteProductByCode(config, sessionId, sku);
      if (!remote) remote = await this.createProduct(config, sessionId, sku, productName, salePrice);
      if (!this.findProductByCode(catalog, sku)) catalog.push(remote);
      details.push({ ProductId: Number(remote.Id), Quantity: Number(item.quantity), Price: Number(item.unitCost) });
    }

    const code = `GEME-${receipt.receiptNo}`;
    const existing = await this.findPurchaseOrder(config, sessionId, code);
    if (existing) {
      const existingBranchId = asNumber(existing.BranchId);
      if (existingBranchId !== null && existingBranchId !== config.branchId) throw new Error(`Mã phiếu POS365 ${code} đã tồn tại ở chi nhánh khác.`);
      if (Number(existing.Status) !== 2) throw new Error(`Mã phiếu POS365 ${code} đã tồn tại nhưng chưa hoàn thành; cần kiểm tra trong POS365 để tránh cộng tồn trùng.`);
      return code;
    }

    const payload = {
      PurchaseOrder: {
        Id: 0,
        Code: code,
        DocumentDate: new Date(receipt.receivedAt).toISOString().slice(0, 19).replace("T", " "),
        BranchId: config.branchId,
        Status: 2,
        Discount: Number(receipt.discountAmount) || 0,
        VAT: Number(receipt.vatAmount) || 0,
        Total: Number(receipt.subtotalAmount) || 0,
        TotalPayment: 0,
        PurchaseOrderDetails: details,
      },
    };
    try {
      await this.requestJson(new URL("/api/orderstock", config.baseUrl), sessionId, { method: "POST", body: JSON.stringify(payload) });
    } catch (error) {
      // If POS365 accepted the request but its response was lost, the deterministic code makes retry safe.
      const accepted = await this.findPurchaseOrder(config, sessionId, code).catch(() => null);
      if (!accepted || Number(accepted.Status) !== 2) throw error;
      const existingBranchId = asNumber(accepted.BranchId);
      if (existingBranchId !== null && existingBranchId !== config.branchId) throw error;
    }
    return code;
  }

  private async findPurchaseOrder(config: Pos365Config, sessionId: string, code: string) {
    const filter = encodeURIComponent(`Code eq '${code.replace(/'/g, "''")}'`);
    const page = await this.requestJson(new URL(`/api/orderstock?format=json&$top=10&$skip=0&$filter=${filter}`, config.baseUrl!), sessionId);
    const matches = this.rows(page).filter((row) => String(row.Code || "") === code);
    if (matches.length > 1) throw new Error(`POS365 trả về nhiều phiếu cùng mã ${code}; cần kiểm tra thủ công.`);
    return matches[0] || null;
  }

  private async createProduct(config: Pos365Config, sessionId: string, sku: string, name: string, price: number) {
    const saved = await this.requestJson(new URL("/api/products", config.baseUrl!), sessionId, {
      method: "POST",
      body: JSON.stringify({ Product: { Id: 0, Code: sku, Name: String(name || sku).slice(0, 180), ProductType: 1, Price: Math.max(0, Math.round(price)), Unit: "Cái", CategoryId: null }, PriceByBranch: Math.max(0, Math.round(price)) }),
    }) as Pos365Record;
    const id = asNumber(saved?.Id ?? saved?.Product?.Id);
    if (!id) throw new Error(`POS365 không trả mã mặt hàng sau khi tạo SKU ${sku}.`);
    return { ...saved, Id: id, Code: String(saved.Code || sku), Name: String(saved.Name || name), OnHand: asNumber(saved.OnHand) ?? 0, TotalOnHand: asNumber(saved.TotalOnHand) ?? 0 };
  }

  private findProductByCode(catalog: Pos365Record[], sku: string) {
    const key = normalizedCode(sku);
    const matches = catalog.filter((product) => normalizedCode(product.Code) === key);
    if (matches.length > 1) throw new Error(`POS365 có nhiều mặt hàng dùng SKU ${sku}; dừng để tránh nhập nhầm.`);
    return matches[0] || null;
  }

  private async findRemoteProductByCode(config: Pos365Config, sessionId: string, sku: string, includeImages = false) {
    const code = sku.trim();
    const filter = encodeURIComponent(`Code eq '${code.replace(/'/g, "''")}'`);
    const pageUrl = new URL(`/api/products?format=json&$top=10&$skip=0&$filter=${filter}`, config.baseUrl!);
    if (includeImages) pageUrl.searchParams.append("Includes", "ProductImages");
    const page = await this.requestJson(pageUrl, sessionId);
    const matches = this.rows(page).filter((product) => normalizedCode(product.Code) === normalizedCode(code)) as Pos365Record[];
    if (matches.length > 1) throw new Error(`POS365 có nhiều mặt hàng dùng SKU ${sku}; dừng để tránh sửa nhầm.`);
    return matches[0] || null;
  }

  private async readProducts(config: Pos365Config, sessionId: string) {
    const all: Pos365Record[] = [];
    const pageSize = 500;
    let skip = 0;
    let expected = Number.POSITIVE_INFINITY;
    while (skip < expected) {
      const page = await this.requestJson(new URL(`/api/products?format=json&$top=${pageSize}&$skip=${skip}`, config.baseUrl!), sessionId);
      const rows = this.rows(page) as Pos365Record[];
      all.push(...rows);
      const count = asNumber((page as Pos365Record)?.__count);
      if (count !== null) expected = count;
      if (rows.length === 0) break;
      skip += rows.length;
      // POS365 may cap a requested $top=500 page to 100 rows while still
      // returning the full __count. Keep paging until that count is reached;
      // otherwise only the first page is cached and every later SKU triggers
      // a slow one-by-one lookup (or is missed by callers that rely on this
      // catalog snapshot).
      if (count === null && rows.length < pageSize) break;
      if (skip > 100000) throw new Error("Danh mục POS365 vượt giới hạn phân trang an toàn.");
    }
    return all;
  }

  private async loadProductPriceCatalogSnapshot(config: Pos365Config, sessionId: string) {
    if (!config.baseUrl) throw new Error("Chưa cấu hình host POS365.");
    const products = await this.readProducts(config, sessionId);
    const byCode = new Map<string, Pos365Record[]>();
    for (const product of products) {
      const key = normalizedCode(product.Code);
      if (!key) continue;
      const matches = byCode.get(key) || [];
      matches.push(product);
      byCode.set(key, matches);
    }
    const snapshot: Pos365ProductPriceSnapshot = { baseUrl: config.baseUrl, loadedAt: Date.now(), byCode };
    this.productPriceCatalogSnapshot = snapshot;
    return snapshot;
  }

  private rows(value: unknown): Pos365Record[] {
    const record = value && typeof value === "object" ? value as Pos365Record : {};
    if (Array.isArray(record.results)) return record.results as Pos365Record[];
    if (Array.isArray(record.data)) return record.data as Pos365Record[];
    if (Array.isArray(value)) return value as Pos365Record[];
    return [];
  }

  private async authenticate(config: Pos365Config) {
    const cached = this.cachedSession;
    if (cached && cached.baseUrl === config.baseUrl && cached.username === config.username && cached.expiresAt > Date.now()) {
      return cached.sessionId;
    }
    const response = await this.fetchPos365(new URL("/api/auth", config.baseUrl!), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ UserName: config.username, Password: config.password }),
      cache: "no-store",
    });
    if (response.status === 401) throw new Error("POS365 từ chối thông tin đăng nhập.");
    const auth = await this.responseBody(response);
    const sessionId = typeof auth?.SessionId === "string" ? auth.SessionId : "";
    if (!/^[A-Za-z0-9._~-]+$/.test(sessionId)) throw new Error("POS365 không trả về SessionId hợp lệ.");
    this.cachedSession = { baseUrl: config.baseUrl!, username: config.username, sessionId, expiresAt: Date.now() + 2 * 60 * 1000 };
    return sessionId;
  }

  private async requestJson(url: URL, sessionId: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("cookie", `ss-id=${sessionId}`);
    if (init.body) headers.set("content-type", "application/json");
    const response = await this.fetchPos365(url, { ...init, headers, cache: "no-store" });
    if (response.status === 401) this.cachedSession = null;
    return this.responseBody(response);
  }

  private async responseBody(response: Response): Promise<any> {
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
    if (!response.ok) {
      const message = body?.ResponseStatus?.Message || body?.message || body?.Message || `POS365 trả về lỗi HTTP ${response.status}.`;
      const rateLimited = response.status === 429 || /TooManyRequests|rate.?limit/i.test(String(message));
      const retryAfterMs = this.parseRetryAfter(response.headers.get("retry-after"));
      // POS365 sometimes returns its TooManyRequests envelope with a non-429
      // HTTP status. Treat the payload as a global rate limit too, otherwise
      // each worker keeps hammering the same endpoint while individual rows
      // back off independently.
      throw new Pos365HttpError(String(message).slice(0, 500), rateLimited ? 429 : response.status, retryAfterMs);
    }
    return body;
  }

  private safeErrorMessage(error: unknown) {
    if (error instanceof Pos365HttpError && error.status === 429) {
      const retrySeconds = Math.ceil((error.retryAfterMs ?? 60_000) / 1000);
      return `POS365 đang giới hạn số request; hệ thống sẽ tạm dừng và thử lại sau khoảng ${retrySeconds} giây.`;
    }
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return "POS365 phản hồi quá thời gian chờ; hệ thống sẽ tự thử lại.";
    return error instanceof Error ? error.message : "Không thể gọi POS365.";
  }

  private retryDelayMs(error: unknown, attempts: number) {
    const exponentialDelay = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.min(attempts - 1, 7)));
    if (!(error instanceof Pos365HttpError) || error.status !== 429) return exponentialDelay;
    return Math.max(exponentialDelay, error.retryAfterMs ?? 60_000);
  }

  private parseRetryAfter(value: string | null) {
    const header = String(value || "").trim();
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60 * 60 * 1000, seconds * 1000);
    const timestamp = Date.parse(header);
    if (!Number.isFinite(timestamp)) return null;
    return Math.min(60 * 60 * 1000, Math.max(0, timestamp - Date.now()));
  }

  private async fetchPos365(url: URL, init: RequestInit) {
    let slotReserved = false;
    while (!slotReserved) {
      let release = () => {};
      const previous = this.posRequestQueue;
      this.posRequestQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      let waitMs = Math.max(0, this.posRequestNotBefore - Date.now());
      if (this.activePosRequests >= this.maxConcurrentPosRequests) waitMs = Math.max(waitMs, 100);
      if (waitMs === 0) {
        this.activePosRequests += 1;
        this.posRequestNotBefore = Date.now() + this.posRequestIntervalMs;
        slotReserved = true;
      }
      release();
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      // Start the network timeout after the serialized/rate-limit wait, or a
      // request can expire before it reaches POS365 while waiting its turn.
      const response = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(20000) });
      // Keep the global request gate until the response body is consumed. A
      // POS response can arrive with headers first and stream its body later;
      // releasing the gate at headers would let the next worker overlap it.
      const payload = await response.arrayBuffer();
      const bufferedBody = [204, 205, 304].includes(response.status) ? null : payload;
      const bufferedResponse = new Response(bufferedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      if (response.status === 429) {
        this.pauseForRateLimit(this.parseRetryAfter(response.headers.get("retry-after")));
      } else if (response.ok) {
        this.posRateLimitStreak = 0;
      } else {
        let body: Pos365Record = {};
        try { body = payload.byteLength ? JSON.parse(new TextDecoder().decode(payload)) : {}; } catch { /* responseBody keeps the existing text fallback */ }
        const message = body?.ResponseStatus?.Message || body?.message || body?.Message || "";
        if (/TooManyRequests|rate.?limit/i.test(String(message))) {
          this.pauseForRateLimit(this.parseRetryAfter(response.headers.get("retry-after")));
        }
      }
      return bufferedResponse;
    } catch (error) {
      this.posRequestNotBefore = Math.max(this.posRequestNotBefore, Date.now() + 5000);
      throw error;
    } finally {
      this.activePosRequests = Math.max(0, this.activePosRequests - 1);
    }
  }

  private pauseForRateLimit(retryAfterMs: number | null) {
    this.posRateLimitStreak = Math.min(this.posRateLimitStreak + 1, 5);
    const serverDelay = retryAfterMs ?? 60_000;
    const backoffDelay = Math.min(15 * 60 * 1000, 60_000 * (2 ** (this.posRateLimitStreak - 1)));
    this.posRequestNotBefore = Math.max(this.posRequestNotBefore, Date.now() + Math.max(serverDelay, backoffDelay));
  }

  private readConfiguration(): Pos365Config {
    const rawBaseUrl = process.env.POS365_API_BASE_URL?.trim() ?? "";
    let baseUrl: string | null = null;
    if (rawBaseUrl) {
      try {
        const parsed = new URL(rawBaseUrl);
        const validStoreHost = /^[a-z0-9-]+\.pos365\.vn$/i.test(parsed.hostname) && parsed.hostname.toLowerCase() !== "api.pos365.vn";
        if (parsed.protocol === "https:" && validStoreHost && (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash) baseUrl = parsed.origin;
      } catch {
        // Do not echo configured credentials or malformed connection values to callers.
      }
    }
    const branchNumber = Number(process.env.POS365_BRANCH_ID);
    return {
      rawBaseUrl,
      baseUrl,
      username: process.env.POS365_USERNAME?.trim() ?? "",
      password: process.env.POS365_PASSWORD ?? "",
      enabled: process.env.POS365_ENABLED?.trim().toLowerCase() === "true",
      branchId: Number.isSafeInteger(branchNumber) && branchNumber > 0 ? branchNumber : null,
    };
  }
}
