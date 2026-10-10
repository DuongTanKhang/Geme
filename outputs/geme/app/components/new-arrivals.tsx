"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { StoreProductCard } from "./store-product-grid";
import { useViewportAutoplayVideo } from "./use-viewport-video";
import type { StoreCategory, StoreMaterial, StoreNewArrivalsMedia, StoreProduct, StorePromotion } from "../lib/store-api";

const PRODUCT_PAGE_SIZE = 12;

const priceRanges = [
  ["under2", "Dưới 2.000.000 ₫"],
  ["2to5", "2.000.000 – 5.000.000 ₫"],
  ["5to10", "5.000.000 – 10.000.000 ₫"],
  ["over10", "Trên 10.000.000 ₫"],
] as const;

export type NewArrivalsFilters = {
  categoryIds: string[];
  stoneKeys: string[];
  priceRange: string;
  sort: string;
  search: string;
};

type StoneFilterOption = { value: string; label: string };

function isLocalOrPublicMediaUrl(value: string) {
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

function withFiltersInUrl(currentSearch: string, filters: NewArrivalsFilters) {
  const params = new URLSearchParams(currentSearch);
  for (const key of ["categoryId", "stone", "price", "sort", "search"]) params.delete(key);
  filters.categoryIds.forEach((id) => params.append("categoryId", id));
  filters.stoneKeys.forEach((key) => params.append("stone", key));
  if (filters.priceRange) params.set("price", filters.priceRange);
  if (filters.sort && filters.sort !== "newest") params.set("sort", filters.sort);
  if (filters.search) params.set("search", filters.search);
  return params.toString();
}

function NewArrivalsSkeleton() {
  return <div className="new-arrivals-skeleton-grid" aria-label="Đang tải thiết kế mới" aria-busy="true">
    {Array.from({ length: 8 }, (_, index) => <div className="new-arrivals-skeleton-card" key={index}><span /><i /><i /></div>)}
  </div>;
}

function NewArrivalEditorial({ media }: { media: StoreNewArrivalsMedia }) {
  const configuredImage = media.editorialImageUrl.trim();
  const image = isLocalOrPublicMediaUrl(configuredImage) ? configuredImage : "/assets/new-arrivals-hero.png";
  return <article className="new-arrivals-editorial">
    <div className="new-arrivals-editorial-image"><img src={image} alt={media.editorialAltText || "Vòng cẩm thạch trên tay, sắc xanh dịu nhẹ"} loading="lazy" /></div>
    <div className="new-arrivals-editorial-copy">
      <span>VỪA ĐẾN GEME</span>
      <h3>Sắc xanh cho ngày mới.</h3>
      <a href={isLocalOrPublicMediaUrl(media.editorialHref) ? media.editorialHref : "/san-pham#san-pham"}>{media.editorialCtaLabel || "Khám phá →"}</a>
    </div>
  </article>;
}

function NewArrivalsVideo({ media }: { media: StoreNewArrivalsMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const configuredVideo = media.videoUrl.trim();
  const configuredPoster = media.videoPosterUrl.trim();
  const videoUrl = configuredVideo && isLocalOrPublicMediaUrl(configuredVideo) ? configuredVideo : "";
  const posterUrl = configuredPoster && isLocalOrPublicMediaUrl(configuredPoster) ? configuredPoster : "/assets/journal/07-craftsmanship.png";
  useViewportAutoplayVideo(videoRef, Boolean(videoUrl));
  return <section className="new-arrivals-video" aria-label="Cận cảnh chế tác GEME">
    <div className="new-arrivals-video-copy">
      <span>CẬN CẢNH</span>
      <h3>Đẹp trong từng chuyển động.</h3>
    </div>
    <div className="new-arrivals-video-media">
      {videoUrl
        ? <video ref={videoRef} src={videoUrl} poster={posterUrl} controls preload="none" playsInline muted loop aria-label="Video chế tác trang sức GEME" />
        : <img src={posterUrl} alt={media.videoAltText || "Nghệ nhân kiểm tra chi tiết nhẫn Moonstone GEME"} loading="lazy" />}
    </div>
  </section>;
}

export function NewArrivals({
  products,
  categories,
  materials,
  promotions,
  media,
  connected,
  heroImage,
  filters,
}: {
  products: StoreProduct[];
  categories: StoreCategory[];
  materials: StoreMaterial[];
  promotions: StorePromotion[];
  media: StoreNewArrivalsMedia;
  connected: boolean;
  heroImage: string;
  filters: NewArrivalsFilters;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftCategoryIds, setDraftCategoryIds] = useState(filters.categoryIds);
  const [draftStoneKeys, setDraftStoneKeys] = useState(filters.stoneKeys);
  const [draftPriceRange, setDraftPriceRange] = useState(filters.priceRange);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);
  const [newsletterNotice, setNewsletterNotice] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const committedFilters = useRef(filters);

  useEffect(() => {
    committedFilters.current = filters;
    setDraftCategoryIds(filters.categoryIds);
    setDraftStoneKeys(filters.stoneKeys);
    setDraftPriceRange(filters.priceRange);
    setVisibleCount(PRODUCT_PAGE_SIZE);
  }, [filters]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!filtersOpen || !isMobile) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const panel = filterPanelRef.current;
    panel?.focus();
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFiltersOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [filtersOpen, isMobile]);

  const categoryOptions = useMemo(() => categories
    .filter((category) => category.status === "ACTIVE" && category.usage === "PRODUCT_CATEGORY" && category.kind === "JEWELRY" && category.level > 1)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi")), [categories]);
  const tabs = useMemo(() => {
    const levelTwo = categoryOptions.filter((category) => category.level === 2);
    return levelTwo.length ? levelTwo : categoryOptions;
  }, [categoryOptions]);
  const stoneOptions = useMemo<StoneFilterOption[]>(() => {
    const materialStones = materials.filter((item) => item.active && item.kind === "STONE").map((item) => ({ value: `m:${item.id}`, label: item.name }));
    const categoryStones = categories.filter((item) => item.status === "ACTIVE" && item.usage === "GEMSTONE_TYPE").map((item) => ({ value: `g:${item.id}`, label: item.name }));
    const unique = new Map<string, StoneFilterOption>();
    for (const option of [...materialStones, ...categoryStones]) if (!unique.has(option.value)) unique.set(option.value, option);
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [categories, materials]);

  const activeFilterCount = filters.categoryIds.length + filters.stoneKeys.length + Number(Boolean(filters.priceRange)) + Number(Boolean(filters.search));
  const activeFilters = activeFilterCount > 0;
  const uniqueProducts = useMemo(() => [...new Map(products.map((product) => [product.id, product] as const)).values()], [products]);
  const visibleProducts = uniqueProducts.slice(0, visibleCount);
  const featureProducts = activeFilters ? [] : visibleProducts.slice(0, 4);
  const nextRowProducts = activeFilters ? [] : visibleProducts.slice(4, 8);
  const remainingProducts = activeFilters ? visibleProducts : visibleProducts.slice(8);

  const commitFilters = (next: NewArrivalsFilters) => {
    committedFilters.current = next;
    const query = withFiltersInUrl(searchParams.toString(), next);
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    startTransition(() => router.push(`${pathname}${query ? `?${query}` : ""}${hash}`, { scroll: false }));
  };
  const updateCategory = (categoryId: string) => {
    const next = { ...committedFilters.current, categoryIds: categoryId ? [categoryId] : [] };
    setDraftCategoryIds(next.categoryIds);
    commitFilters(next);
  };
  const applyFilters = () => {
    commitFilters({ ...committedFilters.current, categoryIds: draftCategoryIds, stoneKeys: draftStoneKeys, priceRange: draftPriceRange });
    setFiltersOpen(false);
  };
  const resetFilters = () => {
    const next = { ...committedFilters.current, categoryIds: [], stoneKeys: [], priceRange: "", search: "", sort: "newest" };
    setDraftCategoryIds([]);
    setDraftStoneKeys([]);
    setDraftPriceRange("");
    commitFilters(next);
  };
  const toggleValue = (value: string, selected: string[], setSelected: (values: string[]) => void) => {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };
  const submitNewsletter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewsletterNotice("Chức năng đăng ký email chưa được kết nối với hệ thống.");
  };

  return <main className="new-arrivals-page" id="top">
    <section className="new-arrivals-hero" aria-labelledby="arrivals-title">
      <div className="new-arrivals-hero-copy">
        <span className="new-arrivals-eyebrow">GEME / NEW ARRIVALS</span>
        <h1 id="arrivals-title">New Arrivals</h1>
        <p className="new-arrivals-subtitle">Những thiết kế mới, dành cho dấu ấn riêng.</p>
        <a className="new-arrivals-cta" href="#arrivals-products">Khám phá ngay <span aria-hidden="true">→</span></a>
      </div>
      <div className="new-arrivals-hero-media">
        <Image className="new-arrivals-hero-image" src={heroImage} alt="Nhẫn Moonstone bạc trên bàn tay, bộ sưu tập mới của GEME" fill sizes="(max-width: 767px) 100vw, (max-width: 1279px) 54vw, 690px" preload />
      </div>
    </section>

    <section className="new-arrivals-products" id="arrivals-products" aria-labelledby="new-arrivals-heading">
      <div className="new-arrivals-container">
        <nav className="new-arrivals-breadcrumb" aria-label="Đường dẫn trang">
          <a href="/">Trang chủ</a><span aria-hidden="true">/</span><span aria-current="page">New Arrivals</span>
        </nav>

        <div className="new-arrivals-toolbar">
          <div className="new-arrivals-heading-row">
            <h2 id="new-arrivals-heading">Mới tại GEME</h2>
            <p role="status" aria-live="polite">{uniqueProducts.length} thiết kế mới</p>
          </div>
          <div className="new-arrivals-tabs" role="group" aria-label="Lọc theo danh mục">
            <button type="button" className={!filters.categoryIds.length ? "is-selected" : ""} aria-pressed={!filters.categoryIds.length} onClick={() => updateCategory("")}>Tất cả</button>
            {tabs.map((category) => <button type="button" key={category.id} className={filters.categoryIds.length === 1 && filters.categoryIds[0] === category.id ? "is-selected" : ""} aria-pressed={filters.categoryIds.length === 1 && filters.categoryIds[0] === category.id} onClick={() => updateCategory(category.id)}>{category.name}</button>)}
          </div>
          <div className="new-arrivals-actions">
            <button type="button" className="new-arrivals-filter-toggle" aria-expanded={filtersOpen} aria-controls="new-arrivals-filter-panel" onClick={() => setFiltersOpen((open) => !open)}>
              Bộ lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
            </button>
            <label className="new-arrivals-sort"><span>Sắp xếp</span><select value={filters.sort} onChange={(event) => commitFilters({ ...committedFilters.current, sort: event.target.value })}>
              <option value="newest">Mới nhất ↓</option>
              <option value="price-asc" disabled>Giá tăng dần · API chưa hỗ trợ</option>
              <option value="price-desc" disabled>Giá giảm dần · API chưa hỗ trợ</option>
            </select></label>
          </div>
        </div>

        {filtersOpen && <>
          <button type="button" className="new-arrivals-filter-overlay" aria-hidden={!isMobile} tabIndex={isMobile ? 0 : -1} aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)} />
          <div className="new-arrivals-filter-panel" id="new-arrivals-filter-panel" ref={filterPanelRef} role={isMobile ? "dialog" : undefined} aria-modal={isMobile ? true : undefined} aria-labelledby="new-arrivals-filter-title" tabIndex={isMobile ? -1 : undefined}>
          <div className="new-arrivals-filter-header"><h3 id="new-arrivals-filter-title">Bộ lọc</h3><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)}>×</button></div>
          {categoryOptions.length > 0 && <fieldset>
            <legend>Loại sản phẩm</legend>
            {categoryOptions.map((category) => <label key={category.id}><input type="checkbox" checked={draftCategoryIds.includes(category.id)} onChange={() => toggleValue(category.id, draftCategoryIds, setDraftCategoryIds)} />{category.name}</label>)}
          </fieldset>}
          {stoneOptions.length > 0 && <fieldset>
            <legend>Loại đá</legend>
            {stoneOptions.map((stone) => <label key={stone.value}><input type="checkbox" checked={draftStoneKeys.includes(stone.value)} onChange={() => toggleValue(stone.value, draftStoneKeys, setDraftStoneKeys)} />{stone.label}</label>)}
          </fieldset>}
          <fieldset>
            <legend>Khoảng giá</legend>
            {priceRanges.map(([value, label]) => <label className="is-unavailable" key={value}><input type="radio" name="new-arrivals-price" checked={false} disabled />{label}</label>)}
            <small className="new-arrivals-filter-note">API hiện chưa có bộ lọc khoảng giá.</small>
          </fieldset>
          <div className="new-arrivals-filter-actions">
            <button type="button" className="new-arrivals-reset" onClick={resetFilters}>Xóa bộ lọc</button>
            <button type="button" className="new-arrivals-apply" onClick={applyFilters}>Áp dụng</button>
          </div>
          </div>
        </>}

        <div className="new-arrivals-card-area" aria-busy={isPending}>
          {isPending ? <NewArrivalsSkeleton /> : !connected ? <div className="new-arrivals-message is-error" role="alert"><p>Chưa tải được danh sách thiết kế. Kiểm tra kết nối rồi thử lại.</p><button type="button" onClick={() => router.refresh()}>Thử lại</button></div>
            : uniqueProducts.length === 0 ? <>
              <div className="new-arrivals-message" role="status"><p>{activeFilters ? "Không có thiết kế mới phù hợp với lựa chọn này." : "Hiện chưa có sản phẩm mới đang bán."}</p>{activeFilters && <button type="button" onClick={resetFilters}>Xóa bộ lọc</button>}</div>
              {!activeFilters && <div className="new-arrivals-empty-media">
                <div className="new-arrivals-editorial-standalone"><NewArrivalEditorial media={media} /></div>
                <NewArrivalsVideo media={media} />
              </div>}
            </>
              : <>
                {featureProducts.length > 0 && <div className="new-arrivals-feature-grid">
                  <NewArrivalEditorial media={media} />
                  {featureProducts.map((product) => <div className="new-arrivals-feature-product" key={product.id}><StoreProductCard product={product} promotions={promotions} /></div>)}
                </div>}
                {nextRowProducts.length > 0 && <div className="new-arrivals-product-grid">{nextRowProducts.map((product) => <StoreProductCard key={product.id} product={product} promotions={promotions} />)}</div>}
                {!activeFilters && <NewArrivalsVideo media={media} />}
                {remainingProducts.length > 0 && <div className="new-arrivals-product-grid">{remainingProducts.map((product) => <StoreProductCard key={product.id} product={product} promotions={promotions} />)}</div>}
              </>}
        </div>
        {!isPending && connected && visibleCount < uniqueProducts.length && <button type="button" className="new-arrivals-load-more" onClick={() => setVisibleCount((count) => Math.min(count + PRODUCT_PAGE_SIZE, uniqueProducts.length))}>Xem thêm thiết kế mới <span aria-hidden="true">→</span></button>}
      </div>
    </section>

    <section className="new-arrivals-newsletter" aria-labelledby="new-arrivals-newsletter-title">
      <div className="new-arrivals-container new-arrivals-newsletter-inner">
        <div><h2 id="new-arrivals-newsletter-title">Nhận tin mới từ GEME</h2></div>
        <form onSubmit={submitNewsletter}>
          <label className="sr-only" htmlFor="new-arrivals-email">Địa chỉ email của bạn</label>
          <input id="new-arrivals-email" type="email" placeholder="Nhập email của bạn" required autoComplete="email" />
          <button type="submit" aria-label="Đăng ký nhận tin">→</button>
          {newsletterNotice && <span role="status" aria-live="polite">{newsletterNotice}</span>}
        </form>
      </div>
    </section>
  </main>;
}
