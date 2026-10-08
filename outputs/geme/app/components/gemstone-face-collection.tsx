"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { StoreProductGrid } from "./store-product-grid";
import type { StoreProduct, StorePromotion, StoreSalesProduct } from "../lib/store-api";

export type StoneChoice = { id: string; name: string; slug: string; sortOrder: number };

const priceOptions = [
  ["under2", "Dưới 2.000.000 ₫"],
  ["2to5", "2.000.000 – 5.000.000 ₫"],
  ["5to10", "5.000.000 – 10.000.000 ₫"],
  ["over10", "Trên 10.000.000 ₫"],
] as const;

type FilterState = { stone?: string; price?: string; sort?: string; page?: number };

function setParam(params: URLSearchParams, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") params.delete(key);
  else params.set(key, String(value));
}

function StoneFigure({ stone, index, label, description, image, alt, position, href, large = false }: {
  stone: string;
  index: string;
  label: string;
  description?: string;
  image: string;
  alt: string;
  position: string;
  href?: string;
  large?: boolean;
}) {
  const content = <>
    <div className={large ? "gemstone-gallery-photo gemstone-gallery-photo-large" : "gemstone-gallery-photo gemstone-gallery-photo-small"}>
      <Image
        src={image}
        alt={alt}
        width={1536}
        height={1024}
        priority={large}
        loading={large ? "eager" : "lazy"}
        sizes={large ? "(max-width: 767px) 92vw, 65vw" : "(max-width: 767px) 44vw, 31vw"}
        style={{ objectPosition: position }}
      />
    </div>
    <figcaption className={large ? "gemstone-gallery-caption gemstone-gallery-caption-featured" : "gemstone-gallery-caption"}>
      {large
        ? <><span>{index} / {label}</span><strong>{description}</strong></>
        : <><span>{index} / {label}</span>{href && <span className="gemstone-gallery-arrow" aria-hidden="true">→</span>}</>}
    </figcaption>
  </>;

  return <figure className={"gemstone-gallery-figure" + (large ? " is-featured" : "")} aria-label={stone}>
    {href ? <a className="gemstone-gallery-link" href={href} aria-label={"Khám phá đá " + stone}>{content}</a> : <div className="gemstone-gallery-static">{content}</div>}
  </figure>;
}

export function GemstoneFaceCollection({ activeStone = "", stones, products, promotions, connected, sales = [], initialPriceRange = "", initialSort = "newest", initialPage = 1 }: {
  activeStone?: string;
  stones: StoneChoice[];
  products: StoreProduct[];
  promotions?: StorePromotion[];
  connected: boolean;
  sales?: StoreSalesProduct[];
  initialPriceRange?: string;
  initialSort?: string;
  initialPage?: number;
}) {
  const validStone = stones.some((stone) => stone.slug === activeStone) ? activeStone : "";
  const [selectedStone, setSelectedStone] = useState(validStone);
  const [priceRange, setPriceRange] = useState(priceOptions.some(([key]) => key === initialPriceRange) ? initialPriceRange : "");
  const [sort, setSort] = useState(["newest", "price-asc", "price-desc", "best-selling"].includes(initialSort) ? initialSort : "newest");
  const [page, setPage] = useState(Math.max(1, Number.isFinite(initialPage) ? initialPage : 1));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const salesBySku = useMemo(() => new Map(sales.map((item) => [item.sku, item.sold])), [sales]);
  const hasSalesData = sales.some((item) => item.sold > 0);

  const writeQuery = (patch: FilterState) => {
    const params = new URLSearchParams(window.location.search);
    if (patch.stone !== undefined) setParam(params, "loai", patch.stone);
    if (patch.price !== undefined) setParam(params, "gia", patch.price);
    if (patch.sort !== undefined) setParam(params, "sort", patch.sort === "newest" ? "" : patch.sort);
    if (patch.page !== undefined) setParam(params, "page", patch.page <= 1 ? "" : patch.page);
    window.history.pushState({}, "", "/da-quy" + (params.size ? "?" + params.toString() : ""));
  };

  useEffect(() => {
    const readQuery = () => {
      const params = new URLSearchParams(window.location.search);
      const nextStone = params.get("loai") || "";
      const nextPrice = params.get("gia") || "";
      const nextSort = params.get("sort") || "newest";
      const nextPage = Number(params.get("page") || "1");
      setSelectedStone(stones.some((stone) => stone.slug === nextStone) ? nextStone : "");
      setPriceRange(priceOptions.some(([key]) => key === nextPrice) ? nextPrice : "");
      setSort(["newest", "price-asc", "price-desc", "best-selling"].includes(nextSort) ? nextSort : "newest");
      setPage(Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1);
    };
    window.addEventListener("popstate", readQuery);
    return () => window.removeEventListener("popstate", readQuery);
  }, [stones]);

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFiltersOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [filtersOpen]);

  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const productStones = [product.materialOption?.slug, product.gemstoneType?.slug, product.category?.slug].filter(Boolean);
      const matchesStone = !selectedStone || productStones.includes(selectedStone);
      const matchesPrice = !priceRange ||
        (priceRange === "under2" ? product.price < 2_000_000 :
          priceRange === "2to5" ? product.price >= 2_000_000 && product.price <= 5_000_000 :
            priceRange === "5to10" ? product.price > 5_000_000 && product.price <= 10_000_000 :
              product.price > 10_000_000);
      return matchesStone && matchesPrice;
    });

    return filtered
      .map((product, index) => ({ product, index }))
      .sort((a, b) => {
        if (sort === "price-asc") return a.product.price - b.product.price || a.index - b.index;
        if (sort === "price-desc") return b.product.price - a.product.price || a.index - b.index;
        if (sort === "best-selling") return (salesBySku.get(b.product.sku) || 0) - (salesBySku.get(a.product.sku) || 0) || a.index - b.index;
        return new Date(b.product.createdAt || 0).getTime() - new Date(a.product.createdAt || 0).getTime() || a.index - b.index;
      })
      .map(({ product }) => product);
  }, [products, selectedStone, priceRange, sort, salesBySku]);

  const clearFilters = () => {
    setSelectedStone("");
    setPriceRange("");
    setSort("newest");
    setPage(1);
    setFiltersOpen(false);
    window.history.pushState({}, "", "/da-quy");
  };

  const selectStone = (slug: string) => {
    setSelectedStone(slug);
    setPage(1);
    writeQuery({ stone: slug, page: 1 });
  };

  const selectPrice = (value: string) => {
    setPriceRange(value);
    setPage(1);
    writeQuery({ price: value, page: 1 });
  };

  const selectSort = (value: string) => {
    setSort(value);
    writeQuery({ sort: value, page: 1 });
    setPage(1);
  };

  const showMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    writeQuery({ page: nextPage });
  };

  const filteredCount = Number(Boolean(selectedStone)) + Number(Boolean(priceRange));
  const displayProducts = filteredProducts.slice(0, page * 12);
  const stoneHref = (slug: string) => "/da-quy?loai=" + encodeURIComponent(slug);
  const emerald = stones.find((stone) => stone.slug === "emerald");
  const opal = stones.find((stone) => stone.slug === "opal");
  const aquamarine = stones.find((stone) => stone.slug === "aquamarine");

  return <main className="gemstone-collection-page">
    <div className="gemstone-page-container">
      <section className="gemstone-page-heading" aria-labelledby="gemstone-page-title">
        <span className="gemstone-page-eyebrow">GEME / THE GEMSTONE COLLECTION</span>
        <div className="gemstone-page-title-row">
          <h1 id="gemstone-page-title">Sắc đá. Chất riêng.</h1>
          <p>Đá quý thiên nhiên, được chọn để kể câu chuyện của riêng bạn.</p>
        </div>
      </section>

      <section className="gemstone-gallery" aria-label="Khám phá các loại đá quý">
        <StoneFigure stone="Emerald" index="01" label="EMERALD" description="Chiều sâu của sắc xanh" image="/assets/geme-gemstones-emerald.png" alt="Tay cầm viên Emerald xanh lục trên nền sáng" position="60% 50%" href={emerald ? stoneHref(emerald.slug) : undefined} large />
        <div className="gemstone-gallery-side">
          <StoneFigure stone="Opal" index="02" label="OPAL" image="/assets/geme-gemstones-opal.png" alt="Viên Opal nhiều sắc màu trên nền vải tự nhiên" position="55% 50%" href={opal ? stoneHref(opal.slug) : undefined} />
          <StoneFigure stone="Aquamarine" index="03" label="AQUAMARINE" image="/assets/geme-gemstones-aquamarine.png" alt="Viên Aquamarine xanh lam trên nền vải tự nhiên" position="50% 50%" href={aquamarine ? stoneHref(aquamarine.slug) : undefined} />
        </div>
      </section>

      <section className="gemstone-products" id="gemstone-products" aria-labelledby="gemstone-products-title">
        <div className="gemstone-products-heading">
          <h2 id="gemstone-products-title">Bộ sưu tập đá quý</h2>
          <button type="button" className="gemstone-view-all" onClick={clearFilters}>Xem tất cả <span aria-hidden="true">→</span></button>
        </div>

        <nav className="gemstone-type-tabs" aria-label="Lọc theo loại đá">
          <button type="button" className={!selectedStone ? "is-active" : ""} aria-pressed={!selectedStone} onClick={() => selectStone("")}>Tất cả</button>
          {stones.map((stone) => <button type="button" key={stone.id} className={selectedStone === stone.slug ? "is-active" : ""} aria-pressed={selectedStone === stone.slug} onClick={() => selectStone(stone.slug)}>{stone.name}</button>)}
        </nav>

        <div className="gemstone-product-toolbar">
          <div className="gemstone-filter-control">
            <button ref={filterButtonRef} type="button" className="gemstone-filter-toggle" aria-expanded={filtersOpen} aria-controls="gemstone-filter-panel" onClick={() => setFiltersOpen((open) => !open)}>
              Bộ lọc{filteredCount ? " (" + filteredCount + ")" : ""} <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
            </button>
            {filtersOpen && <div className="gemstone-filter-panel" id="gemstone-filter-panel" role="region" aria-label="Bộ lọc sản phẩm">
              {stones.length > 0 && <fieldset>
                <legend>Loại đá</legend>
                <label><input type="radio" name="gemstone-filter-stone" checked={!selectedStone} onChange={() => selectStone("")} /> Tất cả</label>
                {stones.map((stone) => <label key={stone.id}><input type="radio" name="gemstone-filter-stone" checked={selectedStone === stone.slug} onChange={() => selectStone(stone.slug)} /> {stone.name}</label>)}
              </fieldset>}
              <fieldset>
                <legend>Khoảng giá</legend>
                <label><input type="radio" name="gemstone-filter-price" checked={!priceRange} onChange={() => selectPrice("")} /> Tất cả mức giá</label>
                {priceOptions.map(([value, label]) => <label key={value}><input type="radio" name="gemstone-filter-price" checked={priceRange === value} onChange={() => selectPrice(value)} /> {label}</label>)}
              </fieldset>
              <button type="button" className="gemstone-filter-reset" onClick={clearFilters}>Đặt lại bộ lọc</button>
            </div>}
          </div>
          <label className="gemstone-sort-control"><span>Sắp xếp</span>
            <select value={sort} onChange={(event) => selectSort(event.target.value)} aria-label="Sắp xếp sản phẩm đá quý">
              <option value="newest">Mới nhất</option>
              {hasSalesData && <option value="best-selling">Bán chạy</option>}
              <option value="price-asc">Giá tăng dần</option>
              <option value="price-desc">Giá giảm dần</option>
            </select>
          </label>
        </div>
        <p className="gemstone-results-count" role="status" aria-live="polite">{filteredProducts.length} sản phẩm</p>
        <StoreProductGrid products={displayProducts} promotions={promotions} connected={connected} emptyMessage="Chưa có sản phẩm đá quý phù hợp với lựa chọn này." />
        {displayProducts.length < filteredProducts.length && <button type="button" className="gemstone-load-more" onClick={showMore}>Khám phá thêm <span aria-hidden="true">→</span></button>}
      </section>
    </div>

    <section className="gemstone-advice-strip" aria-label="Tư vấn đá quý">
      <div className="gemstone-advice-inner">
        <h2>Một viên đá, một dấu ấn riêng.</h2>
        <a href="/lien-he">GEME tư vấn cho bạn <span aria-hidden="true">→</span></a>
      </div>
    </section>
  </main>;
}
