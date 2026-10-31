"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { StoreProductCard } from "./store-product-grid";
import { NewArrivalEditorial, NewArrivalsVideo } from "./new-arrivals";
import { useProductListReturnState } from "./use-product-list-return-state";
import type { StoreCategory, StoreJewelryStoneGroup, StoreNewArrivalsFacets, StoreNewArrivalsGroup, StoreNewArrivalsGroupProductsResponse, StoreNewArrivalsMedia, StorePromotion, StoreProduct } from "../lib/store-api";

type Sort = "recommended" | "newest" | "best_selling" | "price_asc" | "price_desc";
type PriceRange = "" | "under2" | "2to5" | "5to10" | "over10" | "custom";

export type NewArrivalsFilters = {
  mode: "tagged";
  categoryIds: string[];
  stoneGroupIds: string[];
  sizes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  sort: Sort;
  search: string;
  page: number;
  groupPage: number;
};

type Props = {
  groups: StoreNewArrivalsGroup[];
  selectedGroup?: Omit<StoreNewArrivalsGroupProductsResponse, "connected"> | null;
  categories: StoreCategory[];
  stoneGroups: StoreJewelryStoneGroup[];
  facets?: StoreNewArrivalsFacets;
  promotions: StorePromotion[];
  connected: boolean;
  errorMessage?: string;
  heroImage: string;
  media: StoreNewArrivalsMedia;
  filters: NewArrivalsFilters;
  totalProducts: number;
  groupPageInfo?: { groupPage: number; groupPageSize: number; totalGroups: number; hasNextGroup: boolean; nextGroupPage: number | null };
};

const priceRanges = [
  ["under2", "Dưới 2.000.000 ₫"],
  ["2to5", "2.000.000 – 5.000.000 ₫"],
  ["5to10", "5.000.000 – 10.000.000 ₫"],
  ["over10", "Trên 10.000.000 ₫"],
] as const;

function getPriceRange(min: number | null, max: number | null): PriceRange {
  if (min == null && max == null) return "";
  if (min == null && max === 1_999_999) return "under2";
  if (min === 2_000_000 && max === 5_000_000) return "2to5";
  if (min === 5_000_001 && max === 10_000_000) return "5to10";
  if (min === 10_000_001 && max == null) return "over10";
  return "custom";
}
function priceBounds(range: PriceRange): { minPrice: number | null; maxPrice: number | null } | null {
  switch (range) {
    case "under2": return { minPrice: null, maxPrice: 1_999_999 };
    case "2to5": return { minPrice: 2_000_000, maxPrice: 5_000_000 };
    case "5to10": return { minPrice: 5_000_001, maxPrice: 10_000_000 };
    case "over10": return { minPrice: 10_000_001, maxPrice: null };
    default: return null;
  }
}

function toggleValue(value: string, values: string[]) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function NewArrivalsGrouped({ groups, selectedGroup, categories, stoneGroups, facets, promotions, connected, errorMessage, heroImage, media, filters, totalProducts, groupPageInfo }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const filterPanelRef = useRef<HTMLFormElement>(null);
  const [draftCategoryIds, setDraftCategoryIds] = useState(filters.categoryIds);
  const [draftStoneGroupIds, setDraftStoneGroupIds] = useState(filters.stoneGroupIds);
  const [draftSizes, setDraftSizes] = useState(filters.sizes);
  const [draftPriceRange, setDraftPriceRange] = useState<PriceRange>(getPriceRange(filters.minPrice, filters.maxPrice));
  const [draftMinPrice, setDraftMinPrice] = useState(filters.minPrice == null ? "" : String(filters.minPrice));
  const [draftMaxPrice, setDraftMaxPrice] = useState(filters.maxPrice == null ? "" : String(filters.maxPrice));
  const [searchText, setSearchText] = useState(filters.search);
  const [errorText, setErrorText] = useState("");
  useProductListReturnState({
    listId: "new-arrivals-grouped",
    state: null,
    onRestore: () => {},
    readyKey: `${filters.page}:${filters.groupPage}:${selectedGroup?.products.length || 0}:${groups.length}`,
  });

  useEffect(() => {
    setDraftCategoryIds(filters.categoryIds);
    setDraftStoneGroupIds(filters.stoneGroupIds);
    setDraftSizes(filters.sizes);
    setDraftPriceRange(getPriceRange(filters.minPrice, filters.maxPrice));
    setDraftMinPrice(filters.minPrice == null ? "" : String(filters.minPrice));
    setDraftMaxPrice(filters.maxPrice == null ? "" : String(filters.maxPrice));
    setSearchText(filters.search);
    setErrorText("");
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
      if (event.key === "Escape") { event.preventDefault(); setFiltersOpen(false); return; }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")).filter((element) => element.offsetParent !== null);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [filtersOpen, isMobile]);

  const categoryCounts = useMemo(() => new Map((facets?.categories || []).map((item) => [item.id, item.count])), [facets]);
  const enabledCategories = useMemo(() => categories
    .filter((category) => category.status === "ACTIVE" && category.usage === "PRODUCT_CATEGORY" && category.kind === "JEWELRY" && category.level > 1)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi")), [categories]);
  const categoryOptions = useMemo(() => {
    const enabledIds = new Set(enabledCategories.map((item) => item.id));
    const children = new Map<string, StoreCategory[]>();
    for (const category of enabledCategories) {
      if (!category.parentId || !enabledIds.has(category.parentId)) continue;
      const list = children.get(category.parentId) || [];
      list.push(category);
      children.set(category.parentId, list);
    }
    const result: Array<{ category: StoreCategory; depth: number; count: number }> = [];
    const visit = (category: StoreCategory, depth: number, path: Set<string>) => {
      if (path.has(category.id)) return;
      const descendants = [category, ...(children.get(category.id) || []).flatMap((child) => collect(child, new Set([...path, category.id])))];
      const count = descendants.reduce((sum, item) => sum + (categoryCounts.get(item.id) || 0), 0);
      result.push({ category, depth, count });
      for (const child of children.get(category.id) || []) visit(child, depth + 1, new Set([...path, category.id]));
    };
    const collect = (category: StoreCategory, path: Set<string>): StoreCategory[] => {
      if (path.has(category.id)) return [];
      const nextPath = new Set([...path, category.id]);
      return [category, ...(children.get(category.id) || []).flatMap((child) => collect(child, nextPath))];
    };
    for (const category of enabledCategories.filter((item) => !item.parentId || !enabledIds.has(item.parentId))) visit(category, Math.max(0, category.level - 2), new Set());
    for (const category of enabledCategories) if (!result.some((item) => item.category.id === category.id)) visit(category, Math.max(0, category.level - 2), new Set());
    return result.filter((item) => item.count > 0);
  }, [enabledCategories, categoryCounts]);
  const categoryTabs = categoryOptions.filter((item) => item.depth === 0);
  const stoneOptions = useMemo(() => {
    const source = facets?.stones?.length ? facets.stones : [
      ...stoneGroups.map((group) => ({ id: group.id, slug: group.slug, name: group.name, count: 0 })),
      { id: null, slug: "trang-suc-khac", name: "Trang sức khác", count: 0 },
    ];
    return source.filter((item) => item.count > 0).map((item) => ({ id: item.id || "other", name: item.name, count: item.count }));
  }, [facets, stoneGroups]);
  const sizeOptions = facets?.sizes || [];
  const shownGroups = selectedGroup
    ? [{ ...selectedGroup.group, latestPublishedAt: null, total: selectedGroup.total, products: selectedGroup.products, hasMore: selectedGroup.pageInfo.hasNextPage }]
    : groups;
  const activeFilterCount = filters.categoryIds.length + filters.stoneGroupIds.length + filters.sizes.length
    + Number(filters.minPrice != null || filters.maxPrice != null) + Number(Boolean(filters.search));
  const activeFilters = activeFilterCount > 0 || filters.sort !== "recommended";

  const navigate = (patch: Partial<NewArrivalsFilters>, keepGroup = false) => {
    const next = { ...filters, ...patch, mode: "tagged" as const, page: patch.page ?? 1, groupPage: patch.groupPage ?? 1 };
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["mode", "categoryId", "stoneGroupId", "size", "minPrice", "maxPrice", "sort", "search", "page", "groupPage"]) params.delete(key);
    if (!keepGroup) params.delete("group");
    for (const id of next.categoryIds) params.append("categoryId", id);
    for (const id of next.stoneGroupIds) params.append("stoneGroupId", id);
    for (const size of next.sizes) params.append("size", size);
    if (next.minPrice != null) params.set("minPrice", String(next.minPrice));
    if (next.maxPrice != null) params.set("maxPrice", String(next.maxPrice));
    if (next.sort !== "recommended") params.set("sort", next.sort);
    if (next.search) params.set("search", next.search);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.groupPage > 1) params.set("groupPage", String(next.groupPage));
    const query = params.toString();
    startTransition(() => router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  };

  const changeCategory = (id: string) => navigate({ categoryIds: id ? [id] : [] });
  const applyFilters = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    let minPrice = draftMinPrice.trim() ? Number(draftMinPrice) : null;
    let maxPrice = draftMaxPrice.trim() ? Number(draftMaxPrice) : null;
    if (draftPriceRange && draftPriceRange !== "custom") {
      const bounds = priceBounds(draftPriceRange);
      minPrice = bounds?.minPrice ?? null;
      maxPrice = bounds?.maxPrice ?? null;
    }
    if ((minPrice != null && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice != null && maxPrice != null && minPrice > maxPrice)) {
      setErrorText("Khoảng giá chưa hợp lệ. Hãy nhập số không âm và bảo đảm giá tối thiểu không lớn hơn giá tối đa.");
      return;
    }
    setErrorText("");
    navigate({ categoryIds: draftCategoryIds, stoneGroupIds: draftStoneGroupIds, sizes: draftSizes, minPrice, maxPrice, search: searchText.trim() });
    setFiltersOpen(false);
  };
  const clearFilters = () => {
    setDraftCategoryIds([]); setDraftStoneGroupIds([]); setDraftSizes([]); setDraftPriceRange(""); setDraftMinPrice(""); setDraftMaxPrice(""); setSearchText(""); setErrorText("");
    navigate({ categoryIds: [], stoneGroupIds: [], sizes: [], minPrice: null, maxPrice: null, sort: "recommended", search: "" });
    setFiltersOpen(false);
  };
  const openFilters = () => {
    setDraftCategoryIds(filters.categoryIds); setDraftStoneGroupIds(filters.stoneGroupIds); setDraftSizes(filters.sizes);
    setDraftPriceRange(getPriceRange(filters.minPrice, filters.maxPrice));
    setDraftMinPrice(filters.minPrice == null ? "" : String(filters.minPrice)); setDraftMaxPrice(filters.maxPrice == null ? "" : String(filters.maxPrice));
    setSearchText(filters.search); setErrorText(""); setFiltersOpen((open) => !open);
  };
  const activeCategoryName = filters.categoryIds.length === 1 ? categories.find((item) => item.id === filters.categoryIds[0])?.name : "";
  const title = activeCategoryName || (selectedGroup ? selectedGroup.group.name : "Mới tại GEME");

  const groupUrl = (group: StoreNewArrivalsGroup) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); params.delete("groupPage"); params.set("group", group.slug);
    return `${pathname}?${params.toString()}`;
  };
  const pageUrl = (key: "page" | "groupPage", value: number) => {
    const params = new URLSearchParams(searchParams.toString()); params.set(key, String(value)); return `${pathname}?${params.toString()}`;
  };
  const backToGroupsUrl = () => {
    const params = new URLSearchParams(searchParams.toString()); params.delete("group"); params.delete("page"); params.delete("groupPage");
    const query = params.toString(); return `${pathname}${query ? `?${query}` : ""}`;
  };

  return <main className="new-arrivals-page" id="top">
    <section className="new-arrivals-hero" aria-labelledby="arrivals-title">
      <div className="new-arrivals-hero-copy"><span className="new-arrivals-eyebrow">GEME / NEW ARRIVALS</span><h1 id="arrivals-title">Mới tại GEME</h1><p className="new-arrivals-subtitle">Trang sức đang mang nhãn “Mới”, được tuyển chọn theo từng nhóm đá.</p><a className="new-arrivals-cta" href="#arrivals-products">Khám phá ngay <span aria-hidden="true">→</span></a></div>
      <div className="new-arrivals-hero-media"><Image className="new-arrivals-hero-image" src={heroImage} alt="Trang sức trong bộ sưu tập mới của GEME" fill sizes="(max-width: 767px) 100vw, (max-width: 1279px) 54vw, 690px" priority /></div>
    </section>

    <section className="new-arrivals-products" id="arrivals-products" aria-labelledby="new-arrivals-heading">
      <div className="new-arrivals-container">
        <nav className="new-arrivals-breadcrumb" aria-label="Đường dẫn trang"><a href="/">Trang chủ</a><span aria-hidden="true">/</span><span aria-current="page">Mới tại GEME</span></nav>
        <div className="new-arrivals-toolbar">
          <div className="new-arrivals-heading-row"><h2 id="new-arrivals-heading">{title}</h2><p role="status" aria-live="polite">{selectedGroup ? selectedGroup.total : totalProducts} sản phẩm</p></div>
          <nav className="new-arrivals-tabs" aria-label="Lọc theo loại trang sức">
            <button type="button" className={!filters.categoryIds.length ? "is-selected" : ""} aria-pressed={!filters.categoryIds.length} onClick={() => changeCategory("")}>Tất cả</button>
            {categoryTabs.map(({ category }) => <button type="button" key={category.id} className={filters.categoryIds.includes(category.id) ? "is-selected" : ""} aria-pressed={filters.categoryIds.includes(category.id)} onClick={() => changeCategory(category.id)}>{category.name}</button>)}
          </nav>
          <div className="new-arrivals-actions">
            <button type="button" className="new-arrivals-filter-toggle" aria-expanded={filtersOpen} aria-controls="new-arrivals-filter-panel" onClick={openFilters}>Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button>
            <label className="new-arrivals-sort"><span>Sắp xếp</span><select aria-label="Sắp xếp sản phẩm" value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as Sort })}><option value="recommended">Gợi ý</option><option value="newest">Mới nhất ↓</option><option value="best_selling">Bán chạy</option><option value="price_asc">Giá tăng dần</option><option value="price_desc">Giá giảm dần</option></select></label>
            {activeFilters && <button type="button" className="catalog-reset" onClick={clearFilters}>Xóa lọc <span aria-hidden="true">×</span></button>}
          </div>
        </div>

        {filtersOpen && <>
          <button type="button" className="new-arrivals-filter-overlay" aria-hidden={!isMobile} tabIndex={isMobile ? 0 : -1} aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)} />
          <form className="new-arrivals-filter-panel" id="new-arrivals-filter-panel" ref={filterPanelRef} role={isMobile ? "dialog" : undefined} aria-modal={isMobile ? true : undefined} aria-labelledby="new-arrivals-filter-title" tabIndex={isMobile ? -1 : undefined} onSubmit={applyFilters}>
            <div className="new-arrivals-filter-header"><h3 id="new-arrivals-filter-title">Bộ lọc</h3><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)}>×</button></div>
            {categoryOptions.length > 0 && <fieldset><legend>Loại sản phẩm</legend>{categoryOptions.map(({ category, depth, count }) => <label key={category.id} style={{ marginInlineStart: Math.min(depth, 3) * 12 }}><input type="checkbox" checked={draftCategoryIds.includes(category.id)} onChange={() => setDraftCategoryIds((items) => toggleValue(category.id, items))}/>{category.name} <span>({count})</span></label>)}</fieldset>}
            {stoneOptions.length > 0 && <fieldset><legend>Loại đá</legend>{stoneOptions.map((stone) => <label key={stone.id}><input type="checkbox" checked={draftStoneGroupIds.includes(stone.id)} onChange={() => setDraftStoneGroupIds((items) => toggleValue(stone.id, items))}/>{stone.name} <span>({stone.count})</span></label>)}</fieldset>}
            {sizeOptions.length > 0 && <fieldset><legend>Kích thước</legend>{sizeOptions.map(({ size, count }) => <label key={size}><input type="checkbox" checked={draftSizes.includes(size)} onChange={() => setDraftSizes((items) => toggleValue(size, items))}/>{size} <span>({count})</span></label>)}</fieldset>}
            <fieldset><legend>Khoảng giá</legend><label><input type="radio" name="new-arrivals-price" checked={!draftPriceRange && draftMinPrice === "" && draftMaxPrice === ""} onChange={() => { setDraftPriceRange(""); setDraftMinPrice(""); setDraftMaxPrice(""); }}/>Tất cả mức giá</label>{priceRanges.map(([value, label]) => <label key={value}><input type="radio" name="new-arrivals-price" checked={draftPriceRange === value} onChange={() => { setDraftPriceRange(value); setDraftMinPrice(""); setDraftMaxPrice(""); }}/>{label}</label>)}<label><input type="radio" name="new-arrivals-price" checked={draftPriceRange === "custom"} onChange={() => setDraftPriceRange("custom")}/>Tùy chỉnh</label><div className="new-arrivals-custom-price"><label>Từ <input type="number" min="0" value={draftMinPrice} onChange={(event) => { setDraftMinPrice(event.target.value); setDraftPriceRange("custom"); }}/></label><label>Đến <input type="number" min="0" value={draftMaxPrice} onChange={(event) => { setDraftMaxPrice(event.target.value); setDraftPriceRange("custom"); }}/></label></div></fieldset>
            <fieldset className="new-arrivals-search-facet"><legend>Tìm sản phẩm</legend><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Tên hoặc SKU"/></fieldset>
            <div className="new-arrivals-filter-actions"><button type="button" className="new-arrivals-reset" onClick={clearFilters}>Xóa bộ lọc</button><button type="submit" className="new-arrivals-apply">Áp dụng</button></div>
            {errorText && <p className="new-arrivals-filter-error" role="alert">{errorText}</p>}
          </form>
        </>}

        <div className="new-arrivals-card-area" aria-busy={pending}>
          {pending ? <div className="new-arrivals-message" role="status">Đang cập nhật danh sách…</div>
            : !connected ? <div className="new-arrivals-message is-error" role="alert"><p>{errorMessage || "Chưa tải được danh sách sản phẩm. Lỗi kết nối không được xem là danh sách rỗng."}</p><button type="button" onClick={() => router.refresh()}>Thử lại</button></div>
              : shownGroups.length === 0 ? <div className="new-arrivals-message" role="status"><p>{activeFilters ? "Không có sản phẩm phù hợp với bộ lọc này." : "Hiện chưa có sản phẩm đang mang nhãn Mới."}</p>{activeFilters && <button type="button" onClick={clearFilters}>Xóa bộ lọc</button>}</div>
                : shownGroups.map((group, groupIndex) => {
                  const featureGroup = groupIndex === 0 && !activeFilters && !selectedGroup;
                  return <section className="new-arrivals-stone-section" key={group.id || group.slug} aria-labelledby={`stone-${group.slug}`}>
                    <header><div><h3 id={`stone-${group.slug}`}>{group.name}</h3><span>{group.total} sản phẩm</span></div>{!selectedGroup && group.hasMore && <a href={groupUrl(group)}>Xem tất cả {group.name} <span aria-hidden="true">→</span></a>}</header>
                    <div className={`new-arrivals-product-grid${featureGroup ? " new-arrivals-feature-grid" : ""}`}>
                      {featureGroup && <NewArrivalEditorial media={media}/>}
                      {group.products.map((product: StoreProduct, productIndex) => featureGroup && productIndex < 4
                        ? <div className="new-arrivals-feature-product" key={product.id}><StoreProductCard product={product} promotions={promotions}/></div>
                        : <StoreProductCard key={product.id} product={product} promotions={promotions}/>) }
                    </div>
                    {featureGroup && <NewArrivalsVideo media={media}/>}
                  </section>;
                })}
        </div>
        {selectedGroup?.pageInfo.hasNextPage && <a className="new-arrivals-load-more" href={pageUrl("page", selectedGroup.pageInfo.nextPage || filters.page + 1)}>Xem thêm sản phẩm <span aria-hidden="true">→</span></a>}
        {!selectedGroup && groupPageInfo?.hasNextGroup && groupPageInfo.nextGroupPage && <a className="new-arrivals-load-more" href={pageUrl("groupPage", groupPageInfo.nextGroupPage)}>Xem thêm nhóm đá <span aria-hidden="true">→</span></a>}
        {selectedGroup && <a className="new-arrivals-back-link" href={backToGroupsUrl()}>← Quay lại tất cả nhóm</a>}
      </div>
    </section>
  </main>;
}
