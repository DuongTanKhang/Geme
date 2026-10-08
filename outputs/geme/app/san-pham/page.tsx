import { SiteHeader } from "../components/site-header";
import { OpalCollection } from "../components/opal-collection";
import { CollectionBanner } from "../components/collection-banner";
import { SiteFooter } from "../components/site-footer";
import { getStoreBanner, getStoreCatalog, getStoreCatalogEditorialPromos, getStoreJewelryCarouselBanners, getStoreProducts, getStorePromotions, getStoreSalesOverview, getStoreSiteSettings, orderStoreProductsForBestSelling } from "../lib/store-api";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ loai?: string | string[]; "danh-muc"?: string | string[]; sort?: string | string[] }> }) {
  const params = await searchParams;
  const stoneSlug = Array.isArray(params.loai) ? params.loai[0] : params.loai;
  const categorySlug = Array.isArray(params["danh-muc"]) ? params["danh-muc"][0] : params["danh-muc"];
  const sortParam = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const bestSelling = sortParam === "best-selling";
  const [catalog, promotions, site, sales, featured] = await Promise.all([
    getStoreCatalog(),
    getStorePromotions(),
    getStoreSiteSettings(),
    bestSelling ? getStoreSalesOverview() : Promise.resolve({ products: [], connected: false }),
    bestSelling ? getStoreProducts({ featuredOnly: true, limit: 8 }) : Promise.resolve({ products: [], connected: false }),
  ]);
  const { products, categories, materials, connected } = catalog;
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
  return <>
    <main className="all-products-page" id="top">
      <SiteHeader />
      <CollectionBanner slides={selectedCategory?.bannerUrl ? [{ id: `category-${selectedCategory.id}`, src: selectedCategory.bannerUrl, alt: selectedCategory.name, eyebrow: "COLLECTION / GEME", title: selectedCategory.name, description: selectedCategory.description || "Trang sức bạc tinh tế kết hợp đá quý thiên nhiên, lưu giữ vẻ đẹp riêng trong từng khoảnh khắc.", ctaLabel: "Khám phá trang sức", href: "#san-pham", position: "68% 50%" }] : configuredCollectionSlides.length ? configuredCollectionSlides : undefined} />
      <div className="catalog-breadcrumb catalog-breadcrumb-inline"><a href="/">Trang chủ</a><span>/</span><span>Sản phẩm</span><span>/</span><span>{selectedCategory?.name || "Tất cả sản phẩm"}</span></div>
      <OpalCollection key={`${categorySlug ?? ""}-${stoneSlug ?? ""}-${sortParam ?? ""}`} products={products} categories={categories} materials={materials} connected={connected} promotions={promotions.promotions} editorialPromos={editorialPromos} initialCategoryId={selectedCategory?.id} initialCategory={selectedCategory?.name} initialStoneSlug={selectedStone?.slug} initialStoneName={selectedStone?.name} initialSort={bestSelling ? "best-selling" : "newest"} bestSellerOrder={bestSellerOrder} />
    </main>
    <SiteFooter variant="catalog" />
  </>;
}
