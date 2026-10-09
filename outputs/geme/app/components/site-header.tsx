"use client";

import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { normalizeApiBaseUrl } from "../lib/api-base";

type MenuId = "trang-suc" | "da-quy" | "san-pham";

type MenuStone = { id: string; name: string; slug: string; imageUrl?: string; appliedCategoryIds?: string[] };
type MenuCategory = { id: string; name: string; slug: string; kind: "JEWELRY" | "GEMSTONE"; usage: "PRODUCT_CATEGORY" | "GEMSTONE_TYPE"; level: number; parentId?: string | null; status: "ACTIVE" | "INACTIVE"; imageUrl?: string | null; sortOrder?: number };
type ApiMaterialOption = { id: string; name: string; scope: "JEWELRY" | "GEMSTONE"; kind: "MATERIAL" | "STONE"; active: boolean; imageUrl?: string | null; slug?: string; sortOrder?: number; appliedCategoryIds?: string[] };
type StoreCartLine = { key: string; productId: string; variantId: string | null; slug: string; name: string; sku: string; price: number; quality: string | null; beadSize: string | null; quantity: number; stock: number };
const CART_STORAGE_KEY = "geme-cart-v1";
function readStoreCart(): StoreCartLine[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.key === "string") as StoreCartLine[] : [];
  } catch { return []; }
}
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
const categoryShape = (name: string): "diamond" | "ring" | "bracelet" | "circle" | "necklace" | "pendant" | "earrings" => /nhẫn/i.test(name) ? "ring" : /dây chuyền/i.test(name) ? "necklace" : /mặt dây/i.test(name) ? "pendant" : /hoa tai/i.test(name) ? "earrings" : /lắc|vòng/i.test(name) ? "bracelet" : "diamond";
const materialsApiBase = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
const fallbackStoneImages: Record<string, string> = {
  "Thạch anh tím": "/assets/gemstone-quartz.png", Moonstone: "/assets/gemstone-moonstone.png", "Ngọc bích": "/assets/gemstone-jadeite.png",
  Opal: "/assets/gemstone-opal.png", Ruby: "/assets/gemstone-ruby.png", Tourmaline: "/assets/gemstone-tourmaline.png",
  Peridot: "/assets/gemstone-peridot.png", Aquamarine: "/assets/gemstone-aquamarine.png", Topaz: "/assets/gem-4-crisp.jpg",
};
const slugifyStone = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function HeaderIcon({ name }: { name: "search" | "heart" | "user" | "bag" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.2" /><path d="m15.4 15.4 4.2 4.2" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.8c0 5-8.8 10.3-8.8 10.3S3.2 13.8 3.2 8.8A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.8 2.3Z" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="7.5" r="3.2" /><path d="M5.3 20v-1.6a6.7 6.7 0 0 1 13.4 0V20Z" /></svg>;
  return <svg {...common}><path d="M4.5 8h15l1 12h-17l1-12Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
}

function CategoryGlyph({ shape }: { shape: "diamond" | "ring" | "bracelet" | "circle" | "necklace" | "pendant" | "earrings" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (shape === "diamond") return <svg {...common}><path d="m3 9 4-6h10l4 6-9 12L3 9Z" /><path d="M3 9h18M7 3l5 18 5-18" /></svg>;
  if (shape === "ring") return <svg {...common}><path d="m8 5 4-3 4 3 2 5-6 12-6-12 2-5Z" /><path d="M6 10h12" /></svg>;
  if (shape === "bracelet" || shape === "circle") return <svg {...common}><ellipse cx="12" cy="12" rx={shape === "bracelet" ? "8.7" : "7.8"} ry={shape === "bracelet" ? "6.2" : "7.8"} /><ellipse cx="12" cy="12" rx="5.2" ry="3.6" /></svg>;
  if (shape === "necklace") return <svg {...common}><path d="M5 3c0 6 2.5 10 7 14 4.5-4 7-8 7-14" /><circle cx="12" cy="18" r="2.1" /></svg>;
  if (shape === "pendant") return <svg {...common}><path d="M5 3c0 5 2.2 8 7 11 4.8-3 7-6 7-11" /><path d="m12 14 3 3-3 5-3-5 3-3Z" /></svg>;
  return <svg {...common}><path d="M8 3v3m8-3v3" /><circle cx="8" cy="10" r="2.4" /><circle cx="16" cy="10" r="2.4" /><path d="M8 12.5v7m8-7v7" /></svg>;
}

function JewelryTypeColumn({ categories, activeType, onSelect }: { categories: MenuCategory[]; activeType: string | null; onSelect: (type: string) => void }) {
  return <div className="mega-column">
    <h3 className="mega-column-title">Theo loại trang sức</h3>
    <div className="mega-category-list">
      {categories.map((category) => <a href={"/san-pham?danh-muc=" + category.slug} className={"mega-category-link" + (activeType === category.id ? " is-selected" : "")} key={category.id} aria-controls={activeType === category.id ? "jewelry-stone-list" : undefined} aria-expanded={activeType === category.id} onMouseEnter={() => onSelect(category.id)} onFocus={() => onSelect(category.id)}>{category.imageUrl ? <img className="mega-category-thumbnail" src={category.imageUrl} alt="" /> : <CategoryGlyph shape={categoryShape(category.name)} />}<span>{category.name}</span></a>)}
      {!categories.length && <span className="mega-gem-empty">Chưa có danh mục trang sức</span>}
    </div>
  </div>;
}

function JewelryStoneColumn({ stones, showHeading = true, categorySlug = "" }: { stones: MenuStone[]; showHeading?: boolean; categorySlug?: string }) {
  return <div className="mega-column" id="jewelry-stone-list">
    {showHeading && <><h3 className="mega-column-title">Theo loại đá</h3><p className="mega-column-description">Chọn loại đá để xem {categorySlug ? "mẫu vòng tay" : "trang sức"} phù hợp.</p></>}
    <div className="mega-gem-list">
      {stones.map((stone) => <a href={`/san-pham?${categorySlug ? `danh-muc=${categorySlug}&` : ""}loai=${encodeURIComponent(stone.slug)}`} className="mega-gem-link" key={stone.id}>{stone.imageUrl ? <img src={stone.imageUrl} alt="" /> : <span className="mega-gem-placeholder" aria-hidden="true">◇</span>}<span>{stone.name}</span></a>)}
      {!stones.length && <span className="mega-gem-empty">Chưa có loại đá</span>}
      <a className="mega-view-all" href={categorySlug ? `/san-pham?danh-muc=${categorySlug}` : "/san-pham"}>Xem tất cả <span>›</span></a>
    </div>
  </div>;
}

function BraceletCategoryColumn({ categories, activeCategory, onSelect }: { categories: MenuCategory[]; activeCategory: string | null; onSelect: (id: string) => void }) {
  return <div className="mega-column">
    <h3 className="mega-column-title">Danh mục con</h3>
    <div className="mega-category-list">
      {categories.map((category) => <a href={"/san-pham?danh-muc=" + category.slug} className={"mega-category-link" + (activeCategory === category.id ? " is-selected" : "")} key={category.id} aria-controls={activeCategory === category.id ? "jewelry-stone-list" : undefined} aria-expanded={activeCategory === category.id} onMouseEnter={() => onSelect(category.id)} onFocus={() => onSelect(category.id)}>{category.imageUrl ? <img className="mega-category-thumbnail" src={category.imageUrl} alt="" /> : <CategoryGlyph shape={categoryShape(category.name)} />}<span>{category.name}</span><span className="mega-sub-chevron">&gt;</span></a>)}
    </div>
  </div>;
}

function GemstoneListColumn({ stones, categories = [], showHeading = true }: { stones: Array<Pick<MenuCategory, "id" | "name" | "slug" | "imageUrl">>; categories?: MenuCategory[]; showHeading?: boolean }) {
  const categoryTrail = (category: MenuCategory) => {
    const parts = [category.name];
    let parentId = category.parentId;
    while (parentId) {
      const parent = categories.find((item) => item.id === parentId);
      if (!parent || parent.level <= 1) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }
    return parts.join(" / ");
  };
  return <>
    {categories.length > 0 && <div className="mega-column"><h3 className="mega-column-title">Danh mục sản phẩm</h3><div className="mega-category-list">{categories.map((category) => <a href={`/san-pham?danh-muc=${encodeURIComponent(category.slug)}`} className="mega-category-link" key={category.id}>{category.imageUrl ? <img className="mega-category-thumbnail" src={category.imageUrl} alt=""/> : <CategoryGlyph shape={categoryShape(category.name)}/>}<span>{categoryTrail(category)}</span></a>)}</div></div>}
    <div className="mega-column" id="gemstone-stone-list">
      {showHeading && <><h3 className="mega-column-title">Mặt đá quý theo loại đá</h3><p className="mega-column-description">Chọn loại đá để xem các mặt đá đang có.</p></>}
      <div className="mega-gem-list mega-gem-list-dense">
        {stones.map((stone) => <a href={`/da-quy?loai=${encodeURIComponent(stone.slug)}`} className="mega-gem-link" key={stone.id}>{stone.imageUrl ? <img src={stone.imageUrl} alt="" /> : <span className="mega-gem-placeholder" aria-hidden="true">◇</span>}<span>{stone.name}</span></a>)}
        {!stones.length && <span className="mega-gem-empty">Chưa có loại đá</span>}
        <a className="mega-view-all" href="/da-quy">Xem tất cả mặt đá quý <span>›</span></a>
      </div>
    </div>
  </>;
}

function JewelLinks({ showAll = false, categories, stones }: { showAll?: boolean; categories: MenuCategory[]; stones: MenuStone[] }) {
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeChild, setActiveChild] = useState<string | null>(null);
  const jewelryProductCategories = categories.filter((item) => item.kind === "JEWELRY" && item.usage === "PRODUCT_CATEGORY");
  const rootIds = new Set(jewelryProductCategories.filter((item) => !item.parentId).map((item) => item.id));
  const sortCategories = (items: MenuCategory[]) => items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "vi"));
  // Parent links are the source of truth; level is only display metadata and
  // older categories may have been saved with a missing or stale level.
  const typeCategories = sortCategories(jewelryProductCategories.filter((item) => rootIds.has(item.parentId || "")));
  const activeCategory = categories.find((item) => item.id === (activeChild || activeType));
  const children = activeType ? sortCategories(jewelryProductCategories.filter((item) => item.parentId === activeType)) : [];
  const selectedChildren = activeChild ? sortCategories(jewelryProductCategories.filter((item) => item.parentId === activeChild)) : [];
  const showStones = Boolean(activeCategory);
  const stoneCategory = activeChild ? categories.find((item) => item.id === activeChild) : activeCategory;
  const typeColumn = <JewelryTypeColumn categories={typeCategories} activeType={activeType} onSelect={(id) => { setActiveType(id); setActiveChild(null); }} />;
  const secondColumn = activeType && children.length > 0 ? <BraceletCategoryColumn categories={children} activeCategory={activeChild} onSelect={setActiveChild} /> : null;
  const thirdColumn = activeChild && selectedChildren.length > 0 ? <BraceletCategoryColumn categories={selectedChildren} activeCategory={null} onSelect={setActiveChild} /> : null;
  const applicableStones = stoneCategory
    ? stones.filter((stone) => stone.appliedCategoryIds === undefined || stone.appliedCategoryIds.includes(stoneCategory.id))
    : [];
  const stonesColumn = showStones ? <JewelryStoneColumn stones={applicableStones} categorySlug={stoneCategory?.slug || ""} /> : null;
  if (showAll) return <div className="mega-columns has-selection">{typeColumn}{secondColumn}{thirdColumn}{stonesColumn}</div>;
  return <div className={"mega-selection-layout" + (activeType ? " has-selection" : "")}>
    <MenuCard id="trang-suc" title="TRANG SỨC"><div className="mega-columns">{typeColumn}</div></MenuCard>
    {secondColumn && <MenuCard id="trang-suc" title={activeCategory?.name || "DANH MỤC"} className="mega-card-stone-panel"><div className="mega-columns">{secondColumn}</div></MenuCard>}
    {thirdColumn && <MenuCard id="trang-suc" title="DANH MỤC" className="mega-card-stone-panel"><div className="mega-columns">{thirdColumn}</div></MenuCard>}
    {stonesColumn && <MenuCard id="trang-suc" title="THEO LOẠI ĐÁ" className="mega-card-stone-panel mega-card-stone-types"><div className="mega-columns">{stonesColumn}</div></MenuCard>}
  </div>;
}

function GemLinks({ showAll = false, stones, types, categories }: { showAll?: boolean; stones: MenuStone[]; types: MenuCategory[]; categories: MenuCategory[] }) {
  const combinedStones = [...types, ...stones].reduce<Array<Pick<MenuCategory, "id" | "name" | "slug" | "imageUrl">>>((all, item) => all.some((stone) => stone.slug === item.slug) ? all : [...all, item], []);
  const productCategories = categories.filter((item) => item.status === "ACTIVE" && item.usage === "PRODUCT_CATEGORY" && item.level > 1).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (showAll) return <div className="mega-columns mega-gemstone-columns"><GemstoneListColumn stones={combinedStones} categories={productCategories}/></div>;
  return <MenuCard id="da-quy" title="MẶT ĐÁ QUÝ"><div className="mega-columns"><GemstoneListColumn stones={combinedStones} categories={productCategories}/></div></MenuCard>;
}

function MenuCard({ id, title, children, className = "" }: { id: MenuId; title: string; children: ReactNode; className?: string }) {
  return <section className={`mega-card mega-card-${id}${className ? ` ${className}` : ""}`} aria-label={title}>
    <div className="mega-card-heading"><span className="mega-sparkle">✦</span><h2>{title}</h2><span className="mega-chevron">›</span></div>
    {children}
  </section>;
}

export function SiteHeader({ searchPlaceholder = "Tìm kiếm sản phẩm...", activePage }: { searchPlaceholder?: string; activePage?: "blog" | "new-arrivals" | "gemstone" }) {
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [jewelryStones, setJewelryStones] = useState<MenuStone[]>([]);
  const [gemstoneStones, setGemstoneStones] = useState<MenuStone[]>([]);
  const [jewelryCategories, setJewelryCategories] = useState<MenuCategory[]>([]);
  const [gemstoneTypes, setGemstoneTypes] = useState<MenuCategory[]>([]);
  const [gemstoneCategories, setGemstoneCategories] = useState<MenuCategory[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<StoreCartLine[]>([]);
  const [accountHref, setAccountHref] = useState("/tai-khoan");
  const [accountAvatarUrl, setAccountAvatarUrl] = useState("");
  const [accountName, setAccountName] = useState("");
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const applyMaterials = (records: ApiMaterialOption[]) => {
      if (!active) return;
      const stones = records.filter((item) => item.kind === "STONE" && item.active).map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug || slugifyStone(item.name),
        imageUrl: item.imageUrl || fallbackStoneImages[item.name],
        ...(Array.isArray(item.appliedCategoryIds) ? { appliedCategoryIds: item.appliedCategoryIds } : {}),
        sortOrder: item.sortOrder ?? 0,
      }));
      const order = (left: MenuStone & { sortOrder?: number }, right: MenuStone & { sortOrder?: number }) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name, "vi");
      setJewelryStones(stones.filter((item) => records.find((record) => record.id === item.id)?.scope === "JEWELRY").sort(order));
      setGemstoneStones(stones.filter((item) => records.find((record) => record.id === item.id)?.scope === "GEMSTONE").sort(order));
    };
    const applyCategories = (records: MenuCategory[]) => {
      if (!active) return;
      const enabled = records.filter((item) => item.status === "ACTIVE");
      setJewelryCategories(enabled.filter((item) => item.kind === "JEWELRY" && item.usage === "PRODUCT_CATEGORY"));
      setGemstoneTypes(enabled.filter((item) => item.kind === "GEMSTONE" && item.usage === "GEMSTONE_TYPE"));
      setGemstoneCategories(enabled.filter((item) => item.kind === "GEMSTONE" && item.usage === "PRODUCT_CATEGORY"));
    };
    let categoriesRequestId = 0;
    const fetchCategories = async (fresh = false) => {
      const requestId = ++categoriesRequestId;
      try {
        const response = await fetch(`${materialsApiBase}/categories`, { cache: fresh ? "no-store" : "default" });
        if (response.ok) {
          const records = await response.json() as MenuCategory[];
          if (requestId === categoriesRequestId) applyCategories(records);
        }
      } catch { /* Keep the category menu empty until the API is available. */ }
    };
    const refreshCategories = () => { void fetchCategories(true); };
    // The materials SSE stream delivers a shared in-memory snapshot on open;
    // avoid issuing a duplicate database read for every visitor.
    void fetchCategories(true);
    window.addEventListener("geme:categories-changed", refreshCategories);
    const events = new EventSource(`${materialsApiBase}/materials/events`);
    events.onmessage = (event) => {
      try { applyMaterials(JSON.parse(event.data) as ApiMaterialOption[]); } catch { /* Ignore malformed event payloads. */ }
    };
    return () => { active = false; window.removeEventListener("geme:categories-changed", refreshCategories); events.close(); };
  }, []);

  useEffect(() => {
    let alive = true;
    let expiryTimer: number | undefined;
    const checkAccountSession = async () => {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (response.status === 401) {
          if (alive) {
            setAccountHref("/dang-nhap?next=%2Ftai-khoan");
            setAccountAvatarUrl("");
            setAccountName("");
          }
          return;
        }
        // A timeout, rate limit, or temporary API outage is not evidence that
        // the customer signed out. Keep the account link and current identity.
        if (!response.ok) return;
        const result = await response.json() as { customer?: { name?: string; avatarUrl?: string | null }; sessionExpiresAt?: number };
        if (!alive) return;
        setAccountHref("/tai-khoan");
        setAccountAvatarUrl(result.customer?.avatarUrl || "");
        setAccountName(result.customer?.name || "");
        const expiresAt = Number(result.sessionExpiresAt);
        if (Number.isFinite(expiresAt)) {
          expiryTimer = window.setTimeout(() => {
            const currentPage = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (["/dang-nhap", "/dang-ky"].includes(window.location.pathname)) return;
            window.location.replace(`/dang-nhap?next=${encodeURIComponent(currentPage)}`);
          }, Math.max(0, expiresAt - Date.now()));
        }
      } catch {
        // Preserve the signed-in state when the auth service is temporarily unreachable.
      }
    };
    void checkAccountSession();
    return () => { alive = false; if (expiryTimer !== undefined) window.clearTimeout(expiryTimer); };
  }, []);

  useEffect(() => {
    const refreshCart = () => {
      const items = readStoreCart();
      setCartItems(items);
      setCartCount(items.reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0));
    };
    refreshCart();
    window.addEventListener("geme:cart-updated", refreshCart);
    return () => window.removeEventListener("geme:cart-updated", refreshCart);
  }, []);

  const saveCart = (items: StoreCartLine[]) => {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    setCartItems(items);
    setCartCount(items.reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0));
    window.dispatchEvent(new CustomEvent("geme:cart-updated", { detail: { count: items.reduce((total, item) => total + item.quantity, 0) } }));
  };

  const cancelMenuClose = () => {
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = null;
  };
  const closeMenuSoon = () => {
    cancelMenuClose();
    menuCloseTimer.current = setTimeout(() => setActiveMenu(null), 220);
  };
  const openMenu = (menu: MenuId | null) => {
    cancelMenuClose();
    setActiveMenu(menu);
  };

  const onHeaderBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveMenu(null);
  };

  const navItems: { id: MenuId; label: string; href: string }[] = [
    { id: "trang-suc", label: "TRANG SỨC", href: "/san-pham" },
    { id: "da-quy", label: "ĐÁ QUÝ", href: "/da-quy" },
    { id: "san-pham", label: "NEW ARRIVALS", href: "/new-arrivals" },
  ];

  return <header className="site-header" onMouseEnter={cancelMenuClose} onMouseLeave={() => { if (!mobileOpen) closeMenuSoon(); }} onBlur={onHeaderBlur} onKeyDown={(event) => { if (event.key === "Escape") { cancelMenuClose(); setActiveMenu(null); setMobileOpen(false); } }}>
    <div className="header-main">
      <a className="wordmark" href="/" aria-label="GEME trang chủ"><span className="sparkle">✦</span> GEME</a>
      <nav className={`main-nav${mobileOpen ? " is-open" : ""}`} id="geme-main-nav" aria-label="Điều hướng chính">
        {navItems.map((item) => <a
          href={item.href}
          className={`nav-link${activeMenu === item.id ? " is-active" : ""}${activePage === "new-arrivals" && item.id === "san-pham" ? " is-current" : ""}`}
          aria-current={activePage === "new-arrivals" && item.id === "san-pham" || activePage === "gemstone" && item.id === "da-quy" ? "page" : undefined}
          aria-expanded={item.id === "san-pham" ? undefined : activeMenu === item.id}
          aria-controls={activeMenu === item.id ? (mobileOpen ? "geme-mobile-submenu" : "geme-mega-menu") : undefined}
          key={item.id}
          onMouseEnter={() => { if (!mobileOpen) openMenu(item.id === "san-pham" ? null : item.id); }}
          onFocus={() => { if (!mobileOpen) openMenu(item.id === "san-pham" ? null : item.id); }}
          onClick={(event) => {
            if (item.id !== "san-pham" && window.matchMedia("(max-width: 760px)").matches) {
              event.preventDefault();
              setActiveMenu((current) => current === item.id ? null : item.id);
            } else {
              openMenu(null);
              setMobileOpen(false);
            }
          }}
        >{item.label}<span className="mobile-nav-indicator" aria-hidden="true">{activeMenu === item.id ? "−" : "+"}</span></a>)}
        <a className="nav-link nav-link-page" href="/ve-geme" onMouseEnter={() => openMenu(null)} onFocus={() => openMenu(null)} onClick={() => { openMenu(null); setMobileOpen(false); }}>VỀ GEME</a>
        <a className={`nav-link nav-link-page${activePage === "blog" ? " is-current" : ""}`} href="/blog" onMouseEnter={() => openMenu(null)} onFocus={() => openMenu(null)} onClick={() => { openMenu(null); setMobileOpen(false); }}>BLOG</a>
        <a className="nav-link nav-link-page" href="/lien-he" onMouseEnter={() => openMenu(null)} onFocus={() => openMenu(null)} onClick={() => { openMenu(null); setMobileOpen(false); }}>LIÊN HỆ</a>
        {mobileOpen && activeMenu && <div className="mobile-mega-submenu" id="geme-mobile-submenu" onClick={() => { setActiveMenu(null); setMobileOpen(false); }}>
          {activeMenu === "trang-suc" && <JewelLinks stones={jewelryStones} categories={jewelryCategories} showAll />}
          {activeMenu === "da-quy" && <GemLinks stones={gemstoneStones} types={gemstoneTypes} categories={gemstoneCategories} showAll />}
          {activeMenu === "san-pham" && <a className="mobile-arrivals-link" href="/new-arrivals">Tất cả sản phẩm mới <span>→</span></a>}
        </div>}
      </nav>
      <div className="header-tools">
        <label className="search-box"><HeaderIcon name="search" /><input aria-label={searchPlaceholder} placeholder={searchPlaceholder} /></label>
        <a className="header-icon" href="/tai-khoan?tab=favorites" aria-label="Sản phẩm yêu thích"><HeaderIcon name="heart" /></a>
        <a className="header-icon" href={accountHref} aria-label={accountName ? `Tài khoản của ${accountName}` : "Đăng nhập hoặc vào tài khoản"}>{accountAvatarUrl ? <img className="header-account-avatar" src={accountAvatarUrl} alt=""/> : <HeaderIcon name="user" />}</a>
        <button className="header-icon header-cart-button" type="button" aria-label={`Giỏ hàng${cartCount ? `, ${cartCount} sản phẩm` : ""}`} aria-haspopup="dialog" aria-expanded={cartOpen} onClick={() => { setCartItems(readStoreCart()); setCartOpen(true); }}><HeaderIcon name="bag" />{cartCount > 0 && <span className="header-cart-count">{cartCount}</span>}</button>
      </div>
      <button className={`mobile-menu${mobileOpen ? " is-open" : ""}`} type="button" aria-label={mobileOpen ? "Đóng menu" : "Mở menu"} aria-expanded={mobileOpen} aria-controls="geme-main-nav" onClick={() => { setMobileOpen((open) => !open); setActiveMenu(null); }}><span></span><span></span></button>
    </div>
    {activeMenu && !mobileOpen && <div className="mega-menu-layer">
      <div className="mega-menu" id="geme-mega-menu" onMouseEnter={cancelMenuClose}>
        {activeMenu === "trang-suc" && <JewelLinks stones={jewelryStones} categories={jewelryCategories} />}
        {activeMenu === "da-quy" && <GemLinks stones={gemstoneStones} types={gemstoneTypes} categories={gemstoneCategories} />}
      </div>
    </div>}
    {cartOpen && <div className="store-cart-layer">
      <button className="store-cart-backdrop" type="button" aria-label="Đóng giỏ hàng" onClick={() => setCartOpen(false)} />
      <aside className="store-cart-drawer" role="dialog" aria-modal="true" aria-labelledby="store-cart-title">
        <div className="store-cart-heading"><div><span className="eyebrow">GEME</span><h2 id="store-cart-title">Giỏ hàng <small>({cartCount})</small></h2></div><button type="button" aria-label="Đóng giỏ hàng" onClick={() => setCartOpen(false)}>×</button></div>
        {cartItems.length ? <>
          <div className="store-cart-lines">{cartItems.map((item) => <article className="store-cart-line" key={item.key}>
            <div className="store-cart-line-copy"><a href={`/san-pham/${encodeURIComponent(item.slug)}`} onClick={() => setCartOpen(false)}>{item.name}</a><small>{[item.quality, item.beadSize].filter(Boolean).join(" · ") || item.sku}</small><strong>{money(item.price)}</strong></div>
            <div className="store-cart-line-controls"><button type="button" aria-label={`Giảm số lượng ${item.name}`} onClick={() => saveCart(cartItems.flatMap((row) => row.key !== item.key ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []))}>−</button><span>{item.quantity}</span><button type="button" aria-label={`Tăng số lượng ${item.name}`} disabled={item.quantity >= item.stock} onClick={() => saveCart(cartItems.map((row) => row.key === item.key ? { ...row, quantity: Math.min(row.stock, row.quantity + 1) } : row))}>+</button></div>
            <button className="store-cart-remove" type="button" onClick={() => saveCart(cartItems.filter((row) => row.key !== item.key))}>Xóa</button>
          </article>)}</div>
          <div className="store-cart-total"><span>Tạm tính</span><strong>{money(cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0))}</strong></div>
          <a className="store-cart-checkout" href="/thanh-toan" onClick={() => setCartOpen(false)}>TIẾN HÀNH ĐẶT HÀNG</a>
          <button className="store-cart-continue" type="button" onClick={() => setCartOpen(false)}>Tiếp tục xem sản phẩm</button>
        </> : <div className="store-cart-empty"><p>Giỏ hàng đang trống.</p><button type="button" onClick={() => setCartOpen(false)}>Tiếp tục xem sản phẩm</button></div>}
      </aside>
    </div>}
  </header>;
}
