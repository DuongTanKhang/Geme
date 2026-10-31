import type { Metadata } from "next";
import { SiteHeader } from "../components/site-header";
import { OpalCollection } from "../components/opal-collection";
import { CollectionBanner } from "../components/collection-banner";
import { SiteFooter } from "../components/site-footer";
import { getStoreBanner, getStoreCatalog, getStoreCatalogEditorialPromos, getStoreFacets, getStoreJewelryCarouselBanners, getStoreProducts, getStorePromotions, getStoreSalesOverview, getStoreSiteSettings, orderStoreProductsForBestSelling } from "../lib/store-api";
import { StructuredData } from "../components/structured-data";
import { absoluteSiteUrl, plainText } from "../lib/seo";

type SearchValue = string | string[] | undefined;
type ProductsPageProps = { searchParams: Promise<{ loai?: SearchValue; "danh-muc"?: SearchValue; sort?: SearchValue; search?: SearchValue }> };
const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] || "" : value || "";

export async function generateMetadata({ searchParams }: ProductsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const categorySlug = firstValue(params["danh-muc"]);
  const stoneSlug = firstValue(params.loai);
  const sort = firstValue(params.sort);
  const search = firstValue(params.search).trim();
  const hasFilters = Boolean(categorySlug || stoneSlug || sort || search);
  let category: Awaited<ReturnType<typeof getStoreCatalog>>["categories"][number] | undefined;
  let stoneName = "";
  if (categorySlug || stoneSlug) {
    const facets = await getStoreFacets();
    if (!facets.catalogConnected) throw new Error("Không thể tải danh mục GEME từ API.");
    category = facets.categories.find((item) => item.slug === categorySlug && item.status === "ACTIVE" && item.usage === "PRODUCT_CATEGORY");
    stoneName = facets.materials.find((item) => item.slug === stoneSlug && item.active && item.scope === "JEWELRY" && item.kind === "STONE")?.name || "";
  }
  const title = [category?.name, stoneName].filter(Boolean).join(" · ") || "Trang sức đá quý thiên nhiên";
  const description = plainText(category?.seoDescription || category?.description, 320) || "Khám phá trang sức bạc và đá quý thiên nhiên GEME, với những thiết kế tinh tế lưu giữ dấu ấn riêng.";
  return { title: category?.seoTitle ? { absolute: plainText(category.seoTitle, 180) } : title, description, alternates: { canonical: "/san-pham" }, ...(hasFilters ? { robots: { index: false, follow: true } } : {}) };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const stoneSlug = Array.isArray(params.loai) ? params.loai[0] : params.loai;
  const categorySlug = Array.isArray(params["danh-muc"]) ? params["danh-muc"][0] : params["danh-muc"];
  const sortParam = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const search = firstValue(params.search).trim().slice(0, 100);
  const bestSelling = sortParam === "best-selling";
  const [catalog, promotions, site, sales, featured] = await Promise.all([
    getStoreCatalog(search),
    getStorePromotions(),
    getStoreSiteSettings(),
    bestSelling ? getStoreSalesOverview() : Promise.resolve({ products: [], connected: false }),
    bestSelling ? getStoreProducts({ featuredOnly: true, limit: 8 }) : Promise.resolve({ products: [], connected: false }),
  ]);
  const { products, categories, materials, connected } = catalog;
  if (!connected || !catalog.catalogConnected) throw new Error("Không thể tải danh sách sản phẩm từ GEME API.");
  const bestSellerOrder = bestSelling ? orderStoreProductsForBestSelling(products, featured.products, sales.products).map((product) => product.id) : [];
  const configuredCollectionSlides = getStoreJewelryCarouselBanners(site.settings).map((banner, index) => ({
    id: banner.id || banner.position,
    src: banner.imageUrl,
    alt: banner.name || `Bộ sưu tập trang sức GEME ${index + 1}`,
    position: ["68% 50%", "69% 50%", "68% 50%", "68% 50%", "69% 50%"][Number(banner.position.match(/[1-5]$/)?.[0] || index + 1) - 1],
    captionIndex: Number(banner.position.match(/[1-5]$/)?.[0] || index + 1) - 1,
    eyebrow: banner.eyebrow,
    title: banner.title,
    description: banner.description,
    ctaLabel: banner.ctaLabel,
    href: banner.href,
  }));
  const editorialPromos = getStoreCatalogEditorialPromos(site.settings);
  const selectedCategory = categories.find((category) => category.slug === categorySlug && category.status === "ACTIVE" && category.usage === "PRODUCT_CATEGORY");
  const selectedStone = materials.find((material) => material.slug === stoneSlug && material.scope === "JEWELRY" && material.kind === "STONE" && material.active);
  const breadcrumbSchema = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Trang chủ", item: absoluteSiteUrl("/") }, { "@type": "ListItem", position: 2, name: "Sản phẩm", item: absoluteSiteUrl("/san-pham") }] };
  return <>
    <StructuredData value={breadcrumbSchema} />
    <main className="all-products-page" id="top">
      <SiteHeader />
      <CollectionBanner slides={selectedCategory?.bannerUrl ? [{ id: `category-${selectedCategory.id}`, src: selectedCategory.bannerUrl, alt: selectedCategory.name, eyebrow: "COLLECTION / GEME", title: selectedCategory.name, description: selectedCategory.description || "Trang sức bạc tinh tế kết hợp đá quý thiên nhiên, lưu giữ vẻ đẹp riêng trong từng khoảnh khắc.", ctaLabel: "Khám phá trang sức", href: "#san-pham", position: "68% 50%" }] : configuredCollectionSlides.length ? configuredCollectionSlides : undefined} />
      <div className="catalog-breadcrumb catalog-breadcrumb-inline"><a href="/">Trang chủ</a><span>/</span><span>Sản phẩm</span><span>/</span><span>{selectedCategory?.name || "Tất cả sản phẩm"}</span></div>
      <OpalCollection key={`${categorySlug ?? ""}-${stoneSlug ?? ""}-${sortParam ?? ""}-${search}`} products={products} categories={categories} materials={materials} connected={connected} promotions={promotions.promotions} editorialPromos={editorialPromos} initialCategoryId={selectedCategory?.id} initialCategory={selectedCategory?.name} initialStoneSlug={selectedStone?.slug} initialStoneName={selectedStone?.name} initialSearch={search} initialSort={bestSelling ? "best-selling" : "newest"} bestSellerOrder={bestSellerOrder} />
    </main>
    <SiteFooter variant="catalog" />
  </>;
}
