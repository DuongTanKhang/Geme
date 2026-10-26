import type { Metadata } from "next";
import { NewArrivalsGrouped, type NewArrivalsFilters } from "../components/new-arrivals-grouped";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBanner, getStoreFacets, getStoreJewelryStoneGroups, getStoreNewArrivals, getStoreNewArrivalsGroup, getStorePromotions, getStoreSiteSettings } from "../lib/store-api";

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const query = await searchParams;
  const hasFilters = Object.values(query).some((value) => values(value).length > 0);
  return {
    title: "Mới tại GEME",
    description: "Khám phá trang sức GEME đang mang nhãn Mới, được tuyển chọn theo từng nhóm đá.",
    alternates: { canonical: "/new-arrivals" },
    ...(hasFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

function values(value: SearchValue) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.trim()).filter(Boolean);
}

export default async function NewArrivalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [query, facets, promotions, site, stoneGroups] = await Promise.all([
    searchParams,
    getStoreFacets(),
    getStorePromotions(),
    getStoreSiteSettings(),
    getStoreJewelryStoneGroups(),
  ]);
  const one = (value: SearchValue) => values(value)[0] || "";
  const sortValue = one(query.sort);
  const mode: NewArrivalsFilters["mode"] = "tagged";
  const allowedSorts = new Set(["recommended", "newest", "best_selling", "price_asc", "price_desc"]);
  const sort: NewArrivalsFilters["sort"] = allowedSorts.has(sortValue) ? sortValue as NewArrivalsFilters["sort"] : "recommended";
  const categoryIds = values(query.categoryId).filter((id) => facets.categories.some((category) => category.id === id && category.status === "ACTIVE" && category.kind === "JEWELRY"));
  const requestedStoneGroupIds = values(query.stoneGroupId);
  const stoneGroupIds = [...new Set(requestedStoneGroupIds.filter((id) => id === "other" || stoneGroups.groups.some((group) => group.id === id)))];
  const sizes = [...new Set(values(query.size).filter((size) => size.length <= 24))];
  const parsePrice = (value: SearchValue) => {
    const raw = one(value);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  let minPrice = parsePrice(query.minPrice);
  let maxPrice = parsePrice(query.maxPrice);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) { minPrice = null; maxPrice = null; }
  const search = one(query.search).trim().slice(0, 120);
  const groupSlug = one(query.group);
  const page = Math.max(1, Math.min(100_000, Number.parseInt(one(query.page), 10) || 1));
  const groupPage = Math.max(1, Math.min(100_000, Number.parseInt(one(query.groupPage), 10) || 1));
  const filters: NewArrivalsFilters = {
    mode,
    categoryIds,
    stoneGroupIds,
    sizes,
    minPrice,
    maxPrice,
    sort,
    search,
    page,
    groupPage,
  };
  const apiFilters = { mode, categoryIds, stoneGroupIds, sizes, minPrice, maxPrice, sort, search, page, groupPage };
  const [listResult, detailResult] = groupSlug
    ? [null, await getStoreNewArrivalsGroup(groupSlug, apiFilters)]
    : [await getStoreNewArrivals(apiFilters), null];
  const catalogConnected = Boolean((listResult?.connected ?? detailResult?.connected) && facets.catalogConnected && stoneGroups.connected);
  const connected = catalogConnected && promotions.connected;
  const errorMessage = !catalogConnected
    ? detailResult?.status === 404
      ? "Nhóm đá này không còn hoạt động hoặc đường dẫn không hợp lệ. Hãy quay lại danh sách nhóm đá."
      : "Chưa tải được danh sách trang sức. Lỗi kết nối không được xem là danh sách rỗng."
    : "Chưa tải được dữ liệu khuyến mãi nên GEME đang tạm ẩn giá để tránh hiển thị sai giá sản phẩm.";
  const groups = listResult?.data?.groups || [];
  const selectedGroup = detailResult?.data || null;
  const totalProducts = listResult?.data?.totalProducts ?? selectedGroup?.total ?? 0;
  const configuredHeroImage = getStoreBanner(site.settings, "New Arrivals - Hero", "");
  const fallbackHeroImage = "/assets/new-arrivals-hero.png";
  const heroImage = !configuredHeroImage || configuredHeroImage === "/assets/collection-jewelry-banner-1.png"
    ? fallbackHeroImage
    : configuredHeroImage;

  return <>
    <SiteHeader activePage="new-arrivals" />
    <NewArrivalsGrouped
      groups={groups}
      selectedGroup={selectedGroup}
      categories={facets.categories}
      stoneGroups={stoneGroups.groups}
      facets={listResult?.data?.facets ?? detailResult?.data?.facets}
      promotions={promotions.promotions}
      connected={connected}
      errorMessage={errorMessage}
      heroImage={heroImage}
      filters={filters}
      totalProducts={totalProducts}
      groupPageInfo={listResult?.data?.pageInfo}
    />
    <SiteFooter variant="catalog" />
  </>;
}
