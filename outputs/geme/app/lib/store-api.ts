import { cache } from "react";
import { normalizeApiBaseUrl } from "./api-base.ts";

export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
  kind: "JEWELRY" | "GEMSTONE";
  usage: "PRODUCT_CATEGORY" | "GEMSTONE_TYPE";
  level: number;
  parentId: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  bannerUrl?: string | null;
  status: "ACTIVE" | "INACTIVE";
  sortOrder: number;
  pricingMode?: string;
};

export type StoreMaterial = {
  id: string;
  name: string;
  slug: string;
  scope: "JEWELRY" | "GEMSTONE";
  kind: "MATERIAL" | "STONE";
  active: boolean;
  imageUrl?: string | null;
  sortOrder: number;
};

export type StoreVariant = {
  id?: string;
  sku?: string | null;
  quality: string;
  shape?: string | null;
  beadSize?: string | null;
  carat?: number | null;
  gemstoneQuality?: string | null;
  price: number;
  originalPrice?: number | null;
  stock: number;
  sortOrder: number;
  imageUrls: string[];
  videoUrl?: string | null;
};

export type StoreReview = {
  rating: number;
  title?: string | null;
  content?: string | null;
  createdAt: string;
  customerName?: string | null;
};

export type StoreProduct = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  kind: "JEWELRY" | "GEMSTONE";
  categoryId?: string | null;
  gemstoneTypeId?: string | null;
  materialOptionId?: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  fullDescription?: string | null;
  coverVideoUrl?: string | null;
  technicalImageUrl?: string | null;
  technicalVideoUrl?: string | null;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  status: "DRAFT" | "ACTIVE" | "HIDDEN";
  isNew: boolean;
  newLabelActive?: boolean;
  newUntil?: string | null;
  firstPublishedAt?: string | null;
  jewelryStoneGroupId?: string | null;
  jewelryStoneGroup?: StoreJewelryStoneGroup | null;
  isFeatured: boolean;
  isPremiumGemstone: boolean;
  price: number;
  originalPrice?: number | null;
  stock: number;
  category?: StoreCategory | null;
  gemstoneType?: Pick<StoreCategory, "id" | "name" | "slug"> | null;
  materialOption?: StoreMaterial | null;
  images: Array<{ url: string; alt?: string | null; sortOrder: number; isPrimary: boolean }>;
  variants: StoreVariant[];
  reviews?: StoreReview[];
  createdAt?: string;
  updatedAt?: string;
};

export type StoreJewelryStoneGroup = {
  id: string;
  slug: string;
  name: string;
  pinnedOrder?: number | null;
  sortOrder?: number;
};

export type StoreNewArrivalsGroup = StoreJewelryStoneGroup & {
  latestPublishedAt: string | null;
  total: number;
  products: StoreProduct[];
  hasMore: boolean;
};

export type StoreNewArrivalsResponse = {
  connected: boolean;
  mode: "all" | "tagged" | "published";
  recentDays: number;
  facets?: StoreNewArrivalsFacets;
  totalProducts: number;
  groups: StoreNewArrivalsGroup[];
  pageInfo?: { groupPage: number; groupPageSize: number; totalGroups: number; hasNextGroup: boolean; nextGroupPage: number | null };
};

export type StoreNewArrivalsGroupProductsResponse = {
  connected: boolean;
  mode: "all" | "tagged" | "published";
  recentDays: number;
  facets?: StoreNewArrivalsFacets;
  group: StoreJewelryStoneGroup;
  total: number;
  products: StoreProduct[];
  pageInfo: { page: number; pageSize: number; hasNextPage: boolean; nextPage: number | null };
};

export type StoreNewArrivalsFacets = {
  categories: Array<{ id: string; count: number }>;
  stones: Array<{ id: string | null; slug: string; name: string; count: number }>;
  sizes: Array<{ size: string; count: number }>;
};

export type StorePromotion = {
  id: string;
  value: number;
  startsAt?: string | null;
  endsAt?: string | null;
  productIds: string[];
  categoryIds: string[];
  excludedProductIds: string[];
  excludedCategoryIds: string[];
};

export type StoreSalesProduct = {
  sku: string;
  sold: number;
};

export type StoreSitemapEntry = { slug: string; createdAt?: string; updatedAt?: string; publishedAt?: string | null };

// Server Components should call the API over Docker's private network when available.
// The public URL remains the fallback for local runs outside Compose.
const API_BASE = normalizeApiBaseUrl(process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
// Share public catalogue reads between visitors for a short window. Product,
// banner, and price changes appear quickly while bursts do not fan out into
// hundreds of identical database queries.
const STOREFRONT_REVALIDATE_SECONDS = (() => {
  const configured = Number(process.env.STOREFRONT_API_REVALIDATE_SECONDS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 60 ? configured : 5;
})();
const STOREFRONT_CACHE_TAG = "storefront-catalog";
const STOREFRONT_PRODUCT_PAGE_SIZE = 500;
const STOREFRONT_PRODUCT_MAX_PAGES = 20;

const requestApi = cache(async (path: string, revalidateSeconds = 0, cacheTag = ""): Promise<{ data: unknown | null; connected: boolean; status?: number }> => {
  try {
    const requestOptions: RequestInit & { next?: { revalidate: number; tags: string[] } } = revalidateSeconds > 0
      ? { next: { revalidate: revalidateSeconds, tags: cacheTag ? [cacheTag] : [] } }
      : { cache: "no-store" };
    const response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { data: null, connected: false, status: response.status };
    return { data: await response.json() as unknown, connected: true, status: response.status };
  } catch {
    return { data: null, connected: false, status: 0 };
  }
});

async function readApi<T>(path: string, options?: { revalidateSeconds?: number; cacheTag?: string }): Promise<{ data: T | null; connected: boolean; status?: number }> {
  return await requestApi(path, options?.revalidateSeconds ?? STOREFRONT_REVALIDATE_SECONDS, options?.cacheTag ?? "") as { data: T | null; connected: boolean; status?: number };
}

export function requireStoreApi<T extends { connected: boolean }>(result: T, resource: string): T {
  if (!result.connected) throw new Error(`Không thể tải ${resource} từ GEME API.`);
  return result;
}

export type StoreBanner = {
  id?: string;
  name?: string;
  position: string;
  imageUrl: string;
  href?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  status?: "ACTIVE" | "SCHEDULED" | "HIDDEN";
  startAt?: string;
  endAt?: string;
  devices?: string[];
};

export type StoreSiteSettings = {
  banners?: StoreBanner[];
  footerContent?: Record<string, unknown>;
  catalogEditorialPromos?: StoreCatalogEditorialPromo[];
  newArrivalsMedia?: StoreNewArrivalsMedia;
  [key: string]: unknown;
};

export type StoreNewArrivalsMedia = {
  editorialImageUrl: string;
  editorialAltText: string;
  editorialCtaLabel: string;
  editorialHref: string;
  videoUrl: string;
  videoPosterUrl: string;
  videoAltText: string;
};

export function getStoreNewArrivalsMedia(settings: StoreSiteSettings): StoreNewArrivalsMedia {
  const value = settings.newArrivalsMedia && typeof settings.newArrivalsMedia === "object" ? settings.newArrivalsMedia as Partial<StoreNewArrivalsMedia> : {};
  const text = (field: keyof StoreNewArrivalsMedia) => typeof value[field] === "string" ? value[field] as string : "";
  return {
    editorialImageUrl: text("editorialImageUrl"),
    editorialAltText: text("editorialAltText"),
    editorialCtaLabel: text("editorialCtaLabel") || "Khám phá →",
    editorialHref: text("editorialHref") || "/san-pham#san-pham",
    videoUrl: text("videoUrl"),
    videoPosterUrl: text("videoPosterUrl"),
    videoAltText: text("videoAltText"),
  };
}

export type StoreCatalogEditorialPromo = {
  id: "green-edit" | "geme-on-you" | "stone-to-jewelry";
  kind: "image" | "video";
  enabled: boolean;
  sortOrder: number;
  placement: "after-4" | "after-12" | "after-18";
  title: string;
  description: string;
  ctaLabel: string;
  imageUrl: string;
  posterUrl: string;
  videoUrl: string;
  altText: string;
  href: string;
  focusX: number;
  focusY: number;
};

const defaultCatalogEditorialPromos: StoreCatalogEditorialPromo[] = [
  { id: "green-edit", kind: "image", enabled: true, sortOrder: 1, placement: "after-4", title: "THE GREEN EDIT", description: "Một sắc xanh. Nhiều cách thể hiện.", ctaLabel: "Khám phá →", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
  { id: "geme-on-you", kind: "video", enabled: true, sortOrder: 2, placement: "after-12", title: "GEME TRÊN BẠN", description: "Những chi tiết làm nên dấu ấn.", ctaLabel: "Xem câu chuyện →", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
  { id: "stone-to-jewelry", kind: "video", enabled: true, sortOrder: 3, placement: "after-18", title: "TỪ ĐÁ ĐẾN TRANG SỨC", description: "Vẻ đẹp qua từng chi tiết.", ctaLabel: "", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
];

export function getStoreCatalogEditorialPromos(settings: StoreSiteSettings): StoreCatalogEditorialPromo[] {
  const saved = Array.isArray(settings.catalogEditorialPromos) ? settings.catalogEditorialPromos : [];
  const byId = new Map(saved.filter((item) => item && typeof item === "object").map((item) => [item.id, item]));
  return defaultCatalogEditorialPromos.map((defaults) => {
    const item = byId.get(defaults.id);
    if (!item) return defaults;
    const safeNumber = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
    return {
      ...defaults,
      ...item,
      id: defaults.id,
      kind: (item.kind === "video" ? "video" : "image") as StoreCatalogEditorialPromo["kind"],
      enabled: item.enabled !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : defaults.sortOrder,
      placement: item.placement === "after-4" || item.placement === "after-12" || item.placement === "after-18" ? item.placement : defaults.placement,
      title: typeof item.title === "string" ? item.title : defaults.title,
      description: typeof item.description === "string" ? item.description : defaults.description,
      ctaLabel: typeof item.ctaLabel === "string" ? item.ctaLabel : defaults.ctaLabel,
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
      posterUrl: typeof item.posterUrl === "string" ? item.posterUrl : "",
      videoUrl: typeof item.videoUrl === "string" ? item.videoUrl : "",
      altText: typeof item.altText === "string" ? item.altText : "",
      href: typeof item.href === "string" ? item.href : "",
      focusX: safeNumber(item.focusX, defaults.focusX),
      focusY: safeNumber(item.focusY, defaults.focusY),
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getStoreSiteSettings() {
  // Settings are edited in the admin and should be consistent on both local
  // host aliases as soon as the next page request reaches the shared server.
  const result = await readApi<StoreSiteSettings>("/settings/public", { cacheTag: STOREFRONT_CACHE_TAG });
  return { settings: result.data ?? {}, connected: result.connected };
}

function canonicalBannerPosition(position: string) {
  const normalized = position.normalize("NFC").trim().replace(/[·–—]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "ô trang sức": "Trang chủ - Ô Trang sức",
    "ô mặt đá quý": "Trang chủ - Ô Mặt đá quý",
    "ô new arrivals": "Trang chủ - Ô New Arrivals",
    "mặt đá quý": "Mặt đá quý - Banner",
    blog: "Blog - Banner",
    "new arrivals": "New Arrivals - Hero",
    "đăng nhập": "Đăng nhập - Banner",
    "đăng nhập - banner": "Đăng nhập - Banner",
    "tài khoản": "Đăng nhập - Banner",
    "tài khoản - banner": "Đăng nhập - Banner",
    "liên hệ - cta": "Liên hệ - Banner tư vấn",
    "về geme - cuối trang": "Về GEME - Banner cuối",
    "new arrivals - cuối trang": "New Arrivals - Banner cuối",
  };
  const key = normalized.toLocaleLowerCase("vi");
  return aliases[key] || normalized;
}

export function getStoreBanner(settings: StoreSiteSettings, position: string, fallback: string) {
  const now = new Date();
  const wantedPosition = canonicalBannerPosition(position);
  const eligible = settings.banners?.filter((item) => {
    if (canonicalBannerPosition(item.position) !== wantedPosition || item.status === "HIDDEN" || item.status === "SCHEDULED" || !item.imageUrl) return false;
    if (item.startAt && new Date(`${item.startAt}T00:00:00`) > now) return false;
    if (item.endAt && new Date(`${item.endAt}T23:59:59`) < now) return false;
    return true;
  }) || [];
  // Prefer the canonical position if an older record still uses the short label.
  const banner = eligible.find((item) => item.position === wantedPosition) || eligible[0];
  return banner?.imageUrl || fallback;
}

export function getStoreJewelryCarouselBanners(settings: StoreSiteSettings) {
  const now = new Date();
  return (settings.banners ?? [])
    .filter((item) => {
      if (!/^Trang sức - Carousel [1-5]$/i.test(canonicalBannerPosition(item.position)) || item.status === "HIDDEN" || item.status === "SCHEDULED" || !item.imageUrl) return false;
      if (item.startAt && new Date(`${item.startAt}T00:00:00`) > now) return false;
      if (item.endAt && new Date(`${item.endAt}T23:59:59`) < now) return false;
      return true;
    })
    .sort((a, b) => Number(a.position.match(/[1-5]$/)?.[0] || canonicalBannerPosition(a.position).match(/[1-5]$/)?.[0] || 0) - Number(b.position.match(/[1-5]$/)?.[0] || canonicalBannerPosition(b.position).match(/[1-5]$/)?.[0] || 0));
}

function asStoreProduct(value: any): StoreProduct {
  const isPremiumGemstone = value.kind === "GEMSTONE" && Boolean(value.isPremiumGemstone);
  const images = Array.isArray(value.images)
    ? value.images
        .filter((image: any) => typeof image?.url === "string" && image.url)
        .sort((a: any, b: any) => Number(b.isPrimary) - Number(a.isPrimary) || Number(a.sortOrder) - Number(b.sortOrder))
        .map((image: any) => ({ url: image.url, alt: image.alt ?? null, sortOrder: Number(image.sortOrder) || 0, isPrimary: Boolean(image.isPrimary) }))
    : [];
  const variants: StoreVariant[] = Array.isArray(value.variants)
    ? value.variants.map((variant: any, index: number) => ({
        id: variant.id ? String(variant.id) : undefined,
        sku: variant.sku ?? null,
        quality: String(variant.quality || "Tiêu chuẩn"),
        shape: variant.shape || null,
        beadSize: variant.beadSize || null,
        carat: variant.carat == null ? null : Number(variant.carat),
        gemstoneQuality: variant.gemstoneQuality || null,
        price: isPremiumGemstone ? 0 : Number(variant.price) || 0,
        originalPrice: isPremiumGemstone || variant.originalPrice == null ? null : Number(variant.originalPrice),
        stock: Number(variant.stock) || 0,
        imageUrls: Array.isArray(variant.imageUrls) ? variant.imageUrls.filter((url: unknown) => typeof url === "string" && url) : [],
        videoUrl: typeof variant.videoUrl === "string" && variant.videoUrl ? variant.videoUrl : null,
        sortOrder: Number(variant.sortOrder ?? index) || 0,
      }))
    : [];
  const categoryPricingMode = String(value.category?.pricingMode || "");
  const variantPrices = variants.map((variant) => variant.price * (value.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(categoryPricingMode) ? Number(variant.carat || 0) : 1)).filter((price) => price > 0);
  const variantOriginalPrices = variants.map((variant) => Number(variant.originalPrice || 0) * (value.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(categoryPricingMode) ? Number(variant.carat || 0) : 1)).filter((price) => price > 0);
  return {
    id: String(value.id),
    sku: String(value.sku || ""),
    name: String(value.name || ""),
    slug: String(value.slug || ""),
    kind: value.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY",
    categoryId: value.categoryId ?? null,
    gemstoneTypeId: value.gemstoneTypeId ?? null,
    materialOptionId: value.materialOptionId ?? null,
    description: value.description ?? null,
    seoTitle: value.seoTitle ?? null,
    seoDescription: value.seoDescription ?? null,
    fullDescription: value.fullDescription ?? null,
    coverVideoUrl: typeof value.coverVideoUrl === "string" && value.coverVideoUrl ? value.coverVideoUrl : null,
    technicalImageUrl: value.technicalImageUrl ?? null,
    technicalVideoUrl: value.technicalVideoUrl ?? null,
    weightGrams: value.weightGrams == null ? null : Number(value.weightGrams),
    lengthCm: value.lengthCm == null ? null : Number(value.lengthCm),
    widthCm: value.widthCm == null ? null : Number(value.widthCm),
    heightCm: value.heightCm == null ? null : Number(value.heightCm),
    status: value.status,
    isNew: Boolean(value.isNew),
    newLabelActive: typeof value.newLabelActive === "boolean" ? value.newLabelActive : undefined,
    newUntil: value.newUntil ?? null,
    firstPublishedAt: value.firstPublishedAt ?? null,
    jewelryStoneGroupId: value.jewelryStoneGroupId ?? null,
    jewelryStoneGroup: value.jewelryStoneGroup ? { id: String(value.jewelryStoneGroup.id), slug: String(value.jewelryStoneGroup.slug), name: String(value.jewelryStoneGroup.name), pinnedOrder: value.jewelryStoneGroup.pinnedOrder ?? null, sortOrder: Number(value.jewelryStoneGroup.sortOrder) || 0 } : null,
    isFeatured: Boolean(value.isFeatured),
    isPremiumGemstone,
    price: isPremiumGemstone ? 0 : variants.length && variantPrices.length ? Math.min(...variantPrices) : Number(value.price) || 0,
    originalPrice: isPremiumGemstone ? null : variants.length && variantOriginalPrices.length ? Math.min(...variantOriginalPrices) : value.originalPrice == null ? null : Number(value.originalPrice),
    stock: Number(value.stock) || 0,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    category: value.category ? { id: value.category.id, name: value.category.name, slug: value.category.slug, kind: value.category.kind, usage: value.category.usage, level: Number(value.category.level) || 1, parentId: value.category.parentId ?? null, status: value.category.status, sortOrder: Number(value.category.sortOrder) || 0, pricingMode: value.category.pricingMode } : null,
    gemstoneType: value.gemstoneType ? { id: value.gemstoneType.id, name: value.gemstoneType.name, slug: value.gemstoneType.slug } : null,
    materialOption: value.materialOption ? { id: value.materialOption.id, name: value.materialOption.name, slug: value.materialOption.slug, scope: value.materialOption.scope, kind: value.materialOption.kind, active: Boolean(value.materialOption.active), sortOrder: Number(value.materialOption.sortOrder) || 0 } : null,
    images,
    variants,
    reviews: Array.isArray(value.reviews) ? value.reviews.map((review: any) => ({
      rating: Number(review.rating) || 0,
      title: review.title ?? null,
      content: review.content ?? null,
      createdAt: String(review.createdAt || ""),
      customerName: review.customer?.name ?? null,
    })) : [],
  } as StoreProduct;
}

export async function getStoreProducts(options: {
  kind?: StoreProduct["kind"];
  newOnly?: boolean;
  featuredOnly?: boolean;
  categoryId?: string;
  gemstoneTypeId?: string;
  materialOptionId?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams({ view: "storefront-list", limit: String(options.limit ?? 500) });
  if (options.offset && options.offset > 0) params.set("offset", String(Math.floor(options.offset)));
  if (options.kind) params.set("kind", options.kind);
  if (options.newOnly) params.set("new", "true");
  if (options.featuredOnly) params.set("featured", "true");
  if (options.categoryId) params.set("categoryId", options.categoryId);
  if (options.gemstoneTypeId) params.set("gemstoneTypeId", options.gemstoneTypeId);
  if (options.materialOptionId) params.set("materialOptionId", options.materialOptionId);
  if (options.search?.trim()) params.set("search", options.search.trim());
  const result = await readApi<any[]>(`/products?${params.toString()}`, { cacheTag: STOREFRONT_CACHE_TAG });
  return { products: (result.data ?? []).map(asStoreProduct), connected: result.connected };
}

type StoreNewArrivalsQuery = {
  mode?: "all" | "tagged" | "published";
  categoryIds?: string[];
  stoneGroupId?: string;
  stoneGroupIds?: string[];
  sizes?: string[];
  search?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: "recommended" | "newest" | "best_selling" | "price_asc" | "price_desc";
  page?: number;
  groupPage?: number;
};

function newArrivalsQuery(options: StoreNewArrivalsQuery) {
  const params = new URLSearchParams();
  if (options.mode) params.set("mode", options.mode);
  for (const categoryId of options.categoryIds || []) params.append("categoryId", categoryId);
  for (const id of options.stoneGroupIds || []) params.append("stoneGroupId", id);
  if (options.stoneGroupId) params.set("stoneGroupId", options.stoneGroupId);
  for (const size of options.sizes || []) params.append("size", size);
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.minPrice != null) params.set("minPrice", String(options.minPrice));
  if (options.maxPrice != null) params.set("maxPrice", String(options.maxPrice));
  if (options.sort) params.set("sort", options.sort);
  if (options.page && options.page > 1) params.set("page", String(Math.floor(options.page)));
  if (options.groupPage && options.groupPage > 1) params.set("groupPage", String(Math.floor(options.groupPage)));
  return params.toString();
}

export async function getStoreNewArrivals(options: StoreNewArrivalsQuery = {}) {
  const query = newArrivalsQuery(options);
  const result = await readApi<any>(`/catalog/new-arrivals${query ? `?${query}` : ""}`, { revalidateSeconds: 5, cacheTag: STOREFRONT_CACHE_TAG });
  return {
    connected: result.connected,
    status: result.status,
    data: result.data ? {
      ...result.data,
      groups: Array.isArray(result.data.groups) ? result.data.groups.map((group: any) => ({ ...group, products: Array.isArray(group.products) ? group.products.map(asStoreProduct) : [] })) : [],
    } as Omit<StoreNewArrivalsResponse, "connected"> : null,
  };
}

export async function getStoreNewArrivalsGroup(slug: string, options: StoreNewArrivalsQuery = {}) {
  const query = newArrivalsQuery(options);
  const result = await readApi<any>(`/catalog/new-arrivals/groups/${encodeURIComponent(slug)}/products${query ? `?${query}` : ""}`, { revalidateSeconds: 5, cacheTag: STOREFRONT_CACHE_TAG });
  return {
    connected: result.connected,
    status: result.status,
    data: result.data ? {
      ...result.data,
      products: Array.isArray(result.data.products) ? result.data.products.map(asStoreProduct) : [],
    } as Omit<StoreNewArrivalsGroupProductsResponse, "connected"> : null,
  };
}

export async function getStoreJewelryStoneGroups() {
  const result = await readApi<StoreJewelryStoneGroup[]>("/catalog/jewelry-stone-groups", { revalidateSeconds: 30, cacheTag: STOREFRONT_CACHE_TAG });
  return { groups: result.data ?? [], connected: result.connected };
}

export async function getStoreSitemapProducts(limit = 500, offset = 0) {
  const params = new URLSearchParams({ view: "sitemap", limit: String(Math.max(1, Math.min(500, Math.floor(limit)))), offset: String(Math.max(0, Math.floor(offset))) });
  return await readApi<StoreSitemapEntry[]>(`/products?${params.toString()}`, { cacheTag: STOREFRONT_CACHE_TAG });
}

export async function getStoreSalesOverview() {
  const result = await readApi<{ products?: StoreSalesProduct[] }>("/reports/storefront", { revalidateSeconds: 30, cacheTag: "store-sales" });
  return {
    products: Array.isArray(result.data?.products) ? result.data.products.map((item) => ({ sku: String(item.sku || ""), sold: Math.max(0, Number(item.sold) || 0) })) : [],
    connected: result.connected,
  };
}

export function getStoreSoldQuantity(sku: string, sales: StoreSalesProduct[]) {
  return sales.find((item) => item.sku === sku)?.sold ?? 0;
}

export function sortStoreProductsBySoldQuantity(products: StoreProduct[], sales: StoreSalesProduct[]) {
  const soldBySku = new Map(sales.map((item) => [item.sku, item.sold]));
  return products
    .map((product, index) => ({ product, index, sold: soldBySku.get(product.sku) ?? 0 }))
    .sort((a, b) => b.sold - a.sold || a.index - b.index)
    .map(({ product }) => product);
}

export function orderStoreProductsForBestSelling(products: StoreProduct[], featuredProducts: StoreProduct[], sales: StoreSalesProduct[]) {
  const ranked = sortStoreProductsBySoldQuantity(products, sales);
  const purchased = ranked.filter((product) => getStoreSoldQuantity(product.sku, sales) > 0);
  const unique = new Map<string, StoreProduct>();
  // Put real sales first; until sales exist, seed with real active catalog items,
  // preferring products already selected as featured in the admin.
  for (const product of [...purchased, ...featuredProducts, ...ranked]) unique.set(product.id, product);
  return [...unique.values()];
}

export function selectHomeBestSellers(products: StoreProduct[], featuredProducts: StoreProduct[], sales: StoreSalesProduct[]) {
  return orderStoreProductsForBestSelling(products, featuredProducts, sales).slice(0, 8);
}

export async function getStorePromotions() {
  const result = await readApi<StorePromotion[]>("/promotions/storefront", { cacheTag: STOREFRONT_CACHE_TAG });
  return { promotions: result.data ?? [], connected: result.connected };
}

export async function getStoreFacets() {
  const [categories, materials] = await Promise.all([
    readApi<any[]>("/categories/public", { cacheTag: STOREFRONT_CACHE_TAG }),
    readApi<any[]>("/materials", { cacheTag: STOREFRONT_CACHE_TAG }),
  ]);
  return {
    categories: (categories.data ?? []).map((item: any) => ({ id: item.id, name: item.name, slug: item.slug, kind: item.kind, usage: item.usage, level: Number(item.level) || 1, parentId: item.parentId ?? null, description: item.description ?? null, bannerUrl: item.bannerUrl ?? null, seoTitle: item.seoTitle ?? null, seoDescription: item.seoDescription ?? null, status: item.status, sortOrder: Number(item.sortOrder) || 0 })) as StoreCategory[],
    materials: (materials.data ?? []).map((item: any) => ({ id: item.id, name: item.name, slug: item.slug, scope: item.scope, kind: item.kind, active: Boolean(item.active), imageUrl: item.imageUrl ?? null, sortOrder: Number(item.sortOrder) || 0 })) as StoreMaterial[],
    catalogConnected: categories.connected && materials.connected,
  };
}

export async function getStoreCatalog() {
  const [products, facets] = await Promise.all([getAllStorefrontProducts(), getStoreFacets()]);
  return { ...products, ...facets };
}

async function getAllStorefrontProducts() {
  const products: StoreProduct[] = [];

  for (let page = 0; page < STOREFRONT_PRODUCT_MAX_PAGES; page += 1) {
    const offset = page * STOREFRONT_PRODUCT_PAGE_SIZE;
    const result = await getStoreProducts({ limit: STOREFRONT_PRODUCT_PAGE_SIZE, offset });
    if (!result.connected) return { products: [] as StoreProduct[], connected: false };

    products.push(...result.products);
    if (result.products.length < STOREFRONT_PRODUCT_PAGE_SIZE) {
      return { products, connected: true };
    }
  }

  // Do not render an apparently complete catalog if it exceeds the pagination safety limit.
  return { products: [] as StoreProduct[], connected: false };
}

export async function getStoreProduct(slug: string) {
  const result = await readApi<any>(`/products/detail/${encodeURIComponent(slug)}`, { cacheTag: STOREFRONT_CACHE_TAG });
  if (!result.connected && result.status !== 404) throw new Error("Không thể tải sản phẩm từ GEME API.");
  return { product: result.data ? asStoreProduct(result.data) : null, connected: result.connected };
}

export async function getStoreRelatedProducts(slug: string, limit = 6) {
  const result = await readApi<any[]>(`/products/detail/${encodeURIComponent(slug)}/related?limit=${limit}`, { cacheTag: STOREFRONT_CACHE_TAG });
  return { products: (result.data ?? []).map(asStoreProduct), connected: result.connected };
}

export type StoreBlogPost = {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
  category?: string | null;
  tags: string[];
  content: string;
  coverImageUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  views: number;
  images: Array<{ url: string; alt?: string | null; sortOrder: number }>;
  author?: { displayName: string } | null;
};

export type StoreBlogPostSummary = Pick<StoreBlogPost, "id" | "slug" | "title" | "summary" | "category" | "tags" | "coverImageUrl" | "publishedAt" | "createdAt" | "updatedAt" | "views" | "images">;

export type StoreBlogJournalPage = {
  posts: Array<StoreBlogPostSummary & { readingMinutes?: number }>;
  total: number;
  categories?: Array<{ name: string; count: number }>;
};

export async function getStoreBlogPosts(limit = 500, offset = 0) {
  const result = await readApi<StoreBlogPostSummary[]>(`/blog?view=storefront-list&limit=${Math.max(1, Math.min(500, Math.floor(limit)))}&offset=${Math.max(0, Math.floor(offset))}`);
  return { posts: result.data ?? [], connected: result.connected };
}

export async function getStoreSitemapBlogPosts(limit = 500, offset = 0) {
  const params = new URLSearchParams({ view: "sitemap", limit: String(Math.max(1, Math.min(500, Math.floor(limit)))), offset: String(Math.max(0, Math.floor(offset))) });
  return await readApi<StoreSitemapEntry[]>(`/blog?${params.toString()}`);
}

export async function getStoreBlogJournalPage(options: { limit?: number; offset?: number; search?: string; category?: string } = {}) {
  const params = new URLSearchParams({
    view: "storefront-journal",
    limit: String(Math.max(1, Math.min(500, Math.floor(options.limit ?? 8)))),
    offset: String(Math.max(0, Math.floor(options.offset ?? 0))),
  });
  if (options.search?.trim()) params.set("search", options.search.trim());
  if (options.category?.trim()) params.set("category", options.category.trim());
  const result = await readApi<StoreBlogJournalPage>("/blog?" + params.toString());
  return {
    posts: result.data?.posts ?? [],
    total: result.data?.total ?? 0,
    categories: result.data?.categories ?? [],
    connected: result.connected,
  };
}

export async function getStoreBlogPost(slug: string) {
  const result = await readApi<StoreBlogPost>(`/blog/${encodeURIComponent(slug)}`);
  return { post: result.data, connected: result.connected };
}

export type StoreBlogArticle = {
  post: StoreBlogPost;
  posts: StoreBlogPostSummary[];
  categories: Array<{ name: string; count: number }>;
};

export async function getStoreBlogArticle(slug: string) {
  const result = await readApi<StoreBlogArticle>(`/blog/article/${encodeURIComponent(slug)}`, {
    revalidateSeconds: 5,
    cacheTag: `blog-article:${slug}`,
  });
  if (!result.connected && result.status !== 404) throw new Error("Không thể tải bài viết từ GEME API.");
  return { article: result.data, connected: result.connected };
}

export async function getStoreBlogCategories() {
  const result = await readApi<Record<string, unknown>>("/settings");
  const categories = Array.isArray(result.data?.blogCategories)
    ? result.data.blogCategories.filter((item): item is string => typeof item === "string")
    : [];
  return { categories, connected: result.connected };
}

