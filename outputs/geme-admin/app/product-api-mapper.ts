import type { AdminProduct, ProductPriceVariant } from "./products-workspace";

type Row = Record<string, any>;

export function fromApiProduct(value: Row): AdminProduct {
  const category = value.category;
  const gemstoneTypeId = value.gemstoneTypeId || (value.kind === "GEMSTONE"
    ? (Number(category?.level) === 2 ? category.id : category?.parentId || undefined)
    : undefined);
  const categoryName = value.kind === "GEMSTONE"
    ? (value.gemstoneType?.name || category?.name || "")
    : (category?.name || "");
  const images = Array.isArray(value.images) ? value.images.map((image: Row) => image.url).filter(Boolean) : [];
  const hasFullVariants = Array.isArray(value.variants) && value.variants.every((item: Row) =>
    ["id", "sku", "quality", "shape", "beadSize", "carat", "gemstoneQuality", "price", "originalPrice", "stock", "imageUrls", "videoUrl"].every((key) => Object.hasOwn(item, key)));
  const detailsLoaded = value.adminSummary !== true
    && Object.hasOwn(value, "fullDescription")
    && Object.hasOwn(value, "technicalImageUrl")
    && hasFullVariants;
  const variants: ProductPriceVariant[] = Array.isArray(value.variants)
    ? value.variants.map((item: Row) => ({
      id: String(item.id || ""),
      sku: item.sku || null,
      quality: item.quality,
      shape: item.shape || null,
      beadSize: item.beadSize || undefined,
      carat: item.carat == null ? null : Number(item.carat),
      gemstoneQuality: item.gemstoneQuality || null,
      price: Number(item.price) || 0,
      originalPrice: Number(item.originalPrice) || undefined,
      stock: Number(item.stock) || 0,
      imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls.filter((url: unknown) => typeof url === "string") : [],
      videoUrl: item.videoUrl || null,
    }))
    : [];

  return {
    id: String(value.sku),
    apiId: String(value.id),
    detailsLoaded,
    name: String(value.name || ""),
    price: Number(value.price) || variants.reduce((min, row) => min ? Math.min(min, row.price) : row.price, 0),
    originalPrice: Number(value.originalPrice) || 0,
    stock: Number(value.stock) || variants.reduce((sum, row) => sum + row.stock, 0),
    status: value.status === "ACTIVE" ? "Đang hoạt động" : value.status === "HIDDEN" ? "Tạm ẩn" : value.status === "ARCHIVED" ? "Đã gỡ bài" : "Bản nháp",
    isNew: Boolean(value.isNew),
    newLabelActive: Boolean(value.isNew && (!value.newUntil || new Date(value.newUntil).getTime() > Date.now())),
    newUntil: value.newUntil ? new Date(value.newUntil).toISOString() : null,
    firstPublishedAt: value.firstPublishedAt ? new Date(value.firstPublishedAt).toISOString() : null,
    publicationHistoryKnown: Boolean(value.publicationHistoryKnown),
    jewelryStoneGroupId: value.jewelryStoneGroupId || null,
    jewelryStoneGroup: value.jewelryStoneGroup ? { id: value.jewelryStoneGroup.id, slug: value.jewelryStoneGroup.slug, name: value.jewelryStoneGroup.name, active: value.jewelryStoneGroup.active } : null,
    isPremiumGemstone: value.kind === "GEMSTONE" && Boolean(value.isPremiumGemstone),
    productType: value.kind === "GEMSTONE" ? "Đá quý" : "Trang sức",
    category: categoryName,
    categoryId: String(value.categoryId || ""),
    materialOptionId: value.materialOptionId || undefined,
    gemstoneTypeId: gemstoneTypeId || undefined,
    categoryPricingMode: value.kind === "GEMSTONE" && category?.pricingMode === "QUALITY" ? "GEMSTONE_SIZE" : category?.pricingMode || "FIXED",
    subcategory: value.kind === "GEMSTONE" ? "" : value.materialOption?.name || "",
    description: value.description || "",
    fullDescription: value.fullDescription || "",
    image: images[0] || "",
    gallery: images,
    coverVideoUrl: String(value.coverVideoUrl || ""),
    technicalImage: String(value.technicalImageUrl || ""),
    technicalVideo: String(value.technicalVideoUrl || ""),
    weightGrams: value.weightGrams == null ? undefined : Number(value.weightGrams),
    lengthCm: value.lengthCm == null ? undefined : Number(value.lengthCm),
    widthCm: value.widthCm == null ? undefined : Number(value.widthCm),
    heightCm: value.heightCm == null ? undefined : Number(value.heightCm),
    qualityGrades: [...new Set(variants.map((row) => row.quality))],
    beadSizes: [...new Set(variants.map((row) => row.beadSize).filter(Boolean))] as string[],
    priceVariants: variants,
    seoTitle: value.seoTitle || "",
    seoDescription: value.seoDescription || "",
    pos365PriceSyncStatus: value.pos365PriceSyncStatus || null,
    pos365PriceSyncError: value.pos365PriceSyncError || null,
    pos365PriceSyncedAt: value.pos365PriceSyncedAt || null,
    sold: 0,
    revenue: 0,
  };
}

export function toApiProduct(value: AdminProduct, publish?: boolean) {
  const gemstone = value.productType === "Đá quý";
  return {
    sku: value.id,
    name: value.name,
    kind: gemstone ? "GEMSTONE" : "JEWELRY",
    categoryId: gemstone ? value.gemstoneTypeId || value.categoryId : value.categoryId,
    gemstoneTypeId: gemstone ? value.gemstoneTypeId || value.categoryId : null,
    materialOptionId: value.materialOptionId || null,
    description: value.description || null,
    fullDescription: value.fullDescription || null,
    coverVideoUrl: value.coverVideoUrl || null,
    technicalImageUrl: value.technicalImage || null,
    technicalVideoUrl: value.technicalVideo || null,
    weightGrams: value.weightGrams ?? null,
    lengthCm: value.lengthCm ?? null,
    widthCm: value.widthCm ?? null,
    heightCm: value.heightCm ?? null,
    status: publish === false || value.status === "Bản nháp" ? "DRAFT" : value.status === "Tạm ẩn" ? "HIDDEN" : "ACTIVE",
    isNew: Boolean(value.isNew),
    isPremiumGemstone: gemstone && Boolean(value.isPremiumGemstone),
    price: value.price,
    originalPrice: value.originalPrice || null,
    seoTitle: value.seoTitle || null,
    seoDescription: value.seoDescription || null,
    gallery: value.gallery?.length ? value.gallery : value.image ? [value.image] : [],
    priceVariants: (value.priceVariants || []).map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      quality: variant.quality,
      shape: variant.shape ?? null,
      beadSize: variant.beadSize ?? null,
      carat: variant.carat,
      gemstoneQuality: variant.gemstoneQuality,
      price: variant.price,
      originalPrice: variant.originalPrice,
      imageUrls: variant.imageUrls || [],
      videoUrl: variant.videoUrl || null,
    })),
  };
}
