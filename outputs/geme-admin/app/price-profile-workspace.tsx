"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminProduct, ProductPriceVariant } from "./products-workspace";
import { parsePriceInput } from "./product-images";

type VariantDraft = { price: string; originalPrice: string };
type ProductDraft = { price: string; originalPrice: string; variants: Record<string, VariantDraft> };
type PriceSyncStatus = { id: string; sku: string; status: string | null; error: string | null; syncedAt: string | null };
type Props = {
  products: AdminProduct[];
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

export default function PriceProfileWorkspace({ products, onSave, onNotify, onSyncAll, onRefresh, onCheckSyncStatus }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("Trang sức");
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

  const filtered = useMemo(() => products.filter((product) => {
    const matchesQuery = `${product.id} ${product.name} ${product.category || ""} ${product.subcategory || ""}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
    const matchesKind = product.productType === kind;
    const prices = product.priceVariants?.length ? product.priceVariants.map((variant) => Number(variant.price) || 0) : [Number(product.price) || 0];
    const hasMissing = prices.some((price) => price <= 0);
    return matchesQuery && matchesKind && (!missingOnly || hasMissing);
  }).sort((a, b) => a.id.localeCompare(b.id, "vi")), [products, query, kind, missingOnly]);

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

    <div className="price-profile-kind-tabs" role="tablist" aria-label="Loại hồ sơ giá"><button type="button" role="tab" aria-selected={kind === "Trang sức"} className={kind === "Trang sức" ? "active" : ""} onClick={() => setKind("Trang sức")}>Trang sức <span>{products.filter((product) => product.productType === "Trang sức").length}</span></button><button type="button" role="tab" aria-selected={kind === "Đá quý"} className={kind === "Đá quý" ? "active" : ""} onClick={() => setKind("Đá quý")}>Đá quý <span>{products.filter((product) => product.productType === "Đá quý").length}</span></button></div>
    <div className="price-profile-toolbar"><label className="price-profile-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm SKU, tên hoặc danh mục…"/></label><label className="price-profile-missing"><input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)}/> Chỉ xem thiếu giá</label><span>{filtered.length} / {products.filter((product) => product.productType === kind).length} hồ sơ</span></div>

    <div className="price-profile-list">{filtered.map((product) => {
      const key = product.id;
      const draft = drafts[key] || makeDraft(product);
      const changed = dirty(product, draft);
      const status = syncLabel(product.pos365PriceSyncStatus);
      const variants = product.priceVariants || [];
      const pricePerCarat = product.productType === "Đá quý" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(String(product.categoryPricingMode || ""));
      return <article className="price-profile-card" key={key}>
        <header><div className="price-profile-product"><span className="price-profile-gem">◇</span><div><strong>{product.name || "Sản phẩm chưa đặt tên"}</strong><span>{product.id} · {product.productType || "Trang sức"}{product.category ? ` · ${product.category}` : ""}</span></div></div><span className={`price-profile-sync ${status.tone}`} title={product.pos365PriceSyncError || undefined}><i/>{status.text}</span></header>
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
