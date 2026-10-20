"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminProduct, ProductPriceVariant } from "./products-workspace";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialOption } from "./materials-workspace";
import { parsePriceInput } from "./product-images";

type VariantDraft = { price: string; originalPrice: string };
type ProductDraft = { price: string; originalPrice: string; variants: Record<string, VariantDraft> };
type PriceSyncStatus = { id: string; sku: string; status: string | null; error: string | null; syncedAt: string | null };
type Props = {
  products: AdminProduct[];
  categories: AdminCategory[];
  materials: MaterialOption[];
  onSave: (product: AdminProduct) => Promise<AdminProduct | void> | AdminProduct | void;
  onNotify: (message: string) => void;
  onSyncAll: () => Promise<{ queued?: number; skippedWithoutPrice?: number; synced?: number; syncing?: number; pending?: number; retrying?: number }>;
  onRefresh: () => Promise<void>;
  onCheckSyncStatus: (productIds: string[]) => Promise<PriceSyncStatus[]>;
};

const variantKey = (variant: ProductPriceVariant, index: number) => variant.id || `${variant.quality}::${variant.beadSize || ""}::${variant.carat || ""}::${variant.gemstoneQuality || ""}::${index}`;
const variantDescription = (product: AdminProduct, variant: ProductPriceVariant) => product.productType === "Đá quý"
  ? [`Dạng cắt ${variant.quality}`, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality ? `Chất lượng ${variant.gemstoneQuality}` : null].filter(Boolean).join(" · ")
  : [variant.quality, variant.beadSize].filter(Boolean).join(" · ") || "Biến thể";

function makeDraft(product: AdminProduct): ProductDraft {
  return {
    price: String(product.price || ""),
    originalPrice: String(product.originalPrice || ""),
    variants: Object.fromEntries((product.priceVariants || []).map((variant, index) => [variantKey(variant, index), {
      price: String(variant.price || ""), originalPrice: String(variant.originalPrice || ""),
    }])),
  };
}

function syncLabel(status?: string | null) {
  if (status === "SYNCED") return { text: "Đã đồng bộ POS365", tone: "synced" };
  if (status === "SYNCING") return { text: "Đang gửi giá sang POS365", tone: "pending" };
  if (status === "PENDING") return { text: "Đang chờ lượt POS365", tone: "pending" };
  if (status === "RETRYING") return { text: "POS365 chưa nhận · sẽ thử lại", tone: "retry" };
  if (status === "NEEDS_PRICE") return { text: "Cần hoàn tất giá", tone: "missing" };
  if (status === "DISABLED") return { text: "POS365 chưa bật", tone: "muted" };
  return { text: "Chưa đồng bộ", tone: "muted" };
}

type JewelryProfileDetails = {
  name: string;
  attributes: { label: string; value: string }[];
};

const formatMillimeters = (value: string) => {
  const numeric = Number(value.replace(",", "."));
  return `${Number.isFinite(numeric) ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(numeric) : value} mm`;
};

/** Presentation-only parsing for Hồ sơ giá. The saved product name and POS payload stay unchanged. */
function jewelryProfileDetails(product: AdminProduct): JewelryProfileDetails {
  const sourceName = product.name?.trim() || "Sản phẩm chưa đặt tên";
  let name = sourceName;
  const sizeValues: string[] = [];
  const dimensionsPattern = /(?:\bsize\s*)?(\d+(?:[.,]\d+)?)\s*(?:mm\s*)?[*x×]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:mm\s*)?[*x×]\s*(\d+(?:[.,]\d+)?))?\s*mm\b/gi;
  let dimensionsMatch: RegExpExecArray | null;
  while ((dimensionsMatch = dimensionsPattern.exec(sourceName)) !== null) {
    const first = formatMillimeters(dimensionsMatch[1]);
    const second = formatMillimeters(dimensionsMatch[2]);
    const third = dimensionsMatch[3] ? formatMillimeters(dimensionsMatch[3]) : null;
    sizeValues.push(third
      ? `Dài ${first} · Rộng ${second} · Cao ${third}`
      : `Dài ${first} · Rộng ${second}`);
  }
  name = name.replace(dimensionsPattern, " ");

  const singleSizePattern = /(?:\bsize\s*)?(\d+(?:[.,]\d+)?)\s*mm\b/gi;
  let singleSizeMatch: RegExpExecArray | null;
  while ((singleSizeMatch = singleSizePattern.exec(name)) !== null) sizeValues.push(formatMillimeters(singleSizeMatch[1]));
  name = name.replace(singleSizePattern, " ");
  if (!sizeValues.length) sizeValues.push(...(product.beadSizes || []).map((value) => value.trim()).filter(Boolean));
  const uniqueSizes = [...new Set(sizeValues)];
  const size = uniqueSizes.join(" · ");

  const materialPattern = /\b(bạc\s*(?:925|950|990|999)?|vàng(?:\s*(?:trắng|hồng))?(?:\s*\d{1,2}\s*k)?|bạch\s*kim|platinum|thép\s+không\s+gỉ|inox|titan|stainless\s+steel|silver|gold)\b/gi;
  const namedMaterials = [...sourceName.matchAll(materialPattern)].map((match) => match[0].trim());
  const subcategoryMaterial = product.subcategory?.trim() || "";
  const namedMaterial = namedMaterials[0] || "";
  const subcategoryIsMaterial = subcategoryMaterial ? new RegExp(`^(?:${materialPattern.source})$`, "i").test(subcategoryMaterial) : false;
  const material = /^bạc$/i.test(subcategoryMaterial) && /\bbạc\s*(?:925|950|990|999)\b/i.test(namedMaterial)
    ? namedMaterial
    : namedMaterial || (subcategoryIsMaterial ? subcategoryMaterial : "");
  name = name.replace(materialPattern, " ");
  if (subcategoryMaterial && subcategoryIsMaterial) {
    const escapedMaterial = subcategoryMaterial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(escapedMaterial, "gi"), " ");
  }
  name = name.replace(/\b(?:925|950|990|999)\b/gi, " ");

  const qualityMatch = sourceName.match(/\bcao\s*cấp\b/i)
    || sourceName.match(/\b(?:chuẩn\s*)?([1-9]a)\b/i)
    || sourceName.match(/\bchất lượng\s*(a{1,4}\+?)(?=\s|$)/i);
  const namedQuality = qualityMatch
    ? (/cao\s*cấp/i.test(qualityMatch[0]) ? "Cao cấp" : /^chất lượng/i.test(qualityMatch[0]) ? qualityMatch[1]?.toUpperCase() || qualityMatch[0].trim() : qualityMatch[1] ? `Chuẩn ${qualityMatch[1].toUpperCase()}` : qualityMatch[0].trim())
    : "";
  const variantQualities = [...new Set([
    ...(product.qualityGrades || []),
    ...(product.priceVariants || []).map((variant) => variant.quality),
  ].map((value) => value.trim()).filter((value) => value && !/^(kích thước|tiêu chuẩn|mặc định)$/i.test(value) && !/^\d+(?:[.,]\d+)?\s*mm$/i.test(value)))];
  const quality = namedQuality || variantQualities.join(" · ");
  name = name.replace(/\bcao\s*cấp\b/gi, " ")
    .replace(/\b(?:chuẩn\s*)?[1-9]a\b/gi, " ")
    .replace(/\bchất lượng\s*a{1,4}\+?(?=\s|$)/gi, " ");

  const trailingCode = name.match(/\s*[-–—]\s*([A-Z0-9]{3,})\s*$/i);
  if (trailingCode && product.id.toLocaleUpperCase("en-US").endsWith(trailingCode[1].toLocaleUpperCase("en-US"))) {
    name = name.slice(0, trailingCode.index ?? name.length).trim();
  }
  name = name.replace(/đính\s+đá/gi, " ").replace(/\s+/g, " ").replace(/\s*[-–—·]\s*$/g, "").trim();
  if (subcategoryMaterial && !subcategoryIsMaterial && !name.toLocaleLowerCase("vi").includes(subcategoryMaterial.toLocaleLowerCase("vi"))) {
    name = [name, subcategoryMaterial].filter(Boolean).join(" ").trim();
  }

  const silverGrade = material.match(/\b(925|950|990|999)\b/i)?.[1] || sourceName.match(/\b(925|950|990|999)\b/i)?.[1];
  return {
    name: name || sourceName,
    attributes: [
      { label: "Size", value: size },
      { label: "Chất liệu bạc", value: silverGrade || "" },
      { label: "Chất lượng", value: quality },
    ],
  };
}

function categoryMatches(product: AdminProduct, selectedId: string, descendants: Map<string, Set<string>>) {
  if (selectedId === "all") return true;
  if (selectedId === "__uncategorized__") return !product.categoryId;
  return descendants.get(selectedId)?.has(product.categoryId || "") ?? product.categoryId === selectedId;
}

function categoryFiltersMatch(product: AdminProduct, selectedIds: string[], descendants: Map<string, Set<string>>) {
  return !selectedIds.length || selectedIds.some((id) => categoryMatches(product, id, descendants));
}

function productSizeValues(product: AdminProduct) {
  const values = new Set<string>();
  const normalize = (value: string) => value.trim().replace(/\s*mm\b/gi, " mm").replace(/\s+/g, " ");
  for (const value of [...(product.beadSizes || []), ...(product.priceVariants || []).map((variant) => variant.beadSize || "")]) {
    if (value.trim()) values.add(normalize(value));
  }

  let remainingName = product.name || "";
  const dimensionsPattern = /(?:\bsize\s*)?(\d+(?:[.,]\d+)?)\s*(?:mm\s*)?[*x×]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:mm\s*)?[*x×]\s*(\d+(?:[.,]\d+)?))?\s*mm\b/gi;
  let dimensionsMatch: RegExpExecArray | null;
  while ((dimensionsMatch = dimensionsPattern.exec(remainingName)) !== null) {
    const first = formatMillimeters(dimensionsMatch[1]);
    const second = formatMillimeters(dimensionsMatch[2]);
    const third = dimensionsMatch[3] ? formatMillimeters(dimensionsMatch[3]) : null;
    values.add(third ? `Dài ${first} · Rộng ${second} · Cao ${third}` : `Dài ${first} · Rộng ${second}`);
  }
  remainingName = remainingName.replace(dimensionsPattern, " ");
  const singleSizePattern = /(?:\bsize\s*)?(\d+(?:[.,]\d+)?)\s*mm\b/gi;
  let singleSizeMatch: RegExpExecArray | null;
  while ((singleSizeMatch = singleSizePattern.exec(remainingName)) !== null) values.add(formatMillimeters(singleSizeMatch[1]));
  return [...values];
}

export default function PriceProfileWorkspace({ products, categories, materials, onSave, onNotify, onSyncAll, onRefresh, onCheckSyncStatus }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("Trang sức");
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [stoneFilters, setStoneFilters] = useState<string[]>([]);
  const [sizeFilters, setSizeFilters] = useState<string[]>([]);
  const [draftCategoryFilters, setDraftCategoryFilters] = useState<string[]>([]);
  const [draftStoneFilters, setDraftStoneFilters] = useState<string[]>([]);
  const [draftSizeFilters, setDraftSizeFilters] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({});
  const [savingId, setSavingId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const activeSyncIds = [...new Set(products
    .filter((product) => product.apiId && ["PENDING", "SYNCING"].includes(String(product.pos365PriceSyncStatus || "")))
    .map((product) => String(product.apiId)))];
  const activeSyncKey = activeSyncIds.join(",");
  const checkSyncStatusRef = useRef(onCheckSyncStatus);
  checkSyncStatusRef.current = onCheckSyncStatus;

  useEffect(() => {
    if (!activeSyncIds.length) return;
    let active = true;
    let inFlight = false;
    const refreshStatus = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await checkSyncStatusRef.current(activeSyncIds); } catch { /* keep showing the last known sync state */ }
      finally { inFlight = false; }
    };
    void refreshStatus();
    const timer = window.setInterval(() => { if (active) void refreshStatus(); }, 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeSyncKey]);

  const categoryDescendants = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const category of categories) {
      const descendants = new Set([category.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const child of categories) {
          if (child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) {
            descendants.add(child.id);
            changed = true;
          }
        }
      }
      result.set(category.id, descendants);
    }
    return result;
  }, [categories]);

  const categoryOptions = useMemo(() => {
    const currentProducts = products.filter((product) => product.productType === kind);
    const expectedCategoryKind = kind === "Trang sức" ? "Trang sức" : "Đá quý";
    const expectedUsage = kind === "Trang sức" ? "product" : "stone";
    const configured = categories
      .filter((category) => category.kind === expectedCategoryKind && category.usage === expectedUsage && category.status === "Hoạt động" && (kind === "Trang sức" ? Number(category.level || 1) > 1 : true))
      .map((category) => [category.id, category.name, currentProducts.filter((product) => categoryDescendants.get(category.id)?.has(product.categoryId || "")).length, Number(category.sortOrder) || 0, category.parentId || ""] as [string, string, number, number, string])
      .filter(([, , count]) => count > 0)
      .sort((a, b) => a[3] - b[3] || a[1].localeCompare(b[1], "vi", { numeric: true }));
    if (configured.length) return configured;
    const fallback = new Map<string, { name: string; count: number }>();
    for (const product of currentProducts) {
      const id = product.categoryId || "__uncategorized__";
      const current = fallback.get(id) || { name: product.category || "Chưa phân loại", count: 0 };
      current.count += 1;
      fallback.set(id, current);
    }
    return [...fallback.entries()].map(([id, item]) => [id, item.name, item.count, 0, ""] as [string, string, number, number, string]).sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [products, categories, kind, categoryDescendants]);

  const categoryTabOptions = useMemo(() => {
    const optionIds = new Set(categoryOptions.map(([id]) => id));
    const roots = categoryOptions.filter(([id, , , , parentId]) => !parentId || !optionIds.has(parentId));
    return roots.length ? roots : categoryOptions;
  }, [categoryOptions]);

  const stoneOptions = useMemo(() => {
    if (kind !== "Trang sức") return [];
    const contextualCategories = filtersOpen ? draftCategoryFilters : categoryFilters;
    const counts = new Map<string, number>();
    for (const stone of materials) {
      if (!stone.active || stone.scope !== "Trang sức" || stone.kind !== "STONE") continue;
      const count = products.filter((product) => product.productType === "Trang sức" && product.materialOptionId === stone.id && categoryFiltersMatch(product, contextualCategories, categoryDescendants)).length;
      if (count > 0) counts.set(stone.id, count);
    }
    return [...counts.entries()].map(([id, count]) => [id, materials.find((stone) => stone.id === id)?.name || "", count] as [string, string, number]).sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [products, materials, kind, categoryFilters, draftCategoryFilters, filtersOpen, categoryDescendants]);

  const sizeOptions = useMemo(() => {
    const contextualCategories = filtersOpen ? draftCategoryFilters : categoryFilters;
    const contextualStones = filtersOpen ? draftStoneFilters : stoneFilters;
    const counts = new Map<string, number>();
    for (const product of products) {
      if (product.productType !== kind || !categoryFiltersMatch(product, contextualCategories, categoryDescendants)) continue;
      if (kind === "Trang sức" && contextualStones.length && !contextualStones.includes(product.materialOptionId || "")) continue;
      for (const size of productSizeValues(product)) counts.set(size, (counts.get(size) || 0) + 1);
    }
    return [...counts.entries()].map(([size, count]) => [size, count] as [string, number]).sort((a, b) => a[0].localeCompare(b[0], "vi", { numeric: true }));
  }, [products, kind, categoryFilters, stoneFilters, draftCategoryFilters, draftStoneFilters, filtersOpen, categoryDescendants]);

  const filtered = useMemo(() => products.filter((product) => {
    const matchesQuery = `${product.id} ${product.name} ${product.category || ""} ${product.subcategory || ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
    const matchesKind = product.productType === kind;
    const matchesCategory = categoryFiltersMatch(product, categoryFilters, categoryDescendants);
    const matchesStone = kind !== "Trang sức" || !stoneFilters.length || stoneFilters.includes(product.materialOptionId || "");
    const matchesSize = !sizeFilters.length || productSizeValues(product).some((size) => sizeFilters.includes(size));
    const prices = product.priceVariants?.length ? product.priceVariants.map((variant) => Number(variant.price) || 0) : [Number(product.price) || 0];
    const hasMissing = prices.some((price) => price <= 0);
    return matchesQuery && matchesKind && matchesCategory && matchesStone && matchesSize && (!missingOnly || hasMissing);
  }).sort((a, b) => a.id.localeCompare(b.id, "vi")), [products, query, kind, categoryFilters, stoneFilters, sizeFilters, missingOnly, categoryDescendants]);

  const activeFilterCount = categoryFilters.length + stoneFilters.length + sizeFilters.length + Number(missingOnly);
  const toggleFilterValue = (value: string, current: string[], update: (next: string[]) => void) => update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const openFilters = () => {
    setDraftCategoryFilters(categoryFilters);
    setDraftStoneFilters(stoneFilters);
    setDraftSizeFilters(sizeFilters);
    setFiltersOpen((open) => !open);
  };
  const applyFilters = () => {
    setCategoryFilters(draftCategoryFilters);
    setStoneFilters(draftStoneFilters);
    setSizeFilters(draftSizeFilters);
    setFiltersOpen(false);
  };
  const resetFilters = () => {
    setCategoryFilters([]);
    setStoneFilters([]);
    setSizeFilters([]);
    setDraftCategoryFilters([]);
    setDraftStoneFilters([]);
    setDraftSizeFilters([]);
    setMissingOnly(false);
  };
  const selectCategoryTab = (id: string) => {
    const next = id ? [id] : [];
    setCategoryFilters(next);
    setDraftCategoryFilters(next);
  };

  const pricedCount = products.filter((product) => product.priceVariants?.length
    ? product.priceVariants.length > 0 && product.priceVariants.every((variant) => Number(variant.price) > 0)
    : Number(product.price) > 0).length;
  const variantCount = products.reduce((sum, product) => sum + (product.priceVariants?.length || 1), 0);
  const dirty = (product: AdminProduct, draft: ProductDraft) => {
    if (Number(draft.price) !== Number(product.price || 0) || Number(draft.originalPrice) !== Number(product.originalPrice || 0)) return true;
    return (product.priceVariants || []).some((variant, index) => {
      const next = draft.variants[variantKey(variant, index)] || { price: "", originalPrice: "" };
      return Number(next.price) !== Number(variant.price || 0) || Number(next.originalPrice) !== Number(variant.originalPrice || 0);
    });
  };

  const updateDraft = (product: AdminProduct, update: (draft: ProductDraft) => ProductDraft) => {
    const key = product.id;
    setDrafts((current) => ({ ...current, [key]: update(current[key] || makeDraft(product)) }));
  };

  const updateVariantPriceDraft = (product: AdminProduct, source: ProductPriceVariant, field: keyof VariantDraft, nextValue: string) => {
    const gemstoneMode = product.productType === "Đá quý" ? product.categoryPricingMode : null;
    const linkedVariants = gemstoneMode === "GEMSTONE_SIZE" && source.beadSize
      ? (product.priceVariants || []).filter((variant) => variant.beadSize === source.beadSize)
      : gemstoneMode === "GEMSTONE_CARAT"
        ? (product.priceVariants || [])
        : gemstoneMode === "GEMSTONE_CARAT_AND_QUALITY" && source.gemstoneQuality
          ? (product.priceVariants || []).filter((variant) => variant.gemstoneQuality === source.gemstoneQuality)
          : [source];
    updateDraft(product, (current) => {
      const variants = { ...current.variants };
      for (const variant of linkedVariants) {
        const key = variantKey(variant, (product.priceVariants || []).indexOf(variant));
        const value = variants[key] || { price: String(variant.price || ""), originalPrice: String(variant.originalPrice || "") };
        variants[key] = { ...value, [field]: nextValue };
      }
      return { ...current, variants };
    });
  };

  const save = async (product: AdminProduct) => {
    const key = product.id;
    const draft = drafts[key] || makeDraft(product);
    const priceVariants = (product.priceVariants || []).map((variant, index) => {
      const next = draft.variants[variantKey(variant, index)] || { price: "", originalPrice: "" };
      return { ...variant, price: parsePriceInput(next.price), originalPrice: parsePriceInput(next.originalPrice) || 0 };
    });
    const prices = priceVariants.length ? priceVariants.map((variant) => variant.price).filter((price) => price > 0) : [parsePriceInput(draft.price)].filter((price) => price > 0);
    const updated = {
      ...product,
      price: priceVariants.length ? (prices.length ? Math.min(...prices) : 0) : parsePriceInput(draft.price),
      originalPrice: parsePriceInput(draft.originalPrice),
      priceVariants,
    };
    setSavingId(key);
    try {
      const saved = await onSave(updated);
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
      const syncStatus = saved && typeof saved === "object" ? saved.pos365PriceSyncStatus : null;
      if (syncStatus === "SYNCED") onNotify("Đã lưu và POS365 xác nhận giá mới.");
      else if (syncStatus === "RETRYING") onNotify(saved?.pos365PriceSyncError || "Đã lưu giá; POS365 chưa nhận được và hệ thống sẽ thử lại.");
      else if (syncStatus === "DISABLED") onNotify("Đã lưu giá; đồng bộ POS365 hiện chưa được bật.");
      else onNotify("Đã lưu giá; đang gửi hoặc chờ POS365 xác nhận.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu Hồ sơ giá.");
    } finally { setSavingId(""); }
  };

  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await onSyncAll();
      const retrying = result.retrying || 0;
      const waiting = (result.syncing || 0) + (result.pending || 0);
      onNotify(`POS365 đã xác nhận ${result.synced || 0}/${result.queued || 0} hồ sơ giá; ${waiting} đang chờ xử lý, ${retrying} cần thử lại. Bỏ qua ${result.skippedWithoutPrice || 0} sản phẩm thiếu giá.`);
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể đồng bộ giá POS365.");
    } finally { setSyncing(false); }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); onNotify("Đã làm mới trạng thái Hồ sơ giá."); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể làm mới giá."); }
    finally { setRefreshing(false); }
  };

  return <section className="price-profile-workspace">
    <div className="price-profile-heading">
      <div><span className="price-profile-eyebrow">GEME · QUẢN LÝ GIÁ</span><h1>Hồ sơ giá</h1><p>Bảng giá cố định theo SKU và biến thể. Đây là nguồn giá dùng chung cho website và POS365.</p></div>
      <div className="price-profile-actions"><button className="button button-quiet" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Đang tải…" : "Làm mới"}</button><button className="button button-primary" type="button" onClick={() => void syncAll()} disabled={syncing}>{syncing ? "Đang xếp hàng…" : "Đồng bộ giá POS365"}</button></div>
    </div>

    <div className="price-profile-stats">
      <article><span>Hồ sơ sản phẩm</span><strong>{products.length}</strong><small>Đang dùng cùng dữ liệu sản phẩm</small></article>
      <article><span>Đã có giá đầy đủ</span><strong>{pricedCount}</strong><small>Sẵn sàng hiển thị và đồng bộ</small></article>
      <article><span>SKU / biến thể</span><strong>{variantCount}</strong><small>Giá được quản lý riêng từng lựa chọn</small></article>
    </div>

    <div className="price-profile-note"><span>◇</span><p><strong>Giá bán được lưu trên hồ sơ SKU hiện tại.</strong> Chỉnh tại đây hoặc trong form sản phẩm đều cập nhật cùng một dữ liệu. Giá nhập kho chỉ cập nhật giá vốn, không tự đổi giá bán.</p></div>

    <div className="price-profile-kind-tabs" role="tablist" aria-label="Loại hồ sơ giá"><button type="button" role="tab" aria-selected={kind === "Trang sức"} className={kind === "Trang sức" ? "active" : ""} onClick={() => { setKind("Trang sức"); resetFilters(); setFiltersOpen(false); }}>Trang sức <span>{products.filter((product) => product.productType === "Trang sức").length}</span></button><button type="button" role="tab" aria-selected={kind === "Đá quý"} className={kind === "Đá quý" ? "active" : ""} onClick={() => { setKind("Đá quý"); resetFilters(); setFiltersOpen(false); }}>Đá quý <span>{products.filter((product) => product.productType === "Đá quý").length}</span></button></div>
    {categoryTabOptions.length > 0 && <div className="price-profile-category-tabs" role="group" aria-label={`Lọc theo danh mục ${kind.toLocaleLowerCase("vi")}`}><button type="button" className={!categoryFilters.length ? "active" : ""} aria-pressed={!categoryFilters.length} onClick={() => selectCategoryTab("")}>Tất cả</button>{categoryTabOptions.map(([id, name, count]) => <button type="button" key={id} className={categoryFilters.length === 1 && categoryFilters[0] === id ? "active" : ""} aria-pressed={categoryFilters.length === 1 && categoryFilters[0] === id} onClick={() => selectCategoryTab(id)}>{name}<span>{count}</span></button>)}</div>}
    <div className="price-profile-toolbar"><label className="price-profile-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm SKU, tên hoặc danh mục…"/></label><button type="button" className="price-profile-filter-toggle" aria-expanded={filtersOpen} aria-controls="price-profile-filter-panel" onClick={openFilters}>Bộ lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button><label className="price-profile-missing"><input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)}/> Chỉ xem thiếu giá</label><span>{filtered.length} / {products.filter((product) => product.productType === kind).length} hồ sơ</span>
      {filtersOpen && <div className="price-profile-filter-panel" id="price-profile-filter-panel"><div className="price-profile-filter-heading"><h3>Bộ lọc</h3><button type="button" aria-label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)}>×</button></div>{categoryOptions.length > 0 && <fieldset><legend>Danh mục</legend>{categoryOptions.map(([id, name, count, , parentId]) => <label key={id} style={{ marginInlineStart: parentId && categoryOptions.some(([candidateId]) => candidateId === parentId) ? 14 : 0 }}><input type="checkbox" checked={draftCategoryFilters.includes(id)} onChange={() => toggleFilterValue(id, draftCategoryFilters, setDraftCategoryFilters)}/>{name}<span>({count})</span></label>)}</fieldset>}{kind === "Trang sức" && stoneOptions.length > 0 && <fieldset><legend>Loại đá</legend>{stoneOptions.map(([id, name, count]) => <label key={id}><input type="checkbox" checked={draftStoneFilters.includes(id)} onChange={() => toggleFilterValue(id, draftStoneFilters, setDraftStoneFilters)}/>{name}<span>({count})</span></label>)}</fieldset>}{sizeOptions.length > 0 && <fieldset><legend>Kích thước</legend>{sizeOptions.map(([size, count]) => <label key={size}><input type="checkbox" checked={draftSizeFilters.includes(size)} onChange={() => toggleFilterValue(size, draftSizeFilters, setDraftSizeFilters)}/>{size}<span>({count})</span></label>)}</fieldset>}<div className="price-profile-filter-actions"><button type="button" className="button button-quiet" onClick={resetFilters}>Xóa bộ lọc</button><button type="button" className="button button-primary" onClick={applyFilters}>Áp dụng</button></div></div>}
    </div>

    <div className="price-profile-list">{filtered.map((product) => {
      const key = product.id;
      const draft = drafts[key] || makeDraft(product);
      const changed = dirty(product, draft);
      const status = syncLabel(product.pos365PriceSyncStatus);
      const variants = product.priceVariants || [];
      const pricePerCarat = product.productType === "Đá quý" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(String(product.categoryPricingMode || ""));
      const jewelryDetails = product.productType === "Trang sức" ? jewelryProfileDetails(product) : null;
      return <article className="price-profile-card" key={key}>
        <header className={jewelryDetails ? "price-profile-card-header-jewelry" : undefined}><div className="price-profile-product"><span className="price-profile-gem">◇</span><div><strong>{jewelryDetails?.name || product.name || "Sản phẩm chưa đặt tên"}</strong><span>{product.id} · {product.productType || "Trang sức"}{product.category ? ` · ${product.category}` : ""}</span></div></div>{jewelryDetails && <div className="price-profile-jewelry-details" aria-label="Thông tin trang sức">{jewelryDetails.attributes.map((attribute) => <div key={attribute.label}><span>{attribute.label}</span><strong className={!attribute.value ? "is-empty" : undefined}>{attribute.value || "—"}</strong></div>)}</div>}<span className={`price-profile-sync ${status.tone}`} title={product.pos365PriceSyncError || undefined}><i/>{status.text}</span></header>
        <div className="price-profile-price-head"><span>SKU / lựa chọn</span><span>Tồn</span><span>{pricePerCarat ? "Giá bán / 1 ct" : "Giá bán"}</span><span>{pricePerCarat ? "Giá gốc / 1 ct" : "Giá gốc"}</span></div>
        {variants.length ? variants.map((variant, index) => {
          const rowKey = variantKey(variant, index);
          const value = draft.variants[rowKey] || { price: "", originalPrice: "" };
          return <div className="price-profile-price-row" key={rowKey}>
            <div><strong>{variant.sku || product.id}</strong><small>{variantDescription(product, variant)}{!variant.sku && variants.length > 1 ? " · Thiếu SKU riêng cho POS" : ""}</small></div>
            <span>{Number(variant.stock) || 0}</span>
            <label className="price-profile-input"><input aria-label={`Giá bán ${variant.sku || product.id}`} inputMode="numeric" value={value.price} onChange={(event) => updateVariantPriceDraft(product, variant, "price", event.target.value)}/><i>₫</i></label>
            <label className="price-profile-input"><input aria-label={`Giá gốc ${variant.sku || product.id}`} inputMode="numeric" value={value.originalPrice} onChange={(event) => updateVariantPriceDraft(product, variant, "originalPrice", event.target.value)}/><i>₫</i></label>
          </div>;
        }) : <div className="price-profile-price-row">
          <div><strong>{product.id}</strong><small>Giá chung · tồn {Number(product.stock) || 0}</small></div><span>{Number(product.stock) || 0}</span>
          <label className="price-profile-input"><input aria-label={`Giá bán ${product.id}`} inputMode="numeric" value={draft.price} onChange={(event) => updateDraft(product, (current) => ({ ...current, price: event.target.value }))}/><i>₫</i></label>
          <label className="price-profile-input"><input aria-label={`Giá gốc ${product.id}`} inputMode="numeric" value={draft.originalPrice} onChange={(event) => updateDraft(product, (current) => ({ ...current, originalPrice: event.target.value }))}/><i>₫</i></label>
        </div>}
        <footer><div className="price-profile-save-hint">{product.pos365PriceSyncError ? <span title={product.pos365PriceSyncError}>{product.pos365PriceSyncError}</span> : <span>{product.pos365PriceSyncedAt ? `Đồng bộ lúc ${new Date(product.pos365PriceSyncedAt).toLocaleString("vi-VN")}` : "Giá gốc chỉ dùng làm giá tham chiếu trên GEME."}</span>}</div><button type="button" className="button button-primary" disabled={!changed || savingId === key} onClick={() => void save(product)}>{savingId === key ? "Đang lưu…" : "Lưu hồ sơ giá"}</button></footer>
      </article>;
    })}{!filtered.length && <div className="price-profile-empty"><strong>Không tìm thấy hồ sơ giá</strong><span>Thử đổi từ khóa hoặc bộ lọc.</span></div>}</div>
  </section>;
}
