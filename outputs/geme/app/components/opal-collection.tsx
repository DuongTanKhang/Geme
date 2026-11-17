"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CatalogEditorialGrid } from "./catalog-editorial-grid";
import { useProductListReturnState } from "./use-product-list-return-state";
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
  initialSearch?: string;
  initialSort?: string;
  bestSellerOrder?: string[];
};

const PRODUCT_BATCH_SIZE = 40;
type CollectionReturnState = {
  selectedTypes: string[];
  selectedStones: string[];
  selectedSizes: string[];
  priceRange: string;
  sort: string;
  visibleCount: number;
  search?: string;
};

const priceOptions = [
  ["under2", "Dưới 2.000.000 ₫"],
  ["2to5", "2.000.000 – 5.000.000 ₫"],
  ["5to10", "5.000.000 – 10.000.000 ₫"],
  ["over10", "Trên 10.000.000 ₫"],
] as const;

function compareNewestByGemstone(a: StoreProduct, b: StoreProduct) {
  const newProductOrder = Number(b.isNew) - Number(a.isNew);
  if (newProductOrder) return newProductOrder;

  const stoneA = (a.materialOption?.kind === "STONE" ? a.materialOption.name : a.gemstoneType?.name || "").trim();
  const stoneB = (b.materialOption?.kind === "STONE" ? b.materialOption.name : b.gemstoneType?.name || "").trim();
  if (!stoneA && stoneB) return 1;
  if (stoneA && !stoneB) return -1;

  const gemstoneOrder = stoneA.localeCompare(stoneB, "vi", { sensitivity: "base", numeric: true });
  if (gemstoneOrder) return gemstoneOrder;

  const dateA = new Date(a.createdAt || 0).getTime() || 0;
  const dateB = new Date(b.createdAt || 0).getTime() || 0;
  return dateB - dateA || a.id.localeCompare(b.id);
}

function resolveProductCategoryContext(categoryIds: string[], categoriesById: Map<string, StoreCategory>) {
  if (!categoryIds.length) return undefined;
  const roots = categoryIds.map((id) => {
    let current = categoriesById.get(id);
    if (!current) return undefined;
    while (current.parentId && current.level > 2) {
      const parent = categoriesById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  });
  const root = roots[0];
  return root && roots.every((item) => item?.id === root.id) ? root : undefined;
}

function FilterChevron() {
  return <svg className="catalog-facet-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.25" /></svg>;
}

export function OpalCollection({ products, categories, materials, connected, promotions, editorialPromos = [], initialCategoryId, initialCategory, initialStoneSlug, initialStoneName, initialSearch = "", initialSort = "newest", bestSellerOrder = [] }: CollectionProps) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(initialCategoryId ? [initialCategoryId] : []);
  const [selectedStones, setSelectedStones] = useState<string[]>(initialStoneSlug ? [initialStoneSlug] : []);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState("");
  const [draftTypes, setDraftTypes] = useState<string[]>(initialCategoryId ? [initialCategoryId] : []);
  const [draftStones, setDraftStones] = useState<string[]>(initialStoneSlug ? [initialStoneSlug] : []);
  const [draftSizes, setDraftSizes] = useState<string[]>([]);
  const [draftPriceRange, setDraftPriceRange] = useState("");
  const [stoneSearch, setStoneSearch] = useState("");
  const [sort, setSort] = useState(initialSort);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_BATCH_SIZE);
  const [search, setSearch] = useState(initialSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const returnState = useMemo<CollectionReturnState>(() => ({ selectedTypes, selectedStones, selectedSizes, priceRange, sort, visibleCount, search }), [selectedTypes, selectedStones, selectedSizes, priceRange, sort, visibleCount, search]);
  const restoreCollectionState = useCallback((saved: CollectionReturnState) => {
    if (!saved || !Array.isArray(saved.selectedTypes) || !Array.isArray(saved.selectedStones) || !Array.isArray(saved.selectedSizes) || !Number.isFinite(saved.visibleCount)) return;
    setSelectedTypes(saved.selectedTypes);
    setSelectedStones(saved.selectedStones);
    setSelectedSizes(saved.selectedSizes);
    setDraftTypes(saved.selectedTypes);
    setDraftStones(saved.selectedStones);
    setDraftSizes(saved.selectedSizes);
    setPriceRange(typeof saved.priceRange === "string" ? saved.priceRange : "");
    setDraftPriceRange(typeof saved.priceRange === "string" ? saved.priceRange : "");
    setSort(typeof saved.sort === "string" ? saved.sort : initialSort);
    setVisibleCount(Math.max(PRODUCT_BATCH_SIZE, Math.floor(saved.visibleCount)));
    setSearch(typeof saved.search === "string" ? saved.search : initialSearch);
  }, [initialSearch, initialSort]);
  const restoringListRef = useProductListReturnState({ listId: `jewelry-catalog:${initialSearch.trim().toLocaleLowerCase("vi")}`, state: returnState, onRestore: restoreCollectionState, readyKey: visibleCount });

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
  const selectedCatalogRoot = useMemo(() => {
    let current = categories.find((category) => category.id === (selectedTypes[0] || initialCategoryId));
    while (current?.parentId) current = categories.find((category) => category.id === current?.parentId);
    return current;
  }, [categories, initialCategoryId, selectedTypes]);
  const categoryKind = selectedCatalogRoot?.kind || "JEWELRY";
  const enabledCategories = useMemo(() => categories
    .filter((category) => category.status === "ACTIVE" && category.usage === "PRODUCT_CATEGORY" && category.kind === categoryKind && category.level > 1)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi")), [categories, categoryKind]);
  const enabledStones = useMemo(() => {
    const catalogProducts = categoryKind === "OTHER" ? products.filter((product) => product.kind === "OTHER") : products.filter((product) => product.kind === "JEWELRY");
    const usedMaterialIds = new Set(catalogProducts.map((product) => product.materialOption?.id).filter((id): id is string => Boolean(id)));
    const materialStones = materials
      .filter((item) => item.active && item.kind === "STONE" && (categoryKind === "OTHER" ? usedMaterialIds.has(item.id) : item.scope === "JEWELRY"))
      .map((item) => ({ id: item.id, slug: item.slug, name: item.name, sortOrder: item.sortOrder }));
    if (categoryKind !== "OTHER") return materialStones.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
    const sphereStones = new Map<string, { id: string; slug: string; name: string; sortOrder: number }>();
    for (const product of catalogProducts) {
      const stone = product.sphereStoneType;
      if (stone) sphereStones.set(stone.id, { id: stone.id, slug: stone.slug, name: stone.name, sortOrder: 0 });
      else if (product.gemstoneType) sphereStones.set(product.gemstoneType.id, { ...product.gemstoneType, sortOrder: 0 });
    }
    return [...new Map([...materialStones, ...sphereStones.values()].map((stone) => [stone.id, stone])).values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
  }, [materials, products, categoryKind]);
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
  const sizeScopeTypes = filtersOpen ? draftTypes : selectedTypes;
  const sizeScopedProducts = useMemo(() => sizeScopeTypes.length
    ? products.filter((product) => sizeScopeTypes.some((categoryId) => categoryDescendants.get(categoryId)?.has(product.categoryId || "")))
    : [], [products, categoryDescendants, sizeScopeTypes]);
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
  const enabledCategoryMap = useMemo(() => new Map(enabledCategories.map((category) => [category.id, category])), [enabledCategories]);
  const categoryContext = useMemo(() => resolveProductCategoryContext(selectedTypes, enabledCategoryMap), [selectedTypes, enabledCategoryMap]);
  const draftCategoryContext = useMemo(() => resolveProductCategoryContext(filtersOpen ? draftTypes : selectedTypes, enabledCategoryMap), [filtersOpen, draftTypes, selectedTypes, enabledCategoryMap]);
  const mainCategoryOptions = useMemo(() => {
    const roots = categoryOptions.filter(({ depth }) => depth === 0);
    return roots.length ? roots : categoryOptions;
  }, [categoryOptions]);
  const categoryContextChildren = useMemo(() => categoryContext
    ? categoryOptions.filter(({ category }) => category.parentId === categoryContext.id)
    : [], [categoryOptions, categoryContext]);
  const filterCategoryOptions = useMemo(() => draftCategoryContext
    ? categoryOptions.filter(({ category }) => category.parentId === draftCategoryContext.id)
    : categoryOptions, [categoryOptions, draftCategoryContext]);
  const isAllOtherProductsView = categoryKind === "OTHER" && (!draftCategoryContext || draftCategoryContext.level === 1);
  const showCategoryFacet = !isAllOtherProductsView && (!draftCategoryContext || filterCategoryOptions.length > 0);
  const tabs = categoryContext
    ? categoryContext.level > 1 && categoryContext.parentId
      ? categoryOptions.filter(({ category }) => category.parentId === categoryContext.parentId)
      : categoryContextChildren
    : mainCategoryOptions;
  // A category tab represents a fresh collection view. Scope stone choices to
  // products in that collection so the filter never offers stones that cannot
  // produce a result for the selected category.
  const stoneScopeTypes = filtersOpen ? draftTypes : selectedTypes;
  const stoneCounts = useMemo(() => {
    const scopedProducts = stoneScopeTypes.length
      ? products.filter((product) => stoneScopeTypes.some((categoryId) => categoryDescendants.get(categoryId)?.has(product.categoryId || "")))
      : products;
    return new Map(enabledStones.map((stone) => [stone.slug, scopedProducts.filter((product) => product.materialOption?.slug === stone.slug || product.gemstoneType?.slug === stone.slug || product.sphereStoneType?.slug === stone.slug).length]));
  }, [enabledStones, products, categoryDescendants, stoneScopeTypes]);
  const availableStones = useMemo(() => enabledStones.filter((stone) => (stoneCounts.get(stone.slug) || 0) > 0), [enabledStones, stoneCounts]);
  const normalizedStoneSearch = useMemo(() => stoneSearch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").trim(), [stoneSearch]);
  const visibleStones = useMemo(() => availableStones.filter((stone) => {
    const name = stone.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
    return !normalizedStoneSearch || name.includes(normalizedStoneSearch);
  }), [availableStones, normalizedStoneSearch]);
  const draftStoneOptions = useMemo(() => draftStones.map((slug) => enabledStones.find((stone) => stone.slug === slug) || {
    id: slug,
    slug,
    name: slug === initialStoneSlug && initialStoneName ? initialStoneName : slug,
    sortOrder: 0,
  }), [draftStones, enabledStones, initialStoneName, initialStoneSlug]);
  const sizeOptions = useMemo(() => {
    const sizes = new Set(sizeScopedProducts.flatMap((product) => product.variants.map((variant) => variant.beadSize).filter((size): size is string => Boolean(size?.trim()))));
    return [...sizes].sort((a, b) => a.localeCompare(b, "vi", { numeric: true })).map((size) => ({ size, count: sizeScopedProducts.filter((product) => product.variants.some((variant) => variant.beadSize === size)).length }));
  }, [sizeScopedProducts]);
  useEffect(() => {
    const available = new Set(sizeOptions.map(({ size }) => size));
    if (filtersOpen) setDraftSizes((current) => current.filter((size) => available.has(size)));
    else setSelectedSizes((current) => current.filter((size) => available.has(size)));
  }, [filtersOpen, sizeOptions]);
  const selectedSizeSet = useMemo(() => new Set(selectedTypes.length
    ? products
      .filter((product) => selectedTypes.some((categoryId) => categoryDescendants.get(categoryId)?.has(product.categoryId || "")))
      .flatMap((product) => product.variants.map((variant) => variant.beadSize).filter((size): size is string => Boolean(size?.trim())))
    : []), [products, selectedTypes, categoryDescendants]);
  const appliedSizes = useMemo(() => selectedTypes.length ? selectedSizes.filter((size) => selectedSizeSet.has(size)) : [], [selectedTypes.length, selectedSizes, selectedSizeSet]);
  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").trim();
    const filtered = products.filter((product) => {
      const matchesType = selectedTypes.length === 0 || selectedTypes.some((categoryId) => categoryDescendants.get(categoryId)?.has(product.categoryId || ""));
      const productStones = [product.materialOption?.slug, product.gemstoneType?.slug, product.sphereStoneType?.slug].filter(Boolean);
      const matchesStone = selectedStones.length === 0 || selectedStones.some((slug) => productStones.includes(slug));
      const matchesSize = appliedSizes.length === 0 || product.variants.some((variant) => appliedSizes.includes(variant.beadSize || ""));
      const matchesPrice = !priceRange || (!product.isPremiumGemstone && (priceRange === "under2" ? product.price < 2_000_000 : priceRange === "2to5" ? product.price >= 2_000_000 && product.price <= 5_000_000 : priceRange === "5to10" ? product.price > 5_000_000 && product.price <= 10_000_000 : product.price > 10_000_000));
      const searchable = `${product.name} ${product.sku} ${product.variants.map((variant) => variant.sku || "").join(" ")}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
      const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
      return matchesType && matchesStone && matchesSize && matchesPrice && matchesSearch;
    });
    return filtered.sort((a, b) => sort === "price-asc" ? Number(a.isPremiumGemstone) - Number(b.isPremiumGemstone) || a.price - b.price : sort === "price-desc" ? Number(a.isPremiumGemstone) - Number(b.isPremiumGemstone) || b.price - a.price : sort === "best-selling" ? (bestSellerRanks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (bestSellerRanks.get(b.id) ?? Number.MAX_SAFE_INTEGER) : compareNewestByGemstone(a, b));
  }, [products, categoryDescendants, selectedTypes, selectedStones, appliedSizes, priceRange, sort, bestSellerRanks, search]);
  const visibleProducts = useMemo(() => filteredProducts.slice(0, visibleCount), [filteredProducts, visibleCount]);

  const filterStateKey = JSON.stringify([selectedTypes, selectedStones, appliedSizes, priceRange, sort, search]);
  const previousFilterStateKey = useRef(filterStateKey);
  useEffect(() => {
    if (previousFilterStateKey.current === filterStateKey) return;
    previousFilterStateKey.current = filterStateKey;
    if (restoringListRef.current) return;
    setVisibleCount(PRODUCT_BATCH_SIZE);
  }, [filterStateKey, restoringListRef]);

  const toggle = (value: string, current: string[], update: (next: string[]) => void) => update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const toggleContextCategory = (categoryId: string) => {
    const context = draftCategoryContext;
    if (!context) {
      toggle(categoryId, draftTypes, setDraftTypes);
      return;
    }
    const childIds = new Set(filterCategoryOptions.map(({ category }) => category.id));
    setDraftTypes((current) => {
      const currentChildren = current.includes(context.id) ? [] : current.filter((id) => childIds.has(id));
      const nextChildren = currentChildren.includes(categoryId)
        ? currentChildren.filter((id) => id !== categoryId)
        : [...currentChildren, categoryId];
      return nextChildren.length ? nextChildren : [context.id];
    });
  };
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
    const validSizes = new Set(sizeOptions.map(({ size }) => size));
    setSelectedSizes(draftTypes.length ? draftSizes.filter((size) => validSizes.has(size)) : []);
    setPriceRange(draftPriceRange);
    setVisibleCount(PRODUCT_BATCH_SIZE);
    setFiltersOpen(false);
  };
  const reset = () => {
    const defaultTypes = initialCategoryId ? [initialCategoryId] : [];
    setSelectedTypes(defaultTypes); setSelectedStones([]); setSelectedSizes([]); setPriceRange("");
    setDraftTypes(defaultTypes); setDraftStones([]); setDraftSizes([]); setDraftPriceRange("");
    setSearch("");
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setVisibleCount(PRODUCT_BATCH_SIZE);
  };
  const activeFilterCount = selectedTypes.length + selectedStones.length + appliedSizes.length + Number(Boolean(priceRange)) + Number(Boolean(search));
  const selectedCategoryName = selectedTypes.length === 1 ? categories.find((category) => category.id === selectedTypes[0])?.name || initialCategory : undefined;
  const selectedStoneName = selectedStones.length === 1 ? enabledStones.find((stone) => stone.slug === selectedStones[0])?.name || initialStoneName : undefined;
  const title = search ? `Kết quả tìm kiếm · ${search}` : selectedCategoryName ? selectedCategoryName + (selectedStoneName ? ` · ${selectedStoneName}` : "") : selectedStoneName ? `Trang sức ${selectedStoneName}` : sort === "best-selling" ? "Sản phẩm bán chạy" : "Tất cả sản phẩm";

  return <section className="catalog-shell catalog-jewelry-toolbar" id="san-pham" aria-label="Danh sách sản phẩm">
    <div className="new-arrivals-toolbar">
      <div className="new-arrivals-heading-row">
        <h2>{title}</h2>
        <p role="status" aria-live="polite">{connected ? `${filteredProducts.length} sản phẩm` : "Không thể tải dữ liệu sản phẩm"}</p>
      </div>
      <div className="new-arrivals-tabs" role="group" aria-label="Lọc theo loại trang sức">
        <button type="button" className={categoryContext ? selectedTypes.length === 1 && selectedTypes[0] === categoryContext.id ? "is-selected" : "" : !selectedTypes.length ? "is-selected" : ""} aria-pressed={categoryContext ? selectedTypes.length === 1 && selectedTypes[0] === categoryContext.id : !selectedTypes.length} onClick={() => {
          const allCategoryTypes = categoryContext ? [categoryContext.id] : [];
          setSelectedTypes(allCategoryTypes); setDraftTypes(allCategoryTypes);
          setSelectedStones([]); setDraftStones([]);
          setSelectedSizes([]); setDraftSizes([]);
          setPriceRange(""); setDraftPriceRange("");
          setVisibleCount(PRODUCT_BATCH_SIZE);
        }}>{categoryContext ? "Tất cả sản phẩm" : "Tất cả"}</button>
        {tabs.map(({ category }) => {
          const selected = selectedTypes.includes(category.id) || selectedTypes.some((id) => categoryDescendants.get(category.id)?.has(id));
          return <button type="button" key={category.id} className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => {
            setSelectedTypes([category.id]); setDraftTypes([category.id]);
            // Switching from one jewelry category to another must show the
            // complete category, not retain a stone/size/price filter from
            // the previously selected category.
            setSelectedStones([]); setDraftStones([]);
            setSelectedSizes([]); setDraftSizes([]);
            setPriceRange(""); setDraftPriceRange("");
            setVisibleCount(PRODUCT_BATCH_SIZE);
          }}>{category.name}</button>;
        })}
      </div>
      <div className="new-arrivals-actions">
        <button type="button" className="new-arrivals-filter-toggle" aria-expanded={filtersOpen} aria-controls="catalog-filter-panel" onClick={openFilters}>
          Bộ lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
        </button>
        <label className="new-arrivals-sort"><span>Sắp xếp</span><select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(PRODUCT_BATCH_SIZE); }}>
          <option value="newest">Mới nhất ↓</option><option value="best-selling">Bán chạy</option><option value="price-asc">Giá tăng dần</option><option value="price-desc">Giá giảm dần</option>
        </select></label>
      </div>
    </div>

    {filtersOpen && <>
      <button type="button" className="new-arrivals-filter-overlay" aria-hidden={!isMobile} tabIndex={isMobile ? 0 : -1} aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)} />
      <div className="new-arrivals-filter-panel" id="catalog-filter-panel" ref={filterPanelRef} role={isMobile ? "dialog" : undefined} aria-modal={isMobile ? true : undefined} aria-labelledby="catalog-filter-title" tabIndex={isMobile ? -1 : undefined}>
        <div className="new-arrivals-filter-header"><h3 id="catalog-filter-title">Bộ lọc</h3><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)}>×</button></div>
        <div className="new-arrivals-filter-primary">
          {categoryKind !== "JEWELRY" && showCategoryFacet && filterCategoryOptions.length > 0 && <fieldset>
            <legend>{draftCategoryContext ? "Danh mục con" : "Loại sản phẩm"}</legend>
            {filterCategoryOptions.map(({ category, depth, count }) => <label key={category.id} style={{ marginInlineStart: draftCategoryContext ? 0 : Math.min(depth, 3) * 12 }}><input type="checkbox" checked={draftTypes.includes(category.id)} onChange={() => toggleContextCategory(category.id)} />{category.name} <span>({count})</span></label>)}
          </fieldset>}
          {availableStones.length > 0 && <fieldset className="new-arrivals-stone-fieldset">
            <legend>Loại đá</legend>
            <label className="new-arrivals-stone-search">
              <span aria-hidden="true">⌕</span>
              <input type="search" aria-label="Tìm kiếm loại đá" placeholder="Tìm kiếm loại đá..." value={stoneSearch} onChange={(event) => setStoneSearch(event.target.value)} />
            </label>
            {draftStoneOptions.length > 0 && <div className="new-arrivals-stone-selected" aria-label={`${draftStoneOptions.length} loại đá đang chọn`}>
              <span className="new-arrivals-stone-selected-count">{draftStoneOptions.length} đang chọn</span>
              {draftStoneOptions.map((stone) => <button type="button" key={stone.slug} aria-label={`Bỏ chọn ${stone.name}`} onClick={() => setDraftStones((current) => current.filter((slug) => slug !== stone.slug))}>{stone.name}<span aria-hidden="true">×</span></button>)}
            </div>}
            <div className="new-arrivals-stone-options" aria-label="Các loại đá">
              {visibleStones.length > 0 ? visibleStones.map((stone) => <label className="new-arrivals-stone-option" key={stone.id}>
                <input type="checkbox" checked={draftStones.includes(stone.slug)} onChange={() => toggle(stone.slug, draftStones, setDraftStones)} />
                <span>{stone.name}<small>({stoneCounts.get(stone.slug) || 0})</small></span>
              </label>) : <p className="new-arrivals-stone-empty">Không tìm thấy loại đá phù hợp.</p>}
            </div>
          </fieldset>}
          {sizeOptions.length > 0 && <fieldset>
            <legend>Kích thước</legend>
            <p className="catalog-size-filter-note">Chỉ áp dụng cho sản phẩm có biến thể kích thước trong danh mục đang chọn.</p>
            {sizeOptions.map(({ size, count }) => <label key={size}><input type="checkbox" checked={draftSizes.includes(size)} onChange={() => toggle(size, draftSizes, setDraftSizes)} />{size} <span>({count})</span></label>)}
          </fieldset>}
        </div>
        <div className="new-arrivals-filter-secondary">
          <fieldset className="new-arrivals-price-fieldset">
            <legend>Khoảng giá</legend>
            <label><input type="radio" name="catalog-price" checked={!draftPriceRange} onChange={() => setDraftPriceRange("")} />Tất cả mức giá</label>
            {priceOptions.map(([value, label]) => <label key={value}><input type="radio" name="catalog-price" checked={draftPriceRange === value} onChange={() => setDraftPriceRange(value)} />{label}</label>)}
          </fieldset>
        </div>
        <div className="new-arrivals-filter-actions">
          <button type="button" className="new-arrivals-reset" onClick={reset}>Xóa bộ lọc</button>
          <button type="button" className="new-arrivals-apply" onClick={applyFilters}>Áp dụng</button>
        </div>
      </div>
    </>}

    <div className="catalog-results">
      {filteredProducts.length === 0 && products.length > 0 && activeFilterCount > 0
        ? <CatalogEditorialGrid products={[]} promotions={promotions} connected={connected} editorialPromos={editorialPromos} activeFilters catalogProductCount={products.length} />
        : <CatalogEditorialGrid products={visibleProducts} promotions={promotions} connected={connected} editorialPromos={editorialPromos} activeFilters={activeFilterCount > 0} catalogProductCount={products.length} />}
    </div>
    {visibleProducts.length < filteredProducts.length && <button type="button" className="new-arrivals-load-more" onClick={() => setVisibleCount((count) => Math.min(count + PRODUCT_BATCH_SIZE, filteredProducts.length))}>
      Xem thêm sản phẩm ({visibleProducts.length}/{filteredProducts.length}) <span aria-hidden="true">→</span>
    </button>}
  </section>;
}
