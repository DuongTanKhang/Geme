import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Observable, Subject, interval, merge, map } from "rxjs";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { Pos365Service } from "../pos365/pos365.service.js";
import { MediaAssetsService } from "../media/media-assets.service.js";
import { ensureCustomerForPaidOrder } from "./customer-profile.js";
import { sanitizeBlogHtml } from "./blog-html.js";
import { calculateCheckoutPrice, getCheckoutPromotionValue, loadActiveStorePromotions, type CheckoutPromotion } from "./checkout-pricing.js";
import { canTransitionOrder } from "./order-state.js";
import { getInventoryReservationExpiry } from "./reservation-expiry.js";
import { synchronizeBangleVariantMedia } from "./bangle-variant-media.js";

type Input = Record<string, any>;
const inventoryReceiptDuplicateWindowMs = 5 * 60 * 1000;
const slugify = (value: string) => String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `item-${Date.now()}`;
const gemstoneSizeSkuToken = (value: string) => value.trim().toLocaleUpperCase("en").replace(/([0-9])[.,]([0-9])/g, "$1P$2").replace(/[^A-Z0-9]/g, "");
const gemstoneCutSkuToken = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
const gemstoneOptionKey = (cut: string, size: string, carat: string, gemstoneQuality: string) => carat || gemstoneQuality
  ? `${cut}::${size}::${carat}::${gemstoneQuality}`
  : `${cut}::${size}`;
const gemstoneCaratSkuToken = (value: string) => value.trim().replace(/([0-9])[.,]([0-9])/g, "$1P$2").replace(/[^0-9A-Za-z]/g, "").toLocaleUpperCase("en");
const gemstoneQualitySkuToken = (value: string) => gemstoneCutSkuToken(value).slice(0, 16);
const bangleShapeLabel = (value: unknown) => ({ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" } as Record<string, string>)[String(value || "").trim().toLocaleUpperCase("en")] || "";
const bangleVariantSku = (productSku: string, shape: unknown, quality: unknown, beadSize: unknown) => {
  const shapeToken = ({ ROUND: "R", OVAL: "O", SQUARE: "SQ" } as Record<string, string>)[String(shape || "").trim().toLocaleUpperCase("en")];
  const gradeText = String(quality || "").trim().toLocaleUpperCase("en");
  const grade = gradeText === "A" ? 1 : Number(gradeText.match(/^(\d{1,2})A$/)?.[1]);
  const sizeText = String(beadSize || "").trim().match(/^(\d{1,2})(?:\s*MM)?$/i)?.[1];
  const size = Number(sizeText);
  if (!shapeToken || !Number.isInteger(grade) || grade < 1 || grade > 99 || !sizeText || size < 1 || size > 99) {
    throw new BadRequestException("Mỗi biến thể kiềng cần dáng tròn/oval/vuông, chất lượng A/2A… và size 1–99 mm.");
  }
  const sku = `${productSku}${shapeToken}${String(grade).padStart(2, "0")}S${size}`;
  if (sku.length > 64) throw new BadRequestException("Mã SKU vượt quá 64 ký tự.");
  return sku;
};
const bangleVariantIssue = (productSku: string, variant: Input) => {
  const sku = String(variant.sku || "").trim();
  const shape = String(variant.shape || "").trim().toLocaleUpperCase("en");
  const quality = String(variant.quality || "").trim().toLocaleUpperCase("en");
  const beadSize = String(variant.beadSize || "").trim();
  const issues: string[] = [];
  if (!bangleShapeLabel(shape)) issues.push("dáng (Tròn/Oval/Vuông)");
  const gradeText = quality === "A" ? "1" : quality.match(/^(\d{1,2})A$/)?.[1];
  const grade = Number(gradeText);
  if (!gradeText || !Number.isInteger(grade) || grade < 1 || grade > 99) issues.push("chất lượng (A/2A…)");
  const sizeText = beadSize.match(/^(\d{1,2})(?:\s*MM)?$/i)?.[1];
  const size = Number(sizeText);
  if (!sizeText || !Number.isInteger(size) || size < 1 || size > 99) issues.push("size (1–99 mm)");
  if (!sku) issues.push("SKU");
  if (issues.length) return `SKU ${sku || "(chưa có mã)"}: thiếu hoặc không hợp lệ ${issues.join(", ")}. Sửa tại Hồ sơ sản phẩm > Biến thể.`;

  const expectedSku = bangleVariantSku(productSku, shape, quality, beadSize);
  if (sku.toLocaleUpperCase("en") !== expectedSku.toLocaleUpperCase("en")) {
    return `SKU ${sku}: không khớp dáng, chất lượng và size; mã theo quy tắc hiện tại là ${expectedSku}. Sửa tại Hồ sơ sản phẩm > Biến thể.`;
  }
  return null;
};
const variantOptionKey = (shape: string, quality: string, size: string, carat: string, gemstoneQuality: string) => shape
  ? `BANGLE::${shape}::${quality}::${size}`
  : gemstoneOptionKey(quality, size, carat, gemstoneQuality);
const gemstoneSkuSuffix = (cut: string, pricingMode: string, size: string, carat: string, gemstoneQuality: string) => {
  const base = `C${gemstoneCutSkuToken(cut)}`;
  if (pricingMode === "GEMSTONE_CARAT") return `${base}CT${gemstoneCaratSkuToken(carat)}`;
  if (pricingMode === "GEMSTONE_CARAT_AND_QUALITY") return `${base}CT${gemstoneCaratSkuToken(carat)}Q${gemstoneQualitySkuToken(gemstoneQuality)}`;
  return `${base}S${gemstoneSizeSkuToken(size)}`;
};
const isCaratPricing = (pricingMode: string) => pricingMode === "GEMSTONE_CARAT" || pricingMode === "GEMSTONE_CARAT_AND_QUALITY";
const variantSellPrice = (product: Input, variant: Input | null | undefined) => {
  const base = Number(variant?.price ?? product.price ?? 0);
  const mode = product.category?.pricingMode;
  return product.kind === "GEMSTONE" && isCaratPricing(String(mode || "")) && variant
    ? Math.round(base * Number(variant.carat || 0))
    : base;
};
const variantDisplayLabel = (variant: Input | null | undefined) => variant
  ? [bangleShapeLabel(variant.shape), variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality ? `Chất lượng ${variant.gemstoneQuality}` : null].filter(Boolean).join(" · ") || null
  : null;
const parseDate = (value: unknown, fallback = new Date()) => {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : fallback;
};
const parseReportDate = (value: unknown, fallback: Date, boundary: "start" | "end") => {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}+07:00`);
  }
  return parseDate(value, fallback);
};
const parsePromotionBoundary = (value: unknown, boundary: "start" | "end", fallback = new Date()) => {
  const text = typeof value === "string" ? value.trim() : "";
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/) || text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)?.map((part, index, match) => index === 0 ? part : index === 1 ? match[3] : index === 2 ? match[2] : match[1]);
  const parsed = parseDate(value, fallback);
  const isUtcMidnight = parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0 && parsed.getUTCMilliseconds() === 0;
  if (!dateOnly && !isUtcMidnight) return parsed;

  // The admin promotion form selects calendar dates, so treat them as full
  // Vietnam days instead of UTC midnights that expire at 07:00 local time.
  const [year, month, day] = dateOnly
    ? dateOnly.slice(1).map(Number)
    : parsed.toISOString().slice(0, 10).split("-").map(Number);
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  return new Date(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}+07:00`);
};
const enumValue = (value: unknown, allowed: string[], fallback: string) => allowed.includes(String(value)) ? String(value) : fallback;
const hasMediaSignature = (mimeType: string, bytes: Buffer) => {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (mimeType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/gif") return bytes.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "image/avif") return bytes.subarray(4, 12).toString("ascii").startsWith("ftyp") && /avif|avis/.test(bytes.subarray(8, 32).toString("ascii"));
  if (mimeType === "video/mp4") return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mimeType === "video/webm") return starts(0x1a, 0x45, 0xdf, 0xa3);
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
};
const requiredJewelryCategories = [
  { name: "Nhẫn", slug: "nhan", sortOrder: 10 },
  { name: "Vòng Tay", slug: "vong-tay", sortOrder: 20 },
  { name: "Mặt dây chuyền", slug: "mat-day-chuyen", sortOrder: 30 },
  { name: "Lắc tay", slug: "lac-tay", sortOrder: 40 },
] as const;
const requiredJewelryCategorySlugs = new Set<string>(requiredJewelryCategories.map((category) => category.slug));
const isRequiredJewelryRoot = (category: { slug: string; kind: string; level: number }) => category.slug === "trang-suc" && category.kind === "JEWELRY" && category.level === 1;
const isRequiredJewelryChild = (category: { slug: string; kind: string; level: number; parentId?: string | null }, rootId: string) => category.kind === "JEWELRY" && category.level === 2 && category.parentId === rootId && requiredJewelryCategorySlugs.has(category.slug);
const includeProduct = { category: true, gemstoneType: true, materialOption: true, images: { orderBy: { sortOrder: "asc" as const } }, variants: { orderBy: { sortOrder: "asc" as const } } };
const selectAdminProductSummary = {
  id: true, sku: true, name: true, kind: true, categoryId: true, gemstoneTypeId: true, materialOptionId: true,
  status: true, isNew: true, isPremiumGemstone: true, price: true, originalPrice: true, stock: true,
  pos365PriceSyncStatus: true, pos365PriceSyncError: true, pos365PriceSyncedAt: true,
  category: { select: { id: true, name: true, kind: true, level: true, parentId: true, pricingMode: true } },
  gemstoneType: { select: { id: true, name: true } },
  materialOption: { select: { id: true, name: true } },
  images: { orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }], take: 1, select: { url: true, alt: true } },
  variants: { orderBy: { sortOrder: "asc" as const }, select: { id: true, sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, originalPrice: true, stock: true, sortOrder: true } },
} satisfies Prisma.ProductSelect;
// Product list rows do not need the full variant graph; product details are
// loaded on demand, while price/order workflows keep using admin-summary.
const { variants: _adminSummaryVariants, ...selectAdminProductList } = selectAdminProductSummary;
const includeStorefrontProduct = {
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true, pricingMode: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true } },
  images: { orderBy: { sortOrder: "asc" as const }, take: 2, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { orderBy: { sortOrder: "asc" as const }, select: { id: true, sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, originalPrice: true, stock: true, imageUrls: true, videoUrl: true, sortOrder: true } },
};
const selectStorefrontListing = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  kind: true,
  categoryId: true,
  gemstoneTypeId: true,
  materialOptionId: true,
  status: true,
  seoTitle: true,
  seoDescription: true,
  isNew: true,
  isFeatured: true,
  isPremiumGemstone: true,
  price: true,
  originalPrice: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  coverVideoUrl: true,
  stock: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true, pricingMode: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true, sortOrder: true } },
  images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 2, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { select: { quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, price: true } },
} satisfies Prisma.ProductSelect;
const includeStorefrontProductDetail = {
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true, pricingMode: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true } },
  images: { orderBy: { sortOrder: "asc" as const }, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { orderBy: { sortOrder: "asc" as const }, select: { id: true, sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, originalPrice: true, stock: true, imageUrls: true, videoUrl: true, sortOrder: true } },
  reviews: { where: { status: "APPROVED" as const }, orderBy: { createdAt: "desc" as const }, take: 30, select: { rating: true, title: true, content: true, createdAt: true, customer: { select: { name: true } } } },
};
const withoutPublicPriceForPremiumGemstone = (product: any) => product?.kind === "GEMSTONE" && product?.isPremiumGemstone
  ? {
      ...product,
      price: 0,
      originalPrice: null,
      variants: Array.isArray(product.variants) ? product.variants.map((variant: any) => ({ ...variant, price: 0, originalPrice: null })) : product.variants,
    }
  : product;
const selectAdminOrder = {
  id: true, code: true, status: true, customerName: true, customerEmail: true, customerPhone: true,
  shippingAddress: true, shippingMethod: true, trackingCode: true, shippingProvider: true,
  shippingServiceCode: true, carrierShipmentStatus: true, carrierShipmentError: true,
  carrierFreightPayment: true, carrierCodAmount: true, carrierStatusCode: true,
  carrierStatusName: true, carrierStatusAt: true, carrierLocation: true, carrierFee: true,
  subtotal: true, discountAmount: true, shippingFee: true, totalAmount: true, note: true,
  pos365SyncStatus: true, pos365SyncError: true, placedAt: true,
  customer: { select: { name: true, phone: true, email: true } },
  items: {
    select: {
      id: true, productName: true, productSku: true, quality: true, shape: true, beadSize: true,
      quantity: true, unitPrice: true, lineTotal: true,
      product: { select: { weightGrams: true, images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } } } },
    },
  },
  payments: {
    select: {
      id: true, method: true, status: true, amount: true, providerRef: true, paidAt: true, createdAt: true,
      recordedByAdminId: true, recordingNote: true,
      refunds: { select: { amount: true, createdAt: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  emailOutbox: { where: { eventType: "ORDER_CONFIRMATION" }, select: { status: true, attemptCount: true, lastError: true, nextAttemptAt: true, acceptedAt: true }, take: 1 },
} satisfies Prisma.OrderSelect;

@Injectable()
export class CommerceService implements OnModuleInit, OnModuleDestroy {
  private readonly catalogChanges = new Subject<{ data: { entity: string; action: string; id?: string; at: string } }>();
  private readonly logger = new Logger(CommerceService.name);
  private soldOutCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private promotionStatusTimer: ReturnType<typeof setInterval> | null = null;
  private orderEmailOutboxTimer: ReturnType<typeof setInterval> | null = null;
  private orderEmailOutboxRunning = false;
  private reservationExpiryTimer: ReturnType<typeof setInterval> | null = null;
  private reservationExpiryRunning = false;
  private categoryCache: { expiresAt: number; records: any[] } | null = null;
  private categoryLoad: Promise<any[]> | null = null;
  private categoryCacheVersion = 0;
  private readonly productReadCache = new Map<string, { expiresAt: number; records: any[] }>();
  private readonly productReadLoads = new Map<string, Promise<any[]>>();
  private productReadGeneration = 0;

  constructor(private readonly prisma: PrismaService, private readonly pos365: Pos365Service, private readonly mediaStore: MediaAssetsService) {}

  private async queueProductStockSync(client: any, productIds: Iterable<string>) {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (!ids.length) return;
    const enabled = this.pos365.isSyncEnabled();
    await client.product.updateMany({
      where: { id: { in: ids } },
      data: {
        pos365StockSyncStatus: enabled ? "PENDING" : "DISABLED",
        pos365StockSyncAttempts: 0,
        pos365StockSyncLastAttemptAt: null,
        pos365StockSyncNextAttemptAt: enabled ? new Date() : null,
        pos365StockSyncedAt: null,
        pos365StockSyncError: null,
      },
    });
  }

  async onModuleInit() {
    // Seed the required jewelry categories once at startup. Doing these
    // upserts inside GET /categories made every storefront page read write to
    // PostgreSQL and amplified traffic spikes into lock contention.
    await this.ensureRequiredJewelryCategories();
    void this.backfillMissingJewelryVariantSkus().catch((error) => this.logger.error("Không thể bổ sung SKU còn thiếu cho biến thể trang sức.", error));
    void this.normalizeLegacyProductImages().catch((error) => this.logger.error("Không thể chuyển ảnh sản phẩm sang thư viện media trong database.", error));
    void this.hideExpiredSoldOutListings().catch((error) => this.logger.error("Không thể tự ẩn bài đăng hết hàng đã quá 3 ngày.", error));
    void this.syncPromotionStatuses().catch((error) => this.logger.error("Không thể đồng bộ trạng thái khuyến mãi theo thời gian.", error));
    void this.processOrderEmailOutbox().catch((error) => this.logger.error("Không thể xử lý hàng đợi email xác nhận đơn.", error));
    void this.expireOrderReservations().catch((error) => this.logger.error("Không thể giải phóng tồn kho giữ quá hạn.", error));
    this.soldOutCleanupTimer = setInterval(() => {
      void this.hideExpiredSoldOutListings().catch((error) => this.logger.error("Không thể tự ẩn bài đăng hết hàng đã quá 3 ngày.", error));
    }, 5 * 60_000);
    this.soldOutCleanupTimer.unref?.();
    this.promotionStatusTimer = setInterval(() => {
      void this.syncPromotionStatuses().catch((error) => this.logger.error("Không thể đồng bộ trạng thái khuyến mãi theo thời gian.", error));
    }, 60_000);
    this.promotionStatusTimer.unref?.();
    this.orderEmailOutboxTimer = setInterval(() => {
      void this.processOrderEmailOutbox().catch((error) => this.logger.error("Không thể xử lý hàng đợi email xác nhận đơn.", error));
    }, 5_000);
    this.orderEmailOutboxTimer.unref?.();
    this.reservationExpiryTimer = setInterval(() => {
      void this.expireOrderReservations().catch((error) => this.logger.error("Không thể giải phóng tồn kho giữ quá hạn.", error));
    }, 30_000);
    this.reservationExpiryTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.soldOutCleanupTimer) clearInterval(this.soldOutCleanupTimer);
    if (this.promotionStatusTimer) clearInterval(this.promotionStatusTimer);
    if (this.orderEmailOutboxTimer) clearInterval(this.orderEmailOutboxTimer);
    if (this.reservationExpiryTimer) clearInterval(this.reservationExpiryTimer);
  }

  private async persistDataImageReference(value: string, filename: string, alt?: string | null) {
    const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) throw new BadRequestException("Dữ liệu ảnh sản phẩm không hợp lệ.");
    const mimeType = match[1].toLocaleLowerCase("en");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new BadRequestException("Ảnh sản phẩm sau khi nén phải nhỏ hơn 8 MB.");
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const sourceKey = `assets/products/${digest}.${extension}`;
    const asset = await this.mediaStore.save({ filename, sourceKey, mimeType, bytes, alt: alt ? String(alt).slice(0, 240) : null, updateExisting: true });
    return asset.url;
  }

  private async normalizeLegacyProductImages() {
    let migrated = 0;
    while (true) {
      const images = await this.prisma.productImage.findMany({
        where: { url: { startsWith: "data:image/" } },
        select: { id: true, url: true, alt: true },
        take: 100,
      });
      if (!images.length) break;
      let batchMigrated = 0;
      for (const image of images) {
        try {
          const url = await this.persistDataImageReference(image.url, `product-${image.id}.webp`, image.alt);
          const result = await this.prisma.productImage.updateMany({ where: { id: image.id, url: image.url }, data: { url } });
          batchMigrated += result.count;
        } catch (error) {
          this.logger.warn(`Ảnh sản phẩm ${image.id} chưa được chuyển: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      migrated += batchMigrated;
      if (!batchMigrated) break;
    }

    const technicalImages = await this.prisma.product.findMany({
      where: { technicalImageUrl: { startsWith: "data:image/" } },
      select: { id: true, sku: true, technicalImageUrl: true },
      take: 500,
    });
    for (const product of technicalImages) {
      if (!product.technicalImageUrl) continue;
      try {
        const url = await this.persistDataImageReference(product.technicalImageUrl, `product-${product.sku}-technical.webp`, product.sku);
        await this.prisma.product.updateMany({ where: { id: product.id, technicalImageUrl: product.technicalImageUrl }, data: { technicalImageUrl: url } });
        migrated++;
      } catch (error) {
        this.logger.warn(`Ảnh thông số sản phẩm ${product.sku} chưa được chuyển: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (migrated) this.logger.log(`Đã chuyển ${migrated} ảnh sản phẩm sang URL media lưu trong PostgreSQL.`);
  }

  private async hideExpiredSoldOutListings() {
    // Older active listings can have zero stock without a soldOutAt timestamp.
    // Start their grace period now so they do not stay on the storefront forever.
    await this.prisma.product.updateMany({
      where: { status: "ACTIVE", stock: 0, soldOutAt: null },
      data: { soldOutAt: new Date() },
    });
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.product.findMany({
      where: { status: "ACTIVE", stock: 0, soldOutAt: { lte: cutoff } },
      select: { id: true },
      take: 500,
    });
    if (!expired.length) return;
    const result = await this.prisma.product.updateMany({
      where: { id: { in: expired.map((product) => product.id) }, status: "ACTIVE", stock: 0, soldOutAt: { lte: cutoff } },
      data: { status: "HIDDEN" },
    });
    if (result.count) {
      for (const product of expired.slice(0, result.count)) this.publishCatalogChange("product", "updated", product.id);
    }
  }

  private async syncPromotionStatuses() {
    const now = new Date();
    const expired = await this.prisma.promotion.updateMany({
      where: { status: { in: ["ACTIVE", "SCHEDULED", "PAUSED"] }, endsAt: { lte: now } },
      data: { status: "ENDED" },
    });
    const started = await this.prisma.promotion.updateMany({
      where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } },
      data: { status: "ACTIVE" },
    });
    if (expired.count || started.count) this.publishCatalogChange("promotion", "updated");
  }

  catalogEvents(): Observable<{ data: { entity?: string; action?: string; id?: string; at?: string } | string; type?: string }> {
    const keepAlive = interval(25_000).pipe(map(() => ({ type: "ping", data: "" })));
    return merge(this.catalogChanges.asObservable(), keepAlive);
  }

  private publishCatalogChange(entity: string, action: string, id?: string) {
    if (entity === "product" || entity === "category") {
      this.productReadGeneration += 1;
      this.productReadCache.clear();
      this.productReadLoads.clear();
    }
    this.catalogChanges.next({ data: { entity, action, ...(id ? { id } : {}), at: new Date().toISOString() } });
  }

  notifyProductImagesUpdated(productId: string) {
    this.publishCatalogChange("product", "updated", productId);
  }

  private cachedPublicProductRead(key: string, load: () => Promise<any[]>) {
    const now = Date.now();
    const cached = this.productReadCache.get(key);
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.records);
    if (cached) this.productReadCache.delete(key);
    const active = this.productReadLoads.get(key);
    if (active) return active;
    const generation = this.productReadGeneration;
    let request: Promise<any[]>;
    request = load().then((records) => {
      if (generation !== this.productReadGeneration) return records;
      this.productReadCache.set(key, { expiresAt: Date.now() + 2_000, records });
      while (this.productReadCache.size > 80) {
        const oldestKey = this.productReadCache.keys().next().value;
        if (oldestKey === undefined) break;
        this.productReadCache.delete(oldestKey);
      }
      return records;
    }).finally(() => { if (this.productReadLoads.get(key) === request) this.productReadLoads.delete(key); });
    this.productReadLoads.set(key, request);
    return request;
  }

  private async ensureRequiredJewelryCategories() {
    let root = await this.prisma.category.findUnique({ where: { slug: "trang-suc" }, select: { id: true } });
    if (!root) {
      const legacyRoot = await this.prisma.category.findFirst({ where: { name: "Trang sức", kind: "JEWELRY", level: 1 }, select: { id: true } });
      root = legacyRoot
        ? await this.prisma.category.update({ where: { id: legacyRoot.id }, data: { name: "Trang sức", slug: "trang-suc", kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 1, pricingMode: "FIXED", parentId: null }, select: { id: true } })
        : await this.prisma.category.create({ data: { name: "Trang sức", slug: "trang-suc", kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 1, pricingMode: "FIXED", sortOrder: 10, status: "ACTIVE", description: "Các thiết kế trang sức GEME chế tác từ đá quý tự nhiên." }, select: { id: true } });
    } else {
      await this.prisma.category.update({ where: { id: root.id }, data: { name: "Trang sức", kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 1, pricingMode: "FIXED", parentId: null } });
    }
    for (const category of requiredJewelryCategories) {
      await this.prisma.category.upsert({
        where: { slug: category.slug },
        create: { name: category.name, slug: category.slug, kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 2, pricingMode: "FIXED", parentId: root.id, sortOrder: category.sortOrder, status: "ACTIVE" },
        update: { name: category.name, kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 2, pricingMode: "FIXED", parentId: root.id },
      });
    }
  }

  private variantSkuFor(productSku: string, quality: string, beadSize: string, index: number) {
    const token = (value: string, fallback: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "D").toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "").slice(0, 14) || fallback;
    const qualityToken = token(quality, "VAR");
    const sizeToken = token(beadSize, "NA");
    const suffix = `-${qualityToken}-${sizeToken}-${String(index + 1).padStart(2, "0")}`;
    if (productSku.length + suffix.length > 64) throw new BadRequestException("SKU sản phẩm quá dài để gắn mã riêng cho biến thể. Hãy rút gọn tiền tố hoặc số thứ tự SKU.");
    return `${productSku}${suffix}`;
  }

  private async backfillMissingJewelryVariantSkus() {
    const variants = await this.prisma.productPriceVariant.findMany({
      where: { sku: null, product: { kind: "JEWELRY" } },
      include: { product: { select: { sku: true } } },
      orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      take: 2000,
    });
    const variantIndexes = new Map<string, number>();
    for (const variant of variants) {
      try {
        const index = variantIndexes.get(variant.productId) || 0;
        variantIndexes.set(variant.productId, index + 1);
        const sku = this.variantSkuFor(variant.product.sku, variant.quality, variant.beadSize || "", index);
        const [productCollision, variantCollision] = await Promise.all([
          this.prisma.product.findUnique({ where: { sku }, select: { id: true } }),
          this.prisma.productPriceVariant.findUnique({ where: { sku }, select: { id: true } }),
        ]);
        if (productCollision || variantCollision) {
          this.logger.warn(`Bỏ qua backfill SKU biến thể ${variant.id}: mã ${sku} đã tồn tại.`);
          continue;
        }
        await this.prisma.productPriceVariant.updateMany({ where: { id: variant.id, sku: null }, data: { sku } });
      } catch (error) {
        this.logger.warn(`Bỏ qua backfill SKU biến thể ${variant.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (variants.length) this.logger.log(`Đã rà soát ${variants.length} biến thể trang sức còn thiếu SKU.`);
  }

  async categories(publicOnly = false) {
    let records: any[];
    if (this.categoryCache && this.categoryCache.expiresAt > Date.now()) records = this.categoryCache.records;
    else if (this.categoryLoad) records = await this.categoryLoad;
    else {
      const version = this.categoryCacheVersion;
      const load = this.prisma.category.findMany({ include: { _count: { select: { products: true, gemstoneProducts: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }).then((rows) => {
        const mapped = rows.map((category) => ({ ...category, _count: { ...category._count, products: Math.max(category._count.products, category._count.gemstoneProducts) } }));
        if (version === this.categoryCacheVersion) this.categoryCache = { records: mapped, expiresAt: Date.now() + 2_000 };
        return mapped;
      });
      this.categoryLoad = load;
      try {
        records = await load;
      } finally {
        if (this.categoryLoad === load) this.categoryLoad = null;
      }
    }
    if (!publicOnly) return records;
    const visibleIds = this.activeCategoryTreeIds(records);
    return records.filter((category) => visibleIds.has(category.id));
  }

  private activeCategoryTreeIds(records: any[]) {
    const byId = new Map(records.map((category) => [category.id, category]));
    const visible = new Set<string>();
    const isVisible = (category: any, path = new Set<string>()): boolean => {
      if (!category || category.status !== "ACTIVE" || path.has(category.id)) return false;
      if (!category.parentId) return true;
      const nextPath = new Set(path).add(category.id);
      return isVisible(byId.get(category.parentId), nextPath);
    };
    for (const category of records) if (isVisible(category)) visible.add(category.id);
    return visible;
  }

  private async storefrontProductVisibilityWhere(): Promise<Input> {
    const records = await this.categories();
    const visibleCategoryIds = this.activeCategoryTreeIds(records);
    const visibleCutKeys = new Set(records
      .filter((category) => category.kind === "GEMSTONE" && category.usage === "PRODUCT_CATEGORY" && category.level === 3 && category.parentId && visibleCategoryIds.has(category.id))
      .map((category) => `${category.parentId}::${category.name}`));
    const hiddenCuts = records.filter((category) => category.kind === "GEMSTONE" && category.usage === "PRODUCT_CATEGORY" && category.level === 3 && category.parentId && !visibleCutKeys.has(`${category.parentId}::${category.name}`));
    return {
      AND: [
        { OR: [{ categoryId: null }, { categoryId: { in: [...visibleCategoryIds] } }] },
        { OR: [{ gemstoneTypeId: null }, { gemstoneTypeId: { in: [...visibleCategoryIds] } }] },
        { OR: [{ materialOptionId: null }, { materialOption: { active: true } }] },
        ...hiddenCuts.map((cut) => ({ NOT: { kind: "GEMSTONE", gemstoneTypeId: cut.parentId, variants: { some: { quality: cut.name } } } })),
      ],
    };
  }

  private async assertActiveCategoryAncestors(categoryId?: string | null) {
    let currentId = categoryId || null;
    const seen = new Set<string>();
    while (currentId) {
      if (seen.has(currentId)) throw new BadRequestException("Cấu trúc danh mục có vòng lặp, không thể hiện danh mục.");
      seen.add(currentId);
      const current = await this.prisma.category.findUnique({ where: { id: currentId }, select: { name: true, status: true, parentId: true } });
      if (!current) throw new BadRequestException("Danh mục cha không còn tồn tại.");
      if (current.status !== "ACTIVE") throw new BadRequestException(`Hãy hiện danh mục “${current.name}” trước khi hiện mục con.`);
      currentId = current.parentId;
    }
  }

  private invalidateCategoryCache() {
    this.categoryCacheVersion += 1;
    this.categoryCache = null;
    this.categoryLoad = null;
  }

  private categoryData(input: Input) {
    const name = String(input.name || "").trim();
    if (!name) throw new BadRequestException("Tên danh mục không được để trống.");
    return {
      name,
      slug: slugify(input.slug || name),
      kind: enumValue(input.kind, ["JEWELRY", "GEMSTONE"], "JEWELRY") as any,
      usage: enumValue(input.usage, ["PRODUCT_CATEGORY", "GEMSTONE_TYPE"], "PRODUCT_CATEGORY") as any,
      level: Math.max(1, Math.min(3, Number(input.level) || (input.parentId ? 2 : 1))),
  pricingMode: enumValue(input.pricingMode, ["FIXED", "QUALITY", "QUALITY_AND_BEAD_SIZE", "GEMSTONE_SIZE", "GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"], "FIXED") as any,
      parentId: input.parentId || null,
      description: input.description || null,
      status: enumValue(input.status, ["ACTIVE", "INACTIVE"], "ACTIVE") as any,
      sortOrder: Math.max(0, Number(input.sortOrder) || 0),
      imageUrl: input.imageUrl || input.image || null,
      bannerUrl: input.bannerUrl || input.banner || null,
      seoTitle: input.seoTitle || null,
      seoDescription: input.seoDescription || null,
      isHot: Boolean(input.isHot),
    };
  }

  async createCategory(input: Input) {
    await this.ensureRequiredJewelryCategories();
    const data = this.categoryData(input);
    await this.validateCategoryHierarchy(data);
    try {
      const category = await this.prisma.category.create({ data });
      this.invalidateCategoryCache();
      this.publishCatalogChange("category", "created", category.id);
      return category;
    }
    catch (error: any) { if (error?.code === "P2002") throw new ConflictException("Slug danh mục đã tồn tại."); throw error; }
  }

  async updateCategory(id: string, input: Input) {
    await this.ensureRequiredJewelryCategories();
    try {
      const current = await this.prisma.category.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy danh mục.");
      if (isRequiredJewelryRoot(current) || isRequiredJewelryChild(current, String(current.parentId || ""))) {
        const status = (input.status === undefined ? current.status : enumValue(input.status, ["ACTIVE", "INACTIVE"], current.status)) as typeof current.status;
        if (status === "ACTIVE") await this.assertActiveCategoryAncestors(current.parentId);
        const category = await this.prisma.category.update({ where: { id }, data: { status } });
        this.invalidateCategoryCache();
        this.publishCatalogChange("category", "updated", category.id);
        return category;
      }
      const data = this.categoryData(input);
      if (current.kind === "GEMSTONE" && current.level === 2 && current.usage === "GEMSTONE_TYPE" && (data.kind !== "GEMSTONE" || data.level !== 2 || data.usage !== "GEMSTONE_TYPE")) {
        const cutCount = await this.prisma.category.count({ where: { parentId: id, kind: "GEMSTONE", level: 3, usage: "PRODUCT_CATEGORY" } });
        if (cutCount > 0) throw new BadRequestException("Loại đá đang có dạng cắt cấp 3; hãy chuyển hoặc xóa các dạng cắt trước khi đổi cấu trúc.");
      }
      const parentUnchanged = data.parentId === current.parentId;
      if (data.status === "ACTIVE" && (current.status !== "ACTIVE" || !parentUnchanged)) await this.assertActiveCategoryAncestors(data.parentId);
      await this.validateCategoryHierarchy(data, id, data.status === "INACTIVE" || parentUnchanged);
      const category = await this.prisma.category.update({ where: { id }, data });
      this.invalidateCategoryCache();
      this.publishCatalogChange("category", "updated", category.id);
      return category;
    }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy danh mục."); if (error?.code === "P2002") throw new ConflictException("Slug danh mục đã tồn tại."); throw error; }
  }

  async deleteCategory(id: string) {
    await this.ensureRequiredJewelryCategories();
    const root = await this.prisma.category.findUnique({ where: { id }, select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true } });
    if (!root) throw new NotFoundException("Không tìm thấy danh mục.");
    if (isRequiredJewelryRoot(root) || (root.parentId && requiredJewelryCategorySlugs.has(root.slug) && root.kind === "JEWELRY" && root.level === 2)) {
      throw new BadRequestException("Danh mục trang sức bắt buộc không được xóa; chỉ có thể ẩn hoặc hiện.");
    }

    await this.prisma.$transaction(async (tx) => {
      const children = await tx.category.count({ where: { parentId: id } });
      if (children) throw new BadRequestException("Danh mục còn danh mục con. Hãy xử lý hoặc xóa danh mục con trước.");
      const linkedProducts = await tx.product.count({ where: { OR: [{ categoryId: id }, { gemstoneTypeId: id }] } });
      if (linkedProducts) throw new BadRequestException(`Không thể xóa “${root.name}” vì đang có ${linkedProducts} sản phẩm phụ thuộc. Hãy ẩn danh mục hoặc chuyển sản phẩm sang danh mục khác.`);
      if (root.kind === "GEMSTONE" && root.level === 3 && root.parentId) {
        const linkedVariants = await tx.productPriceVariant.count({ where: { quality: root.name, product: { kind: "GEMSTONE", gemstoneTypeId: root.parentId } } });
        if (linkedVariants) throw new BadRequestException(`Không thể xóa dạng cắt “${root.name}” vì đang có ${linkedVariants} biến thể sản phẩm phụ thuộc. Hãy ẩn dạng cắt hoặc chuyển biến thể trước.`);
      }
      await tx.category.delete({ where: { id } });
    }, { isolationLevel: "Serializable" });
    this.invalidateCategoryCache();
    this.publishCatalogChange("category", "deleted", id);
    return { deleted: true, deletedCategories: 1, hiddenProducts: 0 };
  }

  private async validateCategoryHierarchy(data: Input, currentId?: string, allowInactiveParent = false) {
    if (data.usage === "GEMSTONE_TYPE" && (data.kind !== "GEMSTONE" || data.level !== 2)) {
      throw new BadRequestException("Loại đá phải là danh mục đá quý cấp 2.");
    }
    if (data.kind === "GEMSTONE" && data.level === 3 && data.usage !== "PRODUCT_CATEGORY") {
      throw new BadRequestException("Dạng cắt cấp 3 phải là danh mục sản phẩm.");
    }
    if (!data.parentId) {
      if (data.level !== 1) throw new BadRequestException("Danh mục cấp 2 hoặc cấp 3 phải có danh mục cha.");
      if (!currentId && data.kind === "JEWELRY" && data.slug !== "trang-suc") throw new BadRequestException("Nhóm cấp 1 của trang sức đã cố định là Trang sức.");
      return;
    }
    const parent = await this.prisma.category.findUnique({ where: { id: data.parentId }, select: { id: true, slug: true, kind: true, usage: true, level: true, status: true } });
    const gemstoneCutParent = data.kind === "GEMSTONE" && data.level === 3 && parent?.kind === "GEMSTONE" && parent.level === 2 && (parent.usage === "GEMSTONE_TYPE" || parent.usage === "PRODUCT_CATEGORY");
    if (!parent || (!allowInactiveParent && parent.status !== "ACTIVE") || (parent.usage !== "PRODUCT_CATEGORY" && !gemstoneCutParent)) throw new BadRequestException("Danh mục cha phải đang hoạt động và đúng loại.");
    if (data.level !== parent.level + 1 || data.kind !== parent.kind) throw new BadRequestException("Cấp và nhóm của danh mục phải khớp với danh mục cha.");

    if (data.kind === "GEMSTONE" && data.level === 3 && !gemstoneCutParent) {
      throw new BadRequestException("Dạng cắt đá quý cấp 3 phải nằm dưới một loại đá quý cấp 2.");
    }

    if (data.kind === "JEWELRY") {
      const root = parent.level === 1 ? parent : await this.prisma.category.findFirst({ where: { id: parent.id, slug: "trang-suc", kind: "JEWELRY", level: 1 }, select: { id: true } });
      const jewelryRoot = parent.level === 1 && parent.slug === "trang-suc" ? parent : root ?? (parent.level > 1 ? await this.findJewelryRootFor(parent.id) : null);
      if (!jewelryRoot) throw new BadRequestException("Danh mục trang sức phải nằm dưới nhóm Trang sức.");
      if (data.level === 3) {
        if (parent.level !== 2 || parent.usage !== "PRODUCT_CATEGORY") throw new BadRequestException("Danh mục cấp 3 phải nằm dưới một danh mục sản phẩm cấp 2 đang hoạt động.");
      }
    }
    if (currentId) {
      let ancestorId: string | null = data.parentId;
      while (ancestorId) {
        if (ancestorId === currentId) throw new BadRequestException("Danh mục không thể chuyển vào bên dưới chính nó.");
        const ancestor: { parentId: string | null } | null = await this.prisma.category.findUnique({ where: { id: ancestorId }, select: { parentId: true } });
        ancestorId = ancestor?.parentId || null;
      }
    }
  }

  private async findJewelryRootFor(categoryId: string) {
    let current = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, parentId: true, slug: true, kind: true, level: true } });
    while (current?.parentId) current = await this.prisma.category.findUnique({ where: { id: current.parentId }, select: { id: true, parentId: true, slug: true, kind: true, level: true } });
    return current && isRequiredJewelryRoot(current) ? { id: current.id } : null;
  }

  async products(query: Record<string, string>) {
    const where: Input = {};
    if (query.all !== "true") where.status = "ACTIVE";
    if (["JEWELRY", "GEMSTONE"].includes(query.kind)) where.kind = query.kind;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.gemstoneTypeId) where.gemstoneTypeId = query.gemstoneTypeId;
    if (query.materialOptionId) where.materialOptionId = query.materialOptionId;
    if (query.new === "true") where.isNew = true;
    if (query.featured === "true") where.isFeatured = true;
    if (query.search) where.OR = [{ name: { contains: query.search, mode: "insensitive" } }, { sku: { contains: query.search, mode: "insensitive" } }];
    if (query.all !== "true") where.AND = (where.AND || []).concat(await this.storefrontProductVisibilityWhere());
    const orderBy = [{ isNew: "desc" as const }, { createdAt: "desc" as const }, { id: "asc" as const }];
    const productLimit = query.all === "true" ? 5000 : 500;
    const take = Math.min(Math.max(Number(query.limit) || productLimit, 1), productLimit);
    const skip = Math.min(Math.max(Math.floor(Number(query.offset) || 0), 0), 1_000_000);
    if (query.view === "sitemap") {
      const loadSitemapEntries = () => this.prisma.product.findMany({ where, select: { slug: true, createdAt: true, updatedAt: true }, orderBy, take, skip });
      if (query.all === "true" || query.search) return loadSitemapEntries();
      const cacheKey = JSON.stringify(Object.entries(query).sort(([left], [right]) => left.localeCompare(right)));
      return this.cachedPublicProductRead(cacheKey, loadSitemapEntries);
    }
    const load = () => query.view === "storefront-list"
      ? this.prisma.product.findMany({ where, select: selectStorefrontListing, orderBy, take, skip }).then((rows) => rows.map(withoutPublicPriceForPremiumGemstone))
      : query.view === "admin-summary"
        ? this.prisma.product.findMany({ where, select: selectAdminProductSummary, orderBy, take, skip }).then((records) => records.map((record) => ({ ...record, adminSummary: true })))
        : query.view === "admin-list"
          ? this.prisma.product.findMany({ where, select: selectAdminProductList, orderBy, take, skip }).then((records) => records.map((record) => ({ ...record, adminSummary: true })))
        : this.prisma.product.findMany({ where, include: query.view === "storefront" ? includeStorefrontProduct : includeProduct, orderBy, take, skip }).then((records) => query.view === "storefront" ? records.map(withoutPublicPriceForPremiumGemstone) : records);
    if (query.all === "true" || query.search || !["storefront", "storefront-list"].includes(query.view)) return load();
    const cacheKey = JSON.stringify(Object.entries(query).sort(([left], [right]) => left.localeCompare(right)));
    return this.cachedPublicProductRead(cacheKey, load);
  }

  async adminProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: includeProduct });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm.");
    return product;
  }

  async product(slug: string) {
    const visibility = await this.storefrontProductVisibilityWhere();
    const record = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE", ...visibility }, include: includeStorefrontProductDetail });
    if (!record) throw new NotFoundException("Không tìm thấy sản phẩm.");
    return withoutPublicPriceForPremiumGemstone(record);
  }

  async relatedProducts(slug: string, limitInput?: string) {
    const visibility = await this.storefrontProductVisibilityWhere();
    const source = await this.prisma.product.findFirst({
      where: { slug, status: "ACTIVE", ...visibility },
      select: { id: true, kind: true, categoryId: true, materialOptionId: true },
    });
    if (!source) throw new NotFoundException("Không tìm thấy sản phẩm.");
    const matching: Input[] = [];
    if (source.categoryId) matching.push({ categoryId: source.categoryId });
    if (source.materialOptionId) matching.push({ materialOptionId: source.materialOptionId });
    if (!matching.length) return [];
    const limit = Math.min(Math.max(Number(limitInput) || 6, 1), 12);
    const records = await this.prisma.product.findMany({
      where: { id: { not: source.id }, kind: source.kind, status: "ACTIVE", OR: matching, ...visibility },
      include: includeStorefrontProduct,
      orderBy: [{ isNew: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return records.map(withoutPublicPriceForPremiumGemstone);
  }

  private productData(input: Input) {
    const name = String(input.name || "").trim();
    const sku = String(input.sku || input.id || "").trim();
    const categoryId = String(input.categoryId || "").trim();
    if (!name || !sku || !categoryId) throw new BadRequestException("Cần có tên, SKU và danh mục sản phẩm.");
    const status = enumValue(input.status, ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"], /đã gỡ|archived/i.test(String(input.status)) ? "ARCHIVED" : /đang hoạt động|đang bán|đã xuất bản|active/i.test(String(input.status)) ? "ACTIVE" : /ẩn|hidden/i.test(String(input.status)) ? "HIDDEN" : "DRAFT");
    const kind = enumValue(input.kind || input.productType, ["JEWELRY", "GEMSTONE", "Trang sức", "Đá quý"], "JEWELRY").replace("Trang sức", "JEWELRY").replace("Đá quý", "GEMSTONE") as "JEWELRY" | "GEMSTONE";
    const isPremiumGemstone = input.isPremiumGemstone === true;
    if (isPremiumGemstone && kind !== "GEMSTONE") throw new BadRequestException("Nhãn Hàng cao cấp chỉ áp dụng cho sản phẩm đá quý.");
    const dimension = (key: "lengthCm" | "widthCm" | "heightCm") => {
      const raw = input[key];
      if (raw === undefined || raw === null || raw === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new BadRequestException("Kích thước sản phẩm phải là số không âm.");
      return value;
    };
    const weightGrams = input.weightGrams === undefined || input.weightGrams === null || input.weightGrams === "" ? null : Number(input.weightGrams);
    if (weightGrams !== null && (!Number.isFinite(weightGrams) || weightGrams < 0)) throw new BadRequestException("Khối lượng sản phẩm phải là số không âm.");
    return {
      sku, name, slug: slugify(input.slug || name), kind,
      categoryId, gemstoneTypeId: input.gemstoneTypeId || null, materialOptionId: input.materialOptionId || null,
      description: input.description || null, fullDescription: input.fullDescription || null,
      ...(Object.prototype.hasOwnProperty.call(input, "coverVideoUrl") ? { coverVideoUrl: typeof input.coverVideoUrl === "string" ? input.coverVideoUrl.trim().slice(0, 2000) || null : null } : {}),
      technicalImageUrl: typeof input.technicalImageUrl === "string" ? input.technicalImageUrl.trim() || null : null,
      ...(Object.prototype.hasOwnProperty.call(input, "technicalVideoUrl") ? { technicalVideoUrl: typeof input.technicalVideoUrl === "string" ? input.technicalVideoUrl.trim().slice(0, 2000) || null : null } : {}),
      weightGrams,
      lengthCm: dimension("lengthCm"), widthCm: dimension("widthCm"), heightCm: dimension("heightCm"),
      status: status as any, isNew: Boolean(input.isNew), isFeatured: Boolean(input.isFeatured), isPremiumGemstone,
      price: Number(input.price) || null, originalPrice: Number(input.originalPrice) || null,
      seoTitle: input.seoTitle || null, seoDescription: input.seoDescription || null,
      kiotVietProductId: input.kiotVietProductId || null,
    };
  }

  async saveProductBySku(input: Input, skuInput: string) {
    const sku = String(skuInput || "").trim();
    if (!sku || String(input.sku || "").trim() !== sku) throw new BadRequestException("SKU trên đường dẫn và hồ sơ sản phẩm không khớp.");
    const product = await this.prisma.product.findUnique({ where: { sku }, select: { id: true } });
    if (!product) throw new NotFoundException(`Không tìm thấy sản phẩm có SKU ${sku}.`);
    return this.saveProduct(input, product.id);
  }

  async updateProductFields(id: string, input: Input, actor: { id: string; correlationId?: string }) {
    const allowed = new Set(["name", "description", "fullDescription", "coverVideoUrl", "technicalImageUrl", "technicalVideoUrl", "gallery", "seoTitle", "seoDescription", "price", "originalPrice", "priceVariants"]);
    const unknown = Object.keys(input).find((key) => !allowed.has(key));
    if (unknown) throw new BadRequestException(`Không thể cập nhật trường ${unknown} qua luồng chỉnh sửa có phạm vi.`);
    const data: Input = {};
    const textFields: Record<string, { max: number; required?: boolean }> = {
      name: { max: 180, required: true }, description: { max: 160 }, fullDescription: { max: 10000 },
      coverVideoUrl: { max: 2000 }, technicalImageUrl: { max: 2000 }, technicalVideoUrl: { max: 2000 },
      seoTitle: { max: 70 }, seoDescription: { max: 160 },
    };
    for (const [field, rule] of Object.entries(textFields)) {
      if (!Object.hasOwn(input, field)) continue;
      const value = typeof input[field] === "string" ? input[field].trim() : "";
      if (rule.required && !value) throw new BadRequestException("Tên sản phẩm không được để trống.");
      if (value.length > rule.max) throw new BadRequestException(`${field} vượt quá ${rule.max} ký tự.`);
      if (field === "fullDescription") data[field] = sanitizeBlogHtml(value) || null;
      else data[field] = value || null;
    }
    let gallery: string[] | undefined;
    if (Object.hasOwn(input, "gallery")) {
      if (!Array.isArray(input.gallery) || input.gallery.length > 10 || input.gallery.some((value: unknown) => typeof value !== "string" || value.trim().length > 2000)) {
        throw new BadRequestException("Thư viện ảnh cần tối đa 10 đường dẫn hợp lệ, mỗi đường dẫn tối đa 2.000 ký tự.");
      }
      gallery = input.gallery.map((value: string) => value.trim()).filter(Boolean);
    }
    for (const field of ["price", "originalPrice"] as const) {
      if (!Object.hasOwn(input, field)) continue;
      const value = Number(input[field]);
      if (!Number.isSafeInteger(value) || value < 0) throw new BadRequestException(`${field === "price" ? "Giá bán" : "Giá gốc"} phải là số nguyên đồng không âm.`);
      data[field] = value || null;
    }
    const priceVariants = Object.hasOwn(input, "priceVariants") ? input.priceVariants : undefined;
    if (priceVariants !== undefined && (!Array.isArray(priceVariants) || priceVariants.length > 500)) throw new BadRequestException("Danh sách biến thể không hợp lệ.");
    const changedProductIds = new Set<string>();
    let imageSyncChanged = false;
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.product.findUnique({ where: { id }, include: { category: { select: { slug: true } }, images: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { sortOrder: "asc" } } } });
        if (!current) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
        const before = {
          name: current.name, description: current.description, fullDescription: current.fullDescription,
          coverVideoUrl: current.coverVideoUrl, technicalImageUrl: current.technicalImageUrl, technicalVideoUrl: current.technicalVideoUrl,
          seoTitle: current.seoTitle, seoDescription: current.seoDescription,
          price: Number(current.price || 0), originalPrice: Number(current.originalPrice || 0),
          galleryCount: current.images.length, variantPrices: current.variants.map((row) => ({ sku: row.sku, price: Number(row.price || 0), originalPrice: Number(row.originalPrice || 0) })),
        };
        const variantUpdates: Array<{ id: string; data: Input }> = [];
        if (priceVariants !== undefined) {
          const seen = new Set<string>();
          for (const raw of priceVariants as Input[]) {
            const row = raw && typeof raw === "object" ? raw : {};
            const rowUnknown = Object.keys(row).find((key) => !["id", "sku", "price", "originalPrice", "imageUrls", "videoUrl"].includes(key));
            if (rowUnknown) throw new BadRequestException(`Không thể cập nhật trường biến thể ${rowUnknown} qua luồng chỉnh sửa có phạm vi.`);
            const variant = row.id ? current.variants.find((item) => item.id === String(row.id)) : current.variants.find((item) => item.sku === String(row.sku || ""));
            if (!variant || seen.has(variant.id)) throw new BadRequestException("Biến thể thiếu hoặc trùng mã; tải lại hồ sơ SKU trước khi lưu.");
            seen.add(variant.id);
            const variantData: Input = {};
            for (const field of ["price", "originalPrice"] as const) if (Object.hasOwn(row, field)) {
              const value = Number(row[field]);
              if (!Number.isSafeInteger(value) || value < 0) throw new BadRequestException("Giá biến thể phải là số nguyên đồng không âm.");
              variantData[field] = value || null;
            }
            if (Object.hasOwn(row, "imageUrls")) {
              if (!Array.isArray(row.imageUrls) || row.imageUrls.length > 8 || row.imageUrls.some((value: unknown) => typeof value !== "string" || value.trim().length > 2000)) throw new BadRequestException("Mỗi biến thể được lưu tối đa 8 đường dẫn ảnh hợp lệ.");
              variantData.imageUrls = row.imageUrls.map((value: string) => value.trim()).filter(Boolean);
            }
            if (Object.hasOwn(row, "videoUrl")) {
              const value = typeof row.videoUrl === "string" ? row.videoUrl.trim() : "";
              if (value.length > 2000) throw new BadRequestException("Đường dẫn video biến thể quá dài.");
              variantData.videoUrl = value || null;
            }
            if (Object.keys(variantData).length) variantUpdates.push({ id: variant.id, data: variantData });
          }
        }
        if (current.category?.slug === "vong-kieng" && variantUpdates.some((row) => Object.hasOwn(row.data, "imageUrls") || Object.hasOwn(row.data, "videoUrl"))) {
          const updatesById = new Map(variantUpdates.map((row) => [row.id, row.data]));
          const synchronized = synchronizeBangleVariantMedia(current.sku, current.variants.map((variant) => ({
            ...variant,
            ...(updatesById.get(variant.id) || {}),
          })), { changedVariantKeys: new Set(variantUpdates.filter((row) => Object.hasOwn(row.data, "imageUrls") || Object.hasOwn(row.data, "videoUrl")).map((row) => row.id)) });
          const synchronizedUpdates = new Map(variantUpdates.map((row) => [row.id, { ...row.data }]));
          for (const variant of synchronized) {
            const data = synchronizedUpdates.get(variant.id) || {};
            data.imageUrls = variant.imageUrls;
            data.videoUrl = variant.videoUrl;
            synchronizedUpdates.set(variant.id, data);
          }
          variantUpdates.splice(0, variantUpdates.length, ...[...synchronizedUpdates].map(([variantId, data]) => ({ id: variantId, data })));
        }
        const priceChanged = Object.hasOwn(data, "price") || Object.hasOwn(data, "originalPrice") || variantUpdates.some((row) => Object.hasOwn(row.data, "price") || Object.hasOwn(row.data, "originalPrice"));
        imageSyncChanged = gallery !== undefined || variantUpdates.some((row) => Object.hasOwn(row.data, "imageUrls"));
        if (imageSyncChanged) Object.assign(data, {
          pos365ImageSyncStatus: this.pos365.isSyncEnabled() ? "PENDING" : "DISABLED",
          pos365ImageSyncAttempts: 0, pos365ImageSyncLastAttemptAt: null,
          pos365ImageSyncNextAttemptAt: this.pos365.isSyncEnabled() ? new Date() : null,
          pos365ImageSyncedAt: null, pos365ImageSyncError: null,
        });
        if (priceChanged) Object.assign(data, {
          pos365PriceSyncStatus: this.pos365.isSyncEnabled() ? "PENDING" : "DISABLED",
          pos365PriceSyncAttempts: 0, pos365PriceSyncLastAttemptAt: null,
          pos365PriceSyncNextAttemptAt: this.pos365.isSyncEnabled() ? new Date() : null,
          pos365PriceSyncedAt: null, pos365PriceSyncError: null,
        });
        if (gallery) data.images = { deleteMany: {}, create: gallery.map((url, index) => ({ url, alt: data.name || current.name, sortOrder: index, isPrimary: index === 0 })) };
        const meaningful = Object.keys(data).some((key) => !["pos365PriceSyncStatus", "pos365PriceSyncAttempts", "pos365PriceSyncLastAttemptAt", "pos365PriceSyncNextAttemptAt", "pos365PriceSyncedAt", "pos365PriceSyncError", "pos365ImageSyncStatus", "pos365ImageSyncAttempts", "pos365ImageSyncLastAttemptAt", "pos365ImageSyncNextAttemptAt", "pos365ImageSyncedAt", "pos365ImageSyncError"].includes(key)) || variantUpdates.length > 0;
        if (!meaningful) throw new BadRequestException("Không có trường nội dung hoặc giá hợp lệ để cập nhật.");
        await tx.product.update({ where: { id }, data });
        for (const row of variantUpdates) await tx.productPriceVariant.update({ where: { id: row.id }, data: row.data });
        const result = await tx.product.findUniqueOrThrow({ where: { id }, include: includeProduct });
        const after = {
          name: result.name, description: result.description, fullDescription: result.fullDescription,
          coverVideoUrl: result.coverVideoUrl, technicalImageUrl: result.technicalImageUrl, technicalVideoUrl: result.technicalVideoUrl,
          seoTitle: result.seoTitle, seoDescription: result.seoDescription,
          price: Number(result.price || 0), originalPrice: Number(result.originalPrice || 0),
          galleryCount: result.images.length, variantPrices: result.variants.map((row) => ({ sku: row.sku, price: Number(row.price || 0), originalPrice: Number(row.originalPrice || 0) })),
        };
        await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: priceChanged ? "PRODUCT_CONTENT_AND_PRICE_UPDATED" : "PRODUCT_CONTENT_UPDATED", entityType: "PRODUCT", entityId: id, before: before as any, after: after as any } });
        if (priceChanged) changedProductIds.add(id);
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      if (changedProductIds.size && this.pos365.isSyncEnabled()) await this.pos365.syncProductPricesNow(id);
      if (imageSyncChanged) await this.pos365.queueProductImageSync(id);
      this.publishCatalogChange("product", "updated", id);
      return updated;
    } catch (error: any) {
      if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm hoặc biến thể.");
      if (error?.code === "P2002") throw new ConflictException("SKU hoặc dữ liệu sản phẩm đã tồn tại.");
      throw error;
    }
  }

  async updateProductFieldsBySku(skuInput: string, input: Input, actor: { id: string; correlationId?: string }) {
    const sku = String(skuInput || "").trim();
    if (!sku) throw new BadRequestException("Thiếu SKU sản phẩm.");
    const product = await this.prisma.product.findUnique({ where: { sku }, select: { id: true } });
    if (!product) throw new NotFoundException(`Không tìm thấy sản phẩm có SKU ${sku}.`);
    return this.updateProductFields(product.id, input, actor);
  }

  async updateProductPublication(id: string, statusInput: unknown, actor: { id: string; correlationId?: string }, reasonInput?: unknown) {
    const status = enumValue(statusInput, ["ACTIVE", "HIDDEN"], "");
    const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 1000) : "";
    if (!status) throw new BadRequestException("Chỉ có thể đăng bán hoặc ẩn sản phẩm.");
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const current = await tx.product.findUnique({ where: { id }, include: { category: { select: { slug: true } }, variants: { select: { sku: true, shape: true, quality: true, beadSize: true, stock: true, price: true } } } });
        if (!current) throw new NotFoundException("Không tìm thấy sản phẩm.");
        if (status === "ACTIVE") {
          if (current.kind === "JEWELRY" && current.category?.slug === "vong-kieng") {
            if (!current.variants.length) throw new BadRequestException(`Kiềng SKU ${current.sku} chưa có biến thể. Tạo biến thể trong Quản lý tồn kho trước khi đăng bán.`);
            const invalidVariants = current.variants.map((variant) => bangleVariantIssue(current.sku, variant)).filter(Boolean);
            if (invalidVariants.length) throw new BadRequestException(`Không thể đăng bán Kiềng: ${invalidVariants.join(" ")}`);
          }
          const availableStock = current.variants.length ? current.variants.reduce((sum, row) => sum + row.stock, 0) : current.stock;
          if (availableStock <= 0) throw new BadRequestException(`Không thể đăng bán SKU ${current.sku}: tồn kho bằng 0. Hãy nhập kho trong Quản lý tồn kho.`);
          if (!(current.kind === "GEMSTONE" && current.isPremiumGemstone)) {
            const missingPriceSkus = current.variants.filter((row) => Number(row.price) <= 0).map((row) => row.sku || current.sku);
            if (current.variants.length && missingPriceSkus.length) throw new BadRequestException(`Không thể đăng bán: SKU ${missingPriceSkus.join(", ")} chưa có giá bán hợp lệ. Cập nhật tại Hồ sơ giá.`);
            if (!current.variants.length && Number(current.price || 0) <= 0) throw new BadRequestException(`Không thể đăng bán SKU ${current.sku}: chưa có giá bán hợp lệ. Cập nhật tại Hồ sơ giá.`);
          }
        }
        const saved = await tx.product.update({ where: { id }, data: { status: status as any } });
        await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: status === "ACTIVE" ? "PRODUCT_PUBLISHED" : "PRODUCT_UNPUBLISHED", entityType: "PRODUCT", entityId: id, before: { status: current.status }, after: { status, ...(reason ? { reason } : {}) } } });
        return saved;
      });
      this.publishCatalogChange("product", "updated", id);
      return await this.adminProduct(product.id);
    } catch (error: any) {
      if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm.");
      throw error;
    }
  }

  async updateProductNewLabel(id: string, isNewInput: unknown, actor: { id: string; correlationId?: string }) {
    if (typeof isNewInput !== "boolean") throw new BadRequestException("Nhãn sản phẩm mới phải là true hoặc false.");
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, select: { id: true, isNew: true } });
      if (!current) throw new NotFoundException("Không tìm thấy sản phẩm.");
      if (current.isNew === isNewInput) return false;
      await tx.product.update({ where: { id }, data: { isNew: isNewInput } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: "PRODUCT_NEW_LABEL_UPDATED",
        entityType: "PRODUCT",
        entityId: id,
        before: { isNew: current.isNew },
        after: { isNew: isNewInput },
      } });
      return true;
    });
    if (changed) this.publishCatalogChange("product", "updated", id);
    return this.adminProduct(id);
  }

  async saveProduct(input: Input, id?: string) {
    const existingProduct = id ? await this.prisma.product.findUnique({ where: { id }, include: includeProduct }) : null;
    if (id && !existingProduct) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
    const existingInput: Input = existingProduct ? {
      sku: existingProduct.sku, name: existingProduct.name, slug: existingProduct.slug, kind: existingProduct.kind,
      categoryId: existingProduct.categoryId, gemstoneTypeId: existingProduct.gemstoneTypeId, materialOptionId: existingProduct.materialOptionId,
      description: existingProduct.description, fullDescription: existingProduct.fullDescription,
      coverVideoUrl: existingProduct.coverVideoUrl, technicalImageUrl: existingProduct.technicalImageUrl, technicalVideoUrl: existingProduct.technicalVideoUrl,
      weightGrams: existingProduct.weightGrams, lengthCm: existingProduct.lengthCm, widthCm: existingProduct.widthCm, heightCm: existingProduct.heightCm,
      status: existingProduct.status, isNew: existingProduct.isNew, isFeatured: existingProduct.isFeatured,
      isPremiumGemstone: existingProduct.isPremiumGemstone, price: existingProduct.price, originalPrice: existingProduct.originalPrice,
      seoTitle: existingProduct.seoTitle, seoDescription: existingProduct.seoDescription, kiotVietProductId: existingProduct.kiotVietProductId,
      gallery: existingProduct.images.map((image) => image.url),
      priceVariants: existingProduct.variants.map((variant) => ({
        id: variant.id, sku: variant.sku, quality: variant.quality, shape: variant.shape, beadSize: variant.beadSize,
        carat: variant.carat?.toString() || null, gemstoneQuality: variant.gemstoneQuality,
        price: Number(variant.price || 0), originalPrice: Number(variant.originalPrice || 0), stock: variant.stock,
        imageUrls: variant.imageUrls, videoUrl: variant.videoUrl,
      })),
    } : {};
    const effectiveInput: Input = { ...existingInput, ...input };
    if (existingProduct && Array.isArray(input.priceVariants)) {
      const submitted = input.priceVariants.filter((variant: unknown): variant is Input => Boolean(variant) && typeof variant === "object" && !Array.isArray(variant));
      const submittedByExistingId = new Map<string, Input>();
      const unmatched: Input[] = [];
      for (const variant of submitted) {
        const existing = existingProduct.variants.find((row) => (variant.id && row.id === String(variant.id)) || (variant.sku && row.sku === String(variant.sku)));
        if (existing) {
          if (submittedByExistingId.has(existing.id)) throw new BadRequestException(`Biến thể SKU ${existing.sku} bị lặp trong dữ liệu cập nhật.`);
          submittedByExistingId.set(existing.id, variant);
        } else unmatched.push(variant);
      }
      effectiveInput.priceVariants = existingProduct.variants.map((variant, index) => ({
        ...(existingInput.priceVariants as Input[])[index],
        ...(submittedByExistingId.get(variant.id) || {}),
      })).concat(unmatched);
    }
    const data = this.productData(effectiveInput);
    const productDataToPersist: Input = { ...data };
    const productFieldInputs: Array<[string, string]> = [
      ["sku", "sku"], ["name", "name"], ["slug", "slug"], ["kind", "kind"], ["categoryId", "categoryId"],
      ["gemstoneTypeId", "gemstoneTypeId"], ["materialOptionId", "materialOptionId"], ["description", "description"],
      ["fullDescription", "fullDescription"], ["coverVideoUrl", "coverVideoUrl"], ["technicalImageUrl", "technicalImageUrl"],
      ["technicalVideoUrl", "technicalVideoUrl"], ["weightGrams", "weightGrams"], ["lengthCm", "lengthCm"],
      ["widthCm", "widthCm"], ["heightCm", "heightCm"], ["status", "status"], ["isNew", "isNew"],
      ["isFeatured", "isFeatured"], ["isPremiumGemstone", "isPremiumGemstone"], ["price", "price"],
      ["originalPrice", "originalPrice"], ["seoTitle", "seoTitle"], ["seoDescription", "seoDescription"],
      ["kiotVietProductId", "kiotVietProductId"],
    ];
    if (existingProduct) for (const [inputKey, dataKey] of productFieldInputs) if (!Object.hasOwn(input, inputKey)) delete productDataToPersist[dataKey];
    const submittedVariantFields = new Map<string, Set<string>>();
    if (existingProduct && Array.isArray(input.priceVariants)) {
      for (const raw of input.priceVariants) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const row = raw as Input;
        const existing = existingProduct.variants.find((variant) => (row.id && variant.id === String(row.id)) || (row.sku && variant.sku === String(row.sku)));
        if (existing) submittedVariantFields.set(existing.id, new Set(Object.keys(row)));
      }
    }
    if (id) {
      const current = existingProduct!;
      if (data.sku !== current.sku) throw new BadRequestException("Không được thay đổi SKU trong Hồ sơ sản phẩm.");
      if (!Object.hasOwn(input, "isPremiumGemstone")) data.isPremiumGemstone = current.isPremiumGemstone;
      if (data.isPremiumGemstone && data.kind !== "GEMSTONE") throw new BadRequestException("Nhãn Hàng cao cấp chỉ áp dụng cho sản phẩm đá quý.");
      // Status is intentionally omitted by the edit form so content/price saves
      // cannot silently publish or hide a product. Keep the persisted state.
      if (!Object.prototype.hasOwnProperty.call(input, "status")) data.status = current.status;
      // Price-profile and admin edits do not carry a slug. Keep the existing
      // public URL instead of deriving a possibly-colliding slug from the name.
      if (typeof input.slug !== "string" || !input.slug.trim()) data.slug = current.slug;
    }
    if (data.kind === "GEMSTONE" && !data.gemstoneTypeId) throw new BadRequestException("Hồ sơ đá quý cần chọn loại đá cấp 2.");
    let gemstonePricingMode = "GEMSTONE_SIZE";
    if (data.gemstoneTypeId) {
      const [category, gemstoneType] = await Promise.all([
        this.prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true, kind: true, usage: true, level: true, parentId: true, pricingMode: true } }),
        this.prisma.category.findUnique({ where: { id: data.gemstoneTypeId }, select: { kind: true, usage: true, level: true } }),
      ]);
      if (data.kind !== "GEMSTONE" || data.materialOptionId || !category || category.kind !== "GEMSTONE" || category.level !== 2 || category.id !== data.gemstoneTypeId || !gemstoneType || gemstoneType.kind !== "GEMSTONE" || gemstoneType.level !== 2 || !["GEMSTONE_TYPE", "PRODUCT_CATEGORY"].includes(gemstoneType.usage)) {
        throw new BadRequestException("Hồ sơ đá quý cần gắn trực tiếp với danh mục loại đá cấp 2.");
      }
      gemstonePricingMode = category.pricingMode === "GEMSTONE_CARAT" || category.pricingMode === "GEMSTONE_CARAT_AND_QUALITY" ? category.pricingMode : "GEMSTONE_SIZE";
    }
    if (data.materialOptionId) {
      const option = await this.prisma.materialOption.findUnique({ where: { id: data.materialOptionId }, select: { scope: true, active: true } });
      const expectedScope = data.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
      if (!option || !option.active || option.scope !== expectedScope) throw new BadRequestException("Loại đá hoặc chất liệu không thuộc đúng nhóm sản phẩm, hoặc đã bị ẩn.");
      const previous = id ? await this.prisma.product.findUnique({ where: { id }, select: { categoryId: true, materialOptionId: true } }) : null;
      const unchangedAssociation = previous?.categoryId === data.categoryId && previous.materialOptionId === data.materialOptionId;
      await this.assertCategoryAllowsMaterial(this.prisma, data.categoryId, data.materialOptionId, !unchangedAssociation);
    }
    const productCategory = await this.prisma.category.findUnique({ where: { id: data.categoryId }, select: { slug: true } });
    const isBangleProduct = data.kind === "JEWELRY" && productCategory?.slug === "vong-kieng";
    const imageInputs = (Array.isArray(effectiveInput.gallery) ? effectiveInput.gallery : effectiveInput.image ? [effectiveInput.image] : []).filter((url: unknown) => typeof url === "string" && url.length > 0).slice(0, 10) as string[];
    const images = await Promise.all(imageInputs.map((url, index) => url.startsWith("data:image/") ? this.persistDataImageReference(url, `product-${data.sku}-${index + 1}.webp`, data.name) : url));
    if (data.technicalImageUrl?.startsWith("data:image/")) {
      data.technicalImageUrl = await this.persistDataImageReference(data.technicalImageUrl, `product-${data.sku}-technical.webp`, data.name);
    }
    const submittedVariants = Array.isArray(effectiveInput.priceVariants) ? effectiveInput.priceVariants as Input[] : [];
    const changedBangleMediaKeys = new Set<string>();
    const submittedBangleMediaKeys = new Set<string>();
    if (isBangleProduct && existingProduct) {
      if (Array.isArray(input.priceVariants)) for (const raw of input.priceVariants) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const row = raw as Input;
        const existing = existingProduct.variants.find((variant) => (row.id && variant.id === String(row.id)) || (row.sku && variant.sku === String(row.sku)));
        if (existing && (Object.hasOwn(row, "imageUrls") || Object.hasOwn(row, "videoUrl"))) submittedBangleMediaKeys.add(existing.id);
      }
      for (const variant of submittedVariants) {
        const existing = existingProduct.variants.find((row) => (variant.id && row.id === String(variant.id)) || (variant.sku && row.sku === String(variant.sku)));
        if (!existing) continue;
        const submittedImages = Array.isArray(variant.imageUrls) ? variant.imageUrls.map((url: unknown) => String(url || "").trim()).filter(Boolean) : [];
        const existingImages = Array.isArray(existing.imageUrls) ? existing.imageUrls.map((url) => String(url || "").trim()).filter(Boolean) : [];
        const submittedVideo = typeof variant.videoUrl === "string" ? variant.videoUrl.trim() : "";
        const existingVideo = typeof existing.videoUrl === "string" ? existing.videoUrl.trim() : "";
        if (JSON.stringify(submittedImages) !== JSON.stringify(existingImages) || submittedVideo !== existingVideo) changedBangleMediaKeys.add(existing.id);
      }
    }
    const variants = isBangleProduct && (!existingProduct || submittedBangleMediaKeys.size > 0)
      ? synchronizeBangleVariantMedia(data.sku, submittedVariants, { changedVariantKeys: changedBangleMediaKeys, synchronizeAll: !existingProduct })
      : submittedVariants;
    const persistedVariantImageReferences = new Map<string, Promise<string>>();
    const variantCreate = await Promise.all(variants.map(async (variant: Input, index: number) => {
      const quality = String(variant.quality || "Standard").trim().slice(0, 40);
      const shape = String(variant.shape || "").trim().toLocaleUpperCase("en") || null;
      const beadSize = String(variant.beadSize || "").trim().slice(0, 24) || null;
      const caratValue = variant.carat == null || String(variant.carat).trim() === "" ? null : Number(variant.carat);
      const carat = caratValue == null ? null : String(caratValue);
      const gemstoneQuality = String(variant.gemstoneQuality || "").trim().slice(0, 40) || null;
      const imageUrls = (Array.isArray(variant.imageUrls) ? variant.imageUrls : [])
        .filter((url: unknown) => typeof url === "string" && url.trim())
        .slice(0, 8);
      const savedImageUrls = await Promise.all(imageUrls.map((url: string, imageIndex: number) => {
        if (!url.startsWith("data:image/")) return url;
        let pending = persistedVariantImageReferences.get(url);
        if (!pending) {
          pending = this.persistDataImageReference(url, `variant-${data.sku}-${index + 1}-${imageIndex + 1}.webp`, data.name);
          persistedVariantImageReferences.set(url, pending);
        }
        return pending;
      }));
      const sku = String(variant.sku || "").trim();
      const videoUrl = String(variant.videoUrl || "").trim().slice(0, 2000) || null;
      if (!quality) throw new BadRequestException("Mỗi biến thể cần có thông tin chất lượng hoặc phân loại.");
      if (data.kind === "GEMSTONE") {
        if (isCaratPricing(gemstonePricingMode) && (!caratValue || !Number.isFinite(caratValue) || caratValue <= 0 || caratValue > 1000 || Math.round(caratValue * 1000) !== caratValue * 1000)) throw new BadRequestException("Mỗi biến thể đá quý cần carat lớn hơn 0, tối đa 3 chữ số thập phân.");
        if (gemstonePricingMode === "GEMSTONE_SIZE" && !beadSize) throw new BadRequestException("Biến thể đá quý cần có size mặt đá.");
        if (gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY" && !gemstoneQuality) throw new BadRequestException("Biến thể đá quý cần có chất lượng.");
      }
      if (isBangleProduct) {
        const issue = bangleVariantIssue(data.sku, { sku, shape, quality, beadSize });
        if (issue) throw new BadRequestException(issue);
      } else if (shape) {
        throw new BadRequestException("Chỉ sản phẩm thuộc danh mục Vòng Kiềng mới dùng biến thể dáng.");
      }
      if (!sku || !sku.startsWith(data.sku) || sku.length > 64 || !/^[A-Za-z0-9]+$/.test(sku)) {
        throw new BadRequestException(`SKU biến thể ${quality}${beadSize ? ` · ${beadSize}` : ""} phải là mã chữ/số bắt đầu bằng SKU mẹ ${data.sku}.`);
      }
      if (data.kind === "GEMSTONE" && sku.toLocaleUpperCase("en") !== `${data.sku}${gemstoneSkuSuffix(quality, gemstonePricingMode, beadSize || "", carat || "", gemstoneQuality || "")}`.toLocaleUpperCase("en")) {
        throw new BadRequestException("SKU biến thể đá quý phải khớp dạng cắt và size hoặc carat/chất lượng đã chọn.");
      }
      return {
        optionKey: variantOptionKey(shape || "", quality, beadSize || "", carat || "", gemstoneQuality || ""),
        quality, shape, beadSize, carat, gemstoneQuality, sku,
        imageUrls: savedImageUrls,
        videoUrl,
        price: Number(variant.price) || 0, originalPrice: Number(variant.originalPrice) || null,
        sortOrder: index,
      };
    }));
    if (data.kind === "GEMSTONE") {
      const priceByOption = new Map<string, number>();
      for (const variant of variantCreate) {
        const option = gemstonePricingMode === "GEMSTONE_SIZE"
          ? String(variant.beadSize || "").trim()
          : gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY"
            ? String(variant.gemstoneQuality || "").trim()
            : "ALL_CARATS";
        const price = Number(variant.price) || 0;
        const existing = priceByOption.get(option);
        if (existing !== undefined && existing !== price) {
          const basis = gemstonePricingMode === "GEMSTONE_SIZE" ? `size ${option}` : gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY" ? `chất lượng ${option}` : "đơn giá 1 ct";
          throw new BadRequestException(`Các biến thể cùng ${basis} phải dùng chung một giá bán.`);
        }
        priceByOption.set(option, price);
      }
    }
    if (new Set(variantCreate.map((variant) => variant.sku.toLocaleUpperCase("en"))).size !== variantCreate.length) {
      throw new BadRequestException("SKU của các biến thể phải khác nhau.");
    }
    try {
      let catalogChanged = !id;
      let imageSyncChanged = false;
      const result = await this.prisma.$transaction(async (tx) => {
        let record: any;
        const isPublishingNow = data.status === "ACTIVE" && (!existingProduct || existingProduct.status !== "ACTIVE");
        if (isPublishingNow) {
          if (!id) throw new BadRequestException("Để đăng bán, hãy chọn một SKU đã có trong kho.");
          const current = await tx.product.findUnique({ where: { id }, select: { status: true, stock: true, variants: { select: { stock: true } } } });
          if (!current) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
          const availableStock = current.variants.length ? current.variants.reduce((sum, variant) => sum + variant.stock, 0) : current.stock;
          if (current.status !== "ACTIVE" && availableStock <= 0) throw new BadRequestException("Chỉ có thể đăng bán SKU đang còn hàng trong kho.");
          if (!(data.kind === "GEMSTONE" && data.isPremiumGemstone)) {
            const prices = variantCreate.length ? variantCreate.map((variant) => variant.price) : [Number(data.price) || 0];
            if (!prices.length || prices.some((price) => price <= 0)) throw new BadRequestException("Hãy điền giá bán trong Hồ sơ giá trước khi đăng sản phẩm.");
          }
        }
        if (id) {
          const currentPriceData = await tx.product.findUnique({ where: { id }, select: { sku: true, name: true, kind: true, categoryId: true, isPremiumGemstone: true, price: true, originalPrice: true, category: { select: { pricingMode: true } }, variants: { select: { id: true, optionKey: true, sku: true, quality: true, shape: true, beadSize: true, price: true, originalPrice: true, carat: true, gemstoneQuality: true, imageUrls: true, videoUrl: true } } } });
          if (!currentPriceData) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
          if (data.sku !== currentPriceData.sku) throw new BadRequestException("Không được thay đổi SKU trong Hồ sơ sản phẩm.");
          const currentVariantsByKey = new Map(currentPriceData.variants.map((variant) => [variant.optionKey, variant]));
          const submittedGallery = Object.hasOwn(input, "gallery") || Object.hasOwn(input, "image");
          const galleryChanged = submittedGallery && JSON.stringify(images) !== JSON.stringify(existingProduct?.images.map((image) => image.url) || []);
          const variantImagesChanged = variantCreate.some((variant) => {
            const existing = currentVariantsByKey.get(variant.optionKey);
            return existing && JSON.stringify(variant.imageUrls) !== JSON.stringify(existing.imageUrls || []);
          });
          imageSyncChanged = galleryChanged || variantImagesChanged;
          for (const variant of variantCreate) {
            const existing = currentVariantsByKey.get(variant.optionKey);
            if (existing && variant.sku !== existing.sku) {
              throw new BadRequestException(`Không được thay đổi SKU biến thể ${existing.sku} trong Hồ sơ sản phẩm.`);
            }
          }
          const priceChanged = Number(currentPriceData.price ?? 0) !== Number(data.price ?? 0)
            || currentPriceData.categoryId !== data.categoryId
            || (data.kind === "GEMSTONE" && currentPriceData.category?.pricingMode !== gemstonePricingMode)
            || variantCreate.some((variant) => {
              const existing = currentVariantsByKey.get(variant.optionKey);
              return existing && (Number(existing.price ?? 0) !== Number(variant.price)
                || Number(existing.carat ?? 0) !== Number(variant.carat ?? 0)
                || String(existing.gemstoneQuality || "") !== String(variant.gemstoneQuality || ""));
            });
          const premiumModeChanged = currentPriceData.isPremiumGemstone !== data.isPremiumGemstone;
          const shouldSyncPosPrice = priceChanged;
          catalogChanged = currentPriceData.name !== data.name || priceChanged || premiumModeChanged;
          const posPriceSyncFields = shouldSyncPosPrice ? {
            pos365PriceSyncStatus: this.pos365.isSyncEnabled() ? "PENDING" : "DISABLED",
            pos365PriceSyncAttempts: 0,
            pos365PriceSyncLastAttemptAt: null,
            pos365PriceSyncNextAttemptAt: this.pos365.isSyncEnabled() ? new Date() : null,
            pos365PriceSyncedAt: null,
            pos365PriceSyncError: null,
          } : {};
          const posImageSyncFields = imageSyncChanged ? {
            pos365ImageSyncStatus: this.pos365.isSyncEnabled() ? "PENDING" : "DISABLED",
            pos365ImageSyncAttempts: 0,
            pos365ImageSyncLastAttemptAt: null,
            pos365ImageSyncNextAttemptAt: this.pos365.isSyncEnabled() ? new Date() : null,
            pos365ImageSyncedAt: null,
            pos365ImageSyncError: null,
          } : {};
          const productUpdateData: Input = { ...productDataToPersist, ...posPriceSyncFields, ...posImageSyncFields };
          if (Object.hasOwn(input, "gallery") || Object.hasOwn(input, "image")) {
            productUpdateData.images = { deleteMany: {}, create: images.map((url: string, index: number) => ({ url, alt: data.name, sortOrder: index, isPrimary: index === 0 })) };
          }
          await tx.product.update({ where: { id }, data: productUpdateData });
          const existingVariants = await tx.productPriceVariant.findMany({ where: { productId: id }, select: { id: true, optionKey: true } });
          const existingByKey = new Map(existingVariants.map((variant) => [variant.optionKey, variant]));
          for (const variant of variantCreate) {
            const existing = existingByKey.get(variant.optionKey);
            if (existing) {
              if (variant.sku !== currentVariantsByKey.get(variant.optionKey)?.sku) {
                const collision = await tx.productPriceVariant.findUnique({ where: { sku: variant.sku }, select: { id: true } });
                const productCollision = await tx.product.findUnique({ where: { sku: variant.sku }, select: { id: true } });
                if ((collision && collision.id !== existing.id) || productCollision) throw new ConflictException(`SKU biến thể ${variant.sku} đã được sử dụng.`);
              }
              const currentVariant = currentPriceData.variants.find((row) => row.id === existing.id);
              const changedInputFields = submittedVariantFields.get(existing.id) || new Set<string>();
              const variantUpdateData: Input = {};
              for (const field of ["sku", "quality", "shape", "beadSize", "carat", "gemstoneQuality", "price", "originalPrice", "imageUrls", "videoUrl"] as const) {
                if (changedInputFields.has(field)) variantUpdateData[field] = variant[field];
              }
              if (currentVariant && JSON.stringify(currentVariant.imageUrls) !== JSON.stringify(variant.imageUrls)) variantUpdateData.imageUrls = variant.imageUrls;
              if (currentVariant && String(currentVariant.videoUrl || "") !== String(variant.videoUrl || "")) variantUpdateData.videoUrl = variant.videoUrl;
              if (Object.keys(variantUpdateData).length) await tx.productPriceVariant.update({ where: { id: existing.id }, data: variantUpdateData });
            }
          }
          record = await tx.product.findUniqueOrThrow({ where: { id }, include: includeProduct });
        } else {
          throw new BadRequestException("Hãy tạo SKU trong Quản lý tồn kho trước, sau đó chọn SKU đó để tạo bài đăng sản phẩm.");
        }
        return record;
      });
      if (catalogChanged && result.pos365PriceSyncStatus === "PENDING") await this.pos365.syncProductPricesNow(result.id);
      if (imageSyncChanged) await this.pos365.queueProductImageSync(result.id);
      this.publishCatalogChange("product", id ? "updated" : "created", result.id);
      return await this.prisma.product.findUniqueOrThrow({ where: { id: result.id }, include: includeProduct });
    } catch (error: any) {
      if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm.");
      if (error?.code === "P2002") throw new ConflictException("SKU hoặc đường dẫn sản phẩm đã tồn tại.");
      if (error?.code === "P2003") throw new BadRequestException("Danh mục sản phẩm không tồn tại.");
      throw error;
    }
  }

  async unpublishProduct(id: string) {
    try {
      const product = await this.prisma.product.update({ where: { id }, data: { status: "HIDDEN" }, include: includeProduct });
      this.publishCatalogChange("product", "updated", id);
      return product;
    }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm trong kho."); throw error; }
  }

  async deleteProduct(id: string, input: Input = {}, actor?: { id: string; correlationId?: string }) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
    });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
    const skus = [...new Set([product.sku, ...product.variants.map((variant) => variant.sku || "")].map((sku) => sku.trim()).filter(Boolean))];
    if (!this.pos365.status().configured) {
      throw new BadRequestException("POS365 chưa được cấu hình. Hãy kết nối POS365 trước khi xóa để xác nhận SKU bên POS cũng được gỡ.");
    }
    // Match exact SKU/Code and remove POS first. If POS rejects the deletion,
    // retain the local product so the two catalogs cannot silently diverge.
    const posResult = await this.pos365.deleteProductsBySku(skus);
    const reason = String(input.reason || "Xóa cứng sản phẩm theo yêu cầu quản trị").trim().slice(0, 1000);
    const deletedAt = new Date();
    const dateKey = `${deletedAt.getUTCFullYear()}${String(deletedAt.getUTCMonth() + 1).padStart(2, "0")}${String(deletedAt.getUTCDate()).padStart(2, "0")}`;
    const issueId = randomUUID();
    const issueNo = `PX${dateKey}-${issueId.slice(0, 6).toUpperCase()}`;
    let adjustmentIssueNo: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.product.findUnique({
          where: { id },
          include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
        });
        if (!current) throw new NotFoundException("Sản phẩm đã bị xóa khỏi kho.");
        const currentSkus = [...new Set([current.sku, ...current.variants.map((variant) => variant.sku || "")].map((sku) => sku.trim()).filter(Boolean))].sort();
        if (currentSkus.join("|") !== [...skus].sort().join("|")) {
          throw new ConflictException("SKU sản phẩm vừa thay đổi. Đã gỡ mã cũ khỏi POS; hãy tải lại danh sách và thử lại.");
        }
        const adjustmentNote = `[DELETE] Xóa cứng SKU ${current.sku}; giữ lại lịch sử phiếu. Lý do: ${reason}`;
        const historyRows = current.variants.length
          ? current.variants.filter((variant) => variant.stock > 0).map((variant) => ({
              variant, sku: variant.sku || current.sku,
              label: [variant.quality, variant.beadSize].filter(Boolean).join(" · ") || null,
              quantity: variant.stock,
            }))
          : current.stock > 0 ? [{ variant: null, sku: current.sku, label: null, quantity: current.stock }] : [];
        const totalQuantity = historyRows.reduce((sum, row) => sum + row.quantity, 0);
        if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 2_147_483_647) throw new BadRequestException("Tổng tồn của SKU vượt giới hạn phiếu điều chỉnh.");
        if (historyRows.length) {
          await tx.inventoryIssue.create({ data: {
            id: issueId, issueNo, issuedAt: deletedAt, reason: "OTHER", recipient: "Xóa SKU khỏi hệ thống",
            warehouseName: "Kho chính", status: "COMPLETED", note: adjustmentNote,
            totalQuantity, totalAmount: 0,
          } });
          for (const row of historyRows) {
            const stoneName = current.kind === "GEMSTONE" ? current.gemstoneType?.name || current.materialOption?.name || null : current.materialOption?.name || null;
            await tx.inventoryIssueItem.create({ data: {
              issueId, productId: current.id, variantId: row.variant?.id || null,
              productName: current.name, productSku: row.sku, variantLabel: row.label,
              categoryName: current.category?.name || null, stoneName, kind: current.kind,
              quantity: row.quantity, unitPrice: 0, lineTotal: 0,
            } });
            await tx.inventoryMovement.create({ data: {
              productId: current.id, variantId: row.variant?.id || null,
              productName: current.name, productSku: row.sku, variantLabel: row.label,
              type: "OUT", quantity: row.quantity, stockBefore: row.quantity, stockAfter: 0,
              reference: issueNo, note: adjustmentNote,
            } });
          }
          adjustmentIssueNo = issueNo;
        }
        await tx.auditLog.create({ data: {
          adminId: actor?.id || null, correlationId: actor?.correlationId,
          action: "PRODUCT_HARD_DELETED", entityType: "Product", entityId: current.id,
          before: {
            id: current.id, sku: current.sku, name: current.name, status: current.status, stock: current.stock,
            variants: current.variants.map((variant) => ({ id: variant.id, sku: variant.sku, shape: variant.shape, quality: variant.quality, beadSize: variant.beadSize, stock: variant.stock })),
          },
          after: { deleted: true, reason, pos365DeletedSkus: posResult.deleted },
        } });
        // Historical rows keep their captured name, SKU, quantity and price; FK
        // relations are configured as SET NULL, so deleting catalog rows cannot
        // remove receipt, issue, movement or order history.
        await tx.product.delete({ where: { id: current.id } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      // If the database transaction did not complete after POS365 removed the
      // item, queue a catalog stock sync to recreate/repair the still-local SKU.
      await this.queueProductStockSync(this.prisma, [id]).catch(() => undefined);
      throw error;
    }
    this.publishCatalogChange("product", "deleted", id);
    return { id, sku: product.sku, deletedPosSkus: posResult.deleted, retainedHistory: true, adjustmentIssueNo };
  }

  async inventory() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [products, soldItems, movements, reservations] = await Promise.all([
      this.prisma.product.findMany({
        select: {
          id: true,
          sku: true,
          name: true,
          status: true,
          stock: true,
          minimumStock: true,
          price: true,
          kind: true,
          category: { select: { id: true, name: true, pricingMode: true } },
          gemstoneType: { select: { id: true, name: true } },
          materialOption: { select: { id: true, name: true, kind: true, scope: true } },
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, select: { url: true, alt: true } },
          variants: { orderBy: { sortOrder: "asc" }, select: { id: true, sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, price: true, stock: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: 5000,
      }),
      this.prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { placedAt: { gte: monthStart }, status: { not: "CANCELLED" } } },
        _sum: { quantity: true },
      }),
      this.inventoryMovements("8"),
      this.prisma.inventoryReservation.groupBy({
        by: ["productId", "variantId"],
        where: { status: "ACTIVE", product: { status: "ACTIVE" } },
        _sum: { quantity: true },
      }),
    ]);
    const soldByProduct = new Map<string, number>();
    for (const item of soldItems) if (item.productId) soldByProduct.set(item.productId, Number(item._sum.quantity) || 0);
    const reservedByProduct = new Map<string, number>();
    const reservedByVariant = new Map<string, number>();
    for (const reservation of reservations) {
      const quantity = Number(reservation._sum.quantity) || 0;
      reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) || 0) + quantity);
      if (reservation.variantId) reservedByVariant.set(reservation.variantId, quantity);
    }
    return {
      products: products.map((product) => ({
        ...product,
        stock: product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock,
        availableStock: product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock,
        reservedStock: reservedByProduct.get(product.id) || 0,
        onHandStock: (product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock) + (reservedByProduct.get(product.id) || 0),
        variants: product.variants.map((variant) => ({
          ...variant,
          availableStock: variant.stock,
          reservedStock: reservedByVariant.get(variant.id) || 0,
          onHandStock: variant.stock + (reservedByVariant.get(variant.id) || 0),
        })),
        soldThisMonth: soldByProduct.get(product.id) || 0,
      })),
      recentMovements: movements,
      warehouse: "Kho chính",
    };
  }

  inventoryMovements(limitInput?: string) {
    const limit = Math.min(Math.max(Number(limitInput) || 20, 1), 100);
    return this.prisma.inventoryMovement.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async inventorySkuRules() {
    const setting = await this.prisma.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
    return { rules: Array.isArray(setting?.value) ? setting.value : [] };
  }

  private cleanSkuPrefix(value: unknown) {
    const prefix = String(value || "").trim().toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
    if (!prefix || prefix.length > 16) throw new BadRequestException("Mã tiền tố phải có từ 1 đến 16 ký tự chữ hoặc số.");
    return prefix;
  }

  private async assertCategoryAllowsMaterial(client: any, categoryId: string, materialOptionId: string, enforceCategoryApplicability = true) {
    const [setting, applicabilitySetting] = await Promise.all([
      client.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } }),
      client.siteSetting.findUnique({ where: { key: "inventory.materialCategoryApplicability" }, select: { value: true } }),
    ]);
    const rules = Array.isArray(setting?.value) ? setting.value as Input[] : [];
    const applicability = applicabilitySetting?.value && typeof applicabilitySetting.value === "object" && !Array.isArray(applicabilitySetting.value)
      ? applicabilitySetting.value as Record<string, unknown>
      : {};
    const categoryIds = applicability[materialOptionId];
    const hasExplicitApplicability = Object.prototype.hasOwnProperty.call(applicability, materialOptionId) && Array.isArray(categoryIds);
    if (enforceCategoryApplicability && hasExplicitApplicability && !categoryIds.includes(categoryId)) {
      throw new BadRequestException("Loại đá này chưa được áp dụng cho danh mục sản phẩm đã chọn. Hãy chỉnh trong mục Loại đá.");
    }
    const rule = rules.find((candidate) => candidate.categoryId === categoryId);
    // Rules saved before category-specific stone lists remain unrestricted until edited.
    if (!hasExplicitApplicability && rule && Array.isArray(rule.materialOptionIds) && !rule.materialOptionIds.includes(materialOptionId)) {
      throw new BadRequestException("Loại đá này chưa được áp dụng cho danh mục sản phẩm đã chọn.");
    }
  }

  async saveInventorySkuRules(input: Input) {
    const rawRules = Array.isArray(input.rules) ? input.rules : [];
    const categoryIds = [...new Set(rawRules.map((rule: Input) => String(rule.categoryId || "")).filter(Boolean))];
    const categories = categoryIds.length ? await this.prisma.category.findMany({ where: { id: { in: categoryIds }, status: "ACTIVE" }, select: { id: true, slug: true, kind: true, usage: true, level: true, parentId: true } }) : [];
    if (categories.length !== categoryIds.length || categories.some((category) => !(category.usage === "PRODUCT_CATEGORY" && category.level >= 2 || category.kind === "GEMSTONE" && category.usage === "GEMSTONE_TYPE" && category.level === 2))) {
      throw new BadRequestException("Chỉ tạo quy tắc cho danh mục sản phẩm đang hoạt động đã được tạo.");
    }
    const materialIds = [...new Set(rawRules.flatMap((rule: Input) => [
      ...(Array.isArray(rule.materialOptionIds) ? rule.materialOptionIds.map((id: unknown) => String(id || "")) : []),
      ...(Array.isArray(rule.materialPrefixes) ? rule.materialPrefixes.map((entry: Input) => String(entry.materialOptionId || "")) : []),
    ]).filter(Boolean))];
    const materials = materialIds.length ? await this.prisma.materialOption.findMany({ where: { id: { in: materialIds }, active: true, kind: "STONE" }, select: { id: true, scope: true } }) : [];
    const normalized = rawRules.map((rule: Input) => {
      const category = categories.find((item) => item.id === String(rule.categoryId));
      if (!category) throw new BadRequestException("Danh mục trong quy tắc không hợp lệ.");
      const isGemstoneTypeRule = category.usage === "GEMSTONE_TYPE";
      const skuFormat = rule.skuFormat === "BANGLE_SHAPE_QUALITY_SIZE" ? "BANGLE_SHAPE_QUALITY_SIZE" : "SEQUENTIAL";
      if (skuFormat === "BANGLE_SHAPE_QUALITY_SIZE" && (category.kind !== "JEWELRY" || category.slug !== "vong-kieng")) {
        throw new BadRequestException("Quy tắc dáng, chất lượng và size chỉ áp dụng cho danh mục Vòng Kiềng.");
      }
      const prefix = this.cleanSkuPrefix(rule.prefix);
      const hasMaterialList = !isGemstoneTypeRule && Array.isArray(rule.materialOptionIds);
      const materialOptionIds = isGemstoneTypeRule ? [] : hasMaterialList
        ? [...new Set((rule.materialOptionIds as unknown[]).map((id) => String(id || "")).filter(Boolean))]
        : undefined;
      if (hasMaterialList && materialOptionIds!.length !== (rule.materialOptionIds as unknown[]).length) {
        throw new BadRequestException("Danh sách loại đá trong quy tắc bị trùng hoặc rỗng.");
      }
      const expectedScope = category.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
      for (const materialId of materialOptionIds || []) {
        const material = materials.find((item) => item.id === materialId);
        if (!material || material.scope !== expectedScope) throw new BadRequestException("Loại đá phải đang hoạt động và thuộc đúng nhóm danh mục.");
      }
      const materialPrefixes = isGemstoneTypeRule ? [] : Array.isArray(rule.materialPrefixes) ? rule.materialPrefixes.map((entry: Input) => {
        const material = materials.find((item) => item.id === String(entry.materialOptionId || ""));
        if (!material || material.scope !== expectedScope) throw new BadRequestException("Loại đá phải đang hoạt động và thuộc đúng nhóm danh mục.");
        if (hasMaterialList && !materialOptionIds!.includes(material.id)) throw new BadRequestException("Chỉ cấu hình tiền tố cho loại đá đã chọn áp dụng trong danh mục.");
        return { materialOptionId: material.id, prefix: this.cleanSkuPrefix(entry.prefix) };
      }) : [];
      if (new Set(materialPrefixes.map((entry: Input) => entry.materialOptionId)).size !== materialPrefixes.length) throw new BadRequestException("Một loại đá chỉ được cấu hình một tiền tố trong mỗi danh mục.");
      if (skuFormat === "BANGLE_SHAPE_QUALITY_SIZE") {
        const allowedMaterialIds = materialOptionIds || materialPrefixes.map((entry: Input) => entry.materialOptionId);
        if (!allowedMaterialIds.length || allowedMaterialIds.some((id: string) => !materialPrefixes.some((entry: Input) => entry.materialOptionId === id))) {
          throw new BadRequestException("Mỗi loại đá áp dụng cho Vòng Kiềng cần có mã đá để ghép vào SKU.");
        }
      }
      return { categoryId: category.id, prefix, skuFormat, ...(hasMaterialList ? { materialOptionIds } : {}), materialPrefixes };
    });
    if (new Set(normalized.map((rule: Input) => rule.categoryId)).size !== normalized.length) throw new BadRequestException("Mỗi danh mục chỉ được có một quy tắc mã hàng.");
    const prefixOwners = new Map<string, Set<string>>();
    for (const rule of normalized) {
      const expandedPrefixes = [rule.prefix, ...rule.materialPrefixes.map((entry: Input) => `${rule.prefix}${entry.prefix}`)];
      if (new Set(expandedPrefixes).size !== expandedPrefixes.length) {
        throw new BadRequestException("Các tiền tố trong cùng danh mục bị trùng nhau. Hãy chọn mã khác để tránh trùng SKU.");
      }
      for (const prefix of expandedPrefixes) {
        const owners = prefixOwners.get(prefix) ?? new Set<string>();
        owners.add(rule.categoryId);
        prefixOwners.set(prefix, owners);
      }
    }
    for (const [prefix, owners] of prefixOwners) {
      if (owners.size < 2) continue;
      const ownerCategories = categories.filter((category) => owners.has(category.id));
      const sharedParentId = ownerCategories[0]?.parentId;
      const maySharePrefix = Boolean(sharedParentId)
        && ownerCategories.length === owners.size
        && ownerCategories.every((category) => category.parentId === sharedParentId && category.level === ownerCategories[0]?.level && category.usage === "PRODUCT_CATEGORY");
      if (!maySharePrefix) throw new BadRequestException(`Tiền tố ${prefix} chỉ được dùng chung giữa các danh mục con cùng cấp trong một nhóm.`);
    }
    await this.prisma.siteSetting.upsert({ where: { key: "inventory.skuRules" }, create: { key: "inventory.skuRules", value: normalized as any }, update: { value: normalized as any } });
    return { rules: normalized };
  }

  private receiptNumberPrefix(date: Date) {
    return `PN${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}-`;
  }

  private async nextReceiptNumber(client: any, date: Date) {
    const prefix = this.receiptNumberPrefix(date);
    const existing = await client.inventoryReceipt.findMany({ where: { receiptNo: { startsWith: prefix } }, select: { receiptNo: true } });
    const max = existing.reduce((largest: number, row: { receiptNo: string }) => {
      const suffix = Number(row.receiptNo.slice(prefix.length));
      return Number.isInteger(suffix) && suffix > largest ? suffix : largest;
    }, 0);
    return `${prefix}${String(max + 1).padStart(2, "0")}`;
  }

  async nextInventoryReceiptNumber(dateInput?: string) {
    const date = parseDate(dateInput);
    return { receiptNo: await this.nextReceiptNumber(this.prisma, date) };
  }

  inventoryReceipts(limitInput?: string) {
    const limit = Math.min(Math.max(Number(limitInput) || 100, 1), 500);
    return this.prisma.inventoryReceipt.findMany({
      select: { id: true, receiptNo: true, receivedAt: true, supplierName: true, receiver: true, warehouseName: true, totalQuantity: true, totalAmount: true, status: true, pos365SyncStatus: true, pos365SyncCode: true, pos365SyncError: true, pos365SyncedAt: true },
      orderBy: { receivedAt: "desc" }, take: limit,
    });
  }

  async reconcileInventoryReceiptsFromPos(receiptIdsInput: unknown) {
    const receiptIds = Array.isArray(receiptIdsInput)
      ? [...new Set(receiptIdsInput.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))].slice(0, 50)
      : [];
    if (!receiptIds.length) throw new BadRequestException("Chọn ít nhất một phiếu đã đồng bộ POS365 để đối soát.");

    const candidates = await this.prisma.inventoryReceipt.findMany({
      where: { id: { in: receiptIds }, status: "COMPLETED", pos365SyncCode: { not: null } },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
    const result = { checked: 0, stillInPos: 0, canceled: [] as string[], skipped: receiptIds.length - candidates.length, errors: [] as string[] };
    const changedProductIds = new Set<string>();

    for (const candidate of candidates) {
      const code = String(candidate.pos365SyncCode || "").trim();
      if (!code) { result.skipped += 1; continue; }
      let exists: boolean;
      try { exists = await this.pos365.purchaseOrderExists(code); }
      catch (error) {
        result.errors.push(`${candidate.receiptNo}: ${error instanceof Error ? error.message : "Không thể kiểm tra POS365."}`);
        continue;
      }
      result.checked += 1;
      if (exists) { result.stillInPos += 1; continue; }

      try {
        const canceled = await this.prisma.$transaction(async (tx) => {
          const current = await tx.inventoryReceipt.findUnique({ where: { id: candidate.id }, include: { items: true } });
          if (!current || current.status !== "COMPLETED" || current.pos365SyncCode !== code) return null;

          const issues: string[] = [];
          const affected = new Set<string>();
          for (const item of current.items) {
            const requested = Math.max(0, Number(item.quantity) || 0);
            if (!requested || !item.productId) {
              if (!item.productId && requested) issues.push(`${item.productSku}: không còn liên kết sản phẩm trong GEME`);
              continue;
            }
            if (item.variantId) {
              const variant = await tx.productPriceVariant.findUnique({ where: { id: item.variantId }, select: { id: true, productId: true, sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true, stock: true } });
              if (!variant) { issues.push(`${item.productSku}: không tìm thấy SKU biến thể để đối trừ`); continue; }
              const before = Number(variant.stock) || 0;
              const deducted = Math.min(before, requested);
              if (deducted < requested) issues.push(`${item.productSku}: cần trừ ${requested}, tồn GEME chỉ còn ${before}`);
              if (!deducted) continue;
              const after = before - deducted;
              await tx.productPriceVariant.update({ where: { id: variant.id }, data: { stock: after } });
              const siblings = await tx.productPriceVariant.findMany({ where: { productId: variant.productId }, select: { stock: true } });
              const productStock = siblings.reduce((sum, row) => sum + row.stock, 0);
              await tx.product.update({ where: { id: variant.productId }, data: { stock: productStock, soldOutAt: productStock > 0 ? null : new Date() } });
              await tx.inventoryMovement.create({ data: {
                productId: variant.productId, variantId: variant.id, productName: item.productName, productSku: item.productSku,
                variantLabel: variantDisplayLabel(variant), type: "OUT", quantity: deducted, stockBefore: before, stockAfter: after,
                reference: `POS365-${current.receiptNo}`, note: `Đối trừ phiếu ${current.receiptNo} đã bị xóa trên POS365.`,
              } });
              affected.add(variant.productId);
            } else {
              const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, sku: true, name: true, stock: true } });
              if (!product) { issues.push(`${item.productSku}: không tìm thấy sản phẩm để đối trừ`); continue; }
              const before = Number(product.stock) || 0;
              const deducted = Math.min(before, requested);
              if (deducted < requested) issues.push(`${item.productSku}: cần trừ ${requested}, tồn GEME chỉ còn ${before}`);
              if (!deducted) continue;
              const after = before - deducted;
              await tx.product.update({ where: { id: product.id }, data: { stock: after, soldOutAt: after > 0 ? null : new Date() } });
              await tx.inventoryMovement.create({ data: {
                productId: product.id, productName: item.productName, productSku: item.productSku, type: "OUT",
                quantity: deducted, stockBefore: before, stockAfter: after, reference: `POS365-${current.receiptNo}`,
                note: `Đối trừ phiếu ${current.receiptNo} đã bị xóa trên POS365.`,
              } });
              affected.add(product.id);
            }
          }

          await tx.inventoryReceipt.update({
            where: { id: current.id },
            data: {
              status: "CANCELLED",
              pos365SyncStatus: "DELETED",
              pos365SyncError: issues.length ? `Phiếu đã xóa trên POS365; cần kiểm tra đối trừ tồn: ${issues.join("; ")}`.slice(0, 2000) : null,
            },
          });
          await this.queueProductStockSync(tx, affected);
          return { receiptNo: current.receiptNo, productIds: [...affected] };
        }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
        if (canceled) {
          result.canceled.push(canceled.receiptNo);
          for (const id of canceled.productIds) changedProductIds.add(id);
        } else result.skipped += 1;
      } catch (error) {
        result.errors.push(`${candidate.receiptNo}: ${error instanceof Error ? error.message : "Không thể cập nhật phiếu trong GEME."}`);
      }
    }

    for (const id of changedProductIds) this.publishCatalogChange("product", "updated", id);
    return result;
  }

  async inventoryReceipt(id: string) {
    const receipt = await this.prisma.inventoryReceipt.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          include: { variant: { select: { sku: true, quality: true, shape: true, beadSize: true, carat: true, gemstoneQuality: true } } },
        },
      },
    });
    if (!receipt) throw new NotFoundException("Không tìm thấy phiếu nhập kho.");
    return receipt;
  }

  async inventoryIssues(query: Record<string, string> = {}) {
    const where: Input = {};
    if (query.from || query.to) {
      const issuedAt: Input = {};
      if (query.from) issuedAt.gte = parseDate(query.from);
      if (query.to) {
        const end = parseDate(query.to);
        end.setUTCHours(0, 0, 0, 0);
        end.setUTCDate(end.getUTCDate() + 1);
        issuedAt.lt = end;
      }
      where.issuedAt = issuedAt;
    }
    const reason = String(query.reason || "");
    if (["ORDER", "CUSTOMER", "TRANSFER", "OTHER"].includes(reason)) where.reason = reason;
    const term = String(query.search || "").trim();
    if (term) where.OR = [
      { issueNo: { contains: term, mode: "insensitive" } },
      { recipient: { contains: term, mode: "insensitive" } },
      { note: { contains: term, mode: "insensitive" } },
      { items: { some: { OR: [
        { productName: { contains: term, mode: "insensitive" } },
        { productSku: { contains: term, mode: "insensitive" } },
      ] } } },
    ];
    return this.prisma.inventoryIssue.findMany({
      where, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], take: 1000,
      include: { items: { orderBy: { createdAt: "asc" } } },
    });
  }

  async createInventoryIssue(input: Input) {
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) throw new BadRequestException("Phiếu xuất cần ít nhất một mặt hàng.");
    const items: Input[] = rawItems.map((item: Input) => {
      const productId = String(item.productId || "");
      const variantId = String(item.variantId || "") || null;
      const quantity = Number(item.quantity);
      if (!productId) throw new BadRequestException("Chọn sản phẩm cho mỗi dòng xuất.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng xuất phải là số nguyên từ 1 đến 100.000.");
      return { productId, variantId, quantity };
    });
    const uniqueLines = new Set(items.map((item) => `${item.productId}:${item.variantId || ""}`));
    if (uniqueLines.size !== items.length) throw new BadRequestException("Mỗi sản phẩm hoặc phiên bản chỉ được có một dòng trong phiếu.");
    const reason = String(input.reason || "").toUpperCase();
    if (!["ORDER", "CUSTOMER", "TRANSFER", "OTHER"].includes(reason)) throw new BadRequestException("Chọn lý do xuất kho hợp lệ.");
    const issuedAt = parseDate(input.issuedAt || input.date);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(totalQuantity)) throw new BadRequestException("Tổng số lượng trong phiếu vượt giới hạn.");
    const issueId = randomUUID();
    const dateKey = `${issuedAt.getUTCFullYear()}${String(issuedAt.getUTCMonth() + 1).padStart(2, "0")}${String(issuedAt.getUTCDate()).padStart(2, "0")}`;
    const issueNo = `PX${dateKey}-${issueId.slice(0, 6).toUpperCase()}`;
    const changedProductIds: string[] = [];
    try {
      const issue = await this.prisma.$transaction(async (tx) => {
        const prepared: Input[] = [];
        for (const item of items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
          });
          if (!product) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
          const variant = item.variantId ? product.variants.find((row) => row.id === item.variantId) : null;
          if (item.variantId && !variant) throw new BadRequestException("Phiên bản không thuộc sản phẩm đã chọn.");
          if (!variant && product.variants.length) throw new BadRequestException(`Chọn phiên bản cụ thể cho ${product.name} để trừ đúng số lượng tồn.`);
          const unitPrice = variantSellPrice(product, variant);
          const lineTotal = unitPrice * item.quantity;
          if (!Number.isSafeInteger(lineTotal) || lineTotal > 100000000000000) throw new BadRequestException("Giá trị dòng xuất vượt giới hạn.");
          const variantLabel = variantDisplayLabel(variant);
          const stoneName = product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null;
          prepared.push({ ...item, product, variant, unitPrice, lineTotal, variantLabel, stoneName });
        }
        const totalAmount = prepared.reduce((sum, item) => sum + item.lineTotal, 0);
        if (!Number.isSafeInteger(totalAmount) || totalAmount > 99999999999999) throw new BadRequestException("Tổng giá trị phiếu xuất vượt giới hạn.");
        const recipient = String(input.recipient || "").trim().slice(0, 180) || null;
        const warehouseName = String(input.warehouseName || "Kho chính").trim().slice(0, 120) || "Kho chính";
        const note = String(input.note || "").trim().slice(0, 4000) || null;
        await tx.inventoryIssue.create({ data: {
          id: issueId, issueNo, issuedAt, reason, recipient, warehouseName, status: "COMPLETED", note, totalQuantity, totalAmount,
        } });

        for (const item of prepared) {
          const product = item.product;
          let stockBefore: number;
          let stockAfter: number;
          if (item.variant) {
            stockBefore = item.variant.stock;
            if (stockBefore < item.quantity) throw new BadRequestException(`Số lượng xuất của ${product.name} vượt tồn phiên bản hiện tại.`);
            stockAfter = stockBefore - item.quantity;
            const updated = await tx.productPriceVariant.updateMany({ where: { id: item.variant.id, productId: product.id, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
            if (updated.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} vừa thay đổi. Tải lại và thử lại.`);
            const remaining = await tx.productPriceVariant.findMany({ where: { productId: product.id }, select: { stock: true } });
            const productStock = remaining.reduce((sum, row) => sum + row.stock, 0);
            await tx.product.update({ where: { id: product.id }, data: { stock: productStock, soldOutAt: productStock === 0 ? product.soldOutAt ?? new Date() : null } });
          } else {
            stockBefore = product.stock;
            if (stockBefore < item.quantity) throw new BadRequestException(`Số lượng xuất của ${product.name} vượt tồn kho hiện tại.`);
            stockAfter = stockBefore - item.quantity;
            const updated = await tx.product.updateMany({ where: { id: product.id, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, ...(stockAfter === 0 ? { soldOutAt: product.soldOutAt ?? new Date() } : {}) } });
            if (updated.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} vừa thay đổi. Tải lại và thử lại.`);
          }
          const productSku = item.variant?.sku || product.sku;
          await tx.inventoryIssueItem.create({ data: {
            issueId, productId: product.id, variantId: item.variant?.id || null,
            productName: product.name, productSku, variantLabel: item.variantLabel,
            categoryName: product.category?.name || null, stoneName: item.stoneName,
            kind: product.kind, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
          } });
          await tx.inventoryMovement.create({ data: {
            productId: product.id, variantId: item.variant?.id || null, productName: product.name,
            productSku: item.variant?.sku || product.sku, variantLabel: item.variantLabel, type: "OUT", quantity: item.quantity,
            stockBefore, stockAfter, reference: issueNo, note: [reason, recipient, note].filter(Boolean).join(" · ").slice(0, 2000) || null,
          } });
          changedProductIds.push(product.id);
        }
        await this.queueProductStockSync(tx, changedProductIds);
        return tx.inventoryIssue.findUniqueOrThrow({ where: { id: issueId }, include: { items: { orderBy: { createdAt: "asc" } } } });
      });
      for (const id of new Set(changedProductIds)) this.publishCatalogChange("product", "updated", id);
      return issue;
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException("Mã phiếu xuất vừa được tạo. Hãy tải lại rồi thử lại.");
      throw error;
    }
  }

  async resetInventory(input: Input) {
    if (String(input.confirmation || "").trim() !== "RESET") {
      throw new BadRequestException("Nhập RESET để xác nhận thao tác đưa tồn kho về 0.");
    }
    const scope = String(input.scope || "").toUpperCase();
    const requestedIds = [...new Set((Array.isArray(input.productIds) ? input.productIds : []).map((id: unknown) => String(id || "").trim()).filter(Boolean))];
    if (!["ALL", "SELECTED"].includes(scope)) throw new BadRequestException("Chọn phạm vi reset tồn kho hợp lệ.");
    if (scope === "SELECTED" && (!requestedIds.length || requestedIds.length > 1000)) {
      throw new BadRequestException("Chọn từ 1 đến 1.000 sản phẩm để reset.");
    }
    const reason = String(input.note || "").trim().slice(0, 1000);
    if (!reason) throw new BadRequestException("Nhập lý do reset kho để lưu vào phiếu và lịch sử.");

    const issuedAt = new Date();
    const dateKey = `${issuedAt.getUTCFullYear()}${String(issuedAt.getUTCMonth() + 1).padStart(2, "0")}${String(issuedAt.getUTCDate()).padStart(2, "0")}`;
    const issueId = randomUUID();
    const issueNo = `PX${dateKey}-${issueId.slice(0, 6).toUpperCase()}`;
    const note = `[RESET] Reset tồn kho: ${reason}`;
    const changedProductIds: string[] = [];

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: scope === "SELECTED" ? { id: { in: requestedIds } } : undefined,
          include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
          orderBy: [{ sku: "asc" }],
        });
        if (scope === "SELECTED" && products.length !== requestedIds.length) {
          throw new BadRequestException("Một hoặc nhiều sản phẩm đã bị xóa hoặc không còn tồn kho. Tải lại danh sách rồi thử lại.");
        }

        const rows: Input[] = [];
        for (const product of products) {
          if (product.variants.length) {
            for (const variant of product.variants) {
              if (variant.stock <= 0) continue;
              rows.push({
                product, variant, quantity: variant.stock, unitPrice: 0, lineTotal: 0,
                variantLabel: variantDisplayLabel(variant),
                stoneName: product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null,
              });
            }
          } else if (product.stock > 0) {
            rows.push({
              product, variant: null, quantity: product.stock, unitPrice: 0, lineTotal: 0,
              variantLabel: null,
              stoneName: product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null,
            });
          }
        }
        if (!rows.length) throw new BadRequestException("Không có sản phẩm hoặc biến thể nào còn tồn để reset.");

        const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
        if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 2_147_483_647) {
          throw new BadRequestException("Tổng số lượng reset vượt giới hạn của phiếu kho.");
        }
        const affectedProductCount = new Set(rows.map((row) => row.product.id)).size;
        if (input.expectedSkuCount !== undefined || input.expectedTotalQuantity !== undefined || input.expectedProductCount !== undefined) {
          if (Number(input.expectedSkuCount) !== rows.length || Number(input.expectedTotalQuantity) !== totalQuantity || Number(input.expectedProductCount) !== affectedProductCount) {
            throw new ConflictException("Tồn kho đã thay đổi sau khi xem trước. Hãy đóng hộp thoại, tải lại kho và xem trước lần nữa.");
          }
        }
        await tx.inventoryIssue.create({ data: {
          id: issueId, issueNo, issuedAt, reason: "OTHER", recipient: "Điều chỉnh tồn kho",
          warehouseName: "Kho chính", status: "COMPLETED", note, totalQuantity, totalAmount: 0,
        } });

        const touched = new Set<string>();
        for (const row of rows) {
          const product = row.product;
          const variant = row.variant;
          const stockBefore = row.quantity as number;
          if (variant) {
            const updated = await tx.productPriceVariant.updateMany({
              where: { id: variant.id, productId: product.id, stock: stockBefore }, data: { stock: 0 },
            });
            if (updated.count !== 1) throw new ConflictException(`Tồn kho ${variant.sku || product.sku} vừa thay đổi. Tải lại rồi thử lại.`);
          } else {
            const updated = await tx.product.updateMany({
              where: { id: product.id, stock: stockBefore }, data: { stock: 0, soldOutAt: product.soldOutAt ?? issuedAt },
            });
            if (updated.count !== 1) throw new ConflictException(`Tồn kho ${product.sku} vừa thay đổi. Tải lại rồi thử lại.`);
          }

          const productSku = variant?.sku || product.sku;
          await tx.inventoryIssueItem.create({ data: {
            issueId, productId: product.id, variantId: variant?.id || null,
            productName: product.name, productSku, variantLabel: row.variantLabel,
            categoryName: product.category?.name || null, stoneName: row.stoneName,
            kind: product.kind, quantity: stockBefore, unitPrice: 0, lineTotal: 0,
          } });
          await tx.inventoryMovement.create({ data: {
            productId: product.id, variantId: variant?.id || null, productName: product.name,
            productSku, variantLabel: row.variantLabel, type: "OUT", quantity: stockBefore,
            stockBefore, stockAfter: 0, reference: issueNo, note,
          } });
          touched.add(product.id);
          changedProductIds.push(product.id);
        }

        // Keep the parent stock total equal to the sum of its variants, including
        // legacy rows where the cached parent quantity had drifted from the variants.
        for (const productId of touched) {
          const product = products.find((entry) => entry.id === productId)!;
          if (product.variants.length) {
            await tx.product.update({ where: { id: productId }, data: { stock: 0, soldOutAt: product.soldOutAt ?? issuedAt } });
          }
        }
        await this.queueProductStockSync(tx, touched);
        const issue = await tx.inventoryIssue.findUniqueOrThrow({ where: { id: issueId }, include: { items: { orderBy: { createdAt: "asc" } } } });
        return { issue, skuCount: rows.length, productCount: affectedProductCount, totalQuantity };
      }, { isolationLevel: "Serializable" });

      for (const id of new Set(changedProductIds)) this.publishCatalogChange("product", "updated", id);
      return { ...result.issue, resetSummary: { scope, productCount: result.productCount, skuCount: result.skuCount, totalQuantity: result.totalQuantity } };
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException("Mã phiếu reset vừa được tạo. Tải lại rồi thử lại.");
      throw error;
    }
  }

  async inventoryResetPreview(input: Input) {
    const scope = String(input.scope || "").toUpperCase();
    const productIds = [...new Set((Array.isArray(input.productIds) ? input.productIds : []).map((id: unknown) => String(id || "").trim()).filter(Boolean))];
    if (!["ALL", "SELECTED"].includes(scope)) throw new BadRequestException("Chọn phạm vi reset tồn kho hợp lệ.");
    if (scope === "SELECTED" && (!productIds.length || productIds.length > 1000)) {
      throw new BadRequestException("Chọn từ 1 đến 1.000 sản phẩm để xem trước.");
    }
    const products = await this.prisma.product.findMany({
      where: scope === "SELECTED" ? { id: { in: productIds } } : undefined,
      select: { id: true, stock: true, variants: { select: { stock: true } } },
    });
    if (scope === "SELECTED" && products.length !== productIds.length) {
      throw new BadRequestException("Một hoặc nhiều sản phẩm không còn tồn tại. Tải lại danh sách rồi thử lại.");
    }
    let skuCount = 0;
    let totalQuantity = 0;
    let affectedProductCount = 0;
    for (const product of products) {
      const quantities = product.variants.length ? product.variants.map((variant) => variant.stock) : [product.stock];
      const positive = quantities.filter((quantity) => quantity > 0);
      if (positive.length) affectedProductCount += 1;
      skuCount += positive.length;
      totalQuantity += positive.reduce((sum, quantity) => sum + quantity, 0);
    }
    return { scope, selectedProductCount: products.length, affectedProductCount, skuCount, totalQuantity };
  }

  private async skuPrefixFor(client: any, categoryId: string, materialOptionId?: string) {
    const category = await client.category.findUnique({ where: { id: categoryId }, select: { status: true, kind: true, usage: true, level: true } });
    const isGemstoneType = category?.kind === "GEMSTONE" && category.usage === "GEMSTONE_TYPE" && category.level === 2;
    if (!category || category.status !== "ACTIVE" || !(category.usage === "PRODUCT_CATEGORY" && category.level >= 2 || isGemstoneType)) {
      throw new BadRequestException("Chỉ tạo quy tắc cho danh mục sản phẩm đang hoạt động đã được tạo.");
    }
    const setting = await client.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
    const rules = Array.isArray(setting?.value) ? setting.value as Input[] : [];
    const rule = rules.find((candidate) => candidate.categoryId === categoryId);
    if (!rule) throw new BadRequestException("Danh mục này chưa có quy tắc mã hàng. Hãy tạo quy tắc trước khi nhập sản phẩm mới.");
    if (isGemstoneType && materialOptionId) throw new BadRequestException("SKU đá quý được tạo theo loại đá; không gắn tiền tố chất liệu.");
    if (materialOptionId) await this.assertCategoryAllowsMaterial(client, categoryId, materialOptionId);
    if (!materialOptionId) return this.cleanSkuPrefix(rule.prefix);
    const stoneRule = Array.isArray(rule.materialPrefixes) ? rule.materialPrefixes.find((entry: Input) => entry.materialOptionId === materialOptionId) : undefined;
    if (rule.skuFormat === "BANGLE_SHAPE_QUALITY_SIZE" && !stoneRule) {
      throw new BadRequestException("Loại đá này chưa có mã trong quy tắc SKU Vòng Kiềng. Hãy bổ sung mã đá trước khi nhập kho.");
    }
    // Stone prefixes are optional. Newly created stones can use the category prefix;
    // the sequence allocator still guarantees a unique SKU across the category.
    if (!stoneRule) return this.cleanSkuPrefix(rule.prefix);
    return `${this.cleanSkuPrefix(rule.prefix)}${this.cleanSkuPrefix(stoneRule.prefix)}`;
  }

  private productSkuForSequence(prefix: string, rawSequence: unknown, allowLegacyAlphaSuffix = false) {
    const sequence = String(rawSequence ?? "").trim();
    const validSequence = allowLegacyAlphaSuffix ? /^\d+[A-Za-z]{1,4}$/.test(sequence) : /^\d+$/.test(sequence);
    if (!validSequence) throw new BadRequestException(allowLegacyAlphaSuffix
      ? "Mã SKU cũ cần có phần số và hậu tố chữ hợp lệ."
      : "Nhập số thứ tự SKU bằng chữ số nguyên dương.");
    const numericSequence = BigInt(sequence.match(/^\d+/)?.[0] || "0");
    if (numericSequence <= 0n) throw new BadRequestException("Số thứ tự SKU phải là số nguyên dương lớn hơn 0.");
    if (prefix.length + sequence.length > 64) throw new BadRequestException("Số thứ tự quá dài so với giới hạn mã SKU.");
    return `${prefix}${sequence}`;
  }

  private productSkuForLegacy(prefix: string, rawSku: unknown) {
    const sku = String(rawSku ?? "").trim();
    if (!sku || sku.length > 64 || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(sku)
      || sku.length <= prefix.length || !sku.toLocaleUpperCase("en").startsWith(prefix.toLocaleUpperCase("en"))) {
      throw new BadRequestException("SKU cũ chỉ được có chữ, số, dấu gạch nối giữa các cụm và phải bắt đầu bằng tiền tố danh mục, loại đá hiện tại.");
    }
    return sku;
  }

  async nextInventorySku(categoryId: string, materialOptionId?: string, sequence?: string, bangle: { bangleShape?: string; bangleQuality?: string; bangleSizeMm?: string } = {}) {
    if (!categoryId) throw new BadRequestException("Chọn danh mục để tạo mã hàng.");
    const prefix = await this.skuPrefixFor(this.prisma, categoryId, materialOptionId);
    const setting = await this.prisma.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
    const rules = Array.isArray(setting?.value) ? setting.value as Input[] : [];
    const rule = rules.find((candidate) => candidate.categoryId === categoryId);
    const isBangleFormat = rule?.skuFormat === "BANGLE_SHAPE_QUALITY_SIZE";
    if (isBangleFormat) {
      const [product, variant] = await Promise.all([
        this.prisma.product.findUnique({ where: { sku: prefix }, select: { id: true, name: true, stock: true, variants: { select: { id: true, stock: true } } } }),
        this.prisma.productPriceVariant.findUnique({ where: { sku: prefix }, select: { id: true, product: { select: { sku: true, name: true } } } }),
      ]);
      return {
        prefix, sku: prefix, format: "BANGLE_SHAPE_QUALITY_SIZE",
        existingProduct: product ? { id: product.id, name: product.name, stock: product.variants.length ? product.variants.reduce((sum, row) => sum + row.stock, 0) : product.stock, variantCount: product.variants.length } : null,
        existingVariant: variant ? { productSku: variant.product.sku, productName: variant.product.name } : null,
      };
    }
    if (!isBangleFormat && (sequence === undefined || sequence === "")) {
      const [product, variant] = await Promise.all([
        this.prisma.product.findUnique({ where: { sku: prefix }, select: { id: true, name: true, stock: true, variants: { select: { id: true, stock: true } } } }),
        this.prisma.productPriceVariant.findUnique({ where: { sku: prefix }, select: { id: true, product: { select: { sku: true, name: true } } } }),
      ]);
      return {
        prefix,
        sku: prefix,
        format: "SEQUENTIAL",
        existingProduct: product ? { id: product.id, name: product.name, stock: product.variants.length ? product.variants.reduce((sum, row) => sum + row.stock, 0) : product.stock, variantCount: product.variants.length } : null,
        existingVariant: variant ? { productSku: variant.product.sku, productName: variant.product.name } : null,
      };
    }
    const sku = this.productSkuForSequence(prefix, sequence);
    const [product, variant] = await Promise.all([
      this.prisma.product.findUnique({ where: { sku }, select: { id: true, name: true, stock: true, variants: { select: { id: true, stock: true } } } }),
      this.prisma.productPriceVariant.findUnique({ where: { sku }, select: { id: true, productId: true, product: { select: { sku: true, name: true } } } }),
    ]);
    return {
      prefix,
      sku,
      format: isBangleFormat ? "BANGLE_SHAPE_QUALITY_SIZE" : "SEQUENTIAL",
      existingProduct: product ? { id: product.id, name: product.name, stock: product.variants.length ? product.variants.reduce((sum, row) => sum + row.stock, 0) : product.stock, variantCount: product.variants.length } : null,
      existingVariant: variant ? { id: variant.id, productId: variant.productId, productSku: variant.product.sku, productName: variant.product.name } : null,
    };
  }

  async createInventoryReceipt(input: Input) {
    const syncPos365 = this.pos365.isSyncEnabled();
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) throw new BadRequestException("Phiếu nhập cần ít nhất một mặt hàng.");
    const items: Input[] = rawItems.map((item: Input) => {
      if (!item.productId && !item.newProduct) throw new BadRequestException("Mỗi dòng nhập cần chọn sản phẩm hoặc tạo mã hàng mới.");
      const variantDrafts = Array.isArray(item.newProduct?.variants) ? item.newProduct.variants as Input[] : [];
      if (variantDrafts.length) {
        if (variantDrafts.length > 100) throw new BadRequestException("Mỗi mặt hàng được nhập tối đa 100 biến thể cùng lúc.");
        const seen = new Set<string>();
        const seenSkus = new Set<string>();
          const variants = variantDrafts.map((variant) => {
          const quality = String(variant.quality || "").trim().slice(0, 40);
          const shape = String(variant.shape || "").trim().toLocaleUpperCase("en");
          const beadSize = String(variant.beadSize || "").trim().slice(0, 24);
          const caratValue = variant.carat == null || String(variant.carat).trim() === "" ? null : Number(variant.carat);
          const carat = caratValue == null ? "" : String(caratValue);
          const gemstoneQuality = String(variant.gemstoneQuality || "").trim().slice(0, 40);
            const sku = String(variant.sku || "").trim();
          const quantity = Number(variant.quantity);
          const unitCost = Number(variant.unitCost);
            if (!quality) throw new BadRequestException("Mỗi biến thể cần có chất lượng hoặc phân loại.");
            if (!sku || sku.length > 64 || !/^[A-Za-z0-9]+$/.test(sku)) throw new BadRequestException("Mỗi biến thể cần có SKU con chỉ gồm chữ và số.");
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng mỗi biến thể phải từ 1 đến 100.000.");
          if (!Number.isInteger(unitCost) || unitCost < 0 || unitCost > 1000000000000) throw new BadRequestException("Đơn giá nhập của biến thể phải là số nguyên không âm hợp lệ.");
          if (caratValue != null && (!Number.isFinite(caratValue) || caratValue <= 0 || caratValue > 1000 || Math.round(caratValue * 1000) !== caratValue * 1000)) throw new BadRequestException("Carat phải lớn hơn 0, tối đa 3 chữ số thập phân.");
          const optionKey = variantOptionKey(shape, quality, beadSize, carat, gemstoneQuality);
          if (seen.has(optionKey)) throw new BadRequestException("Không thể nhập trùng một tổ hợp biến thể.");
          if (seenSkus.has(sku.toLocaleUpperCase("en"))) throw new BadRequestException("Không thể nhập trùng một SKU con trong cùng mặt hàng.");
          seen.add(optionKey);
          seenSkus.add(sku.toLocaleUpperCase("en"));
          return { quality, shape: shape || null, beadSize: beadSize || null, carat: carat || null, gemstoneQuality: gemstoneQuality || null, cutCategoryId: String(variant.cutCategoryId || "") || null, sku, quantity, unitCost, optionKey };
        });
        const quantity = variants.reduce((sum, variant) => sum + variant.quantity, 0);
        const lineTotal = variants.reduce((sum, variant) => sum + variant.quantity * variant.unitCost, 0);
        if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(lineTotal)) throw new BadRequestException("Tổng số lượng hoặc tiền hàng vượt giới hạn.");
        return { ...item, quantity, unitCost: 0, lineTotal, newProduct: { ...item.newProduct, variants } };
      }
      const quantity = Number(item.quantity);
      const allowUnknownCost = item.newProduct?.standalonePremiumGemstone === true && item.newProduct?.isPremiumGemstone === true;
      const rawUnitCost = item.unitCost == null || String(item.unitCost).trim() === "" ? null : Number(item.unitCost);
      const unitCost = rawUnitCost;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng mỗi mặt hàng phải từ 1 đến 100.000.");
      if ((unitCost === null && !allowUnknownCost) || (unitCost !== null && (!Number.isSafeInteger(unitCost) || unitCost < 0 || unitCost > 1000000000000))) throw new BadRequestException("Đơn giá nhập phải là số nguyên không âm hợp lệ; chỉ mặt đá cao cấp được để trống khi chưa có dữ liệu.");
      return { ...item, quantity, unitCost, lineTotal: unitCost === null ? null : quantity * unitCost };
    });
    const receivedAt = parseDate(input.receivedAt || input.date);
    const totalQuantity = items.reduce((sum: number, item: Input) => sum + item.quantity, 0);
    const subtotalAmount = items.reduce((sum: number, item: Input) => sum + (item.lineTotal ?? 0), 0);
    const discountPercent = Number(input.discountPercent ?? 0);
    const vatPercent = Number(input.vatPercent ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || Math.round(discountPercent * 100) !== discountPercent * 100) throw new BadRequestException("Chiết khấu phải từ 0% đến 100%, tối đa 2 chữ số thập phân.");
    if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100 || Math.round(vatPercent * 100) !== vatPercent * 100) throw new BadRequestException("VAT phải từ 0% đến 100%, tối đa 2 chữ số thập phân.");
    const discountAmount = Math.round(subtotalAmount * discountPercent / 100);
    const vatAmount = Math.round((subtotalAmount - discountAmount) * vatPercent / 100);
    const totalAmount = subtotalAmount - discountAmount + vatAmount;
    if (![subtotalAmount, discountAmount, vatAmount, totalAmount].every(Number.isSafeInteger)) throw new BadRequestException("Tổng tiền phiếu nhập vượt giới hạn.");
    const documents = (Array.isArray(input.documentUrls) ? input.documentUrls : []).map((url: unknown) => String(url)).filter((url: string) => /^\/(media|assets)\//.test(url)).slice(0, 10);
    const fingerprintItems = items.map((item: Input) => {
      const newProduct = item.newProduct as Input | undefined;
      const variants = Array.isArray(newProduct?.variants) ? (newProduct.variants as Input[]).map((variant) => ({
        sku: String(variant.sku || "").trim().toLocaleUpperCase("en"),
        quality: String(variant.quality || "").trim().toLocaleUpperCase("en"),
        shape: String(variant.shape || "").trim().toLocaleUpperCase("en"),
        beadSize: String(variant.beadSize || "").trim().toLocaleUpperCase("en"),
        carat: variant.carat == null ? null : Number(variant.carat),
        gemstoneQuality: String(variant.gemstoneQuality || "").trim().toLocaleUpperCase("en"),
        cutCategoryId: String(variant.cutCategoryId || ""),
        quantity: Number(variant.quantity),
        unitCost: Number(variant.unitCost),
      })).sort((left, right) => left.sku.localeCompare(right.sku)) : [];
      return {
        productId: item.productId ? String(item.productId) : null,
        variantId: item.variantId ? String(item.variantId) : null,
        quantity: Number(item.quantity),
        unitCost: item.unitCost == null ? null : Number(item.unitCost),
        newProduct: newProduct ? {
          name: String(newProduct.name || "").trim().toLocaleLowerCase("vi"),
          kind: String(newProduct.kind || "").trim().toLocaleUpperCase("en"),
          categoryId: String(newProduct.categoryId || ""),
          gemstoneTypeId: String(newProduct.gemstoneTypeId || ""),
          materialOptionId: String(newProduct.materialOptionId || ""),
          sku: String(newProduct.sku || "").trim().toLocaleUpperCase("en"),
          legacySku: String(newProduct.legacySku || "").trim().toLocaleUpperCase("en"),
          standalonePremiumGemstone: newProduct.standalonePremiumGemstone === true,
          isPremiumGemstone: newProduct.isPremiumGemstone === true,
          lengthCm: newProduct.lengthCm == null || String(newProduct.lengthCm).trim() === "" ? null : Number(newProduct.lengthCm),
          widthCm: newProduct.widthCm == null || String(newProduct.widthCm).trim() === "" ? null : Number(newProduct.widthCm),
          price: newProduct.price == null ? null : Number(newProduct.price),
          variants,
        } : null,
      };
    }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      receivedAt: receivedAt.toISOString(),
      supplierName: String(input.supplierName || "").trim().toLocaleLowerCase("vi"),
      warehouseName: String(input.warehouseName || "Kho chính").trim().toLocaleLowerCase("vi"),
      discountPercent,
      vatPercent,
      items: fingerprintItems,
    })).digest("hex");
    const changedProductIds: string[] = [];
    try {
      const receipt = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-receipt:${requestFingerprint}`}))`;
        const duplicate = await tx.inventoryReceipt.findFirst({
          where: { requestFingerprint, createdAt: { gte: new Date(Date.now() - inventoryReceiptDuplicateWindowMs) } },
          orderBy: { createdAt: "desc" },
          select: { receiptNo: true },
        });
        if (duplicate) throw new ConflictException(`Phiếu có nội dung nhập trùng với ${duplicate.receiptNo} vừa tạo trong 5 phút qua. GEME đã chặn để tránh cộng tồn kho hai lần.`);
        const receiptNo = await this.nextReceiptNumber(tx, receivedAt);
        const savedReceipt = await tx.inventoryReceipt.create({ data: {
          receiptNo, receivedAt, supplierName: String(input.supplierName || "").trim().slice(0, 180) || null,
          receiver: String(input.receiver || "").trim().slice(0, 120) || null,
          warehouseName: String(input.warehouseName || "Kho chính").trim().slice(0, 120),
          paymentMethod: String(input.paymentMethod || "").trim().slice(0, 40) || null,
          status: "COMPLETED", requestFingerprint, note: String(input.note || "").trim() || null,
          pos365SyncStatus: syncPos365 ? "PENDING" : null,
          pos365SyncNextAttemptAt: syncPos365 ? new Date() : null,
          additionalNote: String(input.additionalNote || "").trim() || null,
          documentUrls: documents, totalQuantity, subtotalAmount, discountPercent, discountAmount, vatPercent, vatAmount, totalAmount,
        } });

        for (const item of items) {
          let product: any;
          const newProductVariantDrafts = Array.isArray(item.newProduct?.variants) ? item.newProduct.variants as Input[] : [];
          if (item.newProduct) {
            const newProduct = item.newProduct as Input;
            const categoryId = String(newProduct.categoryId || "");
            const name = String(newProduct.name || "").trim();
            const category = await tx.category.findUnique({ where: { id: categoryId } });
            const gemstonePricingMode = category?.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(category.pricingMode) ? category.pricingMode : "GEMSTONE_SIZE";
            const isGemstoneTypeCategory = category?.kind === "GEMSTONE" && category.level === 2;
            const standalonePremiumGemstone = newProduct.standalonePremiumGemstone === true;
            if (!category || category.status !== "ACTIVE" || !(category.usage === "PRODUCT_CATEGORY" && category.level >= 2 || isGemstoneTypeCategory)) throw new BadRequestException("Chọn danh mục sản phẩm hoặc loại đá cấp 2 đang hoạt động.");
            const gemstoneTypeId = String(newProduct.gemstoneTypeId || "") || null;
            const materialOptionId = String(newProduct.materialOptionId || "") || null;
            let materialName = "";
            let gemstoneTypeName = "";
            if (category.kind === "GEMSTONE") {
              const gemstoneType = gemstoneTypeId ? await tx.category.findUnique({ where: { id: gemstoneTypeId } }) : null;
              if (!gemstoneType || gemstoneType.kind !== "GEMSTONE" || gemstoneType.level !== 2 || !["GEMSTONE_TYPE", "PRODUCT_CATEGORY"].includes(gemstoneType.usage) || category.id !== gemstoneType.id || category.level !== 2) {
                throw new BadRequestException("Đá quý cần chọn danh mục loại đá cấp 2.");
              }
              if (materialOptionId) throw new BadRequestException("Đá quý dùng danh mục loại đá, không dùng chất liệu dạng MaterialOption.");
              gemstoneTypeName = gemstoneType.name;
              if (!newProductVariantDrafts.length && !standalonePremiumGemstone) throw new BadRequestException("Đá quý cần ít nhất một biến thể theo dạng cắt và size.");
            } else if (gemstoneTypeId) {
              throw new BadRequestException("Chỉ sản phẩm đá quý mới được gắn loại đá cấp 2.");
            }
            if (standalonePremiumGemstone && (category.kind !== "GEMSTONE" || newProduct.isPremiumGemstone !== true || newProduct.allowLegacySku !== true || newProductVariantDrafts.length || !String(newProduct.legacySku || "").trim())) {
              throw new BadRequestException("Mặt đá cao cấp dạng SKU độc lập cần có hồ sơ đá quý, SKU cũ hợp lệ và không tạo biến thể carat giả.");
            }
            if (materialOptionId) {
              const material = await tx.materialOption.findUnique({ where: { id: materialOptionId } });
              const expectedScope = category.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
              if (!material || !material.active || material.kind !== "STONE" || material.scope !== expectedScope) throw new BadRequestException("Loại đá không thuộc đúng nhóm sản phẩm.");
              materialName = material.name;
            }
            const productName = name || (category.kind === "GEMSTONE" ? gemstoneTypeName : [category.name, materialName].filter(Boolean).join(" ")).slice(0, 180) || `Mặt hàng ${String(newProduct.sku || "").trim()}`;
            const prefix = await this.skuPrefixFor(tx, category.id, materialOptionId || undefined);
            const skuSetting = await tx.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
            const skuRules = Array.isArray(skuSetting?.value) ? skuSetting.value as Input[] : [];
            const skuRule = skuRules.find((candidate) => candidate.categoryId === category.id);
            const rawProfilePrice = newProduct.price === undefined || newProduct.price === null || String(newProduct.price).trim() === "" ? null : Number(newProduct.price);
            if (rawProfilePrice !== null && (!Number.isSafeInteger(rawProfilePrice) || rawProfilePrice < 0 || rawProfilePrice > 1000000000000)) {
              throw new BadRequestException("Giá bán trong hồ sơ sản phẩm phải là số nguyên không âm hợp lệ.");
            }
            const profilePrice = rawProfilePrice && rawProfilePrice > 0 ? rawProfilePrice : null;
            const profilePriceSync = profilePrice !== null ? {
              pos365PriceSyncStatus: syncPos365 ? "PENDING" : "DISABLED",
              pos365PriceSyncAttempts: 0,
              pos365PriceSyncLastAttemptAt: null,
              pos365PriceSyncNextAttemptAt: syncPos365 ? new Date() : null,
              pos365PriceSyncedAt: null,
              pos365PriceSyncError: null,
            } : {};
            // Gemstone products use a sequenced parent SKU; variants append their cut + size tokens.
            const bangleFormat = skuRule?.skuFormat === "BANGLE_SHAPE_QUALITY_SIZE";
            const sku = newProduct.allowLegacySku === true
              ? this.productSkuForLegacy(prefix, newProduct.legacySku)
              : bangleFormat
                ? prefix
              : category.kind === "GEMSTONE" || !newProductVariantDrafts.length
                ? this.productSkuForSequence(prefix, newProduct.skuSequence, newProduct.allowLegacyAlphaSuffix === true)
                : prefix;
            if (newProduct.sku && String(newProduct.sku) !== sku) throw new ConflictException("Quy tắc mã hàng vừa thay đổi. Hãy kiểm tra lại mã xem trước rồi thêm sản phẩm.");
            const [existingProduct, existingVariant] = await Promise.all([
              tx.product.findUnique({ where: { sku }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } }),
              tx.productPriceVariant.findUnique({ where: { sku }, select: { id: true, product: { select: { sku: true, name: true } } } }),
            ]);
            if (standalonePremiumGemstone && existingProduct) {
              throw new ConflictException(`SKU ${sku} đã có hồ sơ sản phẩm; không cộng tồn lần nữa từ lô Emerald này.`);
            }
            const productDimension = (value: unknown, label: string) => {
              if (value == null || String(value).trim() === "") return null;
              const parsed = Number(value);
              const scaled = parsed * 100;
              if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999.99 || Math.abs(Math.round(scaled) - scaled) > 1e-8) {
                throw new BadRequestException(`${label} phải là số cm không âm, tối đa 2 chữ số thập phân.`);
              }
              return Math.round(scaled) / 100;
            };
            const lengthCm = standalonePremiumGemstone ? productDimension(newProduct.lengthCm, "Chiều dài") : null;
            const widthCm = standalonePremiumGemstone ? productDimension(newProduct.widthCm, "Chiều rộng") : null;
            const createVariantForProduct = async (variant: Input, index: number, productId?: string) => {
              const variantSku = String(variant.sku || "").trim();
              if (!variantSku.startsWith(sku) || variantSku.length <= sku.length || variantSku.length > 64 || !/^[A-Za-z0-9]+$/.test(variantSku)) {
                throw new BadRequestException(`SKU con phải bắt đầu bằng SKU mẹ ${sku} và có thêm mã phân biệt chữ/số.`);
              }
              if (category.kind === "GEMSTONE") {
                const cutCategoryId = String(variant.cutCategoryId || "");
                const cut = cutCategoryId ? await tx.category.findUnique({ where: { id: cutCategoryId }, select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true } }) : null;
                const beadSize = String(variant.beadSize || "").trim();
                const carat = String(variant.carat || "").trim();
                const gemstoneQuality = String(variant.gemstoneQuality || "").trim();
                const cutToken = cut ? gemstoneCutSkuToken(cut.name) : "";
                const expectedVariantSku = `${sku}${gemstoneSkuSuffix(cut?.name || "", gemstonePricingMode, beadSize, carat, gemstoneQuality)}`;
                const hasValidCarat = Number.isFinite(Number(carat)) && Number(carat) > 0 && Number(carat) <= 1000 && Math.round(Number(carat) * 1000) === Number(carat) * 1000;
                if (!cut || cut.status !== "ACTIVE" || cut.kind !== "GEMSTONE" || cut.usage !== "PRODUCT_CATEGORY" || cut.level !== 3 || cut.parentId !== gemstoneTypeId || String(variant.quality || "").trim() !== cut.name || !cutToken
                  || (gemstonePricingMode === "GEMSTONE_SIZE" && !beadSize)
                  || (isCaratPricing(gemstonePricingMode) && !hasValidCarat)
                  || (gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY" && !gemstoneQuality)
                  || variantSku.toLocaleUpperCase("en") !== expectedVariantSku.toLocaleUpperCase("en")) {
                  throw new BadRequestException("Biến thể đá quý cần có dạng cắt và đúng size hoặc carat/chất lượng theo cách định giá của danh mục.");
                }
              }
              if (bangleFormat) {
                if (category.slug !== "vong-kieng" || !variant.shape || bangleVariantSku(sku, variant.shape, variant.quality, variant.beadSize).toLocaleUpperCase("en") !== variantSku.toLocaleUpperCase("en")) {
                  throw new BadRequestException("SKU kiềng phải khớp mã mẹ, dáng, chất lượng và size đã chọn.");
                }
              } else if (variant.shape) {
                throw new BadRequestException("Chỉ danh mục Vòng Kiềng mới được có biến thể dáng.");
              }
              const [productCollision, variantCollision] = await Promise.all([
                tx.product.findUnique({ where: { sku: variantSku }, select: { id: true } }),
                tx.productPriceVariant.findUnique({ where: { sku: variantSku }, select: { id: true } }),
              ]);
              if (productCollision || variantCollision) throw new ConflictException(`SKU biến thể ${variantSku} đã tồn tại. Hãy đổi mã SKU con.`);
              const sharedPriceDimensions = gemstonePricingMode === "GEMSTONE_SIZE"
                ? { beadSize: String(variant.beadSize || "") }
                : gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY"
                  ? { gemstoneQuality: String(variant.gemstoneQuality || "") }
                  : {};
              const sharedPrice = category.kind === "GEMSTONE" && productId
                ? await tx.productPriceVariant.findFirst({ where: { productId, ...sharedPriceDimensions, price: { gt: 0 } }, orderBy: { sortOrder: "asc" }, select: { price: true, originalPrice: true } })
                : null;
              const data = {
                optionKey: variant.optionKey,
                quality: variant.quality,
                shape: variant.shape || null,
                beadSize: variant.beadSize,
                carat: variant.carat,
                gemstoneQuality: variant.gemstoneQuality,
                sku: variantSku,
                price: sharedPrice?.price ?? 0,
                originalPrice: sharedPrice?.originalPrice ?? null,
                stock: 0,
                sortOrder: index,
              };
              return productId
                ? tx.productPriceVariant.create({ data: { ...data, productId } })
                : data;
            };
            if (newProductVariantDrafts.length) {
              if (existingVariant) throw new ConflictException(`Mã mẹ ${sku} đang được dùng làm SKU con của một sản phẩm khác.`);
              if (existingProduct) {
                const legacyGemstoneCategory = category.kind === "GEMSTONE" && existingProduct.gemstoneTypeId === gemstoneTypeId;
                if ((existingProduct.categoryId !== category.id && !legacyGemstoneCategory) || existingProduct.gemstoneTypeId !== gemstoneTypeId || existingProduct.materialOptionId !== materialOptionId) {
                  throw new ConflictException(`Mã mẹ ${sku} đã tồn tại ở danh mục hoặc loại đá khác. Hãy kiểm tra quy tắc mã hàng.`);
                }
                if (legacyGemstoneCategory && existingProduct.categoryId !== category.id) await tx.product.update({ where: { id: existingProduct.id }, data: { categoryId: category.id } });
                if (!existingProduct.variants.length) {
                  throw new ConflictException(`Mã ${sku} đã được dùng cho mặt hàng một SKU; không thể nhập chồng thành nhóm biến thể.`);
                }
                const existingByOption = new Map(existingProduct.variants.map((variant: Input) => [variant.optionKey, variant]));
                const existingBySku = new Map(existingProduct.variants.filter((variant: Input) => variant.sku).map((variant: Input) => [String(variant.sku).toLocaleUpperCase("en"), variant]));
                for (const [index, draft] of newProductVariantDrafts.entries()) {
                  const variantSku = String(draft.sku || "").trim();
                  if (!variantSku.startsWith(sku) || variantSku.length <= sku.length || variantSku.length > 64 || !/^[A-Za-z0-9]+$/.test(variantSku)) {
                    throw new BadRequestException(`SKU con phải bắt đầu bằng SKU mẹ ${sku} và có thêm mã phân biệt chữ/số.`);
                  }
                  if (category.kind === "GEMSTONE") {
                    const cutCategoryId = String(draft.cutCategoryId || "");
                    const cut = cutCategoryId ? await tx.category.findUnique({ where: { id: cutCategoryId }, select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true } }) : null;
                    const beadSize = String(draft.beadSize || "").trim();
                    const carat = String(draft.carat || "").trim();
                    const gemstoneQuality = String(draft.gemstoneQuality || "").trim();
                    const cutToken = cut ? gemstoneCutSkuToken(cut.name) : "";
                    const expectedVariantSku = `${sku}${gemstoneSkuSuffix(cut?.name || "", gemstonePricingMode, beadSize, carat, gemstoneQuality)}`;
                    const hasValidCarat = Number.isFinite(Number(carat)) && Number(carat) > 0 && Number(carat) <= 1000 && Math.round(Number(carat) * 1000) === Number(carat) * 1000;
                    if (!cut || cut.status !== "ACTIVE" || cut.kind !== "GEMSTONE" || cut.usage !== "PRODUCT_CATEGORY" || cut.level !== 3 || cut.parentId !== gemstoneTypeId || String(draft.quality || "").trim() !== cut.name || !cutToken
                      || (gemstonePricingMode === "GEMSTONE_SIZE" && !beadSize)
                      || (isCaratPricing(gemstonePricingMode) && !hasValidCarat)
                      || (gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY" && !gemstoneQuality)
                      || variantSku.toLocaleUpperCase("en") !== expectedVariantSku.toLocaleUpperCase("en")) {
                      throw new BadRequestException("Biến thể đá quý cần có dạng cắt và đúng size hoặc carat/chất lượng theo cách định giá của danh mục.");
                    }
                  }
                  const sameOption = existingByOption.get(draft.optionKey) as Input | undefined;
                  const sameSku = existingBySku.get(variantSku.toLocaleUpperCase("en")) as Input | undefined;
                  if (sameSku && !sameOption) {
                    throw new ConflictException(`SKU ${variantSku} đã được gán cho biến thể ${bangleShapeLabel(sameSku.shape)} ${sameSku.quality}${sameSku.beadSize ? ` · ${sameSku.beadSize}` : ""}; không thể dùng lại cho lựa chọn khác.`);
                  }
                  if (sameSku && sameOption && sameSku.id !== sameOption.id) {
                    throw new ConflictException(`SKU ${variantSku} và phân loại đã nhập đang trỏ tới hai biến thể khác nhau.`);
                  }
                  if (sameOption) {
                    if (sameOption.sku && String(sameOption.sku).toLocaleUpperCase("en") !== variantSku.toLocaleUpperCase("en")) {
                      if (category.kind !== "GEMSTONE") throw new ConflictException(`Biến thể ${draft.quality}${draft.beadSize ? ` · ${draft.beadSize}` : ""} đã có SKU ${sameOption.sku}. Hãy dùng lại SKU đó để cộng tồn.`);
                    }
                    if (!sameOption.sku) {
                      const [productCollision, variantCollision] = await Promise.all([
                        tx.product.findUnique({ where: { sku: variantSku }, select: { id: true } }),
                        tx.productPriceVariant.findUnique({ where: { sku: variantSku }, select: { id: true } }),
                      ]);
                      if (productCollision || (variantCollision && variantCollision.id !== sameOption.id)) throw new ConflictException(`SKU biến thể ${variantSku} đã tồn tại. Hãy đổi mã SKU con.`);
                      await tx.productPriceVariant.update({ where: { id: sameOption.id }, data: { sku: variantSku } });
                    }
                    draft.variantId = sameOption.id;
                    continue;
                  }
                  if (sameSku) {
                    draft.variantId = sameSku.id;
                    continue;
                  }
                  const added = await createVariantForProduct(draft, existingProduct.variants.length + index, existingProduct.id);
                  existingByOption.set(draft.optionKey, added);
                  existingBySku.set(variantSku.toLocaleUpperCase("en"), added);
                }
                product = await tx.product.findUniqueOrThrow({ where: { id: existingProduct.id }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
              } else {
                if (existingVariant) throw new ConflictException(`Mã mẹ ${sku} đã tồn tại. Hãy kiểm tra tiền tố danh mục và loại đá.`);
                const generatedVariantSkus = new Set<string>();
                const variantCreate = await Promise.all(newProductVariantDrafts.map(async (variant, index) => {
                  const variantSku = String(variant.sku || "").trim();
                  if (generatedVariantSkus.has(variantSku.toLocaleUpperCase("en"))) throw new ConflictException("Hai biến thể không thể dùng chung một SKU con.");
                  generatedVariantSkus.add(variantSku.toLocaleUpperCase("en"));
                  return createVariantForProduct(variant, index);
                }));
                product = await tx.product.create({ data: {
                  sku, name: productName, slug: `${slugify(productName).slice(0, 180)}-${sku.toLocaleLowerCase("en")}`,
                  kind: category.kind, categoryId: category.id, gemstoneTypeId, materialOptionId,
                  status: "DRAFT", stock: 0, price: profilePrice, ...profilePriceSync,
                  variants: { create: variantCreate },
                }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
              }
            } else {
              if (existingVariant) throw new ConflictException(`Mã ${sku} đang là SKU con của sản phẩm ${existingVariant.product.sku}. Hãy nhập theo mã sản phẩm mẹ và chọn biến thể.`);
              if (existingProduct) {
                const legacyGemstoneCategory = category.kind === "GEMSTONE" && existingProduct.gemstoneTypeId === gemstoneTypeId;
                if ((existingProduct.categoryId !== category.id && !legacyGemstoneCategory) || existingProduct.gemstoneTypeId !== gemstoneTypeId || existingProduct.materialOptionId !== materialOptionId) {
                  throw new ConflictException(`Mã ${sku} đã tồn tại ở danh mục hoặc loại đá khác. Hãy kiểm tra quy tắc mã hàng.`);
                }
                if (legacyGemstoneCategory && existingProduct.categoryId !== category.id) await tx.product.update({ where: { id: existingProduct.id }, data: { categoryId: category.id } });
                if (existingProduct.variants.length) throw new BadRequestException(`Mã ${sku} đã có ${existingProduct.variants.length} biến thể. Chọn kiểu quản lý tồn theo biến thể rồi nhập SKU con để cộng hoặc tạo biến thể.`);
                product = existingProduct;
              } else {
                product = await tx.product.create({ data: {
                  sku, name: productName, slug: `${slugify(productName).slice(0, 180)}-${sku.toLocaleLowerCase("en")}`,
                  kind: category.kind, categoryId: category.id, gemstoneTypeId, materialOptionId,
                  status: "DRAFT", stock: 0, price: profilePrice,
                  ...(standalonePremiumGemstone ? { isPremiumGemstone: true, lengthCm, widthCm } : {}),
                  ...profilePriceSync,
                }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
              }
            }
          } else {
            product = await tx.product.findUnique({ where: { id: String(item.productId) }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
            if (!product) throw new NotFoundException("Không tìm thấy mặt hàng trong kho.");
          }

          const receiptRows: Array<{ variant: Input | null; quantity: number; unitCost: number | null }> = newProductVariantDrafts.length
            ? newProductVariantDrafts.map((draft) => ({
                variant: (draft.variantId ? product.variants.find((entry: Input) => entry.id === draft.variantId) : null)
                  || product.variants.find((entry: Input) => entry.optionKey === draft.optionKey)
                  || product.variants.find((entry: Input) => String(entry.sku || "").toLocaleUpperCase("en") === String(draft.sku || "").toLocaleUpperCase("en"))
                  || null,
                quantity: draft.quantity,
                unitCost: draft.unitCost,
              }))
            : (() => {
                const variantId = String(item.variantId || "") || null;
                const variant = variantId ? product.variants.find((entry: Input) => entry.id === variantId) || null : null;
                if (variantId && !variant) throw new BadRequestException("Phiên bản không thuộc mặt hàng đã chọn.");
                if (product.variants.length && !variant) throw new BadRequestException(`Chọn một biến thể cụ thể cho ${product.name} để nhập đúng tồn kho.`);
                return [{ variant, quantity: item.quantity, unitCost: item.unitCost }];
              })();
          for (const row of receiptRows) {
            const variant = row.variant;
            let stockBefore: number;
            let stockAfter: number;
            let variantLabel: string | null = null;
            if (variant) {
              await tx.productPriceVariant.update({ where: { id: variant.id }, data: { stock: { increment: row.quantity } } });
              const updatedVariant = await tx.productPriceVariant.findUniqueOrThrow({ where: { id: variant.id }, select: { stock: true } });
              stockAfter = updatedVariant.stock;
              stockBefore = stockAfter - row.quantity;
              const currentVariants = await tx.productPriceVariant.findMany({ where: { productId: product.id }, select: { stock: true } });
              const productStock = currentVariants.reduce((sum, current) => sum + current.stock, 0);
              await tx.product.update({ where: { id: product.id }, data: { stock: productStock, soldOutAt: productStock > 0 ? null : product.soldOutAt } });
              variantLabel = variantDisplayLabel(variant);
            } else {
              await tx.product.update({ where: { id: product.id }, data: { stock: { increment: row.quantity }, soldOutAt: null } });
              const updatedProduct = await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true } });
              stockAfter = updatedProduct.stock;
              stockBefore = stockAfter - row.quantity;
            }
            const productSku = variant?.sku || product.sku;
            const stoneName = product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null;
            const lineTotal = row.unitCost == null ? null : row.quantity * row.unitCost;
            await tx.inventoryReceiptItem.create({ data: {
              receiptId: savedReceipt.id, productId: product.id, variantId: variant?.id || null,
              productName: product.name, productSku, quality: variant?.quality || null, shape: variant?.shape || null, beadSize: variant?.beadSize || null,
              carat: variant?.carat || null, gemstoneQuality: variant?.gemstoneQuality || null, categoryName: product.category?.name || null,
              stoneName, kind: product.kind, quantity: row.quantity, unitCost: row.unitCost, lineTotal,
            } });
            await tx.inventoryMovement.create({ data: {
              productId: product.id, variantId: variant?.id || null, productName: product.name,
              productSku: variant?.sku || product.sku, variantLabel, type: "IN", quantity: row.quantity,
              stockBefore, stockAfter, reference: receiptNo, note: String(input.note || input.additionalNote || "").trim().slice(0, 2000) || null,
            } });
            changedProductIds.push(product.id);
          }
        }
        await this.queueProductStockSync(tx, changedProductIds);
        return tx.inventoryReceipt.findUniqueOrThrow({ where: { id: savedReceipt.id }, include: { items: true } });
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
      for (const id of new Set(changedProductIds)) this.publishCatalogChange("product", "updated", id);
      if (syncPos365) await this.pos365.syncReceiptNow(receipt.id);
      return await this.prisma.inventoryReceipt.findUnique({ where: { id: receipt.id }, include: { items: true } }) || receipt;
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException("Mã phiếu hoặc SKU vừa được sử dụng. Kiểm tra số thứ tự và thử lại.");
      if (error?.code === "P2034") {
        const duplicate = await this.prisma.inventoryReceipt.findFirst({
          where: { requestFingerprint, createdAt: { gte: new Date(Date.now() - inventoryReceiptDuplicateWindowMs) } },
          orderBy: { createdAt: "desc" },
          select: { receiptNo: true },
        });
        if (duplicate) throw new ConflictException(`Phiếu có nội dung nhập trùng với ${duplicate.receiptNo} vừa tạo trong 5 phút qua. GEME đã chặn để tránh cộng tồn kho hai lần.`);
      }
      throw error;
    }
  }

  async updateMinimumStock(id: string, value: unknown) {
    const minimumStock = Number(value);
    if (!Number.isInteger(minimumStock) || minimumStock < 0 || minimumStock > 1000000) {
      throw new BadRequestException("Mức tồn tối thiểu phải là số nguyên từ 0 đến 1.000.000.");
    }
    try { return await this.prisma.product.update({ where: { id }, data: { minimumStock } }); }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm."); throw error; }
  }

  async createInventoryMovement(input: Input) {
    const productId = String(input.productId || "");
    const variantId = input.variantId ? String(input.variantId) : null;
    const type = String(input.type || "").toUpperCase();
    const quantity = Number(input.quantity);
    if (!productId || !["IN", "OUT"].includes(type)) throw new BadRequestException("Chọn sản phẩm và loại nhập hoặc xuất kho.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng phải là số nguyên từ 1 đến 100.000.");

    try {
      const movement = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { id: productId }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
        if (!product) throw new NotFoundException("Không tìm thấy sản phẩm.");
        const selectedVariant = variantId ? product.variants.find((variant) => variant.id === variantId) : null;
        if (variantId && !selectedVariant) throw new BadRequestException("Phiên bản không thuộc sản phẩm đã chọn.");

        let stockBefore: number;
        let stockAfter: number;
        let variantLabel: string | null = null;
        if (selectedVariant) {
          stockBefore = selectedVariant.stock;
          if (type === "OUT" && stockBefore < quantity) throw new BadRequestException("Số lượng xuất vượt quá tồn kho của phiên bản.");
          stockAfter = stockBefore + (type === "IN" ? quantity : -quantity);
          await tx.productPriceVariant.update({ where: { id: selectedVariant.id }, data: { stock: stockAfter } });
          const nextVariants = await tx.productPriceVariant.findMany({ where: { productId }, select: { stock: true } });
          const productStock = nextVariants.reduce((sum, item) => sum + item.stock, 0);
          await tx.product.update({ where: { id: productId }, data: { stock: productStock, soldOutAt: productStock === 0 ? product.soldOutAt ?? new Date() : null } });
          variantLabel = variantDisplayLabel(selectedVariant);
        } else {
          stockBefore = product.stock;
          if (type === "OUT" && stockBefore < quantity) throw new BadRequestException("Số lượng xuất vượt quá tồn kho hiện tại.");
          stockAfter = stockBefore + (type === "IN" ? quantity : -quantity);
          await tx.product.update({ where: { id: productId }, data: { stock: stockAfter, soldOutAt: type === "OUT" && stockAfter === 0 ? product.soldOutAt ?? new Date() : stockAfter > 0 ? null : product.soldOutAt } });
        }

        const savedMovement = await tx.inventoryMovement.create({ data: {
          productId, variantId: selectedVariant?.id || null, productName: product.name,
          productSku: selectedVariant?.sku || product.sku, variantLabel, type, quantity, stockBefore, stockAfter,
          reference: input.reference ? String(input.reference).trim().slice(0, 120) : null,
          note: input.note ? String(input.note).trim().slice(0, 2000) : null,
        } });
        await this.queueProductStockSync(tx, [productId]);
        return savedMovement;
      });
      this.publishCatalogChange("product", "updated", productId);
      return movement;
    } catch (error: any) {
      if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy sản phẩm hoặc phiên bản.");
      throw error;
    }
  }

  customers(query: Record<string, string>) {
    if (query.phone) {
      let phone = String(query.phone).replace(/\D/g, "");
      if (phone.startsWith("84") && phone.length >= 10) phone = `0${phone.slice(2)}`;
      return this.prisma.customer.findUnique({
        where: { phone },
        select: {
          id: true, name: true, email: true, phone: true, authSubjectId: true,
          defaultAddress: true, status: true, segment: true, avatarUrl: true, note: true,
        },
      }).then((customer) => customer ? [customer] : []);
    }

    const where: Input = {};
    if (query.status === "ACTIVE" || query.status === "INACTIVE") where.status = query.status;
    if (query.search) where.OR = [{ name: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }, { phone: { contains: query.search, mode: "insensitive" } }];
    return this.prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, email: true, phone: true, defaultAddress: true, status: true,
        segment: true, avatarUrl: true, note: true, createdAt: true,
        _count: { select: { orders: true, reviews: true } },
        orders: {
          orderBy: { placedAt: "desc" }, take: 5,
          select: {
            code: true, placedAt: true, totalAmount: true, status: true,
            items: { select: { productName: true, product: { select: { images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" }, take: 500,
    });
  }

  async saveCustomer(input: Input, id?: string) {
    const name = String(input.name || "").trim();
    if (!name) throw new BadRequestException("Tên khách hàng không được để trống.");
    let phone = input.phone ? String(input.phone).replace(/\D/g, "") : null;
    if (phone?.startsWith("84") && phone.length >= 10) phone = `0${phone.slice(2)}`;
    const data = {
      name, email: input.email ? String(input.email).trim().toLowerCase() : null,
      phone,
      defaultAddress: input.defaultAddress ?? input.address ?? null,
      status: enumValue(input.status, ["ACTIVE", "INACTIVE"], "ACTIVE") as any,
      segment: input.segment || null, avatarUrl: input.avatarUrl || null, note: input.note || null,
    };
    try { return id ? await this.prisma.customer.update({ where: { id }, data }) : await this.prisma.customer.create({ data }); }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy khách hàng."); if (error?.code === "P2002") throw new ConflictException("Email hoặc số điện thoại đã được sử dụng."); throw error; }
  }

  orders(query: Record<string, string> = {}) {
    const take = Math.min(Math.max(Number(query.limit) || 500, 1), 500);
    if (query.view === "admin-summary") return this.prisma.order.findMany({
      select: {
        id: true, code: true, customerName: true, customerPhone: true, customerEmail: true,
        shippingMethod: true, status: true, totalAmount: true, placedAt: true,
        customer: { select: { name: true, phone: true, email: true } },
        items: { select: { productName: true, productSku: true, quantity: true, unitPrice: true, lineTotal: true } },
        payments: { select: { method: true, status: true, amount: true, paidAt: true, refunds: { select: { amount: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { placedAt: "desc" }, take,
    });
    return this.prisma.order.findMany({ select: selectAdminOrder, orderBy: { placedAt: "desc" }, take });
  }

  private async releaseOrderReservation(tx: any, order: Input, changedProductIds: Set<string>, reason = "ORDER_CANCELLED") {
    for (const item of order.items as any[]) {
      if (!item.productId) continue;
      if (item.variantId) {
        const variant = await tx.productPriceVariant.findFirst({ where: { id: item.variantId, productId: item.productId }, select: { stock: true } });
        if (!variant) continue;
        await tx.productPriceVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
        const currentVariant = await tx.productPriceVariant.findUniqueOrThrow({ where: { id: item.variantId }, select: { stock: true } });
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, soldOutAt: null } });
        await tx.inventoryMovement.create({ data: {
          productId: item.productId, variantId: item.variantId, productName: item.productName, productSku: item.productSku,
          variantLabel: variantDisplayLabel(item), type: "IN", quantity: item.quantity,
          stockBefore: currentVariant.stock - item.quantity, stockAfter: currentVariant.stock,
          reference: order.code, note: "Hoàn tồn kho do hủy đơn trước khi xuất hàng",
        } });
      } else {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
        if (!product) continue;
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, soldOutAt: null } });
        const currentProduct = await tx.product.findUniqueOrThrow({ where: { id: item.productId }, select: { stock: true } });
        await tx.inventoryMovement.create({ data: {
          productId: item.productId, variantId: null, productName: item.productName, productSku: item.productSku,
          variantLabel: null, type: "IN", quantity: item.quantity,
          stockBefore: currentProduct.stock - item.quantity, stockAfter: currentProduct.stock,
          reference: order.code, note: "Hoàn tồn kho do hủy đơn trước khi xuất hàng",
        } });
      }
      changedProductIds.add(item.productId);
    }
    await tx.inventoryReservation.updateMany({
      where: { orderId: order.id, status: "ACTIVE" },
      data: { status: reason === "RESERVATION_EXPIRED" ? "EXPIRED" : "RELEASED", releasedAt: new Date(), releaseReason: reason, expiresAt: null },
    });
  }

  private async expireOrderReservations() {
    if (this.reservationExpiryRunning) return;
    this.reservationExpiryRunning = true;
    try {
      const now = new Date();
      const expired = await this.prisma.order.findMany({
        where: {
          status: "PENDING_CONFIRMATION",
          inventoryReservedAt: { not: null },
          inventoryCommittedAt: null,
          inventoryReleasedAt: null,
          inventoryReservationExpiresAt: { lte: now },
          payments: { none: { status: "PAID" } },
        },
        include: { items: true },
        orderBy: { inventoryReservationExpiresAt: "asc" },
        take: 100,
      });
      for (const candidate of expired) {
        const changedProductIds = new Set<string>();
        try {
          const released = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.order.updateMany({
              where: {
                id: candidate.id,
                status: "PENDING_CONFIRMATION",
                inventoryReservedAt: { not: null },
                inventoryCommittedAt: null,
                inventoryReleasedAt: null,
                inventoryReservationExpiresAt: { lte: now },
                payments: { none: { status: "PAID" } },
              },
              data: { status: "CANCELLED", inventoryReleasedAt: now, inventoryReservationExpiresAt: null },
            });
            if (claimed.count !== 1) return false;
            await this.releaseOrderReservation(tx, candidate, changedProductIds, "RESERVATION_EXPIRED");
            await this.queueProductStockSync(tx, changedProductIds);
            await tx.auditLog.create({ data: {
              action: "ORDER_RESERVATION_EXPIRED",
              entityType: "ORDER",
              entityId: candidate.id,
              before: { status: candidate.status, reservationExpiresAt: candidate.inventoryReservationExpiresAt?.toISOString() },
              after: { status: "CANCELLED", releasedAt: now.toISOString() },
            } });
            return true;
          });
          if (released) {
            for (const productId of changedProductIds) this.publishCatalogChange("product", "updated", productId);
            if (this.pos365.isSyncEnabled()) void this.pos365.queueOrderSync(candidate.id).catch(() => undefined);
          }
        } catch (error) {
          this.logger.warn(`Không thể giải phóng reservation của đơn ${candidate.code}.`, error);
        }
      }
    } finally {
      this.reservationExpiryRunning = false;
    }
  }

  async updateOrderStatus(id: string, statusInput: unknown, actor?: { id: string; correlationId?: string }, reasonInput?: unknown) {
    const status = enumValue(statusInput, ["PENDING_CONFIRMATION", "PROCESSING", "SHIPPING", "DELIVERED", "CANCELLED"], "");
    if (!status) throw new BadRequestException("Trạng thái đơn hàng không hợp lệ.");
    const reason = typeof reasonInput === "string" ? reasonInput.trim().slice(0, 1000) : "";
    if (status === "CANCELLED" && reason.length < 5) throw new BadRequestException("Vui lòng ghi lý do hủy đơn tối thiểu 5 ký tự.");
    const changedProductIds = new Set<string>();
    let noOp = false;
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await tx.order.findUnique({ where: { id }, include: { payments: true, items: true } });
        if (!current) throw new NotFoundException("Không tìm thấy đơn hàng.");
        if (current.status === status) { noOp = true; return current; }
        if (!canTransitionOrder(current.status, status)) throw new BadRequestException(`Không thể chuyển đơn từ ${current.status} sang ${status}. Tải lại đơn và chọn bước kế tiếp hợp lệ.`);
        if (status === "CANCELLED" && (current.inventoryCommittedAt || current.payments.some((payment: any) => payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED"))) {
          throw new BadRequestException("Đơn đã xuất hàng hoặc còn tiền chưa hoàn hết. Hoàn tiền thực tế và ghi nhận đầy đủ trước khi hủy đơn.");
        }
        if (current.shippingProvider === "VIETTEL_POST" && status === "SHIPPING" && current.carrierShipmentStatus !== "IN_TRANSIT") {
          throw new BadRequestException("Chỉ chuyển đơn Viettel Post sang Đang giao khi hãng đã xác nhận nhận kiện.");
        }
        if (current.shippingProvider === "VIETTEL_POST" && status === "DELIVERED" && current.carrierShipmentStatus !== "DELIVERED") {
          throw new BadRequestException("Viettel Post chưa xác nhận giao thành công cho đơn này.");
        }
        if (current.shippingProvider === "VIETTEL_POST" && status === "CANCELLED" && current.trackingCode && !["CANCELLED", "RETURNING", "EXCEPTION"].includes(String(current.carrierShipmentStatus || ""))) {
          throw new BadRequestException("Vui lòng hủy hoặc xử lý hoàn vận đơn trên Viettel Post trước khi hủy đơn GEME.");
        }

        let inventoryReleasedAt: Date | undefined;
        let inventoryCommittedAt: Date | undefined;
        if (status === "CANCELLED" && current.inventoryReservedAt && !current.inventoryCommittedAt && !current.inventoryReleasedAt
          && ["PENDING_CONFIRMATION", "PROCESSING"].includes(current.status)) {
          const releasedAt = new Date();
          await this.releaseOrderReservation(tx, current, changedProductIds);
          inventoryReleasedAt = releasedAt;
        }
        // Stock is reduced when the order reserves it. At carrier handoff the
        // reservation stops being on-hand stock; never decrement stock twice.
        if ((status === "SHIPPING" || status === "DELIVERED") && current.inventoryReservedAt && !current.inventoryReleasedAt && !current.inventoryCommittedAt) {
          inventoryCommittedAt = new Date();
        }
        const updated = await tx.order.updateMany({
          where: {
            id, status: current.status, updatedAt: current.updatedAt,
            ...(inventoryReleasedAt || inventoryCommittedAt ? { inventoryReservedAt: { not: null }, inventoryReleasedAt: null, inventoryCommittedAt: null } : {}),
          },
          data: {
            status: status as any,
            ...(inventoryReleasedAt ? { inventoryReleasedAt } : {}),
            ...(inventoryCommittedAt ? { inventoryCommittedAt } : {}),
            ...(inventoryReleasedAt || inventoryCommittedAt || status === "PROCESSING" ? { inventoryReservationExpiresAt: null } : {}),
            ...(this.pos365.isSyncEnabled() ? { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date(), pos365SyncError: null } : {}),
          },
        });
        if (updated.count !== 1) throw new ConflictException("Đơn vừa được cập nhật bởi người khác. Tải lại thông tin rồi thử lại.");
        if (inventoryCommittedAt) await tx.inventoryReservation.updateMany({
          where: { orderId: id, status: "ACTIVE" },
          data: { status: "COMMITTED", committedAt: inventoryCommittedAt, expiresAt: null },
        });
        if (status === "PROCESSING") await tx.inventoryReservation.updateMany({
          where: { orderId: id, status: "ACTIVE" },
          data: { expiresAt: null },
        });
        const updatedOrder = await tx.order.findUnique({ where: { id }, include: { items: true, payments: true, customer: true } });
        if (!updatedOrder) throw new NotFoundException("Không tìm thấy đơn hàng sau khi cập nhật.");
        await tx.auditLog.create({ data: {
          adminId: actor?.id || null,
          correlationId: actor?.correlationId,
          action: status === "CANCELLED" ? "ORDER_CANCELLED" : "ORDER_STATUS_CHANGED",
          entityType: "ORDER",
          entityId: id,
          before: { status: current.status, inventoryCommittedAt: current.inventoryCommittedAt?.toISOString() || null },
          after: { status, reason: reason || null, inventoryCommittedAt: inventoryCommittedAt?.toISOString() || current.inventoryCommittedAt?.toISOString() || null },
        } });
        return updatedOrder;
      });
      if (noOp) return order;
      if (changedProductIds.size) {
        await this.queueProductStockSync(this.prisma, changedProductIds).catch(() => undefined);
        for (const productId of changedProductIds) this.publishCatalogChange("product", "updated", productId);
      }
      if (this.pos365.isSyncEnabled()) void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đánh thức hàng đợi POS365 cho đơn ${order.code}.`, error));
      return order;
    }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy đơn hàng."); throw error; }
  }

  async markOrderPaid(id: string, statusInput: unknown) {
    if (String(statusInput || "").toUpperCase() !== "PAID") throw new BadRequestException("Chỉ được ghi nhận trạng thái đã thanh toán.");
    throw new BadRequestException("Không còn hỗ trợ đánh dấu PAID toàn bộ. Ghi nhận từng khoản thu bằng POST /orders/:id/payments với số tiền, phương thức, mã giao dịch và Idempotency-Key.");
  }

  async recordOrderPayment(id: string, actor: { id: string; correlationId?: string }, input: Input, idempotencyHeader?: string) {
    const amount = Number(input.amount);
    const method = enumValue(input.method, ["BANK_TRANSFER", "MOMO", "CREDIT_CARD", "OTHER"], "");
    const providerRef = typeof input.providerRef === "string" ? input.providerRef.trim() : "";
    const note = typeof input.note === "string" ? input.note.trim() : "";
    const idempotencyKey = String(idempotencyHeader || input.idempotencyKey || "").trim();
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException("Số tiền thu phải là số nguyên đồng lớn hơn 0.");
    if (!method) throw new BadRequestException("Chọn phương thức thu tiền hợp lệ; COD được đối soát riêng.");
    if (providerRef.length < 4 || providerRef.length > 160) throw new BadRequestException("Cần mã giao dịch hoặc chứng từ thu thực tế từ 4 đến 160 ký tự.");
    if (note.length < 5 || note.length > 1000) throw new BadRequestException("Ghi chú khoản thu cần từ 5 đến 1.000 ký tự.");
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho khoản thu.");
    try {
      const order = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await tx.order.findUnique({ where: { id }, include: { payments: { orderBy: { createdAt: "asc" } } } });
        if (!current) throw new NotFoundException("Không tìm thấy đơn hàng.");
        const replay = await tx.payment.findUnique({ where: { idempotencyKey } });
        if (replay) {
          if (replay.orderId !== id || Number(replay.amount) !== amount || replay.method !== method || replay.providerRef !== providerRef || replay.recordingNote !== note) {
            throw new ConflictException("Idempotency-Key đã được dùng cho một khoản thu khác.");
          }
          return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true, payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } }, customer: true } });
        }
        if (current.shippingProvider === "VIETTEL_POST" && ["IN_TRANSIT", "DELIVERED", "RETURNING"].includes(String(current.carrierShipmentStatus || "")) && method === "COD") {
          throw new BadRequestException("Khoản COD do hãng thu phải được ghi nhận qua bảng kê đối soát.");
        }
        const captured = current.payments
          .filter((payment: any) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status))
          .reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
        const remaining = Math.max(0, Number(current.totalAmount) - captured);
        if (amount > remaining) throw new ConflictException(`Khoản thu vượt số dư còn lại ${remaining} ₫.`);
        if (!remaining) throw new ConflictException("Đơn đã thu đủ tiền.");

        const now = new Date();
        const pending = current.payments.find((payment: any) => payment.status === "PENDING");
        const shared = { orderId: id, idempotencyKey, method: method as any, status: "PAID" as any, amount, providerRef, paidAt: now, recordedByAdminId: actor.id, recordingNote: note };
        if (pending && Number(pending.amount) < amount) throw new ConflictException("Số dư trên giao dịch chờ không khớp với số dư đơn. Hãy kiểm tra sổ thanh toán trước khi ghi thêm.");
        if (pending && Number(pending.amount) === amount) {
          await tx.payment.update({ where: { id: pending.id }, data: { ...shared } });
        } else {
          if (pending) await tx.payment.update({ where: { id: pending.id }, data: { amount: Number(pending.amount) - amount, ...(current.status === "CANCELLED" ? { status: "FAILED" as any } : {}) } });
          await tx.payment.create({ data: shared });
        }
        // A late transfer for an expired/cancelled order is recorded for finance
        // follow-up only. The released stock is never reserved again.
        if (current.status !== "CANCELLED") {
          await tx.order.update({ where: { id }, data: { inventoryReservationExpiresAt: null } });
          await tx.inventoryReservation.updateMany({ where: { orderId: id, status: "ACTIVE" }, data: { expiresAt: null } });
        }
        const totalCapturedAfter = captured + amount;
        const customer = current.status !== "CANCELLED" && totalCapturedAfter >= Number(current.totalAmount)
          ? await ensureCustomerForPaidOrder(tx, current)
          : null;
        const result = await tx.order.update({
          where: { id },
          data: {
            ...(customer && !current.customerId ? { customer: { connect: { id: customer.id } } } : {}),
            ...(customer && this.pos365.isSyncEnabled() ? { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: now, pos365SyncError: null } : {}),
          },
          include: { items: true, payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } }, customer: true },
        });
        await tx.auditLog.create({ data: {
          adminId: actor.id,
          correlationId: actor.correlationId,
          action: current.status === "CANCELLED" ? "LATE_PAYMENT_RECORDED_FOR_REFUND" : "ORDER_PAYMENT_RECORDED",
          entityType: "ORDER", entityId: id,
          before: { capturedAmount: captured, remainingAmount: remaining, status: current.status },
          after: { amount, method, providerRef, idempotencyKey, note, capturedAmount: totalCapturedAfter, remainingAmount: remaining - amount, latePayment: current.status === "CANCELLED" },
        } });
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      if (order.status !== "CANCELLED" && this.pos365.isSyncEnabled() && Number(order.payments.filter((payment: any) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0)) >= Number(order.totalAmount)) {
        void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đánh thức hàng đợi POS365 cho đơn ${order.code}.`, error));
      }
      return order;
    } catch (error: any) {
      if (error?.code === "P2002") {
        const prior = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
        if (prior && prior.orderId === id && Number(prior.amount) === amount && prior.method === method && prior.providerRef === providerRef && prior.recordingNote === note) return this.prisma.order.findUnique({ where: { id }, include: { items: true, payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } }, customer: true } });
        if (prior) throw new ConflictException("Idempotency-Key đã được dùng cho một khoản thu khác.");
      }
      if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy đơn hàng.");
      throw error;
    }
  }

  private async activeStorePromotions(client: any, now = new Date()): Promise<CheckoutPromotion[]> {
    return loadActiveStorePromotions(client, now);
  }

  async quoteOrder(input: Input) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new BadRequestException("Đơn hàng cần ít nhất một sản phẩm.");
    const visibility = await this.storefrontProductVisibilityWhere();
    return this.prisma.$transaction(async (tx) => {
      const promotions = await this.activeStorePromotions(tx);
      const requestedStock = new Map<string, number>();
      const quotedItems: Array<Record<string, unknown>> = [];
      let subtotal = 0;
      let discountAmount = 0;
      for (const line of items) {
        const product = await tx.product.findFirst({
          where: {
            OR: [{ id: String(line.productId || "") }, { sku: String(line.sku || "") }],
            status: "ACTIVE",
            AND: visibility.AND,
          },
          include: { category: true, variants: { orderBy: { sortOrder: "asc" } } },
        });
        if (!product) throw new BadRequestException("Một sản phẩm trong giỏ không còn khả dụng.");
        if (product.kind === "GEMSTONE" && product.isPremiumGemstone) throw new BadRequestException(`Sản phẩm đá quý cao cấp ${product.name} chỉ nhận yêu cầu tư vấn, không đặt trực tiếp qua giỏ hàng.`);
        const variant = line.variantId ? product.variants.find((item: any) => item.id === String(line.variantId)) : null;
        if (line.variantId && !variant) throw new BadRequestException(`Phiên bản của ${product.name} không còn khả dụng.`);
        if (product.variants.length && !variant) throw new BadRequestException(`Chọn phiên bản cụ thể cho ${product.name}.`);
        const quantity = Number(line.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("Số lượng mỗi dòng phải từ 1 đến 99.");
        const stockKey = `${product.id}:${variant?.id || "base"}`;
        const requested = (requestedStock.get(stockKey) || 0) + quantity;
        const available = variant ? variant.stock : product.stock;
        if (requested > available) throw new BadRequestException(`Không đủ tồn kho cho ${product.name}${variant ? ` (${variantDisplayLabel(variant)})` : ""}.`);
        requestedStock.set(stockKey, requested);
        const pricing = calculateCheckoutPrice(product, variant, getCheckoutPromotionValue(product, promotions));
        if (pricing.listedUnitPrice <= 0) throw new BadRequestException(`Sản phẩm ${product.name} chưa có giá bán.`);
        const lineTotal = pricing.saleUnitPrice * quantity;
        const lineDiscount = pricing.promotionDiscountPerUnit * quantity;
        subtotal += pricing.listedUnitPrice * quantity;
        discountAmount += lineDiscount;
        quotedItems.push({
          productId: product.id,
          variantId: variant?.id || null,
          productName: product.name,
          productSku: variant?.sku || product.sku,
          quality: variant?.quality || null,
          beadSize: variant?.beadSize || null,
          carat: variant?.carat == null ? null : Number(variant.carat),
          gemstoneQuality: variant?.gemstoneQuality || null,
          quantity,
          unitPrice: pricing.listedUnitPrice,
          saleUnitPrice: pricing.saleUnitPrice,
          lineDiscount,
          lineTotal,
          stock: available,
        });
      }
      const shippingFee = Math.max(0, Number(input.shippingFee) || 0);
      return { subtotal, discountAmount, shippingFee, totalAmount: subtotal - discountAmount + shippingFee, items: quotedItems };
    });
  }

  async createOrder(input: Input, authenticatedCustomerId?: string, trustedStoreSale = false, idempotencyKeyInput?: string) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new BadRequestException("Đơn hàng cần ít nhất một sản phẩm.");
    const storeSale = trustedStoreSale && (input.salesChannel === "STORE" || input.channel === "STORE");
    const method = enumValue(input.paymentMethod, ["COD", "BANK_TRANSFER", "MOMO", "CREDIT_CARD", "OTHER"], "COD");
    const paid = storeSale && (input.paid === true || method === "COD");
    const inventoryReservationExpiresAt = getInventoryReservationExpiry(method, paid);
    const code = `GME-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
    const customerId = String(authenticatedCustomerId || input.customerId || "");
    const idempotencyKey = String(idempotencyKeyInput || "").trim();
    if (!idempotencyKey) throw new BadRequestException("Thiếu mã chống tạo đơn trùng. Hãy tải lại màn hình rồi thử lại.");
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Mã chống tạo đơn trùng không hợp lệ.");
    const idempotencyRequestHash = idempotencyKey ? createHash("sha256").update(JSON.stringify({
      customerId,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email,
      shippingAddress: input.shippingAddress,
      note: input.note,
      paymentMethod: method,
      salesChannel: input.salesChannel || input.channel || null,
      paid: input.paid === true,
      discountAmount: input.discountAmount ?? null,
      shippingFee: input.shippingFee ?? null,
      shippingMethod: input.shippingMethod ?? null,
      expectedTotalAmount: input.expectedTotalAmount,
      items: items.map((line: Input) => ({ productId: line.productId, variantId: line.variantId, sku: line.sku, quantity: line.quantity })),
    })).digest("hex") : null;
    const findIdempotentOrder = async (client: any) => idempotencyKey
      ? client.order.findUnique({ where: { idempotencyKey }, include: { items: true, payments: true, customer: true } })
      : null;
    const verifyIdempotentOrder = (existing: any) => {
      if (existing && existing.idempotencyRequestHash !== idempotencyRequestHash) {
        throw new ConflictException("Mã yêu cầu đã được dùng cho một nội dung đặt hàng khác. Tải lại trang để tạo mã mới.");
      }
      return existing;
    };
    const priorOrder = verifyIdempotentOrder(await findIdempotentOrder(this.prisma));
    if (priorOrder) return priorOrder;
    const changedProductIds = new Set<string>();
    let created = false;
    let order: any;
    try {
    order = await this.prisma.$transaction(async (tx) => {
      const existing = verifyIdempotentOrder(await findIdempotentOrder(tx));
      if (existing) return existing;
      const customer = customerId ? await tx.customer.findUnique({ where: { id: customerId } }) : null;
      if (customerId && !customer) throw new BadRequestException("Không tìm thấy hồ sơ khách hàng đã chọn.");
      const promotions = storeSale ? [] : await this.activeStorePromotions(tx);
      const orderVisibility = storeSale ? null : await this.storefrontProductVisibilityWhere();
      const placedItems: Array<{ productId: string; variantId: string | null; productName: string; productSku: string; shape: string | null; quality: string | null; beadSize: string | null; carat: number | null; gemstoneQuality: string | null; quantity: number; unitPrice: number; lineTotal: number }> = [];
      const outboundItems = new Map<string, {
        productId: string;
        variantId: string | null;
        productName: string;
        productSku: string;
        variantLabel: string | null;
        categoryName: string | null;
        stoneName: string | null;
        kind: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }>();
      for (const line of items) {
        const product = await tx.product.findFirst({
          where: {
            OR: [{ id: String(line.productId || "") }, { sku: String(line.sku || "") }],
            status: storeSale ? { not: "ARCHIVED" } : "ACTIVE",
            ...(orderVisibility ? { AND: orderVisibility.AND } : {}),
          },
          include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
        });
        if (!product) throw new BadRequestException("Một sản phẩm trong giỏ không còn khả dụng.");
        if (product.kind === "GEMSTONE" && product.isPremiumGemstone && !storeSale) throw new BadRequestException(`Sản phẩm đá quý cao cấp ${product.name} chỉ nhận yêu cầu tư vấn, không đặt trực tiếp qua giỏ hàng.`);
        const variant = line.variantId ? product.variants.find((item: any) => item.id === String(line.variantId)) : null;
        if (line.variantId && !variant) throw new BadRequestException(`Phiên bản của ${product.name} không còn khả dụng.`);
        if (product.variants.length && !variant) throw new BadRequestException(`Chọn phiên bản cụ thể cho ${product.name}.`);
        const quantity = Number(line.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("Số lượng mỗi dòng phải từ 1 đến 99.");
        const promotionValue = storeSale ? 0 : getCheckoutPromotionValue(product, promotions);
        const pricing = calculateCheckoutPrice(product, variant, promotionValue);
        const unitPrice = pricing.listedUnitPrice;
        const lineTotal = pricing.saleUnitPrice * quantity;
        if (!unitPrice) throw new BadRequestException(`Sản phẩm ${product.name} chưa có giá bán.`);
        const variantLabel = variantDisplayLabel(variant);
        // Hold stock for unpaid counter orders too. Payment and inventory issue
        // are separate events; a later payment must not be the first stock check.
        const shouldReserveInventory = true;
        if (shouldReserveInventory) {
          let stockBefore: number;
          let stockAfter: number;
          if (variant) {
            const updatedVariant = await tx.productPriceVariant.updateMany({ where: { id: variant.id, productId: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
            if (updatedVariant.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} (${variantLabel}) vừa thay đổi hoặc không đủ. Tải lại và thử lại.`);
            const freshVariant = await tx.productPriceVariant.findUniqueOrThrow({ where: { id: variant.id }, select: { stock: true } });
            stockAfter = freshVariant.stock;
            stockBefore = stockAfter + quantity;
            const updatedProduct = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
            if (updatedProduct.count !== 1) throw new BadRequestException(`Tồn kho tổng của ${product.name} vừa thay đổi hoặc không đủ. Tải lại và thử lại.`);
          } else {
            const updatedProduct = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
            if (updatedProduct.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} vừa thay đổi hoặc không đủ. Tải lại và thử lại.`);
            const freshProduct = await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true } });
            stockAfter = freshProduct.stock;
            stockBefore = stockAfter + quantity;
          }
          await tx.product.updateMany({ where: { id: product.id, stock: 0 }, data: { soldOutAt: product.soldOutAt ?? new Date() } });
          await tx.product.updateMany({ where: { id: product.id, stock: { gt: 0 } }, data: { soldOutAt: null } });
          await tx.inventoryMovement.create({ data: {
            productId: product.id, variantId: variant?.id || null, productName: product.name, productSku: variant?.sku || product.sku,
            variantLabel, type: "OUT", quantity, stockBefore, stockAfter, reference: code,
            note: paid ? "Đơn hàng đã thanh toán" : storeSale ? "Giữ tồn kho cho đơn tại cửa hàng" : "Giữ tồn kho cho đơn online",
          } });
          changedProductIds.add(product.id);
        }
        if (storeSale && paid) {
          const issueKey = `${product.id}:${variant?.id || "base"}`;
          const issueLine = outboundItems.get(issueKey);
          if (issueLine) {
            issueLine.quantity += quantity;
            issueLine.lineTotal += unitPrice * quantity;
          } else {
            outboundItems.set(issueKey, {
              productId: product.id, variantId: variant?.id || null,
              productName: product.name, productSku: variant?.sku || product.sku, variantLabel,
              categoryName: product.category?.name || null,
              stoneName: product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null,
              kind: product.kind, quantity, unitPrice, lineTotal: unitPrice * quantity,
            });
          }
        }
        placedItems.push({ productId: product.id, variantId: variant?.id || null, productName: product.name, productSku: variant?.sku || product.sku, shape: variant?.shape || null, quality: variant?.quality || null, beadSize: variant?.beadSize || null, carat: variant?.carat == null ? null : Number(variant.carat), gemstoneQuality: variant?.gemstoneQuality || null, quantity, unitPrice, lineTotal });
      }
      const subtotal = placedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const promotionDiscount = placedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity - item.lineTotal, 0);
      const discountAmount = Math.min(subtotal, Math.max(0, storeSale ? Number(input.discountAmount) || 0 : promotionDiscount));
      const shippingFee = Math.max(0, Number(input.shippingFee) || 0);
      const totalAmount = subtotal - discountAmount + shippingFee;
      if (input.expectedTotalAmount != null && Number(input.expectedTotalAmount) !== totalAmount) {
        throw new ConflictException("Giá sản phẩm hoặc khuyến mãi vừa thay đổi. Hãy kiểm tra lại giỏ hàng trước khi đặt.");
      }
      const customerName = String(input.customerName || input.name || "").trim() || customer?.name || "";
      if (!customerName && !storeSale) throw new BadRequestException("Nhập tên khách hàng hoặc chọn hồ sơ khách hàng.");
      const customerPhone = String(input.phone || "").trim() || customer?.phone || null;
      const customerEmail = (input.email ? String(input.email).trim().toLowerCase() : "") || customer?.email || null;
      const orderCustomer = paid ? await ensureCustomerForPaidOrder(tx, {
        customerId: customer?.id || null,
        customerName,
        customerPhone,
        customerEmail,
        shippingAddress: String(input.shippingAddress || input.address || "").trim(),
      }) : customer;
      if (paid) {
        const issuedAt = new Date();
        const dateKey = `${issuedAt.getUTCFullYear()}${String(issuedAt.getUTCMonth() + 1).padStart(2, "0")}${String(issuedAt.getUTCDate()).padStart(2, "0")}`;
        const issueId = randomUUID();
        const issueNo = `PX${dateKey}-${issueId.slice(0, 6).toUpperCase()}`;
        const issueLines = [...outboundItems.values()];
        const totalQuantity = issueLines.reduce((sum, item) => sum + item.quantity, 0);
        const issueTotal = issueLines.reduce((sum, item) => sum + item.lineTotal, 0);
        await tx.inventoryIssue.create({ data: {
          id: issueId, issueNo, issuedAt, reason: "ORDER", recipient: customerName || null,
          warehouseName: "Kho chính", status: "COMPLETED", note: `Mã đơn hàng: ${code}`,
          totalQuantity, totalAmount: issueTotal,
          items: { create: issueLines },
        } });
      }
      const savedOrder = await tx.order.create({ data: {
        code,
        ...(idempotencyKey ? { idempotencyKey, idempotencyRequestHash } : {}),
        customerName, customerEmail, customerPhone,
        shippingAddress: String(input.shippingAddress || input.address || "").trim(),
        shippingMethod: storeSale ? "Bán trực tiếp tại cửa hàng" : input.shippingMethod || null,
        note: input.note || null, subtotal, discountAmount, shippingFee, totalAmount,
        status: paid ? "DELIVERED" as any : "PENDING_CONFIRMATION" as any,
        ...(!paid ? { inventoryReservedAt: new Date() } : {}),
        ...(!paid && inventoryReservationExpiresAt ? { inventoryReservationExpiresAt } : {}),
        ...(paid ? { inventoryCommittedAt: new Date() } : {}),
        ...(this.pos365.isSyncEnabled() ? { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date() } : {}),
        ...(orderCustomer ? { customer: { connect: { id: orderCustomer.id } } } : {}),
        items: { create: placedItems },
        payments: { create: { method: method as any, amount: totalAmount, status: paid ? "PAID" as any : "PENDING" as any, ...(paid ? { paidAt: new Date() } : {}) } },
      }, include: { items: true, payments: true, customer: true } });
      if (!paid) {
        await tx.inventoryReservation.createMany({
          data: savedOrder.items.filter((item: any) => item.productId).map((item: any) => ({
            orderId: savedOrder.id,
            orderItemId: item.id,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            status: "ACTIVE",
            expiresAt: inventoryReservationExpiresAt,
          })),
        });
      }
      if (!storeSale && savedOrder.customerEmail) {
        await tx.orderEmailOutbox.create({ data: {
          orderId: savedOrder.id,
          eventType: "ORDER_CONFIRMATION",
          idempotencyKey: `order-confirmation:${savedOrder.id}`,
          recipient: savedOrder.customerEmail.trim().toLowerCase(),
          payload: this.orderConfirmationPayload(savedOrder),
        } });
      }
      await this.queueProductStockSync(tx, changedProductIds);
      created = true;
      return savedOrder;
    });
    } catch (error: any) {
      if (idempotencyKey) {
        const existing = verifyIdempotentOrder(await findIdempotentOrder(this.prisma));
        if (existing) return existing;
      }
      throw error;
    }
    if (!created) return order;
    for (const id of changedProductIds) this.publishCatalogChange("product", "updated", id);
    if (this.pos365.isSyncEnabled()) void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đánh thức hàng đợi POS365 cho đơn ${order.code}.`, error));
    if (!storeSale) void this.processOrderEmailOutbox();
    return order;
  }

  private orderConfirmationPayload(order: any) {
    const recipient = typeof order.customerEmail === "string" ? order.customerEmail.trim().toLowerCase() : "";
    const payment = order.payments?.[0];
    return {
      recipient,
      customerName: order.customerName || null,
      orderCode: order.code,
      placedAt: order.placedAt,
      status: order.status,
      paymentMethod: payment?.method || "OTHER",
      paymentStatus: payment?.status || null,
      shippingAddress: order.shippingAddress,
      customerPhone: order.customerPhone,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount),
      shippingFee: Number(order.shippingFee),
      totalAmount: Number(order.totalAmount),
      note: order.note,
      items: order.items.map((item: any) => ({
        productName: item.productName,
        productSku: item.productSku,
        quality: item.quality,
        beadSize: item.beadSize,
        carat: item.carat,
        gemstoneQuality: item.gemstoneQuality,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      })),
    };
  }

  private async processOrderEmailOutbox() {
    if (this.orderEmailOutboxRunning) return;
    this.orderEmailOutboxRunning = true;
    try {
      const now = new Date();
      const staleProcessingBefore = new Date(now.getTime() - 2 * 60_000);
      // A timeout/crash after Aegis accepted a request has an ambiguous result.
      // Stop automatic resend; an operator must verify or explicitly retry.
      await this.prisma.orderEmailOutbox.updateMany({
        where: { status: "PROCESSING", updatedAt: { lte: staleProcessingBefore } },
        data: { status: "UNKNOWN", lastError: "AEGIS_RESULT_UNKNOWN" },
      });
      const candidates = await this.prisma.orderEmailOutbox.findMany({
        where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
        take: 20,
      });
      for (const candidate of candidates) await this.deliverOrderEmailOutbox(candidate);
    } finally {
      this.orderEmailOutboxRunning = false;
    }
  }

  private async deliverOrderEmailOutbox(candidate: any) {
    const claimed = await this.prisma.orderEmailOutbox.updateMany({
      where: { id: candidate.id, status: candidate.status, updatedAt: candidate.updatedAt },
      data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastError: null },
    });
    if (claimed.count !== 1) return;
    const attempt = Number(candidate.attemptCount || 0) + 1;
    const apiKey = process.env.GEME_ORDER_EMAIL_API_KEY?.trim();
    if (!apiKey) {
      await this.failOrderEmailOutbox(candidate.id, attempt, "EMAIL_SERVICE_NOT_CONFIGURED");
      return;
    }
    const baseUrl = (process.env.AEGIS_ORDER_EMAIL_URL || process.env.AEGIS_AUTH_API_URL || "http://127.0.0.1:5130").trim().replace(/\/+$/, "");
    try {
      const response = await fetch(`${baseUrl}/internal/email/order-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GEME-Internal-Key": apiKey,
          "Idempotency-Key": candidate.idempotencyKey,
        },
        body: JSON.stringify(candidate.payload),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        await this.prisma.orderEmailOutbox.updateMany({ where: { id: candidate.id, status: "PROCESSING" }, data: { status: "ACCEPTED", acceptedAt: new Date(), lastError: null } });
        return;
      }
      if (response.status >= 500) {
        await this.prisma.orderEmailOutbox.updateMany({ where: { id: candidate.id, status: "PROCESSING" }, data: { status: "UNKNOWN", lastError: `AEGIS_HTTP_${response.status}_RESULT_UNKNOWN` } });
        return;
      }
      await this.failOrderEmailOutbox(candidate.id, attempt, `AEGIS_HTTP_${response.status}`);
    } catch (error: any) {
      await this.prisma.orderEmailOutbox.updateMany({
        where: { id: candidate.id, status: "PROCESSING" },
        data: { status: "UNKNOWN", lastError: error?.name === "TimeoutError" || error?.name === "AbortError" ? "AEGIS_TIMEOUT_RESULT_UNKNOWN" : "AEGIS_CONNECTION_RESULT_UNKNOWN" },
      });
    }
  }

  private async failOrderEmailOutbox(id: string, attempt: number, code: string) {
    const delayMs = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
    await this.prisma.orderEmailOutbox.updateMany({
      where: { id, status: "PROCESSING" },
      data: { status: "FAILED", lastError: code, nextAttemptAt: new Date(Date.now() + delayMs) },
    });
  }

  async retryOrderConfirmationEmail(orderId: string) {
    const entry = await this.prisma.orderEmailOutbox.findUnique({ where: { orderId_eventType: { orderId, eventType: "ORDER_CONFIRMATION" } } });
    if (!entry) throw new NotFoundException("Không có email xác nhận đã lưu cho đơn này.");
    if (entry.status === "ACCEPTED") return entry;
    if (entry.status === "UNKNOWN") {
      const apiKey = process.env.GEME_ORDER_EMAIL_API_KEY?.trim();
      const baseUrl = (process.env.AEGIS_ORDER_EMAIL_URL || process.env.AEGIS_AUTH_API_URL || "http://127.0.0.1:5130").trim().replace(/\/+$/, "");
      if (!apiKey) throw new ConflictException("Chưa cấu hình khóa để kiểm tra trạng thái email tại Aegis; chưa gửi lại để tránh email trùng.");
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/internal/email/order-confirmation/${encodeURIComponent(entry.idempotencyKey)}`, {
          headers: { "X-GEME-Internal-Key": apiKey },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new ConflictException("Chưa kiểm tra được trạng thái tại Aegis. Email chưa được gửi lại để tránh tạo bản trùng.");
      }
      if (response.ok) {
        const result = await response.json() as { status?: string };
        if (result.status === "SENT") {
          await this.prisma.orderEmailOutbox.updateMany({ where: { id: entry.id, status: "UNKNOWN" }, data: { status: "ACCEPTED", acceptedAt: new Date(), lastError: null } });
          return this.prisma.orderEmailOutbox.findUnique({ where: { id: entry.id } });
        }
        if (result.status === "UNKNOWN") throw new ConflictException("Aegis cũng đang ghi nhận kết quả chưa rõ. Cần kiểm tra trạng thái gửi ở máy chủ email trước khi thử lại.");
        throw new ConflictException("Aegis đang xử lý yêu cầu này. Email chưa được gửi lại để tránh tạo bản trùng.");
      }
      if (response.status !== 404) throw new ConflictException(`Aegis chưa xác nhận email chưa gửi (HTTP ${response.status}); chưa thử gửi lại.`);
    }
    await this.prisma.orderEmailOutbox.updateMany({ where: { id: entry.id, status: { in: ["FAILED", "PENDING", "UNKNOWN"] } }, data: { status: "PENDING", nextAttemptAt: new Date(), lastError: null } });
    void this.processOrderEmailOutbox();
    return this.prisma.orderEmailOutbox.findUnique({ where: { id: entry.id } });
  }

  async promotions(query: Record<string, string> = {}) {
    const take = Math.min(Math.max(Number(query.limit) || 500, 1), 500);
    if (query.view === "admin-summary") return this.prisma.promotion.findMany({
      select: { id: true, name: true, code: true, type: true, value: true, status: true, visible: true, startsAt: true, endsAt: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take,
    });
    return this.prisma.promotion.findMany({ include: { targets: { include: { category: true, product: true } }, _count: { select: { usages: true } } }, orderBy: { createdAt: "desc" }, take });
  }

  async storefrontPromotions() {
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: { visible: true, status: "ACTIVE", type: "PERCENTAGE" },
      select: { id: true, value: true, startsAt: true, endsAt: true, targets: { select: { categoryId: true, productId: true, excluded: true } } },
      take: 500,
    });
    const categories = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
    const descendantsOf = (roots: string[]) => {
      const ids = new Set(roots);
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of categories) {
          if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); changed = true; }
        }
      }
      return [...ids];
    };
    return promotions.map((promotion) => {
      const startsAt = parsePromotionBoundary(promotion.startsAt, "start");
      const endsAt = parsePromotionBoundary(promotion.endsAt, "end");
      const included = promotion.targets.filter((target) => !target.excluded);
      const excluded = promotion.targets.filter((target) => target.excluded);
      return {
        id: promotion.id,
        value: Number(promotion.value) || 0,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        productIds: included.flatMap((target) => target.productId ? [target.productId] : []),
        categoryIds: descendantsOf(included.flatMap((target) => target.categoryId ? [target.categoryId] : [])),
        excludedProductIds: excluded.flatMap((target) => target.productId ? [target.productId] : []),
        excludedCategoryIds: descendantsOf(excluded.flatMap((target) => target.categoryId ? [target.categoryId] : [])),
      };
    }).filter((promotion) => promotion.value > 0 && new Date(promotion.startsAt) <= now && new Date(promotion.endsAt) >= now);
  }

  private promotionData(input: Input) {
    const name = String(input.name || "").trim();
    if (!name) throw new BadRequestException("Tên khuyến mãi không được để trống.");
    const typeValue = String(input.type || "");
    const type = enumValue(typeValue, ["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING", "GIFT", "POINTS"], /tiền|amount/i.test(typeValue) ? "FIXED_AMOUNT" : /ship/i.test(typeValue) ? "FREE_SHIPPING" : /quà|gift/i.test(typeValue) ? "GIFT" : /điểm|points/i.test(typeValue) ? "POINTS" : "PERCENTAGE");
    const start = parsePromotionBoundary(input.startsAt || input.startAt || input.startDate, "start");
    const end = parsePromotionBoundary(input.endsAt || input.endAt || input.endDate, "end", new Date(start.getTime() + 30 * 86400000));
    const now = new Date();
    const status = enumValue(input.status, ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED"], start > now ? "SCHEDULED" : end < now ? "ENDED" : "ACTIVE");
    const rawValue = input.value ?? input.discountValue ?? input.discount;
    return { name, description: input.description || null, type: type as any, code: input.code ? String(input.code).trim().toUpperCase() : null, value: Number(String(rawValue || "").replace(/[^0-9.]/g, "")) || null, startsAt: start, endsAt: end, status: status as any, usageLimit: Number(input.usageLimit ?? input.codeLimit) || null, autoEndAtLimit: Boolean(input.autoEndAtLimit ?? input.autoEnd), minimumOrder: Number(input.minimumOrder ?? input.minOrder) || null, conditions: input.conditions ?? undefined, visible: input.visible !== false, imageUrl: input.imageUrl || input.image || null };
  }

  async savePromotion(input: Input, id?: string) {
    const data = this.promotionData(input);
    const productTokens = Array.isArray(input.productIds) ? input.productIds.map(String) : Array.isArray(input.products) ? input.products.map(String) : [];
    const categoryTokens = Array.isArray(input.categoryIds) ? input.categoryIds.map(String) : input.category ? [String(input.category)] : [];
    const excludedProductTokens = Array.isArray(input.excludedProductIds) ? input.excludedProductIds.map(String) : [];
    const excludedCategoryTokens = Array.isArray(input.excludedCategoryIds) ? input.excludedCategoryIds.map(String) : [];
    const [categories, products, excludedCategories, excludedProducts] = await Promise.all([
      categoryTokens.length ? this.prisma.category.findMany({ where: { OR: [{ id: { in: categoryTokens } }, { name: { in: categoryTokens } }] }, select: { id: true } }) : [],
      productTokens.length ? this.prisma.product.findMany({ where: { OR: [{ id: { in: productTokens } }, { sku: { in: productTokens } }, { name: { in: productTokens } }] }, select: { id: true } }) : [],
      excludedCategoryTokens.length ? this.prisma.category.findMany({ where: { OR: [{ id: { in: excludedCategoryTokens } }, { name: { in: excludedCategoryTokens } }] }, select: { id: true } }) : [],
      excludedProductTokens.length ? this.prisma.product.findMany({ where: { OR: [{ id: { in: excludedProductTokens } }, { sku: { in: excludedProductTokens } }, { name: { in: excludedProductTokens } }] }, select: { id: true } }) : [],
    ]);
    const targets = [...categories.map((item) => ({ categoryId: item.id })), ...products.map((item) => ({ productId: item.id })), ...excludedCategories.map((item) => ({ categoryId: item.id, excluded: true })), ...excludedProducts.map((item) => ({ productId: item.id, excluded: true }))];
    try {
      const promotion = id
        ? await this.prisma.promotion.update({ where: { id }, data: { ...data, targets: { deleteMany: {}, ...(targets.length ? { create: targets } : {}) } }, include: { targets: { include: { category: true, product: true } }, _count: { select: { usages: true } } } })
        : await this.prisma.promotion.create({ data: { ...data, ...(targets.length ? { targets: { create: targets } } : {}) }, include: { targets: { include: { category: true, product: true } }, _count: { select: { usages: true } } } });
      this.publishCatalogChange("promotion", id ? "updated" : "created", promotion.id);
      return promotion;
    } catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy khuyến mãi."); if (error?.code === "P2002") throw new ConflictException("Mã khuyến mãi đã tồn tại."); throw error; }
  }

  async deletePromotion(id: string) {
    try { await this.prisma.promotion.delete({ where: { id } }); this.publishCatalogChange("promotion", "deleted", id); return { deleted: true }; }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy khuyến mãi."); throw error; }
  }

  posts(query: Record<string, string>) {
    const where: Input = {};
    if (query.all !== "true") where.status = "PUBLISHED";
    if (query.status) where.status = query.status;
    if (query.search) where.OR = [{ title: { contains: query.search, mode: "insensitive" } }, { summary: { contains: query.search, mode: "insensitive" } }, { content: { contains: query.search, mode: "insensitive" } }];
    if (query.category) where.category = query.category;
    const take = Math.min(Math.max(Number(query.limit) || 500, 1), 500);
    const skip = Math.min(Math.max(Math.floor(Number(query.offset) || 0), 0), 1_000_000);
    if (query.view === "storefront-journal") return Promise.all([
      this.prisma.blogPost.findMany({
        where,
        select: { id: true, slug: true, title: true, summary: true, category: true, tags: true, content: true, coverImageUrl: true, publishedAt: true, createdAt: true, views: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, sortOrder: true } } },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], take, skip,
      }),
      this.prisma.blogPost.count({ where }),
      this.prisma.blogPost.groupBy({ by: ["category"], where: { status: "PUBLISHED" }, _count: { _all: true } }),
      this.prisma.siteSetting.findUnique({ where: { key: "blogCategories" }, select: { value: true } }),
    ]).then(([rows, total, categoryRows, savedCategories]) => {
      const categories = new Map<string, number>(categoryRows.map((row) => [row.category?.trim() || "Chuyện GEME", row._count._all]));
      for (const category of Array.isArray(savedCategories?.value) ? savedCategories.value : []) {
        if (typeof category === "string" && category.trim() && !categories.has(category.trim())) categories.set(category.trim(), 0);
      }
      return {
        posts: rows.map(({ content, ...post }) => ({
        ...post,
        readingMinutes: Math.max(1, Math.ceil(content.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim().split(/\s+/).filter(Boolean).length / 200)),
      })),
      total,
      categories: [...categories.entries()].sort(([left], [right]) => left.localeCompare(right, "vi")).map(([name, count]) => ({ name, count })),
      };
    });
    if (query.view === "sitemap") return this.prisma.blogPost.findMany({
      where,
      select: { slug: true, createdAt: true, updatedAt: true, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], take, skip,
    });
    if (query.view === "storefront-list") return this.prisma.blogPost.findMany({
      where,
      select: { id: true, slug: true, title: true, summary: true, category: true, tags: true, coverImageUrl: true, publishedAt: true, createdAt: true, updatedAt: true, views: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, sortOrder: true } } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }], take, skip,
    });
    if (query.view === "admin-summary") return this.prisma.blogPost.findMany({
      where,
      select: { id: true, title: true, summary: true, category: true, status: true, publishedAt: true, createdAt: true, coverImageUrl: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take, skip,
    });
    return this.prisma.blogPost.findMany({ where, include: { images: { orderBy: { sortOrder: "asc" } }, author: { select: { displayName: true } } }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take, skip })
      .then((rows) => rows.map((post) => ({ ...post, content: sanitizeBlogHtml(post.content) })));
  }

  async post(slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, status: "PUBLISHED" }, include: { images: { orderBy: { sortOrder: "asc" } }, author: { select: { displayName: true } } } });
    if (!post) throw new NotFoundException("Không tìm thấy bài viết.");
    await this.prisma.blogPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } });
    return { ...post, content: sanitizeBlogHtml(post.content) };
  }

  async blogArticle(slug: string) {
    const [post, recentPosts, categoryRows, savedCategories] = await Promise.all([
      this.prisma.blogPost.findFirst({ where: { slug, status: "PUBLISHED" }, include: { images: { orderBy: { sortOrder: "asc" } }, author: { select: { displayName: true } } } }),
      this.prisma.blogPost.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, slug: true, title: true, category: true, coverImageUrl: true, publishedAt: true, createdAt: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, sortOrder: true } } },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 6,
      }),
      this.prisma.blogPost.groupBy({ by: ["category"], where: { status: "PUBLISHED" }, _count: { _all: true } }),
      this.prisma.siteSetting.findUnique({ where: { key: "blogCategories" }, select: { value: true } }),
    ]);
    if (!post) throw new NotFoundException("Không tìm thấy bài viết.");
    void this.prisma.blogPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
    const posts = recentPosts
      .filter((item) => item.id !== post.id)
      .sort((a, b) => Number(b.category === post.category) - Number(a.category === post.category))
      .slice(0, 4);
    const categories = new Map<string, number>(categoryRows.map((row) => [row.category?.trim() || "Chuyện GEME", row._count._all]));
    for (const category of Array.isArray(savedCategories?.value) ? savedCategories.value : []) {
      if (typeof category === "string" && !categories.has(category)) categories.set(category, 0);
    }
    return { post: { ...post, content: sanitizeBlogHtml(post.content) }, posts, categories: [...categories.entries()].sort(([a], [b]) => a.localeCompare(b, "vi")).map(([name, count]) => ({ name, count })) };
  }

  async savePost(input: Input, id?: string) {
    const title = String(input.title || input.name || "").trim();
    let content = String(input.content || "");
    if (!title || !content) throw new BadRequestException("Bài viết cần tiêu đề và nội dung.");
    const statusValue = String(input.status || "DRAFT");
    const status = enumValue(statusValue, ["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"], /xuất bản|published/i.test(statusValue) ? "PUBLISHED" : /lên lịch|scheduled/i.test(statusValue) ? "SCHEDULED" : "DRAFT");
    const storeImage = async (url: string, alt?: string | null) => {
      const match = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
      if (!match) return url;
      const mimeType = match[1].toLocaleLowerCase();
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new BadRequestException("Ảnh blog phải nhỏ hơn 8 MB.");
      if (!hasMediaSignature(mimeType, bytes)) throw new BadRequestException("Nội dung ảnh blog không khớp định dạng đã khai báo.");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
      const asset = await this.mediaStore.save({
        filename: `blog-${digest}.${extension}`,
        sourceKey: `blog/${digest}.${extension}`,
        mimeType,
        bytes,
        alt: alt?.slice(0, 240) || null,
        updateExisting: true,
      });
      return asset.url;
    };
    const rawCover = String(input.coverImageUrl || input.cover || input.images?.[0]?.url || input.images?.[0] || "") || null;
    const imageEntries = (Array.isArray(input.images) ? input.images : rawCover ? [rawCover] : [])
      .map((item: unknown) => typeof item === "string" ? { url: item, alt: "" } : item && typeof item === "object" && typeof (item as Input).url === "string" ? { url: String((item as Input).url), alt: String((item as Input).alt || "") } : null)
      .filter((item): item is { url: string; alt: string } => Boolean(item?.url))
      .slice(0, 12);
    const rawImages = imageEntries.map((item) => item.url);
    const imageAlts = new Map(imageEntries.map((item) => [item.url, item.alt]));
    const inlineImageAlts = new Map<string, string>();
    for (const tag of content.matchAll(/<img\b[^>]*>/gi)) {
      const src = tag[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
      const alt = tag[0].match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (src && alt) inlineImageAlts.set(src, alt);
    }
    const images = await Promise.all(rawImages.map((url) => storeImage(url, imageAlts.get(url) || inlineImageAlts.get(url) || title)));
    const imageRows = images.map((url, sortOrder) => ({
      url,
      alt: imageEntries[sortOrder]?.alt?.slice(0, 240) || (rawImages[sortOrder] === rawCover ? String(input.coverImageAlt || "").slice(0, 240) : "") || inlineImageAlts.get(rawImages[sortOrder])?.slice(0, 240) || null,
      sortOrder,
    }));
    const imageSources = new Set([...content.matchAll(/data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+/gi)].map((match) => match[0]));
    const storedSources = new Map<string, string>();
    await Promise.all([...imageSources].map(async (url) => storedSources.set(url, await storeImage(url, title))));
    for (const [source, target] of storedSources) content = content.split(source).join(target);
    const coverAlt = String(input.coverImageAlt || imageAlts.get(rawCover || "") || inlineImageAlts.get(rawCover || "") || title);
    const coverImageUrl = rawCover ? await storeImage(rawCover, coverAlt) : images[0] || null;
    content = sanitizeBlogHtml(content);
    if (content.length > 1_000_000) throw new BadRequestException("Nội dung bài viết vượt quá giới hạn 1 MB.");
    const data = { title, slug: slugify(input.slug || title), summary: input.summary || null, category: input.category || null, tags: Array.isArray(input.tags) ? input.tags.map(String) : [], content, coverImageUrl, status: status as any, seoTitle: input.seoTitle || null, seoDescription: input.seoDescription || null, publishedAt: status === "PUBLISHED" ? parseDate(input.publishedAt || input.date) : null };
    try {
      const post = id
        ? await this.prisma.blogPost.update({ where: { id }, data: { ...data, images: { deleteMany: {}, create: imageRows } }, include: { images: { orderBy: { sortOrder: "asc" } } } })
        : await this.prisma.blogPost.create({ data: { ...data, images: { create: imageRows } }, include: { images: { orderBy: { sortOrder: "asc" } } } });
      this.publishCatalogChange("blog", id ? "updated" : "created", post.id);
      return post;
    } catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy bài viết."); if (error?.code === "P2002") throw new ConflictException("Slug bài viết đã tồn tại."); throw error; }
  }

  async deletePost(id: string) {
    try { await this.prisma.blogPost.delete({ where: { id } }); this.publishCatalogChange("blog", "deleted", id); return { deleted: true }; }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy bài viết."); throw error; }
  }

  async settings() {
    const rows = await this.prisma.siteSetting.findMany();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async publicSettings() {
    const publicKeys = ["banners", "footerContent", "catalogEditorialPromos", "newArrivalsMedia", "address", "addressNote", "phone", "supportEmail", "openingHours", "socialLinks", "blogCategories"];
    const rows = await this.prisma.siteSetting.findMany({ where: { key: { in: publicKeys } }, select: { key: true, value: true } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async storefrontSalesOverview() {
    const from = new Date(Date.now() - 30 * 86400000);
    const to = new Date();
    const products = await this.prisma.$queryRaw<Array<{ sku: string; sold: number }>>`
      SELECT i.product_sku AS sku, COALESCE(SUM(i.quantity), 0)::int AS sold
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
      GROUP BY i.product_sku
    `;
    return { products };
  }

  mediaAssets() {
    return this.prisma.mediaAsset.findMany({
      select: { id: true, filename: true, sourceKey: true, mimeType: true, size: true, alt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async saveMedia(input: Input) {
    const filename = String(input.filename || "image.webp").replace(/[\\/\r\n\0]/g, "_").slice(0, 240);
    const mimeType = String(input.mimeType || "").toLocaleLowerCase();
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mimeType) && !/^video\/(mp4|webm)$/.test(mimeType) && mimeType !== "application/pdf") throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPG, WebP, GIF, AVIF, video MP4/WebM hoặc PDF.");
    const raw = String(input.base64 || input.data || "");
    const encoded = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new BadRequestException("Dữ liệu media không hợp lệ.");
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new BadRequestException("Tệp phải nhỏ hơn hoặc bằng 8 MB.");
    if (!hasMediaSignature(mimeType, bytes)) throw new BadRequestException("Nội dung tệp không khớp với định dạng đã khai báo.");

    const sourceKey = input.sourceKey ? String(input.sourceKey).replace(/^\/+/, "").slice(0, 500) : null;
    const isPrivate = input.isPrivate === true || mimeType === "application/pdf";
    const asset = await this.mediaStore.save({
      filename,
      sourceKey,
      mimeType,
      isPrivate,
      bytes,
      alt: input.alt ? String(input.alt).slice(0, 240) : null,
      updateExisting: true,
    });
    return asset;
  }

  async saveSettings(input: Record<string, unknown>) {
    await this.prisma.$transaction(Object.entries(input).map(([key, value]) => this.prisma.siteSetting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } })));
    this.publishCatalogChange("settings", "updated");
    return this.settings();
  }

  async report(query: Record<string, string>) {
    const from = parseReportDate(query.from, new Date(Date.now() - 30 * 86400000), "start");
    const to = parseReportDate(query.to, new Date(), "end");
    const orderWhere = { placedAt: { gte: from, lte: to }, status: { not: "CANCELLED" as const } };
    const [orderStats, customerCount, newCustomers, productCount, productsSold, cashStats, refundStats, returnedGoodsStats, codUnreconciledStats, codRemittanceStats, timeline, categories, products, payments, salesChannels, promotionPerformance, topOrders] = await Promise.all([
      this.prisma.order.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.customer.count({ where: { createdAt: { lte: to } } }),
      this.prisma.customer.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.product.count({ where: { status: { not: "ARCHIVED" } } }),
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COALESCE(SUM(i.quantity), 0)::int AS count
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text IN ('PROCESSING','SHIPPING','DELIVERED')
      `,
      this.prisma.$queryRaw<Array<{ captured: number }>>`
        SELECT COALESCE(SUM(p.amount), 0)::numeric AS captured
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.paid_at >= ${from} AND p.paid_at <= ${to}
          AND p.status::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
      `,
      this.prisma.$queryRaw<Array<{ refunded: number }>>`
        SELECT COALESCE(SUM(r.amount), 0)::numeric AS refunded
        FROM payment_refunds r
        WHERE r.created_at >= ${from} AND r.created_at <= ${to}
      `,
      this.prisma.$queryRaw<Array<{ returned: unknown }>>`
        WITH returned_lines AS (
          SELECT r.id AS return_id, r.received_at, ri.order_item_id, oi.line_total, oi.quantity AS purchased_quantity,
                 ri.quantity AS returned_quantity,
                 COALESCE(SUM(ri.quantity) OVER (
                   PARTITION BY ri.order_item_id
                   ORDER BY r.received_at, r.created_at, r.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                 ), 0)::int AS quantity_before
          FROM order_returns r
          JOIN order_return_items ri ON ri.return_id = r.id
          JOIN order_items oi ON oi.id = ri.order_item_id
          WHERE r.status::text IN ('RECEIVED','CLOSED') AND r.received_at <= ${to}
        )
        SELECT COALESCE(SUM(
          FLOOR(line_total * (quantity_before + returned_quantity) / NULLIF(purchased_quantity, 0))
          - FLOOR(line_total * quantity_before / NULLIF(purchased_quantity, 0))
        ), 0)::numeric AS returned
        FROM returned_lines
        WHERE received_at >= ${from} AND received_at <= ${to}
      `,
      // Delivered COD without a non-reversed statement is unverified carrier
      // collection, not recognized cash.
      this.prisma.$queryRaw<Array<{ amount: unknown }>>`
        SELECT COALESCE(SUM(GREATEST(COALESCE(o.carrier_cod_amount, o.total_amount), 0)), 0)::numeric AS amount
        FROM orders o
        WHERE o.placed_at <= ${to}
          AND (o.status::text = 'DELIVERED' OR o.carrier_shipment_status = 'DELIVERED')
          AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.method::text = 'COD')
          AND NOT EXISTS (
            SELECT 1 FROM cod_reconciliation_items i
            JOIN cod_reconciliation_batches b ON b.id = i.batch_id
            WHERE i.order_id = o.id AND b.status::text <> 'REVERSED'
          )
      `,
      // A null remittance on a historical batch is unknown, never inferred as
      // zero or reconstructed from delivery status.
      this.prisma.$queryRaw<Array<{ outstanding: unknown; unverifiedLines: number }>>`
        SELECT COALESCE(SUM((i.received_amount - i.carrier_fee) - i.remitted_amount), 0)::numeric AS outstanding,
               COUNT(*) FILTER (WHERE i.remitted_amount IS NULL)::int AS "unverifiedLines"
        FROM cod_reconciliation_items i
        JOIN cod_reconciliation_batches b ON b.id = i.batch_id
        WHERE b.statement_date <= ${to}::date AND b.status::text <> 'REVERSED'
      `,
      this.prisma.$queryRaw<Array<{ date: string; revenue: number; orders: number }>>`
        WITH cash AS (
          SELECT (p.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, SUM(p.amount) AS amount
          FROM payments p
          WHERE p.paid_at >= ${from} AND p.paid_at <= ${to} AND p.status::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
          GROUP BY 1
        ), refunds AS (
          SELECT (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, SUM(r.amount) AS amount
          FROM payment_refunds r
          WHERE r.created_at >= ${from} AND r.created_at <= ${to}
          GROUP BY 1
        ), daily_orders AS (
          SELECT (o.placed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*)::int AS count
          FROM orders o WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
          GROUP BY 1
        )
        SELECT TO_CHAR(COALESCE(c.day, r.day, d.day), 'YYYY-MM-DD') AS date,
               (COALESCE(c.amount, 0) - COALESCE(r.amount, 0))::numeric AS revenue,
               COALESCE(d.count, 0)::int AS orders
        FROM cash c FULL OUTER JOIN refunds r ON r.day = c.day
        FULL OUTER JOIN daily_orders d ON d.day = COALESCE(c.day, r.day)
        ORDER BY COALESCE(c.day, r.day, d.day)
      `,
      this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>`
        SELECT COALESCE(c.name, 'Không phân loại') AS name,
               COALESCE(SUM(i.line_total), 0)::numeric AS revenue
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        LEFT JOIN products p ON p.id = i.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text IN ('PROCESSING','SHIPPING','DELIVERED')
        GROUP BY COALESCE(c.name, 'Không phân loại')
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<Array<{ product: string; sku: string; image: string; sold: number; revenue: number; category: string }>>`
        SELECT i.product_name AS product, i.product_sku AS sku,
               COALESCE(image.url, '') AS image,
               SUM(i.quantity)::int AS sold,
               COALESCE(SUM(i.line_total), 0)::numeric AS revenue,
               COALESCE(c.name, 'Không phân loại') AS category
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        LEFT JOIN products p ON p.id = i.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN LATERAL (
          SELECT pi.url FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.is_primary DESC, pi.sort_order ASC
          LIMIT 1
        ) image ON TRUE
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text IN ('PROCESSING','SHIPPING','DELIVERED')
        GROUP BY i.product_id, i.product_name, i.product_sku, image.url, c.name
        ORDER BY revenue DESC
        LIMIT 20
      `,
      this.prisma.$queryRaw<Array<{ method: string; amount: number }>>`
        WITH captured AS (
          SELECT p.method::text AS method, SUM(p.amount) AS amount
          FROM payments p WHERE p.paid_at >= ${from} AND p.paid_at <= ${to}
            AND p.status::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY p.method
        ), refunded AS (
          SELECT p.method::text AS method, SUM(r.amount) AS amount
          FROM payment_refunds r JOIN payments p ON p.id = r.payment_id
          WHERE r.created_at >= ${from} AND r.created_at <= ${to} GROUP BY p.method
        )
        SELECT COALESCE(c.method, r.method) AS method,
               (COALESCE(c.amount, 0) - COALESCE(r.amount, 0))::numeric AS amount
        FROM captured c FULL OUTER JOIN refunded r ON r.method = c.method
        ORDER BY amount DESC
      `,
      this.prisma.$queryRaw<Array<{ channel: string; revenue: number; orders: number }>>`
        WITH captured AS (
          SELECT CASE WHEN o.shipping_method = 'Bán trực tiếp tại cửa hàng' THEN 'Cửa hàng' ELSE 'Website' END AS channel,
                 SUM(p.amount) AS amount
          FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.paid_at >= ${from} AND p.paid_at <= ${to} AND p.status::text IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
          GROUP BY 1
        ), refunded AS (
          SELECT CASE WHEN o.shipping_method = 'Bán trực tiếp tại cửa hàng' THEN 'Cửa hàng' ELSE 'Website' END AS channel,
                 SUM(r.amount) AS amount
          FROM payment_refunds r JOIN payments p ON p.id = r.payment_id JOIN orders o ON o.id = p.order_id
          WHERE r.created_at >= ${from} AND r.created_at <= ${to} GROUP BY 1
        ), counts AS (
          SELECT CASE WHEN o.shipping_method = 'Bán trực tiếp tại cửa hàng' THEN 'Cửa hàng' ELSE 'Website' END AS channel,
                 COUNT(*)::int AS orders
          FROM orders o WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
          GROUP BY 1
        )
        SELECT COALESCE(c.channel, r.channel, n.channel) AS channel,
               (COALESCE(c.amount, 0) - COALESCE(r.amount, 0))::numeric AS revenue,
               COALESCE(n.orders, 0)::int AS orders
        FROM captured c FULL OUTER JOIN refunded r ON r.channel = c.channel
        FULL OUTER JOIN counts n ON n.channel = COALESCE(c.channel, r.channel)
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<Array<{ name: string; code: string | null; orders: number; discount: number }>>`
        SELECT p.name, p.code, COUNT(*)::int AS orders,
               COALESCE(SUM(u.discount_amount), 0)::numeric AS discount
        FROM promotion_usages u
        JOIN promotions p ON p.id = u.promotion_id
        JOIN orders o ON o.id = u.order_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text IN ('PROCESSING','SHIPPING','DELIVERED')
        GROUP BY p.id, p.name, p.code
        ORDER BY orders DESC, discount DESC
      `,
      this.prisma.$queryRaw<Array<{ code: string; customer: string; total: number; placedAt: Date }>>`
        SELECT o.code, o.customer_name AS customer,
               o.total_amount::numeric AS total, o.placed_at AS "placedAt"
        FROM orders o
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text IN ('PROCESSING','SHIPPING','DELIVERED')
        ORDER BY o.total_amount DESC, o.placed_at DESC
        LIMIT 5
      `,
    ]);
    const grossOrderValue = Number(orderStats._sum.totalAmount) || 0;
    const capturedPayments = Number(cashStats[0]?.captured) || 0;
    const refundAmount = Number(refundStats[0]?.refunded) || 0;
    const revenue = capturedPayments - refundAmount;
    const orderCount = orderStats._count._all;
    const toAdminMoney = <T extends Record<string, any>>(rows: T[], keys: (keyof T)[]) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, keys.includes(key as keyof T) && value != null ? Number(value) : value])) as T);
    return {
      from, to, revenue, capturedPayments, refundAmount, grossOrderValue, orderCount, customerCount, newCustomers, productCount,
      returnedGoodsValue: Number(returnedGoodsStats[0]?.returned) || 0,
      codUnreconciled: Number(codUnreconciledStats[0]?.amount) || 0,
      codRemittanceOutstanding: Number(codRemittanceStats[0]?.outstanding) || 0,
      codUnverifiedRemittanceLines: Number(codRemittanceStats[0]?.unverifiedLines) || 0,
      productsSold: Number(productsSold[0]?.count) || 0,
      averageOrderValue: orderCount ? Math.round(grossOrderValue / orderCount) : 0,
      timeline: toAdminMoney(timeline as any[], ["revenue"]),
      categories: toAdminMoney(categories as any[], ["revenue"]),
      products: toAdminMoney(products as any[], ["revenue"]),
      payments: toAdminMoney(payments as any[], ["amount"]),
      salesChannels: toAdminMoney(salesChannels as any[], ["revenue"]),
      promotionPerformance: toAdminMoney(promotionPerformance as any[], ["discount"]),
      topOrders: toAdminMoney(topOrders as any[], ["total"]),
    };
  }
}


