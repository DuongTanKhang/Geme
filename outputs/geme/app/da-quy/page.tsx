import type { Metadata } from "next";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { StructuredData } from "../components/structured-data";
import { GemstoneFaceCollection, type CutChoice, type StoneChoice } from "../components/gemstone-face-collection";
import { getStoreFacets, getStoreProducts, getStorePromotions, getStoreSalesOverview, requireStoreApi } from "../lib/store-api";
import { absoluteSiteUrl } from "../lib/seo";

type SearchValue = string | string[] | undefined;
const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] : value || "";

type GemstonePageProps = { searchParams: Promise<{ loai?: SearchValue; cut?: SearchValue; gia?: SearchValue; sort?: SearchValue; page?: SearchValue }> };

export async function generateMetadata({ searchParams }: GemstonePageProps): Promise<Metadata> {
  const params = await searchParams;
  const stoneSlug = firstValue(params.loai);
  const cutSlug = firstValue(params.cut);
  const price = firstValue(params.gia);
  const sort = firstValue(params.sort);
  const page = Number(firstValue(params.page) || "1");
  const facets = await getStoreFacets();
  if (!facets.catalogConnected) throw new Error("Không thể tải danh mục đá quý từ GEME API.");
  const stone = facets.categories.find((item) => item.slug === stoneSlug && item.status === "ACTIVE" && item.kind === "GEMSTONE" && item.level === 2)
    || facets.materials.find((item) => item.slug === stoneSlug && item.active && item.scope === "GEMSTONE" && item.kind === "STONE");
  const cut = facets.categories.find((item) => item.slug === cutSlug && item.status === "ACTIVE" && item.kind === "GEMSTONE" && item.level === 3);
  const title = [stone?.name, cut?.name].filter(Boolean).join(" · ") || "Đá quý thiên nhiên";
  const filtered = Boolean(stoneSlug || cutSlug || price || (sort && sort !== "newest"));
  const pageNumber = Number.isFinite(page) && page > 1 ? Math.floor(page) : 1;
  const canonical = pageNumber > 1 ? `/da-quy?page=${pageNumber}` : "/da-quy";
  const description = (stone && "description" in stone ? stone.description : null) || "Khám phá đá quý thiên nhiên GEME và tìm viên đá phù hợp với sắc màu, hình dáng bạn yêu thích.";
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "website", siteName: "GEME", title, description, url: canonical },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function GemstonePage({ searchParams }: GemstonePageProps) {
  const params = await searchParams;
  const rawStone = firstValue(params.loai);
  const rawCut = firstValue(params.cut);
  const rawPrice = firstValue(params.gia);
  const rawSort = firstValue(params.sort);
  const parsedPage = Number(firstValue(params.page) || 1);
  const [productsResult, facets, promotions, sales] = await Promise.all([
    getStoreProducts({ kind: "GEMSTONE", limit: 500 }),
    getStoreFacets(),
    getStorePromotions(),
    getStoreSalesOverview(),
  ]);
  const products = requireStoreApi(productsResult, "danh sách đá quý");
  if (!facets.catalogConnected) throw new Error("Không thể tải bộ lọc đá quý từ GEME API.");

  const uniqueStones = new Map<string, StoneChoice>();
  for (const item of facets.materials.filter((material) => material.active && material.kind === "STONE" && material.scope === "GEMSTONE")) {
    if (!uniqueStones.has(item.slug)) uniqueStones.set(item.slug, { id: item.id, name: item.name, slug: item.slug, sortOrder: item.sortOrder });
  }
  const stoneCategories = facets.categories.filter((category) => category.status === "ACTIVE" && category.kind === "GEMSTONE" && category.level === 2 && (category.usage === "GEMSTONE_TYPE" || facets.categories.some((cut) => cut.status === "ACTIVE" && cut.kind === "GEMSTONE" && cut.level === 3 && cut.parentId === category.id)));
  for (const item of stoneCategories) {
    if (!uniqueStones.has(item.slug)) uniqueStones.set(item.slug, { id: item.id, name: item.name, slug: item.slug, sortOrder: item.sortOrder });
  }

  const stones = [...uniqueStones.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "vi"));
  const cuts: CutChoice[] = facets.categories
    .filter((category) => category.status === "ACTIVE" && category.kind === "GEMSTONE" && category.usage === "PRODUCT_CATEGORY" && category.level === 3)
    .flatMap((category) => {
      const parent = stoneCategories.find((stone) => stone.id === category.parentId);
      return parent ? [{ id: category.id, name: category.name, slug: category.slug, parentId: parent.id, parentSlug: parent.slug }] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
  const activeStone = stones.some((stone) => stone.slug === rawStone) ? rawStone : "";
  const activeCut = cuts.some((cut) => cut.slug === rawCut && cut.parentSlug === activeStone) ? rawCut : "";
  const activePrice = ["under2", "2to5", "5to10", "over10"].includes(rawPrice) ? rawPrice : "";
  const hasSalesData = sales.products.some((item) => item.sold > 0);
  const activeSort = ["newest", "price-asc", "price-desc"].includes(rawSort) || (rawSort === "best-selling" && hasSalesData) ? rawSort : "newest";
  const breadcrumbSchema = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Trang chủ", item: absoluteSiteUrl("/") }, { "@type": "ListItem", position: 2, name: "Đá quý", item: absoluteSiteUrl("/da-quy") }] };

  return <>
    <StructuredData value={breadcrumbSchema} />
    <SiteHeader searchPlaceholder="Tìm kiếm đá quý..." activePage="gemstone" />
    <GemstoneFaceCollection
      activeStone={activeStone}
      activeCut={activeCut}
      stones={stones}
      cuts={cuts}
      products={products.products}
      promotions={promotions.promotions}
      connected={products.connected}
      sales={sales.products}
      initialPriceRange={activePrice}
      initialSort={activeSort}
      initialPage={Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1}
    />
    <SiteFooter variant="catalog" />
  </>;
}
