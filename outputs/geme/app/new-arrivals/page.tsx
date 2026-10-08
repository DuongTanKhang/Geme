import { NewArrivals, type NewArrivalsFilters } from "../components/new-arrivals";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBanner, getStoreFacets, getStoreNewArrivalsMedia, getStoreProducts, getStorePromotions, getStoreSiteSettings } from "../lib/store-api";

type SearchValue = string | string[] | undefined;
type SearchParams = Record<string, SearchValue>;

function values(value: SearchValue) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.trim()).filter(Boolean);
}

function descendants(categoryIds: string[], categories: Awaited<ReturnType<typeof getStoreFacets>>["categories"]) {
  const all = new Set(categoryIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && all.has(category.parentId) && !all.has(category.id)) {
        all.add(category.id);
        changed = true;
      }
    }
  }
  return [...all];
}

export default async function NewArrivalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [query, facets, promotions, site] = await Promise.all([
    searchParams,
    getStoreFacets(),
    getStorePromotions(),
    getStoreSiteSettings(),
  ]);

  const categoryIds = values(query.categoryId).filter((id) => facets.categories.some((category) => category.id === id && category.status === "ACTIVE"));
  const stoneKeys = values(query.stone);
  const stoneQueries: Array<{ materialOptionId?: string; gemstoneTypeId?: string }> = [];
  for (const key of stoneKeys) {
    const [prefix, id] = key.split(":", 2);
    if (!id) continue;
    if (prefix === "m" && facets.materials.some((item) => item.id === id && item.active && item.kind === "STONE")) stoneQueries.push({ materialOptionId: id });
    if (prefix === "g" && facets.categories.some((item) => item.id === id && item.status === "ACTIVE" && item.usage === "GEMSTONE_TYPE")) stoneQueries.push({ gemstoneTypeId: id });
  }
  const categoryQueries = descendants(categoryIds, facets.categories);
  const categoryBranches: Array<string | undefined> = categoryQueries.length ? categoryQueries : [undefined];
  const stoneBranches: Array<{ materialOptionId?: string; gemstoneTypeId?: string } | undefined> = stoneQueries.length ? stoneQueries : [undefined];
  const search = (Array.isArray(query.search) ? query.search[0] : query.search || "").trim();
  const requests = categoryBranches.flatMap((categoryId) => stoneBranches.map((stone) => ({ categoryId, ...stone })));
  const productResults = await Promise.all((requests.length ? requests : [{}]).map((filters) => getStoreProducts({
    newOnly: true,
    limit: 500,
    search,
    ...filters,
  })));
  const connected = productResults.every((result) => result.connected);
  const mergedProducts = new Map<string, (typeof productResults)[number]["products"][number]>();
  for (const result of productResults) for (const product of result.products) if (!mergedProducts.has(product.id)) mergedProducts.set(product.id, product);
  // Preserve the API's ordering within each branch while deduplicating products
  // that match more than one selected category/material branch.
  const products = productResults.length === 1 ? productResults[0].products : [...mergedProducts.values()];

  const filters: NewArrivalsFilters = {
    categoryIds,
    stoneKeys: stoneQueries.length ? stoneKeys : [],
    priceRange: "",
    sort: "newest",
    search,
  };
  const configuredHeroImage = getStoreBanner(site.settings, "New Arrivals - Hero", "");
  const fallbackHeroImage = "/assets/new-arrivals-hero.png";
  const heroImage = !configuredHeroImage || configuredHeroImage === "/assets/collection-jewelry-banner-1.png"
    ? fallbackHeroImage
    : configuredHeroImage;

  return <>
    <SiteHeader activePage="new-arrivals" />
    <NewArrivals
      products={products}
      categories={facets.categories}
      materials={facets.materials}
      promotions={promotions.promotions}
      media={getStoreNewArrivalsMedia(site.settings)}
      connected={connected && facets.catalogConnected}
      heroImage={heroImage}
      filters={filters}
    />
    <SiteFooter variant="catalog" />
  </>;
}
