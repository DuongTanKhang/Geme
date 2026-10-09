import { cache } from "react";
import { normalizeApiBaseUrl } from "./api-base";

export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
  kind: "JEWELRY" | "GEMSTONE";
  usage: "PRODUCT_CATEGORY" | "GEMSTONE_TYPE";
  level: number;
  parentId: string | null;
  description?: string | null;
  bannerUrl?: string | null;
  status: "ACTIVE" | "INACTIVE";
  sortOrder: number;
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
  beadSize?: string | null;
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
  isFeatured: boolean;
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

const requestApi = cache(async (path: string, revalidateSeconds = 0, cacheTag = ""): Promise<{ data: unknown | null; connected: boolean }> => {
  try {
    const requestOptions: RequestInit & { next?: { revalidate: number; tags: string[] } } = revalidateSeconds > 0
      ? { next: { revalidate: revalidateSeconds, tags: cacheTag ? [cacheTag] : [] } }
      : { cache: "no-store" };
    const response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { data: null, connected: false };
    return { data: await response.json() as unknown, connected: true };
  } catch {
    return { data: null, connected: false };
  }
});

async function readApi<T>(path: string, options?: { revalidateSeconds?: number; cacheTag?: string }): Promise<{ data: T | null; connected: boolean }> {
  return await requestApi(path, options?.revalidateSeconds ?? STOREFRONT_REVALIDATE_SECONDS, options?.cacheTag ?? "") as { data: T | null; connected: boolean };
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
  const result = await readApi<StoreSiteSettings>("/settings");
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
        beadSize: variant.beadSize || null,
        price: Number(variant.price) || 0,
        originalPrice: variant.originalPrice == null ? null : Number(variant.originalPrice),
        stock: Number(variant.stock) || 0,
        imageUrls: Array.isArray(variant.imageUrls) ? variant.imageUrls.filter((url: unknown) => typeof url === "string" && url) : [],
        videoUrl: typeof variant.videoUrl === "string" && variant.videoUrl ? variant.videoUrl : null,
        sortOrder: Number(variant.sortOrder ?? index) || 0,
      }))
    : [];
  const variantPrices = variants.map((variant) => variant.price).filter((price) => price > 0);
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
    isFeatured: Boolean(value.isFeatured),
    price: Number(value.price) || (variantPrices.length ? Math.min(...variantPrices) : 0),
    originalPrice: value.originalPrice == null ? null : Number(value.originalPrice),
    stock: Number(value.stock) || 0,
    createdAt: value.createdAt,
    category: value.category ? { id: value.category.id, name: value.category.name, slug: value.category.slug, kind: value.category.kind, usage: value.category.usage, level: Number(value.category.level) || 1, parentId: value.category.parentId ?? null, status: value.category.status, sortOrder: Number(value.category.sortOrder) || 0 } : null,
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
} = {}) {
  const params = new URLSearchParams({ view: "storefront-list", limit: String(options.limit ?? 500) });
  if (options.kind) params.set("kind", options.kind);
  if (options.newOnly) params.set("new", "true");
  if (options.featuredOnly) params.set("featured", "true");
  if (options.categoryId) params.set("categoryId", options.categoryId);
  if (options.gemstoneTypeId) params.set("gemstoneTypeId", options.gemstoneTypeId);
  if (options.materialOptionId) params.set("materialOptionId", options.materialOptionId);
  if (options.search?.trim()) params.set("search", options.search.trim());
  const result = await readApi<any[]>(`/products?${params.toString()}`);
  return { products: (result.data ?? []).map(asStoreProduct), connected: result.connected };
}

export async function getStoreSalesOverview() {
  const result = await readApi<{ products?: StoreSalesProduct[] }>("/reports/overview", { revalidateSeconds: 30, cacheTag: "store-sales" });
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
  const result = await readApi<StorePromotion[]>("/promotions/storefront");
  return { promotions: result.data ?? [], connected: result.connected };
}

export async function getStoreFacets() {
  const [categories, materials] = await Promise.all([
    readApi<any[]>("/categories"),
    readApi<any[]>("/materials"),
  ]);
  return {
    categories: (categories.data ?? []).map((item: any) => ({ id: item.id, name: item.name, slug: item.slug, kind: item.kind, usage: item.usage, level: Number(item.level) || 1, parentId: item.parentId ?? null, description: item.description ?? null, bannerUrl: item.bannerUrl ?? null, status: item.status, sortOrder: Number(item.sortOrder) || 0 })) as StoreCategory[],
    materials: (materials.data ?? []).map((item: any) => ({ id: item.id, name: item.name, slug: item.slug, scope: item.scope, kind: item.kind, active: Boolean(item.active), imageUrl: item.imageUrl ?? null, sortOrder: Number(item.sortOrder) || 0 })) as StoreMaterial[],
    catalogConnected: categories.connected && materials.connected,
  };
}

export async function getStoreCatalog() {
  const [products, facets] = await Promise.all([getStoreProducts(), getStoreFacets()]);
  return { ...products, ...facets };
}

export async function getStoreProduct(slug: string) {
  const result = await readApi<any>(`/products/detail/${encodeURIComponent(slug)}`);
  return { product: result.data ? asStoreProduct(result.data) : null, connected: result.connected };
}

export async function getStoreRelatedProducts(slug: string, limit = 6) {
  const result = await readApi<any[]>(`/products/detail/${encodeURIComponent(slug)}/related?limit=${limit}`);
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
  views: number;
  images: Array<{ url: string; alt?: string | null; sortOrder: number }>;
  author?: { displayName: string } | null;
};

export type StoreBlogPostSummary = Pick<StoreBlogPost, "id" | "slug" | "title" | "summary" | "category" | "tags" | "coverImageUrl" | "publishedAt" | "createdAt" | "views" | "images">;

export type StoreBlogJournalPage = {
  posts: Array<StoreBlogPostSummary & { readingMinutes?: number }>;
  total: number;
  categories?: Array<{ name: string; count: number }>;
};

export async function getStoreBlogPosts(limit = 500) {
  const result = await readApi<StoreBlogPostSummary[]>(`/blog?view=storefront-list&limit=${Math.max(1, Math.min(500, Math.floor(limit)))}`);
  return { posts: result.data ?? [], connected: result.connected };
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
  return { article: result.data, connected: result.connected };
}

export async function getStoreBlogCategories() {
  const result = await readApi<Record<string, unknown>>("/settings");
  const categories = Array.isArray(result.data?.blogCategories)
    ? result.data.blogCategories.filter((item): item is string => typeof item === "string")
    : [];
  return { categories, connected: result.connected };
}

