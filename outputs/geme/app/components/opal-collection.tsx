"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogEditorialGrid } from "./catalog-editorial-grid";
import type { StoreCatalogEditorialPromo, StoreCategory, StoreMaterial, StoreProduct, StorePromotion } from "../lib/store-api";

type CollectionProps = {
  products: StoreProduct[];
  categories: StoreCategory[];
  materials: StoreMaterial[];
  connected: boolean;
  promotions?: StorePromotion[];
  editorialPromos?: StoreCatalogEditorialPromo[];
  initialCategoryId?: string;
  initialCategory?: string;
  initialStoneSlug?: string;
  initialStoneName?: string;
  initialSort?: string;
  bestSellerOrder?: string[];
};

const priceOptions = [
  ["under2", "Dưới 2.000.000 ₫"],
  ["2to5", "2.000.000 – 5.000.000 ₫"],
  ["5to10", "5.000.000 – 10.000.000 ₫"],
  ["over10", "Trên 10.000.000 ₫"],
] as const;

function FilterChevron() {
  return <svg className="catalog-facet-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.25" /></svg>;
}

export function OpalCollection({ products, categories, materials, connected, promotions, editorialPromos = [], initialCategoryId, initialCategory, initialStoneSlug, initialStoneName, initialSort = "newest", bestSellerOrder = [] }: CollectionProps) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialCategoryId ? [initialCategoryId] : []);
  const [selectedStones, setSelectedStones] = useState<string[]>(initialStoneSlug ? [initialStoneSlug] : []);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState("");
  const [draftTypes, setDraftTypes] = useState<string[]>(initialCategoryId ? [initialCategoryId] : []);
  const [draftStones, setDraftStones] = useState<string[]>(initialStoneSlug ? [initialStoneSlug] : []);
  const [draftSizes, setDraftSizes] = useState<string[]>([]);
  const [draftPriceRange, setDraftPriceRange] = useState("");
  const [sort, setSort] = useState(initialSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);

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

  const bestSellerRanks = useMemo(() => new Map(bestSellerOrder.map((id, index) => [id, index])), [bestSellerOrder]);
  const enabledCategories = useMemo(() => categories
    .filter((category) => category.status === "ACTIVE" && category.usage === "PRODUCT_CATEGORY" && category.kind === "JEWELRY" && category.level > 1)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi")), [categories]);
  const enabledStones = useMemo(() => materials
    .filter((item) => item.active && item.scope === "JEWELRY" && item.kind === "STONE")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi")), [materials]);
  const categoryDescendants = useMemo(() => new Map(categories.map((root) => {
    const found = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (category.parentId && found.has(category.parentId) && !found.has(category.id)) {
          found.add(category.id);
          changed = true;
        }
      }
    }
    return [root.id, found];
  })), [categories]);
  const categoryOptions = useMemo(() => {
    const ids = new Set(enabledCategories.map((category) => category.id));
    const visited = new Set<string>();
    const options: Array<{ category: StoreCategory; depth: number; count: number }> = [];
    const visit = (category: StoreCategory, depth: number) => {
      if (visited.has(category.id)) return;
      visited.add(category.id);
      options.push({ category, depth, count: products.filter((product) => categoryDescendants.get(category.id)?.has(product.categoryId || "")).length });
      enabledCategories.filter((child) => child.parentId === category.id).forEach((child) => visit(child, depth + 1));
    };
    enabledCategories.filter((category) => !category.parentId || !ids.has(category.parentId)).forEach((category) => visit(category, 0));
    enabledCategories.forEach((category) => visit(category, 0));
    return options.filter((option) => option.count > 0);
  }, [enabledCategories, products, categoryDescendants]);
  const tabs = useMemo(() => {
    const roots = categoryOptions.filter(({ depth }) => depth === 0);
    return roots.length ? roots : categoryOptions;
  }, [categoryOptions]);
  const stoneCounts = useMemo(() => new Map(enabledStones.map((stone) => [stone.slug, products.filter((product) => product.materialOption?.slug === stone.slug || product.gemstoneType?.slug === stone.slug).length])), [enabledStones, products]);
  const sizeOptions = useMemo(() => {
    const sizes = new Set(products.flatMap((product) => product.variants.map((variant) => variant.beadSize).filter((size): size is string => Boolean(size?.trim()))));
    return [...sizes].sort((a, b) => a.localeCompare(b, "vi", { numeric: true })).map((size) => ({ size, count: products.filter((product) => product.variants.some((variant) => variant.beadSize === size)).length }));
  }, [products]);
  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const matchesType = selectedTypes.length === 0 || selectedTypes.some((categoryId) => categoryDescendants.get(categoryId)?.has(product.categoryId || ""));
      const productStones = [product.materialOption?.slug, product.gemstoneType?.slug].filter(Boolean);
      const matchesStone = selectedStones.length === 0 || selectedStones.some((slug) => productStones.includes(slug));
      const matchesSize = selectedSizes.length === 0 || product.variants.some((variant) => selectedSizes.includes(variant.beadSize || ""));
      const matchesPrice = !priceRange || (priceRange === "under2" ? product.price < 2_000_000 : priceRange === "2to5" ? product.price >= 2_000_000 && product.price <= 5_000_000 : priceRange === "5to10" ? product.price > 5_000_000 && product.price <= 10_000_000 : product.price > 10_000_000);
      return matchesType && matchesStone && matchesSize && matchesPrice;
    });
    return filtered.sort((a, b) => sort === "price-asc" ? a.price - b.price : sort === "price-desc" ? b.price - a.price : sort === "best-selling" ? (bestSellerRanks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (bestSellerRanks.get(b.id) ?? Number.MAX_SAFE_INTEGER) : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [products, categoryDescendants, selectedTypes, selectedStones, selectedSizes, priceRange, sort, bestSellerRanks]);

  const toggle = (value: string, current: string[], update: (next: string[]) => void) => update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const openFilters = () => {
    setDraftTypes(selectedTypes);
    setDraftStones(selectedStones);
    setDraftSizes(selectedSizes);
    setDraftPriceRange(priceRange);
    setFiltersOpen((open) => !open);
  };
  const applyFilters = () => {
    setSelectedTypes(draftTypes);
    setSelectedStones(draftStones);
    setSelectedSizes(draftSizes);
    setPriceRange(draftPriceRange);
    setFiltersOpen(false);
  };
  const reset = () => {
    setSelectedTypes([]); setSelectedStones([]); setSelectedSizes([]); setPriceRange("");
    setDraftTypes([]); setDraftStones([]); setDraftSizes([]); setDraftPriceRange("");
  };
  const activeFilterCount = selectedTypes.length + selectedStones.length + selectedSizes.length + Number(Boolean(priceRange));
  const selectedCategoryName = selectedTypes.length === 1 ? categories.find((category) => category.id === selectedTypes[0])?.name || initialCategory : undefined;
  const selectedStoneName = selectedStones.length === 1 ? enabledStones.find((stone) => stone.slug === selectedStones[0])?.name || initialStoneName : undefined;
  const title = selectedCategoryName ? selectedCategoryName + (selectedStoneName ? ` · ${selectedStoneName}` : "") : selectedStoneName ? `Trang sức ${selectedStoneName}` : sort === "best-selling" ? "Sản phẩm bán chạy" : "Tất cả sản phẩm";

  return <section className="catalog-shell catalog-jewelry-toolbar" id="san-pham" aria-label="Danh sách sản phẩm">
    <div className="new-arrivals-toolbar">
      <div className="new-arrivals-heading-row">
        <h2>{title}</h2>
        <p role="status" aria-live="polite">{connected ? `${filteredProducts.length} sản phẩm` : "Không thể tải dữ liệu sản phẩm"}</p>
      </div>
      <div className="new-arrivals-tabs" role="group" aria-label="Lọc theo loại trang sức">
        <button type="button" className={!selectedTypes.length ? "is-selected" : ""} aria-pressed={!selectedTypes.length} onClick={() => { setSelectedTypes([]); setDraftTypes([]); }}>Tất cả</button>
        {tabs.map(({ category }) => {
          const selected = selectedTypes.includes(category.id) || selectedTypes.some((id) => categoryDescendants.get(category.id)?.has(id));
          return <button type="button" key={category.id} className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => { setSelectedTypes([category.id]); setDraftTypes([category.id]); }}>{category.name}</button>;
        })}
      </div>
      <div className="new-arrivals-actions">
        <button type="button" className="new-arrivals-filter-toggle" aria-expanded={filtersOpen} aria-controls="catalog-filter-panel" onClick={openFilters}>
          Bộ lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
        </button>
        <label className="new-arrivals-sort"><span>Sắp xếp</span><select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="newest">Mới nhất ↓</option><option value="best-selling">Bán chạy</option><option value="price-asc">Giá tăng dần</option><option value="price-desc">Giá giảm dần</option>
        </select></label>
      </div>
    </div>

    {filtersOpen && <>
      <button type="button" className="new-arrivals-filter-overlay" aria-hidden={!isMobile} tabIndex={isMobile ? 0 : -1} aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)} />
      <div className="new-arrivals-filter-panel" id="catalog-filter-panel" ref={filterPanelRef} role={isMobile ? "dialog" : undefined} aria-modal={isMobile ? true : undefined} aria-labelledby="catalog-filter-title" tabIndex={isMobile ? -1 : undefined}>
        <div className="new-arrivals-filter-header"><h3 id="catalog-filter-title">Bộ lọc</h3><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)}>×</button></div>
        {categoryOptions.length > 0 && <fieldset>
          <legend>Loại sản phẩm</legend>
          {categoryOptions.map(({ category, depth, count }) => <label key={category.id} style={{ marginInlineStart: Math.min(depth, 3) * 12 }}><input type="checkbox" checked={draftTypes.includes(category.id)} onChange={() => toggle(category.id, draftTypes, setDraftTypes)} />{category.name} <span>({count})</span></label>)}
        </fieldset>}
        {enabledStones.some((stone) => (stoneCounts.get(stone.slug) || 0) > 0) && <fieldset>
          <legend>Loại đá</legend>
          {enabledStones.filter((stone) => (stoneCounts.get(stone.slug) || 0) > 0).map((stone) => <label key={stone.id}><input type="checkbox" checked={draftStones.includes(stone.slug)} onChange={() => toggle(stone.slug, draftStones, setDraftStones)} />{stone.name} <span>({stoneCounts.get(stone.slug) || 0})</span></label>)}
        </fieldset>}
        {sizeOptions.length > 0 && <fieldset>
          <legend>Kích thước</legend>
          {sizeOptions.map(({ size, count }) => <label key={size}><input type="checkbox" checked={draftSizes.includes(size)} onChange={() => toggle(size, draftSizes, setDraftSizes)} />{size} <span>({count})</span></label>)}
        </fieldset>}
        <fieldset>
          <legend>Khoảng giá</legend>
          <label><input type="radio" name="catalog-price" checked={!draftPriceRange} onChange={() => setDraftPriceRange("")} />Tất cả mức giá</label>
          {priceOptions.map(([value, label]) => <label key={value}><input type="radio" name="catalog-price" checked={draftPriceRange === value} onChange={() => setDraftPriceRange(value)} />{label}</label>)}
        </fieldset>
        <div className="new-arrivals-filter-actions">
          <button type="button" className="new-arrivals-reset" onClick={reset}>Xóa bộ lọc</button>
          <button type="button" className="new-arrivals-apply" onClick={applyFilters}>Áp dụng</button>
        </div>
      </div>
    </>}

    <div className="catalog-results">
      {filteredProducts.length === 0 && products.length > 0 && activeFilterCount > 0
        ? <CatalogEditorialGrid products={[]} promotions={promotions} connected={connected} editorialPromos={editorialPromos} activeFilters catalogProductCount={products.length} />
        : <CatalogEditorialGrid products={filteredProducts} promotions={promotions} connected={connected} editorialPromos={editorialPromos} activeFilters={activeFilterCount > 0} catalogProductCount={products.length} />}
    </div>
  </section>;
}
