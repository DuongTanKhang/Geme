import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { GemstoneFaceCollection, type StoneChoice } from "../components/gemstone-face-collection";
import { getStoreFacets, getStoreProducts, getStorePromotions, getStoreSalesOverview } from "../lib/store-api";

export const metadata = {
  title: "Đá quý thiên nhiên | GEME",
  description: "Khám phá bộ sưu tập đá quý thiên nhiên GEME, với những sắc đá được chọn để kể câu chuyện riêng.",
};

type SearchValue = string | string[] | undefined;
const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] : value || "";

export default async function GemstonePage({ searchParams }: { searchParams: Promise<{ loai?: SearchValue; gia?: SearchValue; sort?: SearchValue; page?: SearchValue }> }) {
  const params = await searchParams;
  const rawStone = firstValue(params.loai);
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
  for (const item of facets.categories.filter((category) => category.status === "ACTIVE" && category.kind === "GEMSTONE" && category.usage === "GEMSTONE_TYPE")) {
    if (!uniqueStones.has(item.slug)) uniqueStones.set(item.slug, { id: item.id, name: item.name, slug: item.slug, sortOrder: item.sortOrder });
  }

  const stones = [...uniqueStones.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "vi"));
  const activeStone = stones.some((stone) => stone.slug === rawStone) ? rawStone : "";
  const activePrice = ["under2", "2to5", "5to10", "over10"].includes(rawPrice) ? rawPrice : "";
  const hasSalesData = sales.products.some((item) => item.sold > 0);
  const activeSort = ["newest", "price-asc", "price-desc"].includes(rawSort) || (rawSort === "best-selling" && hasSalesData) ? rawSort : "newest";

  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm đá quý..." activePage="gemstone" />
    <GemstoneFaceCollection
      activeStone={activeStone}
      stones={stones}
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
