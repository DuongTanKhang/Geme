import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { GemstoneFaceCollection, type CutChoice, type StoneChoice } from "../components/gemstone-face-collection";
import { getStoreFacets, getStoreProducts, getStorePromotions, getStoreSalesOverview } from "../lib/store-api";

export const metadata = {
  title: "Đá quý thiên nhiên | GEME",
  description: "Khám phá bộ sưu tập đá quý thiên nhiên GEME, với những sắc đá được chọn để kể câu chuyện riêng.",
};

type SearchValue = string | string[] | undefined;
const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] : value || "";

export default async function GemstonePage({ searchParams }: { searchParams: Promise<{ loai?: SearchValue; cut?: SearchValue; gia?: SearchValue; sort?: SearchValue; page?: SearchValue }> }) {
  const params = await searchParams;
  const rawStone = firstValue(params.loai);
  const rawCut = firstValue(params.cut);
  const rawPrice = firstValue(params.gia);
  const rawSort = firstValue(params.sort);
  const parsedPage = Number(firstValue(params.page) || 1);
  const [products, facets, promotions, sales] = await Promise.all([
    getStoreProducts({ kind: "GEMSTONE", limit: 500 }),
    getStoreFacets(),
    getStorePromotions(),
    getStoreSalesOverview(),
  ]);

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

  return <>
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
