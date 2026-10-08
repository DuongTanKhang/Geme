import Image from "next/image";
import { ProductGrid } from "./components/product-grid";
import { StoreProductGrid } from "./components/store-product-grid";
import { SiteHeader } from "./components/site-header";
import { SiteFooter } from "./components/site-footer";
import {
  getStoreBanner,
  getStoreFacets,
  getStoreProducts,
  getStorePromotions,
  getStoreSalesOverview,
  getStoreSiteSettings,
  selectHomeBestSellers,
  type StoreCategory,
  type StoreMaterial,
} from "./lib/store-api";

function Icon({ name, className = "" }: { name: "heart" | "user" | "bag" | "search" | "diamond" | "shield" | "chat" | "truck" | "arrow"; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true as const };
  if (name === "heart") return <svg {...common}><path d="M20.8 8.8c0 5-8.8 10.3-8.8 10.3S3.2 13.8 3.2 8.8A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.8 2.3Z" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="7.5" r="3.2" /><path d="M5.3 20v-1.6a6.7 6.7 0 0 1 13.4 0V20Z" /></svg>;
  if (name === "bag") return <svg {...common}><path d="M4.5 8h15l1 12h-17l1-12Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.2" /><path d="m15.4 15.4 4.2 4.2" /></svg>;
  if (name === "diamond") return <svg {...common}><path d="m3 9 4-6h10l4 6-9 12L3 9Z" /><path d="M3 9h18M7 3l2.5 6L12 21l2.5-12L17 3" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 20 6v5.7c0 4.5-3.4 7.7-8 9.3-4.6-1.6-8-4.8-8-9.3V6l8-3Z" /><path d="m8.5 11.8 2.2 2.2 4.8-4.8" /></svg>;
  if (name === "chat") return <svg {...common}><path d="M4 5.5A8 8 0 0 1 18 14l2 4-5-.9a8 8 0 1 1-11-11.6Z" /><path d="M7.5 10h.1m4.4 0h.1m4.4 0h.1" strokeWidth="2.4" /></svg>;
  if (name === "truck") return <svg {...common}><path d="M2.5 5.5h12v11h-12zM14.5 9h4l3 3.5v4h-7z" /><circle cx="7" cy="18.5" r="1.7" /><circle cx="18" cy="18.5" r="1.7" /></svg>;
  return <svg {...common}><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

const localGemstoneImages: Record<string, string> = {
  "thach-anh-tim": "/assets/gemstone-quartz-thumb.jpg",
  moonstone: "/assets/gemstone-moonstone-thumb.jpg",
  "ngoc-bich": "/assets/gemstone-jadeite-thumb.jpg",
  opal: "/assets/gemstone-opal-thumb.jpg",
  ruby: "/assets/gemstone-ruby-thumb.jpg",
  tourmaline: "/assets/gemstone-tourmaline-thumb.jpg",
  peridot: "/assets/gemstone-peridot-thumb.jpg",
  aquamarine: "/assets/gemstone-aquamarine-thumb.jpg",
  topaz: "/assets/gem-4-crisp.jpg",
};
const localGemstoneImageSizes: Record<string, [number, number]> = {
  "thach-anh-tim": [112, 112], moonstone: [112, 112], "ngoc-bich": [112, 112], opal: [112, 112],
  ruby: [112, 112], tourmaline: [112, 112], peridot: [112, 112], aquamarine: [112, 112], topaz: [84, 96],
};

type GemstoneLink = { id: string; name: string; slug: string; image: string; sortOrder: number };

function makeGemstoneLinks(categories: StoreCategory[], materials: StoreMaterial[]): GemstoneLink[] {
  const options: GemstoneLink[] = [
    ...materials
      .filter((item) => item.scope === "GEMSTONE" && item.kind === "STONE" && item.active)
      .map((item) => ({ id: item.id, name: item.name, slug: item.slug, image: item.imageUrl || localGemstoneImages[item.slug] || "", sortOrder: item.sortOrder })),
    ...categories
      .filter((item) => item.kind === "GEMSTONE" && item.usage === "GEMSTONE_TYPE" && item.status === "ACTIVE")
      .map((item) => ({ id: item.id, name: item.name, slug: item.slug, image: item.bannerUrl || localGemstoneImages[item.slug] || "", sortOrder: item.sortOrder })),
  ];
  const unique = new Map<string, GemstoneLink>();
  for (const option of options) {
    const current = unique.get(option.slug);
    if (!current) unique.set(option.slug, option);
    else if (!current.image && option.image) unique.set(option.slug, option);
  }
  return [...unique.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

function BrandStrip() {
  return <div className="home-brand-strip" aria-label="Natural Gemstones / Silver Jewelry / GEME">
    <span>NATURAL GEMSTONES&nbsp; / &nbsp;SILVER JEWELRY&nbsp; / &nbsp;GEME</span>
  </div>;
}

function CategoryTiles({ images, jewelryHref }: { images: [string, string]; jewelryHref: string }) {
  return <section className="home-style-section content-width" id="danh-muc" aria-labelledby="home-style-title">
    <h2 id="home-style-title">Chọn theo phong cách</h2>
    <div className="home-style-grid">
      <a className="home-style-card" href={jewelryHref}>
        <span className="home-style-photo"><Image src={images[0]} alt="Trang sức bạc GEME" fill sizes="(max-width: 760px) 100vw, 50vw" /></span>
        <span className="home-style-caption">Trang sức bạc <Icon name="arrow" /></span>
      </a>
      <a className="home-style-card" href="/da-quy">
        <span className="home-style-photo"><Image src={images[1]} alt="Đá quý tự nhiên GEME" fill sizes="(max-width: 760px) 100vw, 50vw" /></span>
        <span className="home-style-caption">Đá quý tự nhiên <Icon name="arrow" /></span>
      </a>
    </div>
  </section>;
}

const lifestyleTiles = [
  { name: "Dây chuyền", match: /dây chuyền|dây đeo cổ|mặt dây/i, image: "/images/home/geme/07-lifestyle-necklace.webp", bannerPosition: "Trang chủ - GEME trên bạn - Dây chuyền", alt: "Dây chuyền Opal trên cổ", position: "50% 52%" },
  { name: "Vòng tay", match: /vòng tay|lắc tay/i, image: "/images/home/geme/08-lifestyle-bangle.webp", bannerPosition: "Trang chủ - GEME trên bạn - Vòng tay", alt: "Vòng ngọc xanh trên cổ tay", position: "50% 50%" },
  { name: "Nhẫn", match: /nhẫn/i, image: "/images/home/geme/09-lifestyle-ring.webp", bannerPosition: "Trang chủ - GEME trên bạn - Nhẫn", alt: "Nhẫn đá quý trên tay", position: "50% 50%" },
  { name: "Khuyên tai", match: /khuyên tai|bông tai|hoa tai/i, image: "/images/home/geme/10-lifestyle-earring.webp", bannerPosition: "Trang chủ - GEME trên bạn - Khuyên tai", alt: "Khuyên tai đá xanh", position: "55% 50%" },
];

function categoryHref(categories: StoreCategory[], expression: RegExp, fallback: string) {
  const match = categories
    .filter((category) => category.kind === "JEWELRY" && category.usage === "PRODUCT_CATEGORY" && category.status === "ACTIVE" && expression.test(category.name))
    .sort((a, b) => b.level - a.level || a.sortOrder - b.sortOrder)[0];
  return match ? `/san-pham?danh-muc=${encodeURIComponent(match.slug)}` : fallback;
}

function HomeGreenEdit({ imageHref, images }: { imageHref: string; images: [string, string] }) {
  return <section className="home-green-edit" aria-labelledby="home-green-edit-title">
    <div className="home-green-edit-inner">
      <div className="home-green-edit-copy">
        <h2 id="home-green-edit-title">THE GREEN<br />EDIT</h2>
        <p>Một sắc xanh. Nhiều cách thể hiện.</p>
        <a href={imageHref}>Khám phá bộ sưu tập Ngọc <Icon name="arrow" /></a>
      </div>
      <div className="home-green-edit-texture"><img src={images[0]} alt="" loading="lazy" decoding="async" /></div>
      <div className="home-green-edit-wrist"><img src={images[1]} alt="Vòng ngọc xanh trên cổ tay" loading="lazy" decoding="async" /></div>
    </div>
  </section>;
}

function HomeLifestyle({ categories, images }: { categories: StoreCategory[]; images: string[] }) {
  const fallbackCategory = categories.find((category) => category.kind === "JEWELRY" && category.usage === "PRODUCT_CATEGORY" && category.level === 1 && !category.parentId && category.status === "ACTIVE");
  const fallbackHref = fallbackCategory ? `/san-pham?danh-muc=${encodeURIComponent(fallbackCategory.slug)}` : "/san-pham";
  return <section className="home-lifestyle content-width" aria-labelledby="home-lifestyle-title">
    <h2 id="home-lifestyle-title">GEME trên bạn</h2>
    <div className="home-lifestyle-grid">
      {lifestyleTiles.map((tile, index) => <a className="home-lifestyle-card" href={categoryHref(categories, tile.match, fallbackHref)} key={tile.name}>
        <span className="home-lifestyle-photo"><img src={images[index] || tile.image} alt={tile.alt} loading="lazy" decoding="async" style={{ objectPosition: tile.position }} /></span>
        <span className="home-lifestyle-name">{tile.name}</span>
      </a>)}
    </div>
  </section>;
}

function Gemstones({ items, connected }: { items: GemstoneLink[]; connected: boolean }) {
  return <section className="home-gemstones content-width" id="da-quy">
    <div className="section-heading gemstone-heading"><div><span className="eyebrow">KHÁM PHÁ ĐÁ QUÝ</span><h2>Tìm viên đá của bạn</h2></div><a href="/da-quy">Xem tất cả <Icon name="arrow" /></a></div>
    {items.length ? <div className="home-gemstone-list">
      {items.slice(0, 6).map((item) => <a className="home-gemstone-item" href={"/da-quy?loai=" + encodeURIComponent(item.slug)} key={item.id}>
        <span className="home-gemstone-photo">{item.image ? <img src={item.image} alt={item.name} width={localGemstoneImageSizes[item.slug]?.[0] || 112} height={localGemstoneImageSizes[item.slug]?.[1] || 112} loading="lazy" decoding="async" /> : <span aria-hidden="true">✧</span>}</span>
        <span className="home-gemstone-name">{item.name}</span>
      </a>)}
    </div> : <p className="home-section-state" role="status">{connected ? "Danh mục đá quý đang được cập nhật." : "Chưa tải được danh mục đá quý. Vui lòng thử lại sau."}</p>}
  </section>;
}

function Footer() { return <SiteFooter />; }

export default async function Home() {
  const [newestProducts, featuredResult, catalogProducts, salesOverview, promotionsResult, site, facets] = await Promise.all([
    getStoreProducts({ newOnly: true, limit: 8 }),
    getStoreProducts({ featuredOnly: true, limit: 8 }),
    getStoreProducts({ limit: 500 }),
    getStoreSalesOverview(),
    getStorePromotions(),
    getStoreSiteSettings(),
    getStoreFacets(),
  ]);
  const bestSellerProducts = selectHomeBestSellers(catalogProducts.products, featuredResult.products, salesOverview.products);
  const storyBanner = getStoreBanner(site.settings, "Trang chủ - Câu chuyện", "/images/home/geme/06-brand-craft.webp");
  const heroBanner = getStoreBanner(site.settings, "Trang chủ - Hero", "/images/home/geme/01-hero-opal.webp");
  const categoryTileImages: [string, string] = [
    getStoreBanner(site.settings, "Trang chủ - Ô Trang sức", "/images/home/geme/02-category-silver.webp"),
    getStoreBanner(site.settings, "Trang chủ - Ô Mặt đá quý", "/images/home/geme/03-category-gems.webp"),
  ];
  const greenEditImages: [string, string] = [
    getStoreBanner(site.settings, "Trang chủ - THE GREEN EDIT - Vân đá", "/images/home/geme/04-green-edit-texture.webp"),
    getStoreBanner(site.settings, "Trang chủ - THE GREEN EDIT - Vòng tay", "/images/home/geme/05-green-edit-wrist.webp"),
  ];
  const lifestyleImages = lifestyleTiles.map((tile) => getStoreBanner(site.settings, tile.bannerPosition, tile.image));
  const jewelryRoot = facets.categories.find((category) => category.kind === "JEWELRY" && category.usage === "PRODUCT_CATEGORY" && category.level === 1 && !category.parentId && category.status === "ACTIVE");
  const jewelryHref = jewelryRoot ? "/san-pham?danh-muc=" + encodeURIComponent(jewelryRoot.slug) : "/san-pham";
  const jade = [
    ...facets.materials.filter((item) => item.scope === "GEMSTONE" && item.kind === "STONE" && item.active),
    ...facets.categories.filter((item) => item.kind === "GEMSTONE" && item.usage === "GEMSTONE_TYPE" && item.status === "ACTIVE"),
  ].find((item) => /ngọc\s*bích|jadeite/i.test(item.name));
  const jadeHref = jade ? "/da-quy?loai=" + encodeURIComponent(jade.slug) : "/da-quy";
  const gemstones = makeGemstoneLinks(facets.categories, facets.materials);

  return <main className="home-page" id="top">
    <SiteHeader />
    <section className="home-hero" aria-label="GEME — Đá quý tự nhiên. Phong cách riêng.">
      <div className="home-hero-copy">
        <h1>GEME</h1>
        <p>Đá quý tự nhiên. Phong cách riêng.</p>
        <div className="home-hero-edition"><span>Bộ sưu tập mới — 2026</span><a href={jewelryHref} className="home-hero-cta">Khám phá <Icon name="arrow" /></a></div>
      </div>
      <div className="home-hero-photo"><Image src={heroBanner} alt="Bàn tay cầm mặt dây chuyền Opal GEME trên nền xám." fill sizes="(max-width: 767px) 100vw, 62vw" preload /></div>
    </section>
    <BrandStrip />
    <CategoryTiles images={categoryTileImages} jewelryHref={jewelryHref} />

    <section className="home-products home-new-products content-width" id="san-pham">
      <div className="section-heading home-section-heading"><div><span className="eyebrow">NEW ARRIVALS</span><h2>Sản phẩm mới nhất</h2></div><a href="/new-arrivals">Xem tất cả <Icon name="arrow" /></a></div>
      <ProductGrid products={newestProducts.products.slice(0, 8)} promotions={promotionsResult.promotions} connected={newestProducts.connected} />
    </section>

    <HomeGreenEdit imageHref={jadeHref} images={greenEditImages} />

    <section className="home-products home-best-sellers content-width" aria-labelledby="home-featured-title">
      <div className="section-heading home-section-heading"><h2 id="home-featured-title">Được yêu thích tại GEME</h2><a href="/san-pham?sort=best-selling">Xem tất cả <Icon name="arrow" /></a></div>
      <StoreProductGrid products={bestSellerProducts} promotions={promotionsResult.promotions} connected={catalogProducts.connected} compact emptyMessage="Chưa có sản phẩm để hiển thị." />
    </section>

    <Gemstones items={gemstones} connected={facets.catalogConnected} />
    <section className="home-story content-width" id="ve-geme">
      <div className="home-story-copy"><h2>Từ thiên nhiên, qua đôi tay.</h2><a href="/ve-geme">Khám phá câu chuyện GEME <Icon name="arrow" /></a></div>
      <div className="home-story-photo"><img src={storyBanner} alt="Nghệ nhân kiểm tra chiếc nhẫn Opal trong quá trình chế tác" loading="lazy" decoding="async" /></div>
    </section>
    <HomeLifestyle categories={facets.categories} images={lifestyleImages} />
    <Footer />
  </main>;
}
