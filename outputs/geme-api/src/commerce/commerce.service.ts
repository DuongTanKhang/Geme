import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Observable, Subject, interval, merge, map } from "rxjs";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { Pos365Service } from "../pos365/pos365.service.js";

type Input = Record<string, any>;
const slugify = (value: string) => String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `item-${Date.now()}`;
const parseDate = (value: unknown, fallback = new Date()) => {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : fallback;
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
const includeStorefrontProduct = {
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true } },
  images: { orderBy: { sortOrder: "asc" as const }, take: 2, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { orderBy: { sortOrder: "asc" as const }, select: { id: true, sku: true, quality: true, beadSize: true, price: true, originalPrice: true, stock: true, imageUrls: true, videoUrl: true, sortOrder: true } },
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
  isNew: true,
  isFeatured: true,
  price: true,
  originalPrice: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  coverVideoUrl: true,
  stock: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true, sortOrder: true } },
  images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 2, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { select: { beadSize: true, price: true } },
} satisfies Prisma.ProductSelect;
const includeStorefrontProductDetail = {
  category: { select: { id: true, name: true, slug: true, kind: true, usage: true, level: true, parentId: true, status: true, sortOrder: true } },
  gemstoneType: { select: { id: true, name: true, slug: true } },
  materialOption: { select: { id: true, name: true, slug: true, scope: true, kind: true, active: true } },
  images: { orderBy: { sortOrder: "asc" as const }, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
  variants: { orderBy: { sortOrder: "asc" as const }, select: { id: true, sku: true, quality: true, beadSize: true, price: true, originalPrice: true, stock: true, imageUrls: true, videoUrl: true, sortOrder: true } },
  reviews: { where: { status: "APPROVED" as const }, orderBy: { createdAt: "desc" as const }, take: 30, select: { rating: true, title: true, content: true, createdAt: true, customer: { select: { name: true } } } },
};

@Injectable()
export class CommerceService implements OnModuleInit, OnModuleDestroy {
  private readonly catalogChanges = new Subject<{ data: { entity: string; action: string; id?: string; at: string } }>();
  private readonly logger = new Logger(CommerceService.name);
  private soldOutCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private categoryCache: { expiresAt: number; records: any[] } | null = null;
  private categoryLoad: Promise<any[]> | null = null;
  private categoryCacheVersion = 0;

  constructor(private readonly prisma: PrismaService, private readonly pos365: Pos365Service) {}

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
    this.soldOutCleanupTimer = setInterval(() => {
      void this.hideExpiredSoldOutListings().catch((error) => this.logger.error("Không thể tự ẩn bài đăng hết hàng đã quá 3 ngày.", error));
      void this.syncPromotionStatuses().catch((error) => this.logger.error("Không thể đồng bộ trạng thái khuyến mãi theo thời gian.", error));
    }, 60_000);
    this.soldOutCleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.soldOutCleanupTimer) clearInterval(this.soldOutCleanupTimer);
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
    const asset = await this.prisma.mediaAsset.upsert({
      where: { sourceKey },
      create: { filename, sourceKey, mimeType, data: new Uint8Array(bytes), size: bytes.length, alt: alt ? String(alt).slice(0, 240) : null },
      update: {},
      select: { id: true },
    });
    return `/media/${asset.id}`;
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
    this.catalogChanges.next({ data: { entity, action, ...(id ? { id } : {}), at: new Date().toISOString() } });
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

  async categories() {
    if (this.categoryCache && this.categoryCache.expiresAt > Date.now()) return this.categoryCache.records;
    if (this.categoryLoad) return this.categoryLoad;

    const version = this.categoryCacheVersion;
    const load = this.prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }).then((records) => {
      if (version === this.categoryCacheVersion) this.categoryCache = { records, expiresAt: Date.now() + 2_000 };
      return records;
    });
    this.categoryLoad = load;
    try {
      return await load;
    } finally {
      if (this.categoryLoad === load) this.categoryLoad = null;
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
      pricingMode: enumValue(input.pricingMode, ["FIXED", "QUALITY", "QUALITY_AND_BEAD_SIZE"], "FIXED") as any,
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
        if (status === "ACTIVE" && current.level === 2 && current.parentId) {
          const parent = await this.prisma.category.findUnique({ where: { id: current.parentId }, select: { status: true } });
          if (parent?.status !== "ACTIVE") throw new BadRequestException("Hãy hiện nhóm Trang sức trước khi hiện danh mục con.");
        }
        const category = await this.prisma.$transaction(async (tx) => {
          if (status === "INACTIVE") {
            const ids = [current.id];
            for (let index = 0; index < ids.length; index += 1) {
              const children = await tx.category.findMany({ where: { parentId: ids[index] }, select: { id: true } });
              ids.push(...children.map((child) => child.id));
            }
            await tx.category.updateMany({ where: { id: { in: ids } }, data: { status: "INACTIVE" } });
          } else {
            await tx.category.update({ where: { id }, data: { status } });
          }
          return tx.category.findUniqueOrThrow({ where: { id } });
        });
        this.invalidateCategoryCache();
        this.publishCatalogChange("category", "updated", category.id);
        return category;
      }
      const data = this.categoryData(input);
      await this.validateCategoryHierarchy(data, id);
      const category = await this.prisma.category.update({ where: { id }, data });
      this.invalidateCategoryCache();
      this.publishCatalogChange("category", "updated", category.id);
      return category;
    }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy danh mục."); if (error?.code === "P2002") throw new ConflictException("Slug danh mục đã tồn tại."); throw error; }
  }

  async deleteCategory(id: string) {
    await this.ensureRequiredJewelryCategories();
    const root = await this.prisma.category.findUnique({ where: { id }, select: { id: true, name: true, slug: true, kind: true, level: true, parentId: true } });
    if (!root) throw new NotFoundException("Không tìm thấy danh mục.");
    if (isRequiredJewelryRoot(root) || (root.parentId && requiredJewelryCategorySlugs.has(root.slug) && root.kind === "JEWELRY" && root.level === 2)) {
      throw new BadRequestException("Danh mục trang sức bắt buộc không được xóa; chỉ có thể ẩn hoặc hiện.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const ids = [id];
      for (let index = 0; index < ids.length; index += 1) {
        const children = await tx.category.findMany({ where: { parentId: ids[index] }, select: { id: true } });
        ids.push(...children.map((child) => child.id));
      }
      const hiddenProducts = await tx.product.updateMany({
        where: { categoryId: { in: ids } },
        data: { categoryId: null, status: "HIDDEN" },
      });
      const deletedCategories = await tx.category.deleteMany({ where: { id: { in: ids } } });
      return { deleted: true, deletedCategories: deletedCategories.count, hiddenProducts: hiddenProducts.count };
    });
    this.invalidateCategoryCache();
    this.publishCatalogChange("category", "deleted", id);
    return result;
  }

  private async validateCategoryHierarchy(data: Input, currentId?: string) {
    if (!data.parentId) {
      if (data.level !== 1) throw new BadRequestException("Danh mục cấp 2 hoặc cấp 3 phải có danh mục cha.");
      if (!currentId && data.kind === "JEWELRY" && data.slug !== "trang-suc") throw new BadRequestException("Nhóm cấp 1 của trang sức đã cố định là Trang sức.");
      return;
    }
    const parent = await this.prisma.category.findUnique({ where: { id: data.parentId }, select: { id: true, slug: true, kind: true, usage: true, level: true, status: true } });
    if (!parent || parent.status !== "ACTIVE" || parent.usage !== "PRODUCT_CATEGORY") throw new BadRequestException("Chọn danh mục cha đang hoạt động.");
    if (data.level !== parent.level + 1 || data.kind !== parent.kind) throw new BadRequestException("Cấp và nhóm của danh mục phải khớp với danh mục cha.");

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

  products(query: Record<string, string>) {
    const where: Input = {};
    if (query.all !== "true") where.status = "ACTIVE";
    if (["JEWELRY", "GEMSTONE"].includes(query.kind)) where.kind = query.kind;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.gemstoneTypeId) where.gemstoneTypeId = query.gemstoneTypeId;
    if (query.materialOptionId) where.materialOptionId = query.materialOptionId;
    if (query.new === "true") where.isNew = true;
    if (query.featured === "true") where.isFeatured = true;
    if (query.search) where.OR = [{ name: { contains: query.search, mode: "insensitive" } }, { sku: { contains: query.search, mode: "insensitive" } }];
    const orderBy = [{ isNew: "desc" as const }, { createdAt: "desc" as const }];
    const take = Math.min(Math.max(Number(query.limit) || 500, 1), 500);
    if (query.view === "storefront-list") {
      return this.prisma.product.findMany({ where, select: selectStorefrontListing, orderBy, take });
    }
    return this.prisma.product.findMany({ where, include: query.view === "storefront" ? includeStorefrontProduct : includeProduct, orderBy, take });
  }

  async product(slug: string) {
    const record = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, include: includeStorefrontProductDetail });
    if (!record) throw new NotFoundException("Không tìm thấy sản phẩm.");
    return record;
  }

  async relatedProducts(slug: string, limitInput?: string) {
    const source = await this.prisma.product.findFirst({
      where: { slug, status: "ACTIVE" },
      select: { id: true, kind: true, categoryId: true, materialOptionId: true },
    });
    if (!source) throw new NotFoundException("Không tìm thấy sản phẩm.");
    const matching: Input[] = [];
    if (source.categoryId) matching.push({ categoryId: source.categoryId });
    if (source.materialOptionId) matching.push({ materialOptionId: source.materialOptionId });
    if (!matching.length) return [];
    const limit = Math.min(Math.max(Number(limitInput) || 6, 1), 12);
    return this.prisma.product.findMany({
      where: { id: { not: source.id }, kind: source.kind, status: "ACTIVE", OR: matching },
      include: includeStorefrontProduct,
      orderBy: [{ isNew: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
  }

  private productData(input: Input) {
    const name = String(input.name || "").trim();
    const sku = String(input.sku || input.id || "").trim();
    const categoryId = String(input.categoryId || "").trim();
    if (!name || !sku || !categoryId) throw new BadRequestException("Cần có tên, SKU và danh mục sản phẩm.");
    const status = enumValue(input.status, ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"], /đã gỡ|archived/i.test(String(input.status)) ? "ARCHIVED" : /đang hoạt động|đang bán|đã xuất bản|active/i.test(String(input.status)) ? "ACTIVE" : /ẩn|hidden/i.test(String(input.status)) ? "HIDDEN" : "DRAFT");
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
      sku, name, slug: slugify(input.slug || name), kind: enumValue(input.kind || input.productType, ["JEWELRY", "GEMSTONE", "Trang sức", "Đá quý"], "JEWELRY").replace("Trang sức", "JEWELRY").replace("Đá quý", "GEMSTONE") as any,
      categoryId, gemstoneTypeId: input.gemstoneTypeId || null, materialOptionId: input.materialOptionId || null,
      description: input.description || null, fullDescription: input.fullDescription || null,
      ...(Object.prototype.hasOwnProperty.call(input, "coverVideoUrl") ? { coverVideoUrl: typeof input.coverVideoUrl === "string" ? input.coverVideoUrl.trim().slice(0, 2000) || null : null } : {}),
      technicalImageUrl: typeof input.technicalImageUrl === "string" ? input.technicalImageUrl.trim() || null : null,
      ...(Object.prototype.hasOwnProperty.call(input, "technicalVideoUrl") ? { technicalVideoUrl: typeof input.technicalVideoUrl === "string" ? input.technicalVideoUrl.trim().slice(0, 2000) || null : null } : {}),
      weightGrams,
      lengthCm: dimension("lengthCm"), widthCm: dimension("widthCm"), heightCm: dimension("heightCm"),
      status: status as any, isNew: Boolean(input.isNew), isFeatured: Boolean(input.isFeatured),
      price: Number(input.price) || null, originalPrice: Number(input.originalPrice) || null,
      seoTitle: input.seoTitle || null, seoDescription: input.seoDescription || null,
      kiotVietProductId: input.kiotVietProductId || null,
    };
  }

  async saveProduct(input: Input, id?: string) {
    const data = this.productData(input);
    if (data.materialOptionId) {
      const option = await this.prisma.materialOption.findUnique({ where: { id: data.materialOptionId }, select: { scope: true, active: true } });
      const expectedScope = data.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
      if (!option || !option.active || option.scope !== expectedScope) throw new BadRequestException("Loại đá hoặc chất liệu không thuộc đúng nhóm sản phẩm, hoặc đã bị ẩn.");
      const previous = id ? await this.prisma.product.findUnique({ where: { id }, select: { categoryId: true, materialOptionId: true } }) : null;
      const unchangedAssociation = previous?.categoryId === data.categoryId && previous.materialOptionId === data.materialOptionId;
      await this.assertCategoryAllowsMaterial(this.prisma, data.categoryId, data.materialOptionId, !unchangedAssociation);
    }
    const imageInputs = (Array.isArray(input.gallery) ? input.gallery : input.image ? [input.image] : []).filter((url: unknown) => typeof url === "string" && url.length > 0).slice(0, 10) as string[];
    const images = await Promise.all(imageInputs.map((url, index) => url.startsWith("data:image/") ? this.persistDataImageReference(url, `product-${data.sku}-${index + 1}.webp`, data.name) : url));
    if (data.technicalImageUrl?.startsWith("data:image/")) {
      data.technicalImageUrl = await this.persistDataImageReference(data.technicalImageUrl, `product-${data.sku}-technical.webp`, data.name);
    }
    const variants = Array.isArray(input.priceVariants) ? input.priceVariants : [];
    const variantCreate = await Promise.all(variants.map(async (variant: Input, index: number) => {
      const quality = String(variant.quality || "Standard").trim().slice(0, 40);
      const beadSize = String(variant.beadSize || "").trim().slice(0, 24) || null;
      const imageUrls = (Array.isArray(variant.imageUrls) ? variant.imageUrls : [])
        .filter((url: unknown) => typeof url === "string" && url.trim())
        .slice(0, 8);
      const savedImageUrls = await Promise.all(imageUrls.map((url: string, imageIndex: number) =>
        url.startsWith("data:image/") ? this.persistDataImageReference(url, `variant-${data.sku}-${index + 1}-${imageIndex + 1}.webp`, data.name) : url,
      ));
      const sku = String(variant.sku || "").trim();
      const videoUrl = String(variant.videoUrl || "").trim().slice(0, 2000) || null;
      if (!quality) throw new BadRequestException("Mỗi biến thể cần có thông tin chất lượng hoặc phân loại.");
      if (!sku || !sku.startsWith(data.sku) || sku.length > 64 || !/^[A-Za-z0-9]+$/.test(sku)) {
        throw new BadRequestException(`SKU biến thể ${quality}${beadSize ? ` · ${beadSize}` : ""} phải là mã chữ/số bắt đầu bằng SKU mẹ ${data.sku}.`);
      }
      return {
        optionKey: `${quality}::${beadSize || ""}`,
        quality, beadSize, sku,
        imageUrls: savedImageUrls,
        videoUrl,
        price: Number(variant.price) || 0, originalPrice: Number(variant.originalPrice) || null,
        sortOrder: index,
      };
    }));
    if (new Set(variantCreate.map((variant) => variant.sku.toLocaleUpperCase("en"))).size !== variantCreate.length) {
      throw new BadRequestException("SKU của các biến thể phải khác nhau.");
    }
    try {
      let priceChanged = !id;
      const result = await this.prisma.$transaction(async (tx) => {
        let record: any;
        if (data.status === "ACTIVE") {
          if (!id) throw new BadRequestException("Để đăng bán, hãy chọn một SKU đã có trong kho.");
          const current = await tx.product.findUnique({ where: { id }, select: { status: true, stock: true, variants: { select: { stock: true } } } });
          if (!current) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
          const availableStock = current.variants.length ? current.variants.reduce((sum, variant) => sum + variant.stock, 0) : current.stock;
          if (current.status !== "ACTIVE" && availableStock <= 0) throw new BadRequestException("Chỉ có thể đăng bán SKU đang còn hàng trong kho.");
          const prices = variantCreate.length ? variantCreate.map((variant) => variant.price) : [Number(data.price) || 0];
          if (!prices.length || prices.some((price) => price <= 0)) throw new BadRequestException("Hãy điền giá bán trong Hồ sơ giá trước khi đăng sản phẩm.");
        }
        if (id) {
          const currentPriceData = await tx.product.findUnique({ where: { id }, select: { price: true, variants: { select: { id: true, optionKey: true, sku: true, price: true } } } });
          if (!currentPriceData) throw new NotFoundException("Không tìm thấy sản phẩm trong kho.");
          const currentVariantsByKey = new Map(currentPriceData.variants.map((variant) => [variant.optionKey, variant]));
          priceChanged = Number(currentPriceData.price ?? 0) !== Number(data.price ?? 0)
            || variantCreate.some((variant) => Number(currentVariantsByKey.get(variant.optionKey)?.price ?? 0) !== Number(variant.price));
          const nextPrices = variantCreate.length ? variantCreate.map((variant) => variant.price) : [Number(data.price) || 0];
          const allPricesConfigured = nextPrices.length > 0 && nextPrices.every((price) => Number.isFinite(price) && price > 0);
          const posPriceSyncFields = priceChanged ? {
            pos365PriceSyncStatus: allPricesConfigured ? (this.pos365.isSyncEnabled() ? "PENDING" : "DISABLED") : "NEEDS_PRICE",
            pos365PriceSyncAttempts: 0,
            pos365PriceSyncLastAttemptAt: null,
            pos365PriceSyncNextAttemptAt: allPricesConfigured && this.pos365.isSyncEnabled() ? new Date() : null,
            pos365PriceSyncedAt: null,
            pos365PriceSyncError: allPricesConfigured ? null : "Cần điền giá bán cho toàn bộ SKU/biến thể trong Hồ sơ giá.",
          } : {};
          await tx.product.update({ where: { id }, data: { ...data, ...posPriceSyncFields, images: { deleteMany: {}, create: images.map((url: string, index: number) => ({ url, alt: data.name, sortOrder: index, isPrimary: index === 0 })) } } });
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
              await tx.productPriceVariant.update({ where: { id: existing.id }, data: { sku: variant.sku, quality: variant.quality, beadSize: variant.beadSize, imageUrls: variant.imageUrls, videoUrl: variant.videoUrl, price: variant.price, originalPrice: variant.originalPrice, sortOrder: variant.sortOrder } });
            }
          }
          record = await tx.product.findUniqueOrThrow({ where: { id }, include: includeProduct });
        } else {
          throw new BadRequestException("Hãy tạo SKU trong Quản lý tồn kho trước, sau đó chọn SKU đó để tạo bài đăng sản phẩm.");
        }
        return record;
      });
      if (priceChanged && result.pos365PriceSyncStatus === "PENDING") await this.pos365.syncProductPricesNow(result.id);
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

  async deleteProduct(id: string, input: Input = {}) {
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
          action: "PRODUCT_HARD_DELETED", entityType: "Product", entityId: current.id,
          before: {
            id: current.id, sku: current.sku, name: current.name, status: current.status, stock: current.stock,
            variants: current.variants.map((variant) => ({ id: variant.id, sku: variant.sku, quality: variant.quality, beadSize: variant.beadSize, stock: variant.stock })),
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
    const [products, soldItems, movements] = await Promise.all([
      this.prisma.product.findMany({
        include: {
          category: { select: { id: true, name: true } },
          gemstoneType: { select: { id: true, name: true } },
          materialOption: { select: { id: true, name: true, kind: true, scope: true } },
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, select: { url: true, alt: true } },
          variants: { orderBy: { sortOrder: "asc" }, select: { id: true, sku: true, quality: true, beadSize: true, stock: true, sortOrder: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: 1000,
      }),
      this.prisma.orderItem.findMany({
        where: { order: { placedAt: { gte: monthStart }, status: { not: "CANCELLED" } } },
        select: { productId: true, quantity: true },
      }),
      this.inventoryMovements("8"),
    ]);
    const soldByProduct = new Map<string, number>();
    for (const item of soldItems) if (item.productId) soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + item.quantity);
    return {
      products: products.map((product) => ({
        ...product,
        stock: product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock,
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
    const categories = categoryIds.length ? await this.prisma.category.findMany({ where: { id: { in: categoryIds }, status: "ACTIVE" }, select: { id: true, kind: true, usage: true, level: true } }) : [];
    if (categories.length !== categoryIds.length || categories.some((category) => category.usage !== "PRODUCT_CATEGORY" || category.level < 2)) {
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
      const prefix = this.cleanSkuPrefix(rule.prefix);
      const hasMaterialList = Array.isArray(rule.materialOptionIds);
      const materialOptionIds = hasMaterialList
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
      const materialPrefixes = Array.isArray(rule.materialPrefixes) ? rule.materialPrefixes.map((entry: Input) => {
        const material = materials.find((item) => item.id === String(entry.materialOptionId || ""));
        if (!material || material.scope !== expectedScope) throw new BadRequestException("Loại đá phải đang hoạt động và thuộc đúng nhóm danh mục.");
        if (hasMaterialList && !materialOptionIds!.includes(material.id)) throw new BadRequestException("Chỉ cấu hình tiền tố cho loại đá đã chọn áp dụng trong danh mục.");
        return { materialOptionId: material.id, prefix: this.cleanSkuPrefix(entry.prefix) };
      }) : [];
      if (new Set(materialPrefixes.map((entry: Input) => entry.materialOptionId)).size !== materialPrefixes.length) throw new BadRequestException("Một loại đá chỉ được cấu hình một tiền tố trong mỗi danh mục.");
      return { categoryId: category.id, prefix, ...(hasMaterialList ? { materialOptionIds } : {}), materialPrefixes };
    });
    if (new Set(normalized.map((rule: Input) => rule.categoryId)).size !== normalized.length) throw new BadRequestException("Mỗi danh mục chỉ được có một quy tắc mã hàng.");
    const expandedPrefixes = normalized.flatMap((rule: Input) => [rule.prefix, ...rule.materialPrefixes.map((entry: Input) => `${rule.prefix}${entry.prefix}`)]);
    if (new Set(expandedPrefixes).size !== expandedPrefixes.length) throw new BadRequestException("Các tiền tố mã hàng bị trùng nhau. Hãy chọn mã khác để tránh trùng SKU.");
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

  async inventoryReceipt(id: string) {
    const receipt = await this.prisma.inventoryReceipt.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          include: { variant: { select: { sku: true, quality: true, beadSize: true } } },
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
          const unitPrice = Number(variant?.price ?? product.price ?? 0);
          const lineTotal = unitPrice * item.quantity;
          if (!Number.isSafeInteger(lineTotal) || lineTotal > 100000000000000) throw new BadRequestException("Giá trị dòng xuất vượt giới hạn.");
          const variantLabel = variant ? [variant.quality, variant.beadSize].filter(Boolean).join(" · ") || null : null;
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
                variantLabel: [variant.quality, variant.beadSize].filter(Boolean).join(" · ") || null,
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
    const category = await client.category.findUnique({ where: { id: categoryId }, select: { status: true, usage: true, level: true } });
    if (!category || category.status !== "ACTIVE" || category.usage !== "PRODUCT_CATEGORY" || category.level < 2) {
      throw new BadRequestException("Chỉ tạo quy tắc cho danh mục sản phẩm đang hoạt động đã được tạo.");
    }
    const setting = await client.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
    const rules = Array.isArray(setting?.value) ? setting.value as Input[] : [];
    const rule = rules.find((candidate) => candidate.categoryId === categoryId);
    if (!rule) throw new BadRequestException("Danh mục này chưa có quy tắc mã hàng. Hãy tạo quy tắc trước khi nhập sản phẩm mới.");
    if (materialOptionId) await this.assertCategoryAllowsMaterial(client, categoryId, materialOptionId);
    if (!materialOptionId) return this.cleanSkuPrefix(rule.prefix);
    const stoneRule = Array.isArray(rule.materialPrefixes) ? rule.materialPrefixes.find((entry: Input) => entry.materialOptionId === materialOptionId) : undefined;
    // Stone prefixes are optional. Newly created stones can use the category prefix;
    // the sequence allocator still guarantees a unique SKU across the category.
    if (!stoneRule) return this.cleanSkuPrefix(rule.prefix);
    return `${this.cleanSkuPrefix(rule.prefix)}${this.cleanSkuPrefix(stoneRule.prefix)}`;
  }

  private productSkuForSequence(prefix: string, rawSequence: unknown) {
    const sequence = String(rawSequence ?? "").trim();
    if (!/^\d+$/.test(sequence)) throw new BadRequestException("Nhập số thứ tự SKU bằng chữ số nguyên dương.");
    const numericSequence = BigInt(sequence);
    if (numericSequence <= 0n) throw new BadRequestException("Số thứ tự SKU phải là số nguyên dương lớn hơn 0.");
    if (prefix.length + sequence.length > 64) throw new BadRequestException("Số thứ tự quá dài so với giới hạn mã SKU.");
    return `${prefix}${sequence}`;
  }

  async nextInventorySku(categoryId: string, materialOptionId?: string, sequence?: string) {
    if (!categoryId) throw new BadRequestException("Chọn danh mục để tạo mã hàng.");
    const prefix = await this.skuPrefixFor(this.prisma, categoryId, materialOptionId);
    if (sequence === undefined || sequence === "") {
      const [product, variant] = await Promise.all([
        this.prisma.product.findUnique({ where: { sku: prefix }, select: { id: true, name: true, stock: true, variants: { select: { id: true, stock: true } } } }),
        this.prisma.productPriceVariant.findUnique({ where: { sku: prefix }, select: { id: true, product: { select: { sku: true, name: true } } } }),
      ]);
      return {
        prefix,
        sku: prefix,
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
          const beadSize = String(variant.beadSize || "").trim().slice(0, 24);
            const sku = String(variant.sku || "").trim();
          const quantity = Number(variant.quantity);
          const unitCost = Number(variant.unitCost);
            if (!quality) throw new BadRequestException("Mỗi biến thể cần có chất lượng hoặc phân loại.");
            if (!sku || sku.length > 64 || !/^[A-Za-z0-9]+$/.test(sku)) throw new BadRequestException("Mỗi biến thể cần có SKU con chỉ gồm chữ và số.");
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng mỗi biến thể phải từ 1 đến 100.000.");
          if (!Number.isInteger(unitCost) || unitCost < 0 || unitCost > 1000000000000) throw new BadRequestException("Đơn giá nhập của biến thể phải là số nguyên không âm hợp lệ.");
          const optionKey = `${quality}::${beadSize}`;
          if (seen.has(optionKey)) throw new BadRequestException("Không thể nhập trùng một tổ hợp biến thể.");
          if (seenSkus.has(sku.toLocaleUpperCase("en"))) throw new BadRequestException("Không thể nhập trùng một SKU con trong cùng mặt hàng.");
          seen.add(optionKey);
          seenSkus.add(sku.toLocaleUpperCase("en"));
            return { quality, beadSize: beadSize || null, sku, quantity, unitCost, optionKey };
        });
        const quantity = variants.reduce((sum, variant) => sum + variant.quantity, 0);
        const lineTotal = variants.reduce((sum, variant) => sum + variant.quantity * variant.unitCost, 0);
        if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(lineTotal)) throw new BadRequestException("Tổng số lượng hoặc tiền hàng vượt giới hạn.");
        return { ...item, quantity, unitCost: 0, lineTotal, newProduct: { ...item.newProduct, variants } };
      }
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unitCost);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new BadRequestException("Số lượng mỗi mặt hàng phải từ 1 đến 100.000.");
      if (!Number.isInteger(unitCost) || unitCost < 0 || unitCost > 1000000000000) throw new BadRequestException("Đơn giá nhập phải là số nguyên không âm hợp lệ.");
      return { ...item, quantity, unitCost, lineTotal: quantity * unitCost };
    });
    const receivedAt = parseDate(input.receivedAt || input.date);
    const totalQuantity = items.reduce((sum: number, item: Input) => sum + item.quantity, 0);
    const subtotalAmount = items.reduce((sum: number, item: Input) => sum + item.lineTotal, 0);
    const discountPercent = Number(input.discountPercent ?? 0);
    const vatPercent = Number(input.vatPercent ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || Math.round(discountPercent * 100) !== discountPercent * 100) throw new BadRequestException("Chiết khấu phải từ 0% đến 100%, tối đa 2 chữ số thập phân.");
    if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100 || Math.round(vatPercent * 100) !== vatPercent * 100) throw new BadRequestException("VAT phải từ 0% đến 100%, tối đa 2 chữ số thập phân.");
    const discountAmount = Math.round(subtotalAmount * discountPercent / 100);
    const vatAmount = Math.round((subtotalAmount - discountAmount) * vatPercent / 100);
    const totalAmount = subtotalAmount - discountAmount + vatAmount;
    if (![subtotalAmount, discountAmount, vatAmount, totalAmount].every(Number.isSafeInteger)) throw new BadRequestException("Tổng tiền phiếu nhập vượt giới hạn.");
    const documents = (Array.isArray(input.documentUrls) ? input.documentUrls : []).map((url: unknown) => String(url)).filter((url: string) => /^\/(media|assets)\//.test(url)).slice(0, 10);
    const changedProductIds: string[] = [];
    try {
      const receipt = await this.prisma.$transaction(async (tx) => {
        const receiptNo = await this.nextReceiptNumber(tx, receivedAt);
        const savedReceipt = await tx.inventoryReceipt.create({ data: {
          receiptNo, receivedAt, supplierName: String(input.supplierName || "").trim().slice(0, 180) || null,
          receiver: String(input.receiver || "").trim().slice(0, 120) || null,
          warehouseName: String(input.warehouseName || "Kho chính").trim().slice(0, 120),
          paymentMethod: String(input.paymentMethod || "").trim().slice(0, 40) || null,
          status: "COMPLETED", note: String(input.note || "").trim() || null,
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
            if (!category || category.status !== "ACTIVE" || category.usage !== "PRODUCT_CATEGORY" || category.level < 2) throw new BadRequestException("Chọn danh mục sản phẩm cấp dưới đang hoạt động.");
            const materialOptionId = String(newProduct.materialOptionId || "") || null;
            let materialName = "";
            if (materialOptionId) {
              const material = await tx.materialOption.findUnique({ where: { id: materialOptionId } });
              const expectedScope = category.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
              if (!material || !material.active || material.kind !== "STONE" || material.scope !== expectedScope) throw new BadRequestException("Loại đá không thuộc đúng nhóm sản phẩm.");
              materialName = material.name;
            }
            const productName = name || [category.name, materialName].filter(Boolean).join(" ").slice(0, 180) || `Mặt hàng ${String(newProduct.sku || "").trim()}`;
            const prefix = await this.skuPrefixFor(tx, category.id, materialOptionId || undefined);
            // Variant groups use the stable category/material prefix as their parent SKU.
            // Only a product with one inventory SKU needs a user-supplied sequence.
            const sku = newProductVariantDrafts.length
              ? prefix
              : this.productSkuForSequence(prefix, newProduct.skuSequence);
            if (newProduct.sku && String(newProduct.sku) !== sku) throw new ConflictException("Quy tắc mã hàng vừa thay đổi. Hãy kiểm tra lại mã xem trước rồi thêm sản phẩm.");
            const [existingProduct, existingVariant] = await Promise.all([
              tx.product.findUnique({ where: { sku }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } }),
              tx.productPriceVariant.findUnique({ where: { sku }, select: { id: true, product: { select: { sku: true, name: true } } } }),
            ]);
            const createVariantForProduct = async (variant: Input, index: number, productId?: string) => {
              const variantSku = String(variant.sku || "").trim();
              if (!variantSku.startsWith(sku) || variantSku.length <= sku.length || variantSku.length > 64 || !/^[A-Za-z0-9]+$/.test(variantSku)) {
                throw new BadRequestException(`SKU con phải bắt đầu bằng SKU mẹ ${sku} và có thêm mã phân biệt chữ/số.`);
              }
              const [productCollision, variantCollision] = await Promise.all([
                tx.product.findUnique({ where: { sku: variantSku }, select: { id: true } }),
                tx.productPriceVariant.findUnique({ where: { sku: variantSku }, select: { id: true } }),
              ]);
              if (productCollision || variantCollision) throw new ConflictException(`SKU biến thể ${variantSku} đã tồn tại. Hãy đổi mã SKU con.`);
              const data = {
                optionKey: variant.optionKey,
                quality: variant.quality,
                beadSize: variant.beadSize,
                sku: variantSku,
                price: 0,
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
                if (existingProduct.categoryId !== category.id || existingProduct.materialOptionId !== materialOptionId) {
                  throw new ConflictException(`Mã mẹ ${sku} đã tồn tại ở danh mục hoặc loại đá khác. Hãy kiểm tra quy tắc mã hàng.`);
                }
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
                  const sameOption = existingByOption.get(draft.optionKey) as Input | undefined;
                  const sameSku = existingBySku.get(variantSku.toLocaleUpperCase("en")) as Input | undefined;
                  if (sameSku && sameOption && sameSku.id !== sameOption.id) {
                    throw new ConflictException(`SKU ${variantSku} và phân loại đã nhập đang trỏ tới hai biến thể khác nhau.`);
                  }
                  if (sameOption) {
                    if (sameOption.sku && String(sameOption.sku).toLocaleUpperCase("en") !== variantSku.toLocaleUpperCase("en")) {
                      throw new ConflictException(`Biến thể ${draft.quality}${draft.beadSize ? ` · ${draft.beadSize}` : ""} đã có SKU ${sameOption.sku}. Hãy dùng lại SKU đó để cộng tồn.`);
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
                  kind: category.kind, categoryId: category.id, materialOptionId,
                  status: "DRAFT", stock: 0,
                  variants: { create: variantCreate },
                }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
              }
            } else {
              if (existingVariant) throw new ConflictException(`Mã ${sku} đang là SKU con của sản phẩm ${existingVariant.product.sku}. Hãy nhập theo mã sản phẩm mẹ và chọn biến thể.`);
              if (existingProduct) {
                if (existingProduct.categoryId !== category.id || existingProduct.materialOptionId !== materialOptionId) {
                  throw new ConflictException(`Mã ${sku} đã tồn tại ở danh mục hoặc loại đá khác. Hãy kiểm tra quy tắc mã hàng.`);
                }
                if (existingProduct.variants.length) throw new BadRequestException(`Mã ${sku} đã có ${existingProduct.variants.length} biến thể. Chọn kiểu quản lý tồn theo biến thể rồi nhập SKU con để cộng hoặc tạo biến thể.`);
                product = existingProduct;
              } else {
                product = await tx.product.create({ data: {
                  sku, name: productName, slug: `${slugify(productName).slice(0, 180)}-${sku.toLocaleLowerCase("en")}`,
                  kind: category.kind, categoryId: category.id, materialOptionId,
                  status: "DRAFT", stock: 0,
                }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
              }
            }
          } else {
            product = await tx.product.findUnique({ where: { id: String(item.productId) }, include: { category: true, materialOption: true, gemstoneType: true, variants: true } });
            if (!product) throw new NotFoundException("Không tìm thấy mặt hàng trong kho.");
          }

          const receiptRows: Array<{ variant: Input | null; quantity: number; unitCost: number }> = newProductVariantDrafts.length
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
              variantLabel = [variant.quality !== "Kích thước" ? variant.quality : "", variant.beadSize].filter(Boolean).join(" · ") || null;
            } else {
              await tx.product.update({ where: { id: product.id }, data: { stock: { increment: row.quantity }, soldOutAt: null } });
              const updatedProduct = await tx.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true } });
              stockAfter = updatedProduct.stock;
              stockBefore = stockAfter - row.quantity;
            }
            const productSku = variant?.sku || product.sku;
            const stoneName = product.kind === "GEMSTONE" ? product.gemstoneType?.name || product.materialOption?.name || null : product.materialOption?.name || null;
            const lineTotal = row.quantity * row.unitCost;
            await tx.inventoryReceiptItem.create({ data: {
              receiptId: savedReceipt.id, productId: product.id, variantId: variant?.id || null,
              productName: product.name, productSku, categoryName: product.category?.name || null,
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
      }, { isolationLevel: "Serializable" });
      for (const id of new Set(changedProductIds)) this.publishCatalogChange("product", "updated", id);
      if (syncPos365) await this.pos365.syncReceiptNow(receipt.id);
      return await this.prisma.inventoryReceipt.findUnique({ where: { id: receipt.id }, include: { items: true } }) || receipt;
    } catch (error: any) {
      if (error?.code === "P2002") throw new ConflictException("Mã phiếu hoặc SKU vừa được sử dụng. Kiểm tra số thứ tự và thử lại.");
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
          variantLabel = [selectedVariant.quality, selectedVariant.beadSize].filter(Boolean).join(" · ") || null;
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
    return this.prisma.customer.findMany({ where, include: { _count: { select: { orders: true, reviews: true } }, orders: { orderBy: { placedAt: "desc" }, take: 5, include: { items: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
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

  orders() { return this.prisma.order.findMany({ include: { items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 1 } } } } }, payments: true, customer: true }, orderBy: { placedAt: "desc" }, take: 500 }); }

  async updateOrderStatus(id: string, statusInput: unknown) {
    const status = enumValue(statusInput, ["PENDING_CONFIRMATION", "PROCESSING", "SHIPPING", "DELIVERED", "CANCELLED"], "");
    if (!status) throw new BadRequestException("Trạng thái đơn hàng không hợp lệ.");
    try {
      const order = await this.prisma.order.update({
        where: { id },
        data: {
          status: status as any,
          ...(this.pos365.isSyncEnabled() ? { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date(), pos365SyncError: null } : {}),
        },
        include: { items: true, payments: true },
      });
      if (this.pos365.isSyncEnabled()) void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đánh thức hàng đợi POS365 cho đơn ${order.code}.`, error));
      return order;
    }
    catch (error: any) { if (error?.code === "P2025") throw new NotFoundException("Không tìm thấy đơn hàng."); throw error; }
  }

  async createOrder(input: Input, authenticatedCustomerId?: string) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new BadRequestException("Đơn hàng cần ít nhất một sản phẩm.");
    const storeSale = input.salesChannel === "STORE" || input.channel === "STORE";
    const method = enumValue(input.paymentMethod, ["COD", "BANK_TRANSFER", "MOMO", "CREDIT_CARD", "OTHER"], "COD");
    const paid = storeSale && (input.paid === true || method === "COD");
    const code = `GME-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
    const customerId = String(authenticatedCustomerId || input.customerId || "");
    const changedProductIds = new Set<string>();
    const order = await this.prisma.$transaction(async (tx) => {
      const customer = customerId ? await tx.customer.findUnique({ where: { id: customerId } }) : null;
      if (customerId && !customer) throw new BadRequestException("Không tìm thấy hồ sơ khách hàng đã chọn.");
      const placedItems: Array<{ productId: string; variantId: string | null; productName: string; productSku: string; quality: string | null; beadSize: string | null; quantity: number; unitPrice: number; lineTotal: number }> = [];
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
          where: { OR: [{ id: String(line.productId || "") }, { sku: String(line.sku || "") }], status: storeSale ? { not: "ARCHIVED" } : "ACTIVE" },
          include: { category: true, materialOption: true, gemstoneType: true, variants: { orderBy: { sortOrder: "asc" } } },
        });
        if (!product) throw new BadRequestException("Một sản phẩm trong giỏ không còn khả dụng.");
        const variant = line.variantId ? product.variants.find((item: any) => item.id === String(line.variantId)) : null;
        if (line.variantId && !variant) throw new BadRequestException(`Phiên bản của ${product.name} không còn khả dụng.`);
        if (product.variants.length && !variant) throw new BadRequestException(`Chọn phiên bản cụ thể cho ${product.name}.`);
        const quantity = Number(line.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("Số lượng mỗi dòng phải từ 1 đến 99.");
        const unitPrice = Number(variant?.price ?? product.price ?? 0);
        if (!unitPrice) throw new BadRequestException(`Sản phẩm ${product.name} chưa có giá bán.`);
        if (paid) {
          let stockBefore: number;
          let stockAfter: number;
          const variantLabel = variant ? [variant.quality, variant.beadSize].filter(Boolean).join(" · ") || null : null;
          if (variant) {
            stockBefore = variant.stock;
            stockAfter = stockBefore - quantity;
            if (stockAfter < 0) throw new BadRequestException(`Không đủ tồn kho cho ${product.name} (${variantLabel}).`);
            const updated = await tx.productPriceVariant.updateMany({ where: { id: variant.id, productId: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
            if (updated.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} vừa thay đổi. Tải lại và thử lại.`);
            const remaining = await tx.productPriceVariant.findMany({ where: { productId: product.id }, select: { stock: true } });
            const totalStock = remaining.reduce((sum, row) => sum + row.stock, 0);
            await tx.product.update({ where: { id: product.id }, data: { stock: totalStock, soldOutAt: totalStock === 0 ? product.soldOutAt ?? new Date() : null } });
          } else {
            stockBefore = product.stock;
            stockAfter = stockBefore - quantity;
            if (stockAfter < 0) throw new BadRequestException(`Không đủ tồn kho cho ${product.name}.`);
            const updated = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity }, ...(stockAfter === 0 ? { soldOutAt: product.soldOutAt ?? new Date() } : {}) } });
            if (updated.count !== 1) throw new BadRequestException(`Tồn kho ${product.name} vừa thay đổi. Tải lại và thử lại.`);
          }
          await tx.inventoryMovement.create({ data: {
            productId: product.id, variantId: variant?.id || null, productName: product.name, productSku: variant?.sku || product.sku,
            variantLabel, type: "OUT", quantity, stockBefore, stockAfter, reference: code, note: "Đơn hàng đã thanh toán",
          } });
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
          changedProductIds.add(product.id);
        } else if (variant ? variant.stock < quantity : product.stock < quantity) {
          throw new BadRequestException(`Không đủ tồn kho cho ${product.name}.`);
        }
        placedItems.push({ productId: product.id, variantId: variant?.id || null, productName: product.name, productSku: variant?.sku || product.sku, quality: variant?.quality || null, beadSize: variant?.beadSize || null, quantity, unitPrice, lineTotal: unitPrice * quantity });
      }
      const subtotal = placedItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const discountAmount = Math.min(subtotal, Math.max(0, Number(input.discountAmount) || 0));
      const shippingFee = Math.max(0, Number(input.shippingFee) || 0);
      const totalAmount = subtotal - discountAmount + shippingFee;
      const customerName = String(input.customerName || input.name || "").trim() || customer?.name || "";
      if (!customerName && !storeSale) throw new BadRequestException("Nhập tên khách hàng hoặc chọn hồ sơ khách hàng.");
      const customerPhone = String(input.phone || "").trim() || customer?.phone || null;
      const customerEmail = (input.email ? String(input.email).trim().toLowerCase() : "") || customer?.email || null;
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
        code, customerName, customerEmail, customerPhone,
        shippingAddress: String(input.shippingAddress || input.address || "").trim(),
        shippingMethod: storeSale ? "Bán trực tiếp tại cửa hàng" : input.shippingMethod || null,
        note: input.note || null, subtotal, discountAmount, shippingFee, totalAmount,
        status: paid ? "DELIVERED" as any : "PENDING_CONFIRMATION" as any,
        ...(this.pos365.isSyncEnabled() ? { pos365SyncStatus: "PENDING", pos365SyncNextAttemptAt: new Date() } : {}),
        ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
        items: { create: placedItems },
        payments: { create: { method: method as any, amount: totalAmount, status: paid ? "PAID" as any : "PENDING" as any, ...(paid ? { paidAt: new Date() } : {}) } },
      }, include: { items: true, payments: true, customer: true } });
      await this.queueProductStockSync(tx, changedProductIds);
      return savedOrder;
    });
    for (const id of changedProductIds) this.publishCatalogChange("product", "updated", id);
    if (this.pos365.isSyncEnabled()) void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đánh thức hàng đợi POS365 cho đơn ${order.code}.`, error));
    if (!storeSale) void this.queueOrderConfirmationEmail(order);
    return order;
  }

  private async queueOrderConfirmationEmail(order: any) {
    const recipient = typeof order.customerEmail === "string" ? order.customerEmail.trim().toLowerCase() : "";
    if (!recipient) {
      this.logger.warn(`Đơn ${order.code} chưa có email nhận xác nhận.`);
      return;
    }

    const baseUrl = (process.env.AEGIS_ORDER_EMAIL_URL || process.env.AEGIS_AUTH_API_URL || "http://127.0.0.1:5130").trim().replace(/\/+$/, "");
    const apiKey = process.env.GEME_ORDER_EMAIL_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn(`Chưa cấu hình dịch vụ email xác nhận cho đơn ${order.code}.`);
      return;
    }

    const payment = order.payments?.[0];
    const requestBody = {
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
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
      })),
    };

    try {
      const response = await fetch(`${baseUrl}/internal/email/order-confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GEME-Internal-Key": apiKey },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) this.logger.warn(`Không thể đưa email xác nhận đơn ${order.code} vào hàng đợi (HTTP ${response.status}).`);
    } catch (error) {
      this.logger.warn(`Không thể kết nối dịch vụ email xác nhận cho đơn ${order.code}.`, error);
    }
  }

  async promotions() {
    await this.syncPromotionStatuses();
    return this.prisma.promotion.findMany({ include: { targets: { include: { category: true, product: true } }, _count: { select: { usages: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
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
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take, skip,
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
    if (query.view === "storefront-list") return this.prisma.blogPost.findMany({
      where,
      select: { id: true, slug: true, title: true, summary: true, category: true, tags: true, coverImageUrl: true, publishedAt: true, createdAt: true, views: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, sortOrder: true } } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take, skip,
    });
    return this.prisma.blogPost.findMany({ where, include: { images: { orderBy: { sortOrder: "asc" } }, author: { select: { displayName: true } } }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take, skip });
  }

  async post(slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, status: "PUBLISHED" }, include: { images: { orderBy: { sortOrder: "asc" } }, author: { select: { displayName: true } } } });
    if (!post) throw new NotFoundException("Không tìm thấy bài viết.");
    await this.prisma.blogPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } });
    return post;
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
    return { post, posts, categories: [...categories.entries()].sort(([a], [b]) => a.localeCompare(b, "vi")).map(([name, count]) => ({ name, count })) };
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
      const digest = createHash("sha256").update(bytes).digest("hex");
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
      const asset = await this.prisma.mediaAsset.upsert({
        where: { sourceKey: `blog/${digest}.${extension}` },
        create: { filename: `blog-${digest}.${extension}`, sourceKey: `blog/${digest}.${extension}`, mimeType, data: bytes, size: bytes.length, alt: alt?.slice(0, 240) || null },
        update: {},
        select: { id: true },
      });
      return `/media/${asset.id}`;
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

  mediaAssets() {
    return this.prisma.mediaAsset.findMany({
      select: { id: true, filename: true, sourceKey: true, mimeType: true, size: true, alt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async mediaAsset(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("Không tìm thấy ảnh trong thư viện.");
    return asset;
  }

  async mediaAssetByKey(key: string) {
    const safeKey = `assets/${decodeURIComponent(key).replace(/^\/+/, "")}`;
    const asset = await this.prisma.mediaAsset.findUnique({ where: { sourceKey: safeKey } });
    if (!asset) throw new NotFoundException("Không tìm thấy ảnh đã lưu trong database.");
    return asset;
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

    const sourceKey = input.sourceKey ? String(input.sourceKey).replace(/^\/+/, "").slice(0, 500) : null;
    const data = new Uint8Array(bytes);
    const asset = sourceKey
      ? await this.prisma.mediaAsset.upsert({
          where: { sourceKey },
          create: { filename, sourceKey, mimeType, data, size: bytes.length, alt: input.alt ? String(input.alt).slice(0, 240) : null },
          update: { filename, mimeType, data, size: bytes.length, alt: input.alt ? String(input.alt).slice(0, 240) : null },
          select: { id: true, filename: true, sourceKey: true, mimeType: true, size: true, alt: true, createdAt: true },
        })
      : await this.prisma.mediaAsset.create({
          data: { filename, mimeType, data, size: bytes.length, alt: input.alt ? String(input.alt).slice(0, 240) : null },
          select: { id: true, filename: true, sourceKey: true, mimeType: true, size: true, alt: true, createdAt: true },
        });
    return { ...asset, url: sourceKey ? `/assets/${sourceKey.replace(/^assets\//, "")}` : `/media/${asset.id}` };
  }

  async saveSettings(input: Record<string, unknown>) {
    await this.prisma.$transaction(Object.entries(input).map(([key, value]) => this.prisma.siteSetting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } })));
    this.publishCatalogChange("settings", "updated");
    return this.settings();
  }

  async report(query: Record<string, string>) {
    const from = parseDate(query.from, new Date(Date.now() - 30 * 86400000));
    const to = parseDate(query.to, new Date());
    const orderWhere = { placedAt: { gte: from, lte: to }, status: { not: "CANCELLED" as const } };
    const [orderStats, customerCount, newCustomers, productsSold, timeline, categories, products, payments, salesChannels, promotionPerformance, topOrders] = await Promise.all([
      this.prisma.order.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
      this.prisma.customer.count({ where: { createdAt: { lte: to } } }),
      this.prisma.customer.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COALESCE(SUM(i.quantity), 0)::int AS count
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
      `,
      this.prisma.$queryRaw<Array<{ date: string; revenue: number; orders: number }>>`
        SELECT TO_CHAR(DATE_TRUNC('day', o.placed_at), 'YYYY-MM-DD') AS date,
               COALESCE(SUM(o.total_amount), 0)::double precision AS revenue,
               COUNT(*)::int AS orders
        FROM orders o
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY DATE_TRUNC('day', o.placed_at)
        ORDER BY DATE_TRUNC('day', o.placed_at)
      `,
      this.prisma.$queryRaw<Array<{ name: string; revenue: number }>>`
        SELECT COALESCE(c.name, 'Không phân loại') AS name,
               COALESCE(SUM(i.line_total), 0)::double precision AS revenue
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        LEFT JOIN products p ON p.id = i.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY COALESCE(c.name, 'Không phân loại')
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<Array<{ product: string; sku: string; image: string; sold: number; revenue: number; category: string }>>`
        SELECT i.product_name AS product, i.product_sku AS sku,
               COALESCE(image.url, '') AS image,
               SUM(i.quantity)::int AS sold,
               COALESCE(SUM(i.line_total), 0)::double precision AS revenue,
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
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY i.product_id, i.product_name, i.product_sku, image.url, c.name
        ORDER BY revenue DESC
        LIMIT 20
      `,
      this.prisma.$queryRaw<Array<{ method: string; amount: number }>>`
        SELECT p.method::text AS method, COALESCE(SUM(p.amount), 0)::double precision AS amount
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY p.method
        ORDER BY amount DESC
      `,
      this.prisma.$queryRaw<Array<{ channel: string; revenue: number; orders: number }>>`
        SELECT CASE WHEN o.shipping_method = 'Bán trực tiếp tại cửa hàng' THEN 'Cửa hàng' ELSE 'Website' END AS channel,
               COALESCE(SUM(o.total_amount), 0)::double precision AS revenue,
               COUNT(*)::int AS orders
        FROM orders o
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY 1 ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<Array<{ name: string; code: string | null; orders: number; discount: number }>>`
        SELECT p.name, p.code, COUNT(*)::int AS orders,
               COALESCE(SUM(u.discount_amount), 0)::double precision AS discount
        FROM promotion_usages u
        JOIN promotions p ON p.id = u.promotion_id
        JOIN orders o ON o.id = u.order_id
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        GROUP BY p.id, p.name, p.code
        ORDER BY orders DESC, discount DESC
      `,
      this.prisma.$queryRaw<Array<{ code: string; customer: string; total: number; placedAt: Date }>>`
        SELECT o.code, o.customer_name AS customer,
               o.total_amount::double precision AS total, o.placed_at AS "placedAt"
        FROM orders o
        WHERE o.placed_at >= ${from} AND o.placed_at <= ${to} AND o.status::text <> 'CANCELLED'
        ORDER BY o.total_amount DESC, o.placed_at DESC
        LIMIT 5
      `,
    ]);
    const revenue = Number(orderStats._sum.totalAmount) || 0;
    const orderCount = orderStats._count._all;
    return {
      from, to, revenue, orderCount, customerCount, newCustomers,
      productsSold: Number(productsSold[0]?.count) || 0,
      averageOrderValue: orderCount ? Math.round(revenue / orderCount) : 0,
      timeline, categories, products, payments, salesChannels, promotionPerformance, topOrders,
    };
  }
}


