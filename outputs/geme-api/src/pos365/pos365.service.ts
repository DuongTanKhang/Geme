import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type Pos365Status = {
  configured: boolean;
  storeConfigured: boolean;
  credentialsConfigured: boolean;
  syncEnabled: boolean;
  branchIdConfigured: boolean;
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

const normalizedCode = (value: unknown) => String(value || "").trim().toLocaleUpperCase("en");
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
  private processingProductStockQueue = false;
  private processingOrderQueue = false;
  private cachedSession: { baseUrl: string; username: string; sessionId: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!this.isSyncEnabled()) return;
    this.syncTimer = setInterval(() => {
      void this.processPendingReceipts();
      void this.processPendingProductPrices();
      void this.processPendingProductStocks();
      void this.processPendingOrders();
    }, 15000);
    this.syncTimer.unref?.();
    void this.processPendingReceipts();
    void this.processPendingProductPrices();
    void this.prisma.product.updateMany({
      where: { pos365StockSyncStatus: "DISABLED" },
      data: { pos365StockSyncStatus: "PENDING", pos365StockSyncNextAttemptAt: new Date(), pos365StockSyncError: null },
    }).then(() => this.processPendingProductStocks()).catch((error) => this.logger.error(`Không thể đưa tồn kho POS365 vào hàng đợi: ${this.safeErrorMessage(error)}`));
    void this.processPendingOrders();
    void this.processPendingProductStocks();
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
      include: { variants: { orderBy: { sortOrder: "asc" } } },
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
          const label = [variant.quality, variant.beadSize].filter(Boolean).join(" · ");
          if (linesBySku.has(key)) throw new Error(`SKU ${sku} bị lặp giữa nhiều biến thể hoặc sản phẩm; chưa thể đồng bộ tồn an toàn.`);
          linesBySku.set(key, { sku, name: label ? `${product.name} · ${label}` : product.name, price: Number(variant.price) || 0, stock: variant.stock });
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

  async syncProductPricesNow(productId: string) {
    if (!this.isSyncEnabled()) return;
    await this.processPendingProductPrices(productId);
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
      for (const row of products) {
        const [pendingReceipts, pendingOrders] = await Promise.all([
          this.prisma.inventoryReceiptItem.count({ where: { productId: row.id, receipt: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } }),
          this.prisma.orderItem.count({ where: { productId: row.id, order: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } } }),
        ]);
        if (pendingReceipts || pendingOrders) continue;
        const claimedAt = new Date();
        const claim = await this.prisma.product.updateMany({
          where: {
            id: row.id,
            pos365StockSyncStatus: { in: ["PENDING", "RETRYING"] },
            OR: [{ pos365StockSyncNextAttemptAt: null }, { pos365StockSyncNextAttemptAt: { lte: claimedAt } }],
        },
          data: { pos365StockSyncStatus: "SYNCING", pos365StockSyncAttempts: { increment: 1 }, pos365StockSyncLastAttemptAt: claimedAt, pos365StockSyncNextAttemptAt: null },
        });
        if (!claim.count) continue;
        try {
          await this.syncProductStockById(row.id);
          await this.prisma.product.updateMany({
            where: { id: row.id, pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: claimedAt },
            data: { pos365StockSyncStatus: "SYNCED", pos365StockSyncError: null, pos365StockSyncNextAttemptAt: null, pos365StockSyncedAt: new Date() },
          });
        } catch (error) {
          const latest = await this.prisma.product.findUnique({ where: { id: row.id }, select: { pos365StockSyncAttempts: true } });
          const attempts = Number(latest?.pos365StockSyncAttempts || 1);
          const delayMs = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.min(attempts - 1, 7)));
          const message = this.safeErrorMessage(error).slice(0, 2000);
          await this.prisma.product.updateMany({
            where: { id: row.id, pos365StockSyncStatus: "SYNCING", pos365StockSyncLastAttemptAt: claimedAt },
            data: { pos365StockSyncStatus: "RETRYING", pos365StockSyncError: message, pos365StockSyncNextAttemptAt: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Tồn SKU ${row.id} chưa đồng bộ POS365; sẽ tự thử lại. ${message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi tồn kho POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingProductStockQueue = false;
    }
  }

  private async syncProductStockById(productId: string) {
    const config = this.readConfiguration();
    if (!this.isSyncEnabled() || !config.baseUrl || !config.branchId) throw new Error("POS365 chưa bật đồng bộ tồn hoặc chưa chọn chi nhánh.");
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
    if (!product) return;
    const targetLines = product.variants.length
      ? product.variants.map((variant) => ({ sku: String(variant.sku || "").trim(), name: `${product.name}${[variant.quality, variant.beadSize].filter(Boolean).length ? ` · ${[variant.quality, variant.beadSize].filter(Boolean).join(" · ")}` : ""}`, price: Number(variant.price) || 0, stock: variant.stock }))
      : [{ sku: String(product.sku || "").trim(), name: product.name, price: Number(product.price) || 0, stock: product.stock }];
    const seen = new Set<string>();
    for (const line of targetLines) {
      const key = normalizedCode(line.sku);
      if (!key || seen.has(key)) throw new Error(`SKU biến thể của ${product.name} bị thiếu hoặc trùng; tồn chưa được ghi sang POS365.`);
      seen.add(key);
    }
    const sessionId = await this.authenticate(config);
    let catalog = await this.readProducts(config, sessionId);
    for (const line of targetLines) {
      if (this.findProductByCode(catalog, line.sku)) continue;
      catalog.push(await this.createProduct(config, sessionId, line.sku, line.name, line.price));
    }
    catalog = await this.readProducts(config, sessionId);
    const details = targetLines.map((line) => {
      const remote = this.findProductByCode(catalog, line.sku);
      if (!remote) throw new Error(`POS365 chưa có mặt hàng ${line.sku}.`);
      const onHand = asNumber(remote.OnHand ?? remote.TotalOnHand);
      if (onHand === null) throw new Error(`Không đọc được tồn POS365 hiện tại của ${line.sku}.`);
      return { ProductId: Number(remote.Id), ActualCount: line.stock, OnHand: onHand, Cost: asNumber(remote.Cost ?? remote.AverageCost) ?? 0 };
    });
    const code = `GEME-STK-${product.id.replace(/-/g, "").slice(0, 8).toUpperCase()}-${Date.now()}`;
    await this.requestJson(new URL("/api/inventorycount", config.baseUrl), sessionId, {
      method: "POST",
      body: JSON.stringify({ InventoryCount: { Id: 0, Code: code, Status: 2, AdjustmentDate: new Date().toISOString().slice(0, 19).replace("T", " "), BranchId: config.branchId, InventoryCountDetails: details } }),
    });
    const verifiedCatalog = await this.readProducts(config, sessionId);
    const mismatches = targetLines.flatMap((line) => {
      const actual = asNumber(this.findProductByCode(verifiedCatalog, line.sku)?.OnHand ?? this.findProductByCode(verifiedCatalog, line.sku)?.TotalOnHand);
      return actual === line.stock ? [] : [{ sku: line.sku, expected: line.stock, actual }];
    });
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
    const products = await this.prisma.product.findMany({ include: { variants: true } });
    const now = new Date();
    let queued = 0;
    let skippedWithoutPrice = 0;
    for (const product of products) {
      const prices = product.variants.length ? product.variants.map((variant) => Number(variant.price)) : [Number(product.price)];
      if (!prices.length || prices.some((price) => !Number.isFinite(price) || price <= 0)) {
        skippedWithoutPrice += 1;
        continue;
      }
      await this.prisma.product.update({
        where: { id: product.id },
        data: { pos365PriceSyncStatus: "PENDING", pos365PriceSyncNextAttemptAt: now, pos365PriceSyncError: null },
      });
      queued += 1;
    }
    void this.processPendingProductPrices();
    return { queued, skippedWithoutPrice };
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
    const [receiptPending, receiptFailed, pricePending, priceFailed, stockPending, stockFailed, orderPending, orderFailed, syncedOrders] = await Promise.all([
      this.prisma.inventoryReceipt.count({ where: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.inventoryReceipt.count({ where: { pos365SyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365PriceSyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.product.count({ where: { pos365PriceSyncStatus: "FAILED" } }),
      this.prisma.product.count({ where: { pos365StockSyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.product.count({ where: { pos365StockSyncStatus: "FAILED" } }),
      this.prisma.order.count({ where: { pos365SyncStatus: { in: ["PENDING", "RETRYING", "SYNCING"] } } }),
      this.prisma.order.count({ where: { pos365SyncStatus: "BLOCKED" } }),
      this.prisma.order.count({ where: { pos365SyncStatus: "SYNCED" } }),
    ]);
    return { receipts: { pending: receiptPending, failed: receiptFailed }, prices: { pending: pricePending, failed: priceFailed }, stocks: { pending: stockPending, failed: stockFailed }, orders: { pending: orderPending, blocked: orderFailed, synced: syncedOrders } };
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
        const order = await this.prisma.order.findUnique({ where: { id: row.id }, include: { items: true, payments: { orderBy: { createdAt: "asc" } } } });
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
          const delayMs = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.min(attempts - 1, 7)));
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
        Discount: Math.round(Number(order.discountAmount) || 0),
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
    return String(acceptedId);
  }

  private async findOrder(config: Pos365Config, sessionId: string, code: string) {
    const filter = encodeURIComponent(`Code eq '${code.replace(/'/g, "''")}'`);
    const page = await this.requestJson(new URL(`/api/orders?format=json&$top=10&$skip=0&$filter=${filter}`, config.baseUrl!), sessionId);
    const matches = this.rows(page).filter((row) => String(row.Code || "") === code);
    if (matches.length > 1) throw new Error(`POS365 trả về nhiều đơn cùng mã ${code}; cần kiểm tra thủ công.`);
    return matches[0] || null;
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
          include: { items: { include: { product: { select: { name: true, price: true } }, variant: { select: { sku: true, quality: true, beadSize: true, price: true } } } } },
        });
        if (!receipt) continue;
        try {
          const syncCode = await this.sendPurchaseReceipt(receipt);
          await this.prisma.inventoryReceipt.update({
            where: { id: receipt.id },
            data: { pos365SyncStatus: "SYNCED", pos365SyncCode: syncCode, pos365SyncError: null, pos365SyncNextAttemptAt: null, pos365SyncedAt: new Date() },
          });
        } catch (error) {
          const attempts = Number(receipt.pos365SyncAttempts || 0) + 1;
          const delayMs = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.min(attempts - 1, 7)));
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
    if (this.processingProductPriceQueue || !this.isSyncEnabled()) return;
    this.processingProductPriceQueue = true;
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
      };
      if (onlyProductId) dueWhere.id = onlyProductId;
      const products = await this.prisma.product.findMany({
        where: dueWhere,
        orderBy: { updatedAt: "asc" },
        take: onlyProductId ? 1 : 10,
        select: { id: true },
      });
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
        const product = await this.prisma.product.findUnique({ where: { id: row.id }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
        if (!product) continue;
        try {
          await this.sendProductPrices(product);
          await this.prisma.product.update({
            where: { id: product.id },
            data: { pos365PriceSyncStatus: "SYNCED", pos365PriceSyncError: null, pos365PriceSyncNextAttemptAt: null, pos365PriceSyncedAt: new Date() },
          });
        } catch (error) {
          const attempts = Number(product.pos365PriceSyncAttempts || 0) + 1;
          const delayMs = Math.min(60 * 60 * 1000, 15000 * (2 ** Math.min(attempts - 1, 7)));
          const message = this.safeErrorMessage(error).slice(0, 2000);
          await this.prisma.product.update({
            where: { id: product.id },
            data: { pos365PriceSyncStatus: "RETRYING", pos365PriceSyncError: message, pos365PriceSyncNextAttemptAt: new Date(Date.now() + delayMs) },
          });
          this.logger.warn(`Giá SKU ${product.sku} chưa đồng bộ POS365; sẽ tự thử lại. ${message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Không xử lý được hàng đợi đồng bộ giá POS365: ${this.safeErrorMessage(error)}`);
    } finally {
      this.processingProductPriceQueue = false;
    }
  }

  private async sendProductPrices(product: Pos365Record) {
    const config = this.readConfiguration();
    if (!config.baseUrl) throw new Error("Chưa cấu hình host POS365.");
    const sessionId = await this.authenticate(config);
    const lines = product.variants?.length
      ? product.variants.map((variant: Pos365Record) => ({
          sku: String(variant.sku || (product.variants.length === 1 ? product.sku : "")).trim(),
          name: `${product.name}${[variant.quality, variant.beadSize].filter(Boolean).length ? ` · ${[variant.quality, variant.beadSize].filter(Boolean).join(" · ")}` : ""}`,
          price: Math.round(Number(variant.price) || 0),
        }))
      : [{ sku: String(product.sku || "").trim(), name: String(product.name || product.sku), price: Math.round(Number(product.price) || 0) }];
    const uniqueLines = new Map<string, { sku: string; name: string; price: number }>();
    for (const line of lines) {
      if (!line.sku) throw new Error(`Biến thể của ${product.sku} chưa có SKU riêng; chưa thể đồng bộ giá theo từng biến thể.`);
      if (line.price <= 0) throw new Error(`SKU ${line.sku} chưa có giá bán dương trong Hồ sơ giá.`);
      const key = normalizedCode(line.sku);
      const current = uniqueLines.get(key);
      if (current && current.price !== line.price) throw new Error(`SKU ${line.sku} đang gắn nhiều mức giá; cần cấp SKU riêng cho từng biến thể.`);
      if (!current) uniqueLines.set(key, line);
    }

    const catalog = await this.readProducts(config, sessionId);
    for (const line of uniqueLines.values()) {
      const existing = this.findProductByCode(catalog, line.sku);
      if (!existing) {
        const created = await this.createProduct(config, sessionId, line.sku, line.name, line.price);
        catalog.push(created);
      } else if (Math.round(Number(existing.Price) || 0) !== line.price) {
        const saved = await this.requestJson(new URL("/api/products", config.baseUrl), sessionId, {
          method: "POST",
          body: JSON.stringify({
            Product: {
              Id: Number(existing.Id),
              Code: String(existing.Code || line.sku),
              Name: String(line.name || existing.Name || line.sku).slice(0, 180),
              ProductType: asNumber(existing.ProductType) ?? 1,
              Price: line.price,
              Unit: String(existing.Unit || "Cái"),
              CategoryId: existing.CategoryId ?? null,
            },
          }),
        }) as Pos365Record;
        const savedId = asNumber(saved?.Id ?? saved?.Product?.Id);
        if (savedId !== null && savedId !== Number(existing.Id)) throw new Error(`POS365 trả về mã khác khi cập nhật giá SKU ${line.sku}.`);
      }
    }

    const verified = await this.readProducts(config, sessionId);
    const mismatches = [...uniqueLines.values()].flatMap((line) => {
      const remote = this.findProductByCode(verified, line.sku);
      return Math.round(Number(remote?.Price) || 0) === line.price ? [] : [{ sku: line.sku, expected: line.price, actual: remote?.Price ?? null }];
    });
    if (mismatches.length) throw new Error(`POS365 chưa lưu đúng giá cho: ${mismatches.map((row) => row.sku).join(", ")}.`);
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
      const variantLabel = [item.variant?.quality, item.variant?.beadSize].filter(Boolean).join(" · ");
      const productName = variantLabel ? `${item.productName} · ${variantLabel}` : item.productName;
      const salePrice = Number(item.variant?.price ?? item.product?.price) || 0;
      const remote = this.findProductByCode(catalog, sku) || await this.createProduct(config, sessionId, sku, productName, salePrice);
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
      body: JSON.stringify({ Product: { Id: 0, Code: sku, Name: String(name || sku).slice(0, 180), ProductType: 1, Price: Math.max(0, Math.round(price)), Unit: "Cái", CategoryId: null } }),
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
      if (rows.length < pageSize) break;
      skip += rows.length;
      if (skip > 100000) throw new Error("Danh mục POS365 vượt giới hạn phân trang an toàn.");
    }
    return all;
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
    const response = await fetch(new URL("/api/auth", config.baseUrl!), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ UserName: config.username, Password: config.password }),
      signal: AbortSignal.timeout(20000),
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
    const response = await fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(20000), cache: "no-store" });
    if (response.status === 401) this.cachedSession = null;
    return this.responseBody(response);
  }

  private async responseBody(response: Response): Promise<any> {
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
    if (!response.ok) {
      const message = body?.ResponseStatus?.Message || body?.message || body?.Message || `POS365 trả về lỗi HTTP ${response.status}.`;
      throw new Error(String(message).slice(0, 500));
    }
    return body;
  }

  private safeErrorMessage(error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return "POS365 phản hồi quá thời gian chờ; hệ thống sẽ tự thử lại.";
    return error instanceof Error ? error.message : "Không thể gọi POS365.";
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
