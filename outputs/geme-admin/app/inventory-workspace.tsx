"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiBaseUrl } from "../lib/api";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialOption } from "./materials-workspace";
import { compressProductImage } from "./product-images";
import InventoryReceiptsWorkspace from "./inventory-receipts-workspace";

type Variant = { id: string; sku?: string | null; quality: string; beadSize?: string | null; price?: number | string | null; stock: number };
type InventoryProduct = {
  id: string; sku: string; name: string; status: string; stock: number; minimumStock: number; price?: number | string | null;
  kind: "JEWELRY" | "GEMSTONE";
  soldThisMonth: number; category?: { id: string; name: string } | null;
  gemstoneType?: { id: string; name: string } | null;
  materialOption?: { id: string; name: string; kind: "STONE" | "MATERIAL"; scope: "JEWELRY" | "GEMSTONE" } | null;
  images?: Array<{ url: string; alt?: string | null }>;
  variants: Variant[];
};
type Movement = {
  id: string; productId?: string | null; productName: string; productSku: string; variantLabel?: string | null;
  type: "IN" | "OUT"; quantity: number; stockBefore: number; stockAfter: number;
  reference?: string | null; note?: string | null; createdAt: string;
};
export type Tab = "stock" | "inbound" | "receipts" | "outbound" | "history";
type Props = { categories: AdminCategory[]; materials: MaterialOption[]; initialTab: Tab; onNavigate: (tab: Tab) => void; onNotify: (message: string) => void; onCategoryCreated: (category: AdminCategory) => void };

const money = (value: number) => new Intl.NumberFormat("vi-VN").format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const statusOf = (product: InventoryProduct) => product.stock <= 0 ? "Hết hàng" : product.stock <= product.minimumStock ? "Sắp hết" : "Còn hàng";
const productKindLabel = (product: InventoryProduct) => product.kind === "GEMSTONE" ? "Đá quý" : "Trang sức";
const stoneNameOf = (product: InventoryProduct) => product.kind === "GEMSTONE"
  ? product.gemstoneType?.name || product.materialOption?.name || ""
  : product.materialOption?.kind === "STONE" ? product.materialOption.name : "";
const tabTitle: Record<Tab, string> = { stock: "Tồn kho sản phẩm", inbound: "Nhập hàng", receipts: "Phiếu nhập", outbound: "Xuất kho", history: "Lịch sử tồn kho" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    let message = `API trả về lỗi ${response.status}.`;
    try { const body = await response.json(); message = Array.isArray(body.message) ? body.message.join(" ") : body.message || message; } catch { /* empty response */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export default function InventoryWorkspace({ categories, materials, initialTab, onNavigate, onNotify, onCategoryCreated }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stoneFilter, setStoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [expandedVariantIds, setExpandedVariantIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [editingMinimum, setEditingMinimum] = useState(false);
  const [minimumDraft, setMinimumDraft] = useState("5");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetScope, setResetScope] = useState<"ALL" | "SELECTED">("ALL");
  const [resetPreview, setResetPreview] = useState<{ selectedProductCount: number; affectedProductCount: number; skuCount: number; totalQuantity: number } | null>(null);
  const [resetPreviewLoading, setResetPreviewLoading] = useState(false);
  const [resetPreviewError, setResetPreviewError] = useState("");
  const [resetPreviewAttempt, setResetPreviewAttempt] = useState(0);
  const [resetNote, setResetNote] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<InventoryProduct | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{ products: InventoryProduct[]; recentMovements: Movement[] }>("inventory");
      setProducts(data.products || []);
      setMovements(data.recentMovements || []);
      setSelectedId((current) => current && data.products.some((product) => product.id === current) ? current : data.products[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được tồn kho.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => { setTab(initialTab); setPage(1); }, [initialTab]);
  const selectedResetIds = selectedRows.join(",");
  useEffect(() => {
    if (!resetOpen) return;
    let active = true;
    setResetPreview(null);
    setResetPreviewError("");
    setResetPreviewLoading(true);
    void request<{ selectedProductCount: number; affectedProductCount: number; skuCount: number; totalQuantity: number }>("inventory/reset/preview", {
      method: "POST", body: JSON.stringify({ scope: resetScope, productIds: resetScope === "SELECTED" ? selectedResetIds.split(",").filter(Boolean) : [] }),
      }).then((result) => { if (active) setResetPreview(result); })
      .catch((cause) => { if (active) setResetPreviewError(cause instanceof Error ? cause.message : "Không xem trước được phạm vi reset."); })
      .finally(() => { if (active) setResetPreviewLoading(false); });
    return () => { active = false; };
  }, [resetOpen, resetScope, selectedResetIds, resetPreviewAttempt]);

  const stoneOptions = useMemo(() => [...new Set(products.map(stoneNameOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [products]);
  const filtered = useMemo(() => products.filter((product) => {
    const term = search.trim().toLocaleLowerCase("vi");
    return (!term || `${product.name} ${product.sku} ${product.category?.name || ""} ${product.variants.map((variant) => variant.sku || "").join(" ")}`.toLocaleLowerCase("vi").includes(term))
      && (!kindFilter || product.kind === kindFilter)
      && (!categoryFilter || product.category?.id === categoryFilter)
      && (!stoneFilter || stoneNameOf(product) === stoneFilter)
      && (!statusFilter || statusOf(product) === statusFilter);
  }), [products, search, kindFilter, categoryFilter, stoneFilter, statusFilter]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const groupedPageRows = useMemo(() => [...pageRows].sort((a, b) => {
    const groupA = `${productKindLabel(a)} · ${stoneNameOf(a) || "Chưa gắn loại đá"}`;
    const groupB = `${productKindLabel(b)} · ${stoneNameOf(b) || "Chưa gắn loại đá"}`;
    return groupA.localeCompare(groupB, "vi") || a.name.localeCompare(b.name, "vi");
  }), [pageRows]);
  const selected = filtered.find((product) => product.id === selectedId) || filtered[0];
  const resetSkuCount = resetPreview?.skuCount || 0;
  const resetUnitCount = resetPreview?.totalQuantity || 0;
  const summary = {
    total: products.length,
    available: products.filter((product) => product.stock > product.minimumStock).length,
    low: products.filter((product) => product.stock > 0 && product.stock <= product.minimumStock).length,
    empty: products.filter((product) => product.stock <= 0).length,
  };
  const selectedMovements = movements.filter((movement) => movement.productId === selected?.id).slice(0, 5);
  const saveMinimum = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await request<InventoryProduct>(`inventory/products/${encodeURIComponent(selected.id)}/minimum-stock`, { method: "PATCH", body: JSON.stringify({ minimumStock: Number(minimumDraft) }) });
      setProducts((current) => current.map((product) => product.id === updated.id ? { ...product, minimumStock: updated.minimumStock } : product));
      setEditingMinimum(false);
      onNotify("Đã cập nhật mức tồn kho tối thiểu.");
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không thể lưu mức tồn tối thiểu."); }
    finally { setSaving(false); }
  };

  const openReset = () => {
    setResetScope(selectedRows.length ? "SELECTED" : "ALL");
    setResetNote("");
    setResetConfirmation("");
    setResetOpen(true);
  };

  const submitReset = async () => {
    if (!resetPreview || !resetNote.trim() || resetConfirmation !== "RESET" || (resetScope === "SELECTED" && !selectedRows.length)) return;
    setSaving(true);
    try {
      const result = await request<{ issueNo: string; resetSummary?: { productCount: number; skuCount: number; totalQuantity: number } }>("inventory/reset", {
        method: "POST", body: JSON.stringify({ scope: resetScope, productIds: resetScope === "SELECTED" ? selectedRows : [], note: resetNote, confirmation: resetConfirmation, expectedProductCount: resetPreview?.affectedProductCount, expectedSkuCount: resetPreview?.skuCount, expectedTotalQuantity: resetPreview?.totalQuantity }),
      });
      setResetOpen(false);
      setSelectedRows([]);
      onNotify(`Đã điều chỉnh ${money(result.resetSummary?.totalQuantity || 0)} cái từ ${money(result.resetSummary?.productCount || 0)} sản phẩm (${money(result.resetSummary?.skuCount || 0)} SKU). Phiếu ${result.issueNo} đã lưu; POS sẽ nhận tồn theo cấu hình đồng bộ.`);
      await reload();
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không thể reset kho."); }
    finally { setSaving(false); }
  };

  const submitHardDelete = async () => {
    if (!deleteTarget || !deleteReason.trim() || deleteConfirmation !== deleteTarget.sku) return;
    setSaving(true);
    try {
      const result = await request<{ adjustmentIssueNo?: string | null }>(`products/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE", body: JSON.stringify({ reason: deleteReason }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      setDeleteConfirmation("");
      setSelectedRows((current) => current.filter((id) => id !== deleteTarget.id));
      onNotify(result.adjustmentIssueNo
        ? `Đã xóa SKU khỏi hệ thống; tồn cũ được ghi vào phiếu ${result.adjustmentIssueNo}. Lịch sử cũ được giữ.`
        : "Đã xóa SKU khỏi hệ thống. Lịch sử phiếu và đơn hàng được giữ.");
      await reload();
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không thể xóa SKU."); }
    finally { setSaving(false); }
  };

  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["Sản phẩm", "SKU", "Danh mục", "Tồn kho", "Đã bán tháng này", "Trạng thái"], ...filtered.map((product) => [product.name, product.sku, product.category?.name || "", product.stock, product.soldThisMonth, statusOf(product)])];
    const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `geme-ton-kho-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const toggleRow = (id: string) => setSelectedRows((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelectedRows((current) => pageRows.every((product) => current.includes(product.id)) ? current.filter((id) => !pageRows.some((product) => product.id === id)) : [...new Set([...current, ...pageRows.map((product) => product.id)])]);

  return <div className="inventory-workspace">
    <header className="inventory-heading">
      <div><span className="inventory-eyebrow">KHO HÀNG GEME</span><h1>{tab === "outbound" ? "Xuất kho" : "Quản lý tồn kho"}</h1><p>{tab === "outbound" ? "Theo dõi và quản lý các sản phẩm đã xuất kho cho đơn hàng, khách lẻ hoặc mục đích khác." : "Theo dõi số lượng tồn kho, nhập/xuất và quản lý hàng hóa trong kho. Thao tác tại đây không thay đổi trạng thái đăng bán trên website."}</p></div>
      {(tab !== "outbound" && tab !== "receipts") && <div className="inventory-heading-actions"><span className="inventory-date">▣&nbsp; {new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} – {new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</span><button className="button button-quiet" onClick={exportCsv}>⇩&nbsp; Xuất file</button></div>}
    </header>

    <div className="inventory-tabs" role="tablist">{(["stock", "inbound", "receipts", "outbound", "history"] as Tab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); onNavigate(item); }}>{tabTitle[item]}</button>)}</div>

    {(tab === "stock" || tab === "history") && <section className="inventory-stats">
      <article className="inventory-stat"><span className="inventory-stat-icon mint">◇</span><div><small>Tổng sản phẩm</small><strong>{loading ? "—" : money(summary.total)}</strong><em>Trong danh mục quản lý</em></div></article>
      <article className="inventory-stat"><span className="inventory-stat-icon green">▣</span><div><small>Sản phẩm còn hàng</small><strong>{loading ? "—" : money(summary.available)}</strong><em>Tồn trên mức tối thiểu</em></div></article>
      <article className="inventory-stat"><span className="inventory-stat-icon amber">⚠</span><div><small>Sắp hết hàng</small><strong>{loading ? "—" : money(summary.low)}</strong><em>Theo mức tối thiểu từng sản phẩm</em></div></article>
      <article className="inventory-stat"><span className="inventory-stat-icon red">⊘</span><div><small>Hết hàng</small><strong>{loading ? "—" : money(summary.empty)}</strong><em>Cần nhập thêm</em></div></article>
    </section>}

    {error && <div className="inventory-error" role="alert">{error}<button onClick={() => void reload()}>Thử tải lại</button></div>}
    {tab === "history" ? <section className="inventory-history-panel"><div className="inventory-panel-title"><div><h2>Lịch sử nhập / xuất kho</h2><p>Các điều chỉnh đã được ghi trong database.</p></div><button className="button button-quiet" onClick={() => void reload()}>Làm mới</button></div><MovementTable movements={movements} empty={loading ? "Đang tải lịch sử…" : "Chưa có lượt nhập hoặc xuất kho."}/></section> : tab === "receipts" ? <InventoryReceiptsWorkspace /> : tab === "inbound" ? <InboundReceiptPage products={products} categories={categories} materials={materials} onCategoryCreated={onCategoryCreated} onCancel={() => { setTab("stock"); onNavigate("stock"); }} onComplete={async () => { await reload(); setTab("stock"); onNavigate("stock"); }} onNotify={onNotify}/> : tab === "outbound" ? <OutboundIssuePage products={products} onCancel={() => { setTab("stock"); onNavigate("stock"); }} onComplete={async () => { await reload(); }} onNotify={onNotify}/> : <>
      <div className="inventory-toolbar"><label className="inventory-search"><span>⌕</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm theo tên sản phẩm, mã SKU, mã vạch..."/></label><label className="inventory-filter">Nhóm sản phẩm<select value={kindFilter} onChange={(event) => { setKindFilter(event.target.value); setCategoryFilter(""); setStoneFilter(""); setPage(1); setSelectedRows([]); }}><option value="">Trang sức &amp; đá quý</option><option value="JEWELRY">Trang sức</option><option value="GEMSTONE">Đá quý</option></select></label><label className="inventory-filter">Danh mục<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setStoneFilter(""); setPage(1); setSelectedRows([]); }}><option value="">Tất cả</option>{categories.filter((category) => !kindFilter || products.some((product) => product.kind === kindFilter && product.category?.id === category.id)).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label className="inventory-filter">Loại đá<select value={stoneFilter} onChange={(event) => { setStoneFilter(event.target.value); setPage(1); setSelectedRows([]); }}><option value="">Tất cả loại đá</option>{stoneOptions.filter((stone) => products.some((product) => (!kindFilter || product.kind === kindFilter) && (!categoryFilter || product.category?.id === categoryFilter) && stoneNameOf(product) === stone)).map((stone) => <option value={stone} key={stone}>{stone}</option>)}</select></label><label className="inventory-filter">Trạng thái tồn kho<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); setSelectedRows([]); }}><option value="">Tất cả trạng thái</option><option>Còn hàng</option><option>Sắp hết</option><option>Hết hàng</option></select></label><label className="inventory-filter">Kho<select defaultValue="main"><option value="main">Kho chính</option></select></label><div className="inventory-toolbar-actions"><button className="button button-danger" onClick={openReset}>↺ Reset kho</button><button className="button button-quiet" onClick={() => { setTab("inbound"); onNavigate("inbound"); }}>＋ Nhập kho</button><button className="button button-primary" onClick={() => { setTab("outbound"); onNavigate("outbound"); }}>⇧ Xuất kho</button></div></div>

      <div className="inventory-main-grid"><section className="inventory-table-panel"><div className="inventory-table-scroll"><table className="inventory-table"><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả" checked={pageRows.length > 0 && pageRows.every((product) => selectedRows.includes(product.id))} onChange={toggleAll}/></th><th>Sản phẩm</th><th>Mã SKU</th><th>Danh mục</th><th>Tồn kho ↕</th><th>Đã bán (tháng) ↕</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="inventory-empty">Đang tải sản phẩm…</td></tr> : pageRows.length ? groupedPageRows.map((product, index) => {
        const previous = groupedPageRows[index - 1];
        const groupName = `${productKindLabel(product)} · ${stoneNameOf(product) || "Chưa gắn loại đá"}`;
        const previousGroupName = previous ? `${productKindLabel(previous)} · ${stoneNameOf(previous) || "Chưa gắn loại đá"}` : "";
        return <Fragment key={product.id}>{groupName !== previousGroupName && <tr className="inventory-group-row"><td colSpan={7}><span>{productKindLabel(product)}</span><b>{stoneNameOf(product) || "Chưa gắn loại đá"}</b></td></tr>}<tr className={selectedId === product.id ? "selected" : ""} onClick={() => { setSelectedId(product.id); setEditingMinimum(false); }}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${product.name}`} checked={selectedRows.includes(product.id)} onChange={() => toggleRow(product.id)}/></td><td><span className="inventory-product-cell">{product.images?.[0]?.url ? <img src={product.images[0].url} alt={product.images[0].alt || product.name}/> : <span className="inventory-product-placeholder">◇</span>}<strong>{product.name}</strong></span></td><td>{product.sku}{product.variants.length > 0 && <details className="inventory-variant-dropdown"><summary>{product.variants.length} biến thể · tồn kho</summary><div>{product.variants.map((variant) => <span key={variant.id}><b>{[variant.quality, variant.beadSize].filter(Boolean).join(" · ") || "Tiêu chuẩn"}</b><code>{variant.sku || "SKU chưa có"}</code><em>{money(variant.stock)} cái</em></span>)}</div></details>}</td><td>{product.category?.name || "Chưa phân loại"}</td><td className="inventory-number">{money(product.stock)}</td><td>{money(product.soldThisMonth)}</td><td><span className={`inventory-status ${statusOf(product) === "Còn hàng" ? "ok" : statusOf(product) === "Sắp hết" ? "low" : "out"}`}>{statusOf(product)}</span></td></tr></Fragment>;
      }) : <tr><td colSpan={7} className="inventory-empty">{error ? "Không lấy được dữ liệu từ API." : "Không có sản phẩm phù hợp."}</td></tr>}</tbody></table></div><div className="inventory-pagination"><span>Hiển thị {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} / {money(filtered.length)} sản phẩm</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>‹</button><strong>{page}</strong><button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>›</button></div></div></section>

      <aside className="inventory-detail-panel">{selected ? <><div className="inventory-detail-heading"><div><h2>Chi tiết tồn kho</h2><span className={`inventory-status ${statusOf(selected) === "Còn hàng" ? "ok" : statusOf(selected) === "Sắp hết" ? "low" : "out"}`}>{statusOf(selected)}</span></div><button className="inventory-refresh" title="Làm mới" onClick={() => void reload()}>↻</button></div><div className="inventory-detail-product">{selected.images?.[0]?.url ? <img src={selected.images[0].url} alt={selected.name}/> : <span className="inventory-product-placeholder">◇</span>}<div><strong>{selected.name}</strong><small>{selected.sku}</small><small>{productKindLabel(selected)} · {selected.category?.name || "Chưa phân loại"}</small>{stoneNameOf(selected) && <small>Loại đá: {stoneNameOf(selected)}</small>}</div></div><div className="inventory-detail-metrics"><div><small>Tồn kho hiện tại</small><strong>{money(selected.stock)}</strong></div><div><small>Đã bán (tháng)</small><strong>{money(selected.soldThisMonth)}</strong></div><div className="minimum-metric"><small>Tồn kho tối thiểu</small>{editingMinimum ? <div className="minimum-edit"><input type="number" min="0" value={minimumDraft} onChange={(event) => setMinimumDraft(event.target.value)}/><button disabled={saving} onClick={() => void saveMinimum()}>Lưu</button></div> : <strong>{money(selected.minimumStock)} <button className="minimum-pencil" title="Sửa mức tồn tối thiểu" onClick={() => { setMinimumDraft(String(selected.minimumStock)); setEditingMinimum(true); }}>✎</button></strong>}</div></div>
        <section className="inventory-variants"><div className="inventory-subheading"><h3>Theo kích thước / phân loại</h3><span>{selected.variants.length || 1}</span></div><div className="inventory-variant-head"><span>Kích thước / phân loại</span><span>Tồn kho</span><span>Khả dụng</span></div>{selected.variants.length ? selected.variants.map((variant) => <div className="inventory-variant-row" key={variant.id}><span>{[variant.quality, variant.beadSize].filter(Boolean).join(" · ") || "Tiêu chuẩn"}{variant.sku && <small>{variant.sku}</small>}</span><b>{money(variant.stock)}</b><b>{money(variant.stock)}</b></div>) : <div className="inventory-variant-row"><span>Tồn kho chung</span><b>{money(selected.stock)}</b><b>{money(selected.stock)}</b></div>}</section>
        <div className="inventory-retire-action"><button className="button button-danger button-outline" type="button" onClick={() => { setDeleteTarget(selected); setDeleteReason(""); setDeleteConfirmation(""); }}>Xóa SKU khỏi hệ thống</button><small>Xóa cứng sản phẩm này và toàn bộ SKU biến thể; lịch sử phiếu vẫn được giữ.</small></div>
        <section className="inventory-recent"><div className="inventory-subheading"><h3>Lịch sử nhập/xuất gần đây</h3><button onClick={() => { setTab("history"); onNavigate("history"); }}>Xem tất cả →</button></div>{selectedMovements.length ? selectedMovements.map((movement) => <MovementLine key={movement.id} movement={movement}/>) : <p className="inventory-no-history">Chưa có giao dịch nhập hoặc xuất kho.</p>}</section>
        {summary.low + summary.empty > 0 && <div className="inventory-alert"><strong>⚠&nbsp; Cảnh báo tồn kho</strong><span>{summary.low + summary.empty} sản phẩm sắp hết hoặc đã hết hàng.</span><button onClick={() => { setStatusFilter("Sắp hết"); setPage(1); }}>Xem danh sách →</button></div>}
      </> : <div className="inventory-detail-empty">Chọn một sản phẩm để xem tồn kho.</div>}</aside></div>
      </>}

    {resetOpen && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setResetOpen(false); }}><section className="inventory-modal inventory-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-reset-title"><header><div><span className="inventory-eyebrow">ĐIỀU CHỈNH TỒN KHO</span><h2 id="inventory-reset-title">Reset số lượng tồn</h2></div><button type="button" aria-label="Đóng" onClick={() => setResetOpen(false)}>×</button></header><p className="inventory-confirm-copy">Số lượng còn lại sẽ về 0. GEME tạo phiếu điều chỉnh và ghi từng SKU vào lịch sử; sản phẩm, SKU, phiếu nhập cũ và đơn hàng không bị xóa. Tồn mới của POS sẽ được đưa vào hàng đợi đồng bộ.</p><div className="inventory-reset-scope"><label><input type="radio" name="reset-scope" checked={resetScope === "ALL"} onChange={() => setResetScope("ALL")}/> Toàn bộ kho <small>{resetPreviewLoading ? "Đang tính…" : resetPreview ? `${money(resetPreview.selectedProductCount)} sản phẩm` : "—"}</small></label><label><input type="radio" name="reset-scope" checked={resetScope === "SELECTED"} disabled={!selectedRows.length} onChange={() => setResetScope("SELECTED")}/> Chỉ sản phẩm đã chọn <small>{money(selectedRows.length)} sản phẩm</small></label></div>{resetPreviewError && <div className="inventory-error" role="alert">Không tải được dữ liệu xem trước: {resetPreviewError}<button type="button" onClick={() => setResetPreviewAttempt((attempt) => attempt + 1)}>Thử lại</button></div>}<div className="inventory-reset-summary"><span>Sản phẩm có tồn <b>{resetPreviewLoading ? "…" : resetPreview ? money(resetPreview.affectedProductCount) : "—"}</b></span><span>SKU / số lượng <b>{resetPreviewLoading ? "…" : resetPreview ? `${money(resetSkuCount)} SKU · ${money(resetUnitCount)} cái` : "—"}</b></span></div><label>Lý do điều chỉnh<textarea rows={3} value={resetNote} onChange={(event) => setResetNote(event.target.value)} placeholder="Ví dụ: kiểm kê đầu kỳ, làm sạch dữ liệu để nhập lại kho…"/></label><label>Nhập <code>RESET</code> để xác nhận<input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} autoComplete="off" placeholder="RESET"/></label><footer><button className="button button-quiet" type="button" disabled={saving} onClick={() => setResetOpen(false)}>Hủy</button><button className="button button-danger" type="button" disabled={saving || resetPreviewLoading || !resetPreview || !resetNote.trim() || resetConfirmation !== "RESET" || (resetScope === "SELECTED" && !selectedRows.length) || resetSkuCount === 0} onClick={() => void submitReset()}>{saving ? "Đang reset…" : "Đưa tồn về 0 và lưu phiếu"}</button></footer></section></div>}

    {deleteTarget && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDeleteTarget(null); }}><section className="inventory-modal inventory-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-delete-title"><header><div><span className="inventory-eyebrow">XÓA CỨNG SKU</span><h2 id="inventory-delete-title">Xóa khỏi hệ thống?</h2></div><button type="button" aria-label="Đóng" onClick={() => setDeleteTarget(null)}>×</button></header><p className="inventory-confirm-copy">Sản phẩm <strong>{deleteTarget.name}</strong> · SKU mẹ <code>{deleteTarget.sku}</code>{deleteTarget.variants.length ? ` cùng ${deleteTarget.variants.length} SKU biến thể` : ""} sẽ bị xóa khỏi GEME và các mã POS365 tương ứng sẽ được gỡ. Phiếu nhập, phiếu xuất, lịch sử kho và đơn hàng cũ vẫn giữ tên, SKU, số lượng và giá đã chụp; liên kết tới bản ghi sản phẩm sẽ được bỏ. {deleteTarget.stock > 0 ? `Tồn hiện tại (${money(deleteTarget.stock)} cái) sẽ được ghi thành phiếu điều chỉnh trước khi xóa.` : ""} Thao tác xóa không thể hoàn tác.</p><label>Lý do xóa<input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="Nhập lý do để lưu vào nhật ký quản trị"/></label><label>Nhập chính xác SKU mẹ <code>{deleteTarget.sku}</code> để xác nhận<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" placeholder={deleteTarget.sku}/></label><footer><button className="button button-quiet" type="button" disabled={saving} onClick={() => setDeleteTarget(null)}>Hủy</button><button className="button button-danger" type="button" disabled={saving || !deleteReason.trim() || deleteConfirmation !== deleteTarget.sku} onClick={() => void submitHardDelete()}>{saving ? "Đang xóa…" : "Xóa cứng SKU"}</button></footer></section></div>}

  </div>;
}

function MovementLine({ movement }: { movement: Movement }) {
  const action = movement.note?.startsWith("[RESET]") ? "Reset kho" : movement.note?.startsWith("[DELETE]") ? "Xóa SKU" : movement.type === "IN" ? "Nhập kho" : "Xuất kho";
  return <div className="inventory-movement-line"><i className={movement.type === "IN" ? "in" : "out"}>{movement.type === "IN" ? "+" : "−"}</i><span><strong>{action}{movement.variantLabel ? ` · ${movement.variantLabel}` : ""}</strong><small>{movement.reference || dateLabel(movement.createdAt)}</small></span><b className={movement.type === "IN" ? "in" : "out"}>{movement.type === "IN" ? "+" : "−"}{money(movement.quantity)}</b></div>;
}

function MovementTable({ movements, empty }: { movements: Movement[]; empty: string }) {
  return <div className="inventory-history-scroll"><table className="inventory-history-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Sản phẩm</th><th>SKU / Phiên bản</th><th>Số lượng</th><th>Tồn sau giao dịch</th><th>Tham chiếu / Ghi chú</th></tr></thead><tbody>{movements.length ? movements.map((movement) => { const action = movement.note?.startsWith("[RESET]") ? "Reset kho" : movement.note?.startsWith("[DELETE]") ? "Xóa SKU" : movement.type === "IN" ? "Nhập kho" : "Xuất kho"; return <tr key={movement.id}><td>{dateLabel(movement.createdAt)}</td><td><span className={`inventory-status ${movement.type === "IN" ? "ok" : "out"}`}>{action}</span></td><td>{movement.productName}</td><td>{movement.productSku}{movement.variantLabel && <small className="history-subline">{movement.variantLabel}</small>}</td><td className={movement.type === "IN" ? "movement-in" : "movement-out"}>{movement.type === "IN" ? "+" : "−"}{money(movement.quantity)}</td><td>{money(movement.stockAfter)}</td><td>{[movement.reference, movement.note?.replace(/^\[(RESET|DELETE)\]\s*/, "")].filter(Boolean).join(" · ") || "—"}</td></tr>; }) : <tr><td colSpan={7} className="inventory-empty">{empty}</td></tr>}</tbody></table></div>;
}

type IssueItem = { id: string; productId?: string | null; variantId?: string | null; productName: string; productSku: string; variantLabel?: string | null; categoryName?: string | null; stoneName?: string | null; kind: string; quantity: number; unitPrice: number | string; lineTotal: number | string };
type IssueRecord = { id: string; issueNo: string; issuedAt: string; reason: "ORDER" | "CUSTOMER" | "TRANSFER" | "OTHER"; recipient?: string | null; warehouseName: string; status: string; note?: string | null; totalQuantity: number; totalAmount: number | string; items: IssueItem[] };
type IssueDraftLine = { key: string; productId: string; variantId: string; quantity: number };
const issueReasonLabels: Record<IssueRecord["reason"], string> = { ORDER: "Đơn hàng", CUSTOMER: "Khách lẻ", TRANSFER: "Xuất chuyển kho", OTHER: "Khác" };
const localDateValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const issueLineStock = (product: InventoryProduct, variantId: string) => variantId ? product.variants.find((variant) => variant.id === variantId)?.stock || 0 : product.stock;
const issueLinePrice = (product: InventoryProduct, variantId: string) => Number((variantId ? product.variants.find((variant) => variant.id === variantId)?.price : product.price) || 0);

function OutboundIssuePage({ products, onCancel, onComplete, onNotify }: {
  products: InventoryProduct[]; onCancel: () => void; onComplete: () => Promise<void>; onNotify: (message: string) => void;
}) {
  const today = localDateValue();
  const [from, setFrom] = useState(localDateValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [issuedAt, setIssuedAt] = useState(today);
  const [reason, setReason] = useState<IssueRecord["reason"]>("ORDER");
  const [recipient, setRecipient] = useState("");
  const [warehouseName, setWarehouseName] = useState("Kho chính");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<IssueDraftLine[]>([{ key: crypto.randomUUID(), productId: "", variantId: "", quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (search.trim()) params.set("search", search.trim());
    if (reasonFilter) params.set("reason", reasonFilter);
    void request<IssueRecord[]>(`inventory/issues?${params.toString()}`).then((data) => {
      if (active) setIssues(data || []);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được danh sách phiếu xuất.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, search, reasonFilter, reloadKey]);

  const rows = issues.flatMap((issue) => issue.items.map((item, index) => ({ issue, item, index })));
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const totalQuantity = issues.reduce((sum, issue) => sum + issue.totalQuantity, 0);
  const totalAmount = issues.reduce((sum, issue) => sum + Number(issue.totalAmount || 0), 0);
  const reasonCounts = (["ORDER", "CUSTOMER", "TRANSFER", "OTHER"] as IssueRecord["reason"][]).map((key) => ({ key, label: issueReasonLabels[key], count: issues.filter((issue) => issue.reason === key).length }));
  const reasonTotal = Math.max(issues.length, 1);
  const availableProducts = products.filter((product) => product.variants.length
    ? product.variants.some((variant) => variant.stock > 0)
    : product.stock > 0);
  const selectedLineData = (line: IssueDraftLine) => {
    const product = products.find((entry) => entry.id === line.productId);
    const variant = product?.variants.find((entry) => entry.id === line.variantId);
    const unitPrice = product ? issueLinePrice(product, line.variantId) : 0;
    const quantity = Number(line.quantity) || 0;
    return { product, variant, unitPrice, quantity, amount: unitPrice * quantity, stock: product ? issueLineStock(product, line.variantId) : 0 };
  };
  const draftQuantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const draftAmount = lines.reduce((sum, line) => sum + selectedLineData(line).amount, 0);
  const draftIsValid = lines.length > 0 && lines.every((line) => {
    const selected = selectedLineData(line);
    return !!selected.product && selected.quantity > 0 && selected.quantity <= selected.stock && (!selected.product.variants.length || !!selected.variant);
  }) && new Set(lines.map((line) => `${line.productId}:${line.variantId}`)).size === lines.length;

  const exportReport = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csvRows: unknown[][] = [["Ngày xuất", "Mã phiếu", "Lý do", "Khách hàng / nơi nhận", "Sản phẩm", "SKU", "Phiên bản", "Số lượng", "Đơn giá", "Thành tiền", "Trạng thái"]];
    for (const issue of issues) for (const item of issue.items) csvRows.push([dateLabel(issue.issuedAt), issue.issueNo, issueReasonLabels[issue.reason], issue.recipient, item.productName, item.productSku, item.variantLabel, item.quantity, Number(item.unitPrice), Number(item.lineTotal), issue.status === "COMPLETED" ? "Đã xuất" : issue.status]);
    const blob = new Blob(["\uFEFF" + csvRows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `geme-xuat-kho-${from || today}-${to || today}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const createIssue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftIsValid || saving) return;
    setSaving(true);
    try {
      const saved = await request<IssueRecord>("inventory/issues", { method: "POST", body: JSON.stringify({ issuedAt, reason, recipient, warehouseName, note, items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId || undefined, quantity: Number(line.quantity) })) }) });
      onNotify(`Đã lưu phiếu xuất ${saved.issueNo}, ${money(saved.totalQuantity)} sản phẩm vào database.`);
      setCreating(false);
      setLines([{ key: crypto.randomUUID(), productId: "", variantId: "", quantity: 1 }]);
      setNote("");
      setReloadKey((value) => value + 1);
      await onComplete();
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không thể lưu phiếu xuất."); }
    finally { setSaving(false); }
  };

  if (creating) return <div className="outbound-create-page">
    <header className="outbound-create-heading"><div><button className="outbound-back" type="button" onClick={() => setCreating(false)}>← Quay lại danh sách</button><h2>Tạo phiếu xuất kho</h2><p>Ghi nhận lý do xuất và các mặt hàng cần trừ tồn kho.</p></div><div><button type="button" className="button button-quiet" onClick={() => setCreating(false)}>Hủy</button><button type="submit" form="outbound-issue-form" className="button button-primary" disabled={saving || !draftIsValid}>{saving ? "Đang lưu…" : "Lưu phiếu xuất"}</button></div></header>
    <form id="outbound-issue-form" className="outbound-create-grid" onSubmit={(event) => void createIssue(event)}>
      <main className="outbound-create-main">
        <section className="outbound-card"><h3>Thông tin phiếu xuất</h3><div className="outbound-fields"><label>Ngày xuất <b>*</b><input required type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)}/></label><label>Lý do xuất kho <b>*</b><select value={reason} onChange={(event) => setReason(event.target.value as IssueRecord["reason"])}><option value="ORDER">Đơn hàng</option><option value="CUSTOMER">Khách lẻ</option><option value="TRANSFER">Xuất chuyển kho</option><option value="OTHER">Khác</option></select></label><label>Khách hàng / mã đơn<input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={180} placeholder="Ví dụ: Nguyễn Thị Lan · SO-20261003"/></label><label>Kho xuất<select value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)}><option>Kho chính</option></select></label></div><label className="outbound-note">Ghi chú<textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Thông tin bổ sung cho phiếu xuất"/></label></section>
        <section className="outbound-card outbound-lines-card"><div className="outbound-card-heading"><div><h3>Danh sách sản phẩm xuất</h3><p>Chỉ chọn sản phẩm và phiên bản còn tồn trong kho.</p></div><button type="button" className="button button-quiet" onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), productId: "", variantId: "", quantity: 1 }])}>＋ Thêm sản phẩm</button></div><div className="outbound-lines-scroll"><table className="outbound-lines-table"><thead><tr><th>#</th><th>Sản phẩm</th><th>SKU / Phiên bản</th><th>Tồn</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th></th></tr></thead><tbody>{lines.map((line, index) => {
          const selected = selectedLineData(line);
          return <tr key={line.key}><td>{index + 1}</td><td><select aria-label={`Sản phẩm dòng ${index + 1}`} required value={line.productId} onChange={(event) => { const product = products.find((entry) => entry.id === event.target.value); const variant = product?.variants.find((entry) => entry.stock > 0); setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, productId: product?.id || "", variantId: variant?.id || "" } : entry)); }}><option value="">Chọn sản phẩm</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td>{selected.product?.variants.length ? <select aria-label={`Phiên bản dòng ${index + 1}`} required value={line.variantId} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, variantId: event.target.value } : entry))}><option value="">Chọn mã phiên bản</option>{selected.product.variants.filter((variant) => variant.stock > 0).map((variant) => <option key={variant.id} value={variant.id}>{variant.sku || [variant.quality, variant.beadSize].filter(Boolean).join(" · ")} · tồn {variant.stock}</option>)}</select> : <span>{selected.product?.sku || "—"}</span>}</td><td>{selected.product ? money(selected.stock) : "—"}</td><td><input aria-label={`Số lượng dòng ${index + 1}`} type="number" min="1" max={Math.max(1, selected.stock)} value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: Number(event.target.value) } : entry))}/></td><td>{money(selected.unitPrice)} ₫</td><td>{money(selected.amount)} ₫</td><td><button type="button" className="outbound-remove-line" aria-label={`Xóa dòng ${index + 1}`} onClick={() => setLines((current) => current.length === 1 ? [{ ...current[0], productId: "", variantId: "", quantity: 1 }] : current.filter((entry) => entry.key !== line.key))}>×</button></td></tr>;
        })}</tbody></table></div></section>
      </main>
      <aside className="outbound-create-aside"><section className="outbound-card"><h3>Tóm tắt phiếu xuất</h3><div><span>Tổng số mặt hàng</span><b>{lines.filter((line) => line.productId).length}</b></div><div><span>Tổng số lượng</span><b>{money(draftQuantity)}</b></div><div className="outbound-total"><span>Tổng giá trị</span><b>{money(draftAmount)} ₫</b></div><small>Giá trị tính theo giá bán hiện tại của từng mặt hàng.</small></section><section className="outbound-card"><h3>Kiểm tra tồn kho</h3><p>Phiếu chỉ được lưu khi số lượng xuất không vượt tồn hiện có. Tồn kho và lịch sử xuất được cập nhật cùng lúc.</p></section></aside>
    </form>
  </div>;

  return <section className="outbound-workspace">
    <header className="outbound-heading"><div><h2>Xuất kho</h2><p>Theo dõi và quản lý các sản phẩm đã xuất kho cho đơn hàng, khách lẻ hoặc mục đích khác.</p></div><div className="outbound-date-range"><label><span>▣</span><input aria-label="Từ ngày" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }}/></label><i>–</i><label><input aria-label="Đến ngày" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }}/></label></div></header>
    {error && <div className="inventory-error" role="alert">{error}<button onClick={() => setReloadKey((value) => value + 1)}>Thử tải lại</button></div>}
    <div className="outbound-layout"><main className="outbound-main-column">
      <div className="outbound-toolbar"><label className="outbound-search"><span>⌕</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm theo mã đơn, mã sản phẩm, tên sản phẩm, khách hàng..."/></label><label>Loại xuất kho<select value={reasonFilter} onChange={(event) => { setReasonFilter(event.target.value); setPage(1); }}><option value="">Tất cả</option><option value="ORDER">Đơn hàng</option><option value="CUSTOMER">Khách lẻ</option><option value="TRANSFER">Xuất chuyển kho</option><option value="OTHER">Khác</option></select></label><button type="button" className="button button-quiet outbound-filter-button" onClick={() => { setSearch(""); setReasonFilter(""); setPage(1); }}>⌕ Lọc</button><button type="button" className="button button-primary" onClick={() => setCreating(true)}>＋ Tạo phiếu xuất</button></div>
      <section className="outbound-table-panel"><div className="outbound-table-scroll"><table className="outbound-table"><thead><tr><th>Ngày xuất</th><th>Mã phiếu xuất</th><th>Loại xuất</th><th>Khách hàng</th><th>Sản phẩm</th><th>Số lượng</th><th>Tổng giá trị (VND)</th><th>Trạng thái</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="inventory-empty">Đang tải phiếu xuất…</td></tr> : pageRows.length ? pageRows.map(({ issue, item, index }) => {
        const product = products.find((entry) => entry.id === item.productId);
        return <tr key={`${issue.id}-${item.id}`}><td>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(issue.issuedAt))}</td><td><strong>{issue.issueNo}</strong></td><td><span className={`outbound-reason ${issue.reason.toLocaleLowerCase("en")}`}>{issueReasonLabels[issue.reason]}</span></td><td>{issue.recipient || "Khách lẻ"}</td><td><span className="outbound-product"><img src={product?.images?.[0]?.url || "/images/product-placeholder.webp"} alt=""/><span><b>{item.productName}</b><small>{item.productSku}{item.variantLabel ? ` · ${item.variantLabel}` : ""}</small></span></span></td><td>{money(item.quantity)}</td><td>{money(Number(item.lineTotal))}</td><td><span className="inventory-status ok">Đã xuất</span></td></tr>;
      }) : <tr><td colSpan={8} className="inventory-empty">{error ? "Không lấy được danh sách phiếu." : "Chưa có phiếu xuất trong khoảng thời gian này."}</td></tr>}</tbody></table></div><div className="inventory-pagination"><span>Hiển thị {rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, rows.length)} trong {money(rows.length)} mặt hàng xuất</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>‹</button><strong>{page}</strong><button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>›</button></div></div></section>
    </main><aside className="outbound-side-column"><section className="outbound-side-card"><h3>Tổng quan xuất kho</h3><div><span>◷</span><p>Tổng số phiếu xuất</p><b>{loading ? "—" : money(issues.length)}</b></div><div><span>▤</span><p>Tổng số lượng</p><b>{loading ? "—" : money(totalQuantity)}</b></div><div><span>◉</span><p>Tổng giá trị (VND)</p><b>{loading ? "—" : money(totalAmount)}</b></div><button className="button button-primary" onClick={exportReport} disabled={!issues.length}>⇩&nbsp; Xuất file báo cáo</button></section>
      <section className="outbound-side-card"><h3>Lý do xuất kho</h3><div className="outbound-reason-summary"><div className="outbound-donut" style={{ background: `conic-gradient(#4d9a7c 0% ${reasonCounts[0].count / reasonTotal * 100}%, #718bb5 ${reasonCounts[0].count / reasonTotal * 100}% ${(reasonCounts[0].count + reasonCounts[1].count) / reasonTotal * 100}%, #b05ca8 ${(reasonCounts[0].count + reasonCounts[1].count) / reasonTotal * 100}% ${(reasonCounts[0].count + reasonCounts[1].count + reasonCounts[2].count) / reasonTotal * 100}%, #d59d56 ${(reasonCounts[0].count + reasonCounts[1].count + reasonCounts[2].count) / reasonTotal * 100}% 100%)` }}><strong>{money(issues.length)}</strong><small>phiếu xuất</small></div><div className="outbound-reason-legend">{reasonCounts.map((entry, index) => <p key={entry.key}><i className={`reason-dot dot-${index}`}/><span>{entry.label}<small>{money(entry.count)} ({Math.round(entry.count / reasonTotal * 100)}%)</small></span></p>)}</div></div></section>
      <section className="outbound-side-card"><h3>Phiếu xuất gần đây</h3>{issues.slice(0, 3).map((issue) => { const item = issue.items[0]; const product = products.find((entry) => entry.id === item?.productId); return <div className="outbound-recent-slip" key={issue.id}><img src={product?.images?.[0]?.url || "/images/product-placeholder.webp"} alt=""/><span><b>{issue.issueNo}</b><small>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(issue.issuedAt))}</small><small>{money(Number(issue.totalAmount))} VND</small></span><i>›</i></div>; })}{!issues.length && <p className="outbound-no-recent">{loading ? "Đang tải…" : "Chưa có phiếu xuất gần đây."}</p>}</section>
    </aside></div>
  </section>;
}

type SkuRule = { categoryId: string; prefix: string; materialOptionIds?: string[]; materialPrefixes: Array<{ materialOptionId: string; prefix: string }> };
type ReceiptVariantDraft = { quality: string; beadSize: string; quantity: number; unitCost: number; skuSuffix: string; sku?: string };
type ReceiptLine = { key: string; productId?: string; variantId?: string; quantity: number; unitCost: number; newProduct?: { name: string; categoryId: string; materialOptionId?: string; skuSequence?: string; sku: string; variants?: ReceiptVariantDraft[] } };
type ReceiptDocument = { name: string; url: string; mimeType: string };
type ReceiptRecord = { receiptNo: string; supplierName?: string | null };
type NewProductVariantMode = "SIZE" | "QUALITY" | "QUALITY_AND_BEAD_SIZE" | null;
type InventorySkuLookup = {
  sku: string;
  existingProduct?: { id: string; name: string; stock?: number; variantCount: number } | null;
  existingVariant?: { productSku: string; productName: string } | null;
};

function categoryPath(category: AdminCategory, categories: AdminCategory[]) {
  const parts = [category.name];
  let parentId = category.parentId;
  while (parentId) {
    const parent = categories.find((item) => item.id === parentId);
    if (!parent) break;
    if (parent.parentId || parent.kind !== category.kind) parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(" / ");
}

function variantModeForCategory(category: AdminCategory | undefined, categories: AdminCategory[]): NewProductVariantMode {
  if (!category) return null;
  if (category.pricingMode === "QUALITY_AND_BEAD_SIZE") return "QUALITY_AND_BEAD_SIZE";
  if (category.pricingMode === "QUALITY") return "QUALITY";
  if (category.kind !== "Trang sức") return null;
  const path = categoryPath(category, categories).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
  if (path.includes("vong chuoi")) return "QUALITY_AND_BEAD_SIZE";
  if (path.includes("vong tay") || path.includes("lac tay")) return "SIZE";
  return null;
}

function categorySlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function InboundReceiptPage({ products, categories, materials, onCategoryCreated, onCancel, onComplete, onNotify }: {
  products: InventoryProduct[]; categories: AdminCategory[]; materials: MaterialOption[];
  onCategoryCreated: (category: AdminCategory) => void;
  onCancel: () => void; onComplete: () => Promise<void>; onNotify: (message: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [materialOptions, setMaterialOptions] = useState(materials);
  const [receivedAt, setReceivedAt] = useState(today);
  const [receiptNo, setReceiptNo] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierIsNew, setSupplierIsNew] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [receiver, setReceiver] = useState("Admin");
  const [warehouseName, setWarehouseName] = useState("Kho chính");
  const [paymentMethod, setPaymentMethod] = useState("Chuyển khoản");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [vatPercent, setVatPercent] = useState("0");
  const [note, setNote] = useState("");
  const [additionalNote, setAdditionalNote] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [documents, setDocuments] = useState<ReceiptDocument[]>([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skuRules, setSkuRules] = useState<SkuRule[]>([]);
  const [ruleModal, setRuleModal] = useState(false);
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [rulePrefix, setRulePrefix] = useState("");
  const [stoneMaterialIdsDraft, setStoneMaterialIdsDraft] = useState<string[]>([]);
  const [stonePrefixDraft, setStonePrefixDraft] = useState<Record<string, string>>({});
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleNotice, setRuleNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [addingRuleMaterial, setAddingRuleMaterial] = useState(false);
  const [savingRuleMaterial, setSavingRuleMaterial] = useState(false);
  const [ruleMaterialName, setRuleMaterialName] = useState("");
  const [newProductModal, setNewProductModal] = useState(false);
  const [newProductKind, setNewProductKind] = useState<"Trang sức" | "Đá quý">("Trang sức");
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [newProductMaterialId, setNewProductMaterialId] = useState("");
  const [newProductQuantity, setNewProductQuantity] = useState("1");
  const [newProductUnitCost, setNewProductUnitCost] = useState("0");
  const [newProductVariantChoice, setNewProductVariantChoice] = useState<"SINGLE" | "SIZE" | "QUALITY" | "QUALITY_AND_BEAD_SIZE">("SINGLE");
  const [newProductVariants, setNewProductVariants] = useState<ReceiptVariantDraft[]>([]);
  const [newVariantQuality, setNewVariantQuality] = useState("A");
  const [newVariantSize, setNewVariantSize] = useState("8mm");
  const [newVariantSkuSuffix, setNewVariantSkuSuffix] = useState("");
  const [newVariantQuantity, setNewVariantQuantity] = useState("1");
  const [newVariantUnitCost, setNewVariantUnitCost] = useState("0");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryPrefix, setNewCategoryPrefix] = useState("");
  const [newCategorySlug, setNewCategorySlug] = useState("");
  const [newCategorySlugEdited, setNewCategorySlugEdited] = useState(false);
  const [newCategoryLevel, setNewCategoryLevel] = useState<1 | 2 | 3>(2);
  const [newCategoryParentId, setNewCategoryParentId] = useState("");
  const [newCategoryPricingMode, setNewCategoryPricingMode] = useState<AdminCategory["pricingMode"]>("FIXED");
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialPrefix, setNewMaterialPrefix] = useState("");
  const [creatingOption, setCreatingOption] = useState(false);
  const [newSkuSequence, setNewSkuSequence] = useState("");
  const [newSkuPreview, setNewSkuPreview] = useState("");
  const [newSkuError, setNewSkuError] = useState("");
  const [newSkuLookup, setNewSkuLookup] = useState<InventorySkuLookup | null>(null);

  const ruleCategories = useMemo(() => categoryOptions.filter((category) =>
    Boolean(category.id.trim())
    && category.status === "Hoạt động"
    && category.usage === "product"
    && category.level !== undefined
    && category.level > 1
    && (category.kind === "Trang sức" || category.kind === "Đá quý")), [categoryOptions]);
  const newProductCategories = ruleCategories.filter((category) => category.kind === newProductKind);
  const newCategoryParents = newCategoryLevel > 1 ? categoryOptions.filter((category) => category.status === "Hoạt động" && category.kind === newProductKind && category.usage !== "stone" && category.level === newCategoryLevel - 1) : [];
  const selectedNewCategoryParent = newCategoryParents.find((category) => category.id === newCategoryParentId) || newCategoryParents[0];
  const newProductCategory = newProductCategories.find((category) => category.id === newProductCategoryId);
  const newProductVariantMode: NewProductVariantMode = newProductVariantChoice === "SINGLE" ? null : newProductVariantChoice;
  const newProductScopeMaterials = materialOptions.filter((material) => material.active && material.kind === "STONE" && material.scope === (newProductKind === "Đá quý" ? "Đá quý" : "Trang sức") && (!Array.isArray(material.appliedCategoryIds) || material.appliedCategoryIds.includes(newProductCategoryId)));
  const newProductRule = skuRules.find((rule) => rule.categoryId === newProductCategoryId);
  const newProductAllowedMaterialIds = newProductRule
    ? new Set(Array.isArray(newProductRule.materialOptionIds) ? newProductRule.materialOptionIds : newProductScopeMaterials.map((material) => material.id))
    : new Set<string>();
  const newProductMaterials = newProductScopeMaterials.filter((material) => Array.isArray(material.appliedCategoryIds)
    ? material.appliedCategoryIds.includes(newProductCategoryId)
    : newProductAllowedMaterialIds.has(material.id));
  const ruleCategory = ruleCategories.find((category) => category.id === ruleCategoryId);
  const ruleScopeMaterials = materialOptions.filter((material) => material.active && material.kind === "STONE" && material.scope === (ruleCategory?.kind === "Đá quý" ? "Đá quý" : "Trang sức") && (!Array.isArray(material.appliedCategoryIds) || material.appliedCategoryIds.includes(ruleCategoryId)));
  const ruleMaterials = ruleScopeMaterials.filter((material) => stoneMaterialIdsDraft.includes(material.id));
  const savedSkuRules = skuRules.filter((rule) => ruleCategories.some((category) => category.id === rule.categoryId)).map((rule) => ({
    ...rule,
    category: categoryOptions.find((category) => category.id === rule.categoryId),
    materialSummary: (Array.isArray(rule.materialOptionIds) ? rule.materialOptionIds : rule.materialPrefixes.map((entry) => entry.materialOptionId)).map((materialOptionId) => {
      const materialName = materialOptions.find((material) => material.id === materialOptionId)?.name || "Loại đá";
      const prefix = rule.materialPrefixes.find((entry) => entry.materialOptionId === materialOptionId)?.prefix;
      return `${prefix ? `${prefix} ` : ""}(${materialName})`;
    }).join(" · "),
  }));
  const totalQuantity = lines.reduce((total, line) => total + (line.newProduct?.variants?.length ? line.newProduct.variants.reduce((sum, variant) => sum + variant.quantity, 0) : Number(line.quantity) || 0), 0);
  const subtotalAmount = lines.reduce((total, line) => total + (line.newProduct?.variants?.length ? line.newProduct.variants.reduce((sum, variant) => sum + variant.quantity * variant.unitCost, 0) : (Number(line.quantity) || 0) * (Number(line.unitCost) || 0)), 0);
  const discountRate = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const vatRate = Math.min(100, Math.max(0, Number(vatPercent) || 0));
  const discountAmount = Math.round(subtotalAmount * discountRate / 100);
  const vatAmount = Math.round((subtotalAmount - discountAmount) * vatRate / 100);
  const totalAmount = subtotalAmount - discountAmount + vatAmount;
  const completeLines = lines.filter((line) => (line.productId || line.newProduct) && line.quantity > 0);
  const suppliers = [...new Set(supplierOptions.filter(Boolean))];

  useEffect(() => { setCategoryOptions(categories); }, [categories]);
  useEffect(() => {
    if (ruleCategories.some((category) => category.id === ruleCategoryId)) return;
    setRuleCategoryId(ruleCategories[0]?.id || "");
  }, [ruleCategories, ruleCategoryId]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      request<{ rules: SkuRule[] }>("inventory/sku-rules"),
      request<ReceiptRecord[]>("inventory/receipts?limit=200"),
    ]).then(([ruleData, receiptData]) => {
      if (!alive) return;
      const loadedRules = ruleData.rules || [];
      setSkuRules(loadedRules);
      setSupplierOptions([...new Set(receiptData.map((receipt) => receipt.supplierName || "").filter(Boolean))]);
    }).catch((cause) => onNotify(cause instanceof Error ? cause.message : "Không tải được thông tin phiếu nhập."));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!receivedAt) { setReceiptNo(""); return () => { alive = false; }; }
    void request<{ receiptNo: string }>(`inventory/receipts/next-number?date=${encodeURIComponent(receivedAt)}`)
      .then((result) => { if (alive) setReceiptNo(result.receiptNo); })
      .catch(() => { if (alive) setReceiptNo(`PN${receivedAt.replaceAll("-", "")}-01`); });
    return () => { alive = false; };
  }, [receivedAt]);

  useEffect(() => {
    if (!ruleCategoryId) { setRulePrefix(""); setStoneMaterialIdsDraft([]); setStonePrefixDraft({}); return; }
    const existing = skuRules.find((rule) => rule.categoryId === ruleCategoryId);
    setRulePrefix(existing?.prefix || "");
    setStonePrefixDraft(Object.fromEntries((existing?.materialPrefixes || []).map((entry) => [entry.materialOptionId, entry.prefix])));
    const scope = ruleCategories.find((category) => category.id === ruleCategoryId)?.kind === "Đá quý" ? "Đá quý" : "Trang sức";
    setStoneMaterialIdsDraft(existing
      ? Array.isArray(existing.materialOptionIds)
        ? existing.materialOptionIds.filter((id) => materialOptions.some((material) => material.id === id && material.active && material.scope === scope))
        : materialOptions.filter((material) => material.active && material.kind === "STONE" && material.scope === scope).map((material) => material.id)
      : []);
  }, [ruleCategoryId, skuRules]);

  useEffect(() => {
    if (newCategoryLevel === 1 || newCategoryParents.some((category) => category.id === newCategoryParentId)) return;
    const firstParent = newCategoryParents[0];
    if (firstParent) setNewCategoryParentId(firstParent.id);
  }, [categoryOptions, newProductKind, newCategoryLevel, newCategoryParentId]);

  useEffect(() => {
    let alive = true;
    setNewSkuPreview(""); setNewSkuError(""); setNewSkuLookup(null);
    if (!newProductCategoryId || (!newProductVariantMode && !newSkuSequence)) return () => { alive = false; };
    const query = new URLSearchParams({ categoryId: newProductCategoryId });
    if (newProductMaterialId) query.set("materialOptionId", newProductMaterialId);
    if (!newProductVariantMode && newSkuSequence) query.set("sequence", newSkuSequence);
    void request<InventorySkuLookup & { prefix?: string }>(`inventory/sku-next?${query.toString()}`)
      .then((result) => { if (alive) { setNewSkuPreview(result.sku || (newProductVariantMode ? result.prefix || "" : "")); setNewSkuLookup(result); } })
      .catch((cause) => { if (alive) { setNewSkuPreview(""); setNewSkuError(cause instanceof Error ? cause.message : "Chưa có quy tắc mã hàng."); } });
    return () => { alive = false; };
  }, [newProductCategoryId, newProductMaterialId, newSkuSequence, newProductVariantMode, skuRules]);

  const updateLine = (key: string, update: Partial<ReceiptLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...update } : line));
  const addEmptyLine = () => setLines((current) => [...current, { key: crypto.randomUUID(), quantity: 1, unitCost: 0 }]);
  const createInventoryCategory = async () => {
    const name = newCategoryName.trim();
    const prefix = newCategoryPrefix.trim().toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
    let parentCategory = selectedNewCategoryParent;
    if (!name) { onNotify("Nhập tên danh mục trước khi lưu."); return; }
    if (newCategoryLevel > 1 && !parentCategory && newCategoryLevel !== 2) { onNotify(`Hãy tạo danh mục cấp ${newCategoryLevel - 1} trước.`); return; }
    if (newCategoryLevel > 1 && !prefix) { onNotify("Nhập tiền tố mã hàng cho danh mục cấp dưới."); return; }
    setCreatingOption(true);
    try {
      const apiKind = newProductKind === "Đá quý" ? "GEMSTONE" : "JEWELRY";
      const toAdminCategory = (record: Record<string, any>): AdminCategory => ({
        id: String(record.id), name: String(record.name), slug: String(record.slug || ""), products: 0,
        status: record.status === "INACTIVE" ? "Đã ẩn" : "Hoạt động", kind: record.kind === "GEMSTONE" ? "Đá quý" : "Trang sức",
        usage: record.usage === "GEMSTONE_TYPE" ? "stone" : "product", level: Number(record.level || 2) as 1 | 2 | 3,
        parentId: record.parentId || undefined, pricingMode: record.pricingMode || "FIXED", sortOrder: String(record.sortOrder ?? 0),
      });
      if (newCategoryLevel === 2 && !parentCategory) {
        const inactiveParent = categoryOptions.find((category) => category.kind === newProductKind && category.level === 1 && category.usage !== "stone");
        if (inactiveParent) throw new Error(`Nhóm cấp 1 “${inactiveParent.name}” đang bị ẩn. Hãy bật nhóm này trong Danh mục rồi lưu lại.`);
        const rootName = newProductKind;
        const rootRecord = await request<Record<string, any>>("categories", { method: "POST", body: JSON.stringify({
          name: rootName, slug: categorySlug(rootName), kind: apiKind, usage: "PRODUCT_CATEGORY", level: 1,
          parentId: null, pricingMode: "FIXED", status: "ACTIVE",
          sortOrder: categoryOptions.filter((category) => category.kind === newProductKind && category.level === 1).reduce((max, category) => Math.max(max, Number(category.sortOrder) || 0), 0) + 1,
        }) });
        parentCategory = toAdminCategory(rootRecord);
        setCategoryOptions((current) => current.some((item) => item.id === parentCategory!.id) ? current : [...current, parentCategory!]);
        onCategoryCreated(parentCategory);
      }
      const nextSortOrder = categoryOptions.filter((category) => category.kind === newProductKind && category.level === newCategoryLevel && (category.parentId || "") === (parentCategory?.id || "")).reduce((max, category) => Math.max(max, Number(category.sortOrder) || 0), 0) + 1;
      const record = await request<Record<string, any>>("categories", { method: "POST", body: JSON.stringify({
        name,
        slug: newCategorySlug.trim() || categorySlug(name),
        kind: apiKind,
        usage: "PRODUCT_CATEGORY",
        level: newCategoryLevel,
        parentId: parentCategory?.id || null,
        pricingMode: newCategoryLevel === 1 ? "FIXED" : newCategoryPricingMode || (newProductKind === "Đá quý" ? "QUALITY" : "FIXED"),
        status: "ACTIVE",
        sortOrder: nextSortOrder,
      }) });
      const category = toAdminCategory(record);
      setCategoryOptions((current) => current.some((item) => item.id === category.id) ? current : [...current, category]);
      onCategoryCreated(category);
      setNewCategoryName(""); setNewCategorySlug(""); setNewCategorySlugEdited(false); setNewCategoryPrefix("");
      if (newCategoryLevel === 1) {
        setNewCategoryLevel(2);
        setNewCategoryParentId(category.id);
        setNewCategoryPricingMode(newProductKind === "Đá quý" ? "QUALITY" : "FIXED");
        onNotify(`Đã tạo nhóm cấp 1 “${category.name}”. Chọn cấp 2 để thêm danh mục con vào menu.`);
        return;
      }

      setNewProductCategoryId(category.id);
      setNewProductMaterialId("");
      setNewProductVariantChoice(variantModeForCategory(category, [...categoryOptions, category]) || "SINGLE");
      setNewProductVariants([]);
      setNewVariantSkuSuffix("");
      setCreatingCategory(false);
      setRuleCategoryId(category.id);
      setRulePrefix(prefix);
      const rule: SkuRule = { categoryId: category.id, prefix, materialOptionIds: [], materialPrefixes: [] };
      try {
        const rules = await request<{ rules: SkuRule[] }>("inventory/sku-rules", { method: "PATCH", body: JSON.stringify({ rules: [...skuRules.filter((item) => item.categoryId !== category.id), rule] }) });
        setSkuRules(rules.rules || []);
        onNotify(`Đã tạo danh mục ${category.name}, lưu quy tắc mã hàng và đồng bộ lên menu.`);
      } catch (cause) {
        setRuleModal(true);
        onNotify(`Danh mục “${category.name}” đã được tạo. Chưa lưu được quy tắc SKU: ${cause instanceof Error ? cause.message : "hãy thử lưu quy tắc lại."}`);
      }
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không tạo được danh mục mới."); }
    finally { setCreatingOption(false); }
  };
  const createInventoryMaterial = async () => {
    const name = newMaterialName.trim();
    const prefix = newMaterialPrefix.trim().toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
    if (!name) { onNotify("Nhập tên loại đá trước khi lưu."); return; }
    if (!newProductCategoryId) { onNotify("Chọn danh mục cấp dưới trước khi tạo loại đá."); return; }
    setCreatingOption(true);
    try {
      const ruleData = await request<{ rules: SkuRule[] }>("inventory/sku-rules");
      const currentRules = (ruleData.rules || []).filter((rule) => ruleCategories.some((category) => category.id === rule.categoryId));
      setSkuRules(currentRules);
      const categoryRule = currentRules.find((rule) => rule.categoryId === newProductCategoryId);
      if (!categoryRule) {
        setRuleCategoryId(newProductCategoryId);
        setRuleModal(true);
        onNotify("Danh mục này chưa có quy tắc mã hàng. Hãy lưu quy tắc danh mục trước khi thêm loại đá.");
        return;
      }
      const scope = newProductKind === "Đá quý" ? "Đá quý" : "Trang sức";
      const previouslyAllowed = Array.isArray(categoryRule.materialOptionIds)
        ? categoryRule.materialOptionIds
        : materialOptions.filter((material) => material.active && material.kind === "STONE" && material.scope === scope).map((material) => material.id);
      const record = await request<Record<string, any>>("materials", { method: "POST", body: JSON.stringify({ name, scope: newProductKind === "Đá quý" ? "GEMSTONE" : "JEWELRY", kind: "STONE", active: true, appliedCategoryIds: [newProductCategoryId] }) });
      const material: MaterialOption = { id: String(record.id), name: String(record.name), scope: record.scope === "GEMSTONE" ? "Đá quý" : "Trang sức", kind: "STONE", active: record.active !== false, ...(record.imageUrl ? { imageUrl: record.imageUrl } : {}), appliedCategoryIds: Array.isArray(record.appliedCategoryIds) ? record.appliedCategoryIds : [newProductCategoryId], sortOrder: Number(record.sortOrder || 0) };
      const nextRule: SkuRule = {
        ...categoryRule,
        materialOptionIds: [...new Set([...previouslyAllowed, material.id])],
        materialPrefixes: prefix
          ? [...categoryRule.materialPrefixes.filter((entry) => entry.materialOptionId !== material.id), { materialOptionId: material.id, prefix }]
          : categoryRule.materialPrefixes,
      };
      try {
        const updated = await request<{ rules: SkuRule[] }>("inventory/sku-rules", { method: "PATCH", body: JSON.stringify({ rules: currentRules.map((rule) => rule.categoryId === categoryRule.categoryId ? nextRule : rule) }) });
        setSkuRules(updated.rules || []);
      } catch (cause) {
        await request(`materials/${encodeURIComponent(material.id)}`, { method: "DELETE" }).catch(() => undefined);
        throw cause;
      }
      setMaterialOptions((current) => current.some((item) => item.id === material.id) ? current : [...current, material]);
      setNewProductMaterialId(material.id);
      setNewMaterialName(""); setNewMaterialPrefix(""); setCreatingMaterial(false);
      onNotify(prefix
        ? `Đã thêm loại đá ${material.name} riêng cho ${newProductCategory?.name || "danh mục"} và lưu tiền tố ${prefix}.`
        : `Đã thêm loại đá ${material.name} riêng cho ${newProductCategory?.name || "danh mục"}.`);
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không tạo được loại đá mới."); }
    finally { setCreatingOption(false); }
  };
  const createRuleMaterial = async () => {
    const name = ruleMaterialName.trim();
    if (!ruleCategory || !name) return;
    const scope = ruleCategory.kind === "Đá quý" ? "Đá quý" : "Trang sức";
    const duplicate = materialOptions.find((material) => material.active && material.kind === "STONE" && material.scope === scope && material.name.localeCompare(name, "vi", { sensitivity: "accent" }) === 0);
    if (duplicate) {
      setRuleNotice({ kind: "error", text: `Loại đá “${duplicate.name}” đã có trong danh sách.` });
      return;
    }
    setSavingRuleMaterial(true);
    setRuleNotice(null);
    try {
      const record = await request<Record<string, any>>("materials", { method: "POST", body: JSON.stringify({ name, scope: scope === "Đá quý" ? "GEMSTONE" : "JEWELRY", kind: "STONE", active: true }) });
      const material: MaterialOption = { id: String(record.id), name: String(record.name), scope: record.scope === "GEMSTONE" ? "Đá quý" : "Trang sức", kind: "STONE", active: record.active !== false, ...(record.imageUrl ? { imageUrl: record.imageUrl } : {}), sortOrder: Number(record.sortOrder || 0) };
      setMaterialOptions((current) => current.some((item) => item.id === material.id) ? current : [...current, material]);
      setStoneMaterialIdsDraft((current) => current.includes(material.id) ? current : [...current, material.id]);
      setStonePrefixDraft((current) => ({ ...current, [material.id]: "" }));
      setRuleMaterialName("");
      setAddingRuleMaterial(false);
      setRuleNotice({ kind: "success", text: `Đã thêm loại đá “${material.name}” vào database. Có thể để trống tiền tố riêng.` });
    } catch (cause) {
      setRuleNotice({ kind: "error", text: cause instanceof Error ? cause.message : "Không thêm được loại đá." });
    } finally { setSavingRuleMaterial(false); }
  };
  const addNewProductLine = () => {
    const quantity = Number(newProductQuantity);
    const unitCost = Number(newProductUnitCost);
    if (!newProductCategoryId || !newProductMaterialId || !newSkuPreview) return;
    if (!newProductVariantMode && (!/^\d+$/.test(newSkuSequence) || Number(newSkuSequence) <= 0)) return;
    if (lines.some((line) => line.newProduct?.sku === newSkuPreview)) { onNotify(`Mã ${newSkuPreview} đã có trong phiếu nhập. Hãy chọn số khác.`); return; }
    if (newProductVariantMode && (!newProductVariants.length || newProductVariants.some((variant) => !Number.isInteger(variant.quantity) || variant.quantity < 1 || !Number.isInteger(variant.unitCost) || variant.unitCost < 0))) return;
    if (!newProductVariantMode && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !Number.isInteger(unitCost) || unitCost < 0)) return;
    const variants = newProductVariantMode ? newProductVariants.map((variant) => {
      const quality = newProductVariantMode === "SIZE" ? "Kích thước" : variant.quality;
      return { ...variant, quality, sku: newSkuPreview + variant.skuSuffix };
    }) : undefined;
    const itemQuantity = variants?.reduce((sum, variant) => sum + variant.quantity, 0) ?? quantity;
    const weightedUnitCost = variants?.length ? Math.round(variants.reduce((sum, variant) => sum + variant.quantity * variant.unitCost, 0) / itemQuantity) : unitCost;
    const generatedName = newSkuLookup?.existingProduct?.name || [newProductCategory?.name, newProductMaterials.find((material) => material.id === newProductMaterialId)?.name].filter(Boolean).join(" ") || `Mặt hàng ${newSkuPreview}`;
    const newProduct = { name: generatedName, categoryId: newProductCategoryId, ...(newProductMaterialId ? { materialOptionId: newProductMaterialId } : {}), ...(!variants ? { skuSequence: newSkuSequence } : {}), sku: newSkuPreview, ...(variants ? { variants } : {}) };
    setLines((current) => [...current, { key: crypto.randomUUID(), quantity: itemQuantity, unitCost: weightedUnitCost, newProduct }]);
    setNewProductModal(false);
    setNewProductQuantity("1"); setNewProductUnitCost("0"); setNewProductVariants([]); setNewSkuSequence(""); setNewSkuLookup(null);
    onNotify(newSkuLookup?.existingProduct
      ? `Đã thêm dòng nhập cho SKU ${newSkuPreview}; tồn kho của sản phẩm sẽ được cộng dồn khi lưu phiếu.`
      : `Đã thêm dòng nhập cho SKU ${newSkuPreview}. Sản phẩm mới sẽ được tạo nháp nếu mã chưa có.`);
  };

  const addNewProductVariant = () => {
    const quality = newProductVariantMode === "SIZE" ? "Kích thước" : newVariantQuality.trim();
    const beadSize = newProductVariantMode === "QUALITY" ? "" : newVariantSize.trim();
    const skuSuffix = newVariantSkuSuffix.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "");
    const quantity = Number(newVariantQuantity);
    const unitCost = Number(newVariantUnitCost);
    if (!quality || (newProductVariantMode !== "QUALITY" && !beadSize) || !skuSuffix || (newSkuPreview + skuSuffix).length > 64 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !Number.isInteger(unitCost) || unitCost < 0) {
      onNotify("Nhập đủ phân loại, SKU con, số lượng và đơn giá nhập hợp lệ cho biến thể.");
      return;
    }
    if (newProductVariants.some((variant) => variant.quality === quality && variant.beadSize === beadSize || variant.skuSuffix.toLocaleUpperCase("en") === skuSuffix)) {
      onNotify("SKU con hoặc tổ hợp biến thể này đã có trong danh sách nhập.");
      return;
    }
    setNewProductVariants((current) => [...current, { quality, beadSize, quantity, unitCost, skuSuffix }]);
    setNewVariantSkuSuffix("");
  };

  const uploadDocuments = async (files: FileList | null) => {
    if (!files?.length) return;
    setDocumentBusy(true);
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 10 - documents.length))) {
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} vượt quá giới hạn 8 MB.`);
        if (file.type !== "application/pdf" && !file.type.startsWith("image/")) throw new Error("Chỉ nhận ảnh JPG, PNG, WebP hoặc tệp PDF.");
        const dataUrl = file.type.startsWith("image/") ? await compressProductImage(file) : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không đọc được tệp chứng từ."));
          reader.onerror = () => reject(new Error("Không đọc được tệp chứng từ."));
          reader.readAsDataURL(file);
        });
        const response = await fetch(`${apiBaseUrl}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: file.type.startsWith("image/") ? "image/webp" : "application/pdf", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), alt: `Chứng từ nhập hàng ${file.name}` }) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || `Không tải được ${file.name}.`); }
        const asset = await response.json() as { url?: string; id?: string };
        setDocuments((current) => [...current, { name: file.name, url: String(asset.url || `/media/${asset.id}`), mimeType: file.type.startsWith("image/") ? "image/webp" : "application/pdf" }]);
      }
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không tải được chứng từ vào database."); }
    finally { setDocumentBusy(false); }
  };

  const saveSkuRule = async () => {
    if (!ruleCategories.some((category) => category.id === ruleCategoryId)) { setRuleNotice({ kind: "error", text: "Chỉ tạo quy tắc cho danh mục sản phẩm đang hoạt động đã được tạo." }); return; }
    if (!rulePrefix.trim()) { setRuleNotice({ kind: "error", text: "Nhập tiền tố mã hàng." }); return; }
    setRuleSaving(true);
    setRuleNotice(null);
    const eligibleCategoryIds = new Set(ruleCategories.map((category) => category.id));
    const current = skuRules.filter((rule) => rule.categoryId !== ruleCategoryId && eligibleCategoryIds.has(rule.categoryId));
    const rule: SkuRule = { categoryId: ruleCategoryId, prefix: rulePrefix.trim(), materialOptionIds: [...new Set(stoneMaterialIdsDraft)], materialPrefixes: Object.entries(stonePrefixDraft).filter(([materialOptionId, prefix]) => stoneMaterialIdsDraft.includes(materialOptionId) && prefix.trim()).map(([materialOptionId, prefix]) => ({ materialOptionId, prefix: prefix.trim() })) };
    try {
      const response = await request<{ rules: SkuRule[] }>("inventory/sku-rules", { method: "PATCH", body: JSON.stringify({ rules: [...current, rule] }) });
      setSkuRules(response.rules || []);
      setRuleNotice({ kind: "success", text: `Đã lưu quy tắc mã hàng cho ${ruleCategory?.name || "danh mục"} vào database.` });
    } catch (cause) { setRuleNotice({ kind: "error", text: cause instanceof Error ? cause.message : "Không lưu được quy tắc mã hàng." }); }
    finally { setRuleSaving(false); }
  };

  const removeSkuRule = async () => {
    setRuleSaving(true);
    setRuleNotice(null);
    try {
      const eligibleCategoryIds = new Set(ruleCategories.map((category) => category.id));
      const response = await request<{ rules: SkuRule[] }>("inventory/sku-rules", { method: "PATCH", body: JSON.stringify({ rules: skuRules.filter((rule) => rule.categoryId !== ruleCategoryId && eligibleCategoryIds.has(rule.categoryId)) }) });
      setSkuRules(response.rules || []);
      setRuleNotice({ kind: "success", text: "Đã xóa quy tắc mã hàng khỏi database." });
    } catch (cause) { setRuleNotice({ kind: "error", text: cause instanceof Error ? cause.message : "Không xóa được quy tắc mã hàng." }); }
    finally { setRuleSaving(false); }
  };

  const saveReceipt = async () => {
    if (saving || documentBusy) return;
    if (!supplierName.trim()) { onNotify("Chọn hoặc nhập nhà cung cấp trước khi lưu phiếu."); return; }
    if (!lines.length || completeLines.length !== lines.length) { onNotify("Mỗi dòng cần chọn sản phẩm và có số lượng hợp lệ."); return; }
    if (lines.some((line) => { const product = products.find((item) => item.id === line.productId); return Boolean(product?.variants.length && !line.variantId); })) { onNotify("Chọn đúng biến thể tồn kho cho từng dòng sản phẩm có phân loại."); return; }
    setSaving(true);
    try {
      const saved = await request<{ receiptNo: string; pos365SyncStatus?: string | null; pos365SyncError?: string | null }>("inventory/receipts", { method: "POST", body: JSON.stringify({ receivedAt, supplierName, receiver, warehouseName, paymentMethod, discountPercent: discountRate, vatPercent: vatRate, note, additionalNote, documentUrls: documents.map((document) => document.url), items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: Number(line.quantity), unitCost: Number(line.unitCost), newProduct: line.newProduct })) }) });
      const posMessage = saved.pos365SyncStatus === "SYNCED" ? " POS365 đã nhận phiếu." : saved.pos365SyncStatus ? " Phiếu đang chờ POS365; hệ thống sẽ tự thử lại." : " POS365 chưa bật đồng bộ.";
      onNotify(`Đã lưu phiếu nhập ${saved.receiptNo} vào GEME.${posMessage}${saved.pos365SyncError ? ` ${saved.pos365SyncError}` : ""}`);
      await onComplete();
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không thể lưu phiếu nhập."); }
    finally { setSaving(false); }
  };

  const categoryLabel = (category: AdminCategory) => categoryPath(category, categoryOptions);
  const categoryForProduct = (product: InventoryProduct) => product.category?.name || "Chưa phân loại";
  const materialForProduct = (product: InventoryProduct) => stoneNameOf(product) || "—";
  const amountForLine = (line: ReceiptLine) => line.newProduct?.variants?.length
    ? line.newProduct.variants.reduce((sum, variant) => sum + variant.quantity * variant.unitCost, 0)
    : (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);

  return <div className="receipt-page">
    <header className="receipt-page-heading"><div><h1>Nhập hàng</h1><p>Tạo phiếu nhập hàng mới để cập nhật sản phẩm vào kho.</p></div><div><button className="button button-quiet" onClick={onCancel}>Hủy</button><button className="button button-primary" onClick={() => void saveReceipt()} disabled={saving || documentBusy || !lines.length}>{saving ? "Đang lưu…" : "Lưu phiếu nhập"}</button></div></header>
    <div className="receipt-layout">
      <main className="receipt-main">
        <section className="receipt-card"><h2>Thông tin phiếu nhập</h2><div className="receipt-fields receipt-fields-three">
          <label>Mã phiếu nhập <b>*</b><input readOnly value={receiptNo || "Đang tạo mã…"}/></label><label>Ngày nhập <b>*</b><input type="date" required value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)}/></label>
          <label className="receipt-supplier-field">Nhà cung cấp <b>*</b>{supplierIsNew ? <input autoFocus value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Nhập tên nhà cung cấp"/> : <select value={supplierName} onChange={(event) => { if (event.target.value === "__new") { setSupplierIsNew(true); setSupplierName(""); } else setSupplierName(event.target.value); }}><option value="">Chọn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}<option value="__new">＋ Thêm nhà cung cấp mới</option></select>}</label>
          <label>Người nhập<input value={receiver} onChange={(event) => setReceiver(event.target.value)} placeholder="Tên người nhập"/></label><label>Kho nhập <b>*</b><select value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)}><option>Kho chính</option></select></label><label>Hình thức thanh toán<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>Chuyển khoản</option><option>Tiền mặt</option><option>Công nợ</option></select></label>
        </div><label className="receipt-note-field">Ghi chú<textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú cho phiếu nhập..."/><small>{note.length}/500</small></label></section>

        <section className="receipt-card receipt-items-card"><div className="receipt-card-heading"><div><h2>Danh sách sản phẩm nhập</h2><p>Tạo mặt hàng mới hoặc chọn sản phẩm đã có trong kho.</p></div><div className="receipt-card-actions"><button className="button button-quiet" onClick={() => setRuleModal(true)}>⚙ Quy tắc mã hàng</button><button className="button button-quiet" onClick={addEmptyLine}>＋ Chọn hàng có sẵn</button><button className="button button-primary" onClick={() => { setNewSkuSequence(""); setNewSkuPreview(""); setNewSkuError(""); setNewSkuLookup(null); setNewProductModal(true); }}>＋ Thêm sản phẩm mới</button><label className="button button-quiet receipt-file-import">⇧ Thêm từ CSV<input type="file" accept=".csv,.txt,text/csv" onChange={async (event) => {
            const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
            const linesFromFile = (await file.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const delimiter = linesFromFile[0]?.includes(";") ? ";" : ","; const dataRows = linesFromFile.slice(1); let added = 0;
            const imported: ReceiptLine[] = [];
            for (const record of dataRows) { const [sku, qty, cost] = record.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, "")); const product = products.find((item) => item.sku.toLocaleLowerCase("vi") === sku.toLocaleLowerCase("vi") || item.variants.some((variant) => variant.sku?.toLocaleLowerCase("vi") === sku.toLocaleLowerCase("vi"))); if (!product) continue; const variant = product.variants.find((item) => item.sku?.toLocaleLowerCase("vi") === sku.toLocaleLowerCase("vi")); imported.push({ key: crypto.randomUUID(), productId: product.id, variantId: variant?.id, quantity: Math.max(1, Number(qty) || 1), unitCost: Math.max(0, Number(cost.replace(/\D/g, "")) || 0) }); added++; }
            setLines((current) => [...current, ...imported]); onNotify(added ? `Đã thêm ${added} dòng từ file CSV.` : "Không tìm thấy SKU phù hợp trong file CSV.");
          }}/></label></div></div>
          <div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>#</th><th>Sản phẩm</th><th>Mã SKU</th><th>Phân loại</th><th>Số lượng *</th><th>Đơn giá nhập *</th><th>Thành tiền</th><th></th></tr></thead><tbody>{lines.length ? lines.map((line, index) => {
            const product = products.find((item) => item.id === line.productId);
            const variant = product?.variants.find((item) => item.id === line.variantId);
            const productName = line.newProduct?.name || product?.name || "";
            const productSku = variant?.sku || product?.sku || line.newProduct?.sku || "—";
            const classification = line.newProduct ? `${categoryOptions.find((item) => item.id === line.newProduct?.categoryId)?.name || "—"} · ${line.newProduct.materialOptionId ? materialOptions.find((material) => material.id === line.newProduct?.materialOptionId)?.name || "Loại đá" : "—"}` : product ? `${categoryForProduct(product)} · ${materialForProduct(product)}` : "—";
            const newVariants = line.newProduct?.variants || [];
            return <tr key={line.key}><td>{index + 1}</td><td>{line.newProduct ? <span className="receipt-new-item"><strong>{productName}</strong><small>Mã do người nhập chọn</small>{newVariants.length > 0 && <details className="receipt-variant-summary"><summary>{newVariants.length} biến thể · xem số lượng và SKU</summary>{newVariants.map((item) => <span key={`${item.quality}:${item.beadSize}`}><b>{[item.quality !== "Kích thước" ? item.quality : "", item.beadSize].filter(Boolean).join(" · ")}</b><small>{money(item.quantity)} cái · SKU {item.sku || "Mã sẽ được tạo khi lưu"} · Đơn giá nhập {money(item.unitCost)} ₫/cái</small></span>)}</details>}</span> : <select aria-label={`Sản phẩm dòng ${index + 1}`} value={line.productId || ""} onChange={(event) => { const selected = products.find((item) => item.id === event.target.value); updateLine(line.key, { productId: selected?.id, variantId: selected?.variants[0]?.id }); }}><option value="">Chọn sản phẩm</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</td><td><strong className="receipt-sku">{productSku}</strong></td><td>{classification}{product?.variants.length ? <select aria-label={`Phiên bản dòng ${index + 1}`} value={line.variantId || ""} onChange={(event) => updateLine(line.key, { variantId: event.target.value || undefined })}><option value="">Chọn biến thể</option>{product.variants.map((item) => <option key={item.id} value={item.id}>{[item.quality, item.beadSize].filter(Boolean).join(" · ")} · {item.sku || "Không có mã riêng"}</option>)}</select> : null}{newVariants.length > 0 && <small className="receipt-variant-kind">{line.newProduct?.variants?.length} biến thể</small>}</td><td>{newVariants.length > 0 ? money(line.quantity) : <input type="number" min="1" max="100000" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })}/>}</td><td>{newVariants.length > 0 ? <small>Theo từng biến thể</small> : <input type="text" inputMode="numeric" pattern="[0-9]*" value={line.unitCost} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateLine(line.key, { unitCost: Number(event.target.value.replace(/\D/g, "")) || 0 })}/>}</td><td>{money(amountForLine(line))}</td><td><button className="receipt-remove-line" aria-label={`Xóa dòng ${index + 1}`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>×</button></td></tr>;
          }) : <tr><td className="receipt-empty" colSpan={8}>Chưa có mặt hàng. Hãy thêm sản phẩm hoặc tạo mã hàng mới.</td></tr>}</tbody></table></div>
          <div className="receipt-table-footer"><button className="button button-quiet" onClick={addEmptyLine}>＋ Thêm dòng</button><div><span>Tiền hàng trước điều chỉnh</span><strong>{money(subtotalAmount)} VND</strong></div></div>
        </section>
      </main>

      <aside className="receipt-sidebar">
        <section className="receipt-card receipt-summary"><h2>Tóm tắt phiếu nhập</h2><div><span>▦&nbsp; Tổng mặt hàng</span><strong>{completeLines.length}</strong></div><div><span>▥&nbsp; Tổng số lượng</span><strong>{money(totalQuantity)}</strong></div><div><span>Tiền hàng</span><strong>{money(subtotalAmount)} VND</strong></div><label className="receipt-percent-field">Chiết khấu (%)<input type="number" min="0" max="100" step="0.01" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)}/></label><div className="receipt-calculation-line"><span>Tiền chiết khấu</span><strong>− {money(discountAmount)} VND</strong></div><label className="receipt-percent-field">VAT (%)<input type="number" min="0" max="100" step="0.01" value={vatPercent} onChange={(event) => setVatPercent(event.target.value)}/></label><div className="receipt-calculation-line"><span>Tiền VAT</span><strong>+ {money(vatAmount)} VND</strong></div><div className="receipt-grand-total"><span>Thành tiền</span><strong>{money(totalAmount)} VND</strong></div><small>VAT tính trên tiền hàng sau khi trừ chiết khấu.</small></section>
        <section className="receipt-card"><div className="receipt-card-heading"><h2>Nhà cung cấp</h2>{supplierIsNew && <button className="receipt-text-button" onClick={() => { setSupplierIsNew(false); setSupplierName(""); }}>Chọn đã có</button>}</div>{supplierIsNew ? <label className="receipt-side-field">Tên nhà cung cấp<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Ví dụ: Đá Quý Việt"/></label> : <><select className="receipt-side-select" value={supplierName} onChange={(event) => { if (event.target.value === "__new") { setSupplierIsNew(true); setSupplierName(""); } else setSupplierName(event.target.value); }}><option value="">Chọn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}<option value="__new">＋ Thêm mới</option></select>{supplierName && <div className="receipt-supplier-card"><span>{supplierName.slice(0, 2).toLocaleUpperCase("vi")}</span><strong>{supplierName}</strong><small>Nhà cung cấp được lưu cùng phiếu nhập</small></div>}</>}</section>
        <section className="receipt-card"><h2>Hình ảnh chứng từ</h2><label className="receipt-upload-box"><input type="file" accept="image/*,.pdf,application/pdf" multiple disabled={documentBusy || documents.length >= 10} onChange={(event) => void uploadDocuments(event.target.files)}/><span>{documentBusy ? "Đang tải lên database…" : "⇧"}</span><strong>Kéo thả ảnh vào đây hoặc chọn file</strong><small>Hỗ trợ JPG, PNG, PDF · tối đa 8 MB/tệp</small></label>{documents.length > 0 && <div className="receipt-documents">{documents.map((document, index) => <div key={`${document.url}-${index}`}>{document.mimeType.startsWith("image/") ? <img src={`${apiBaseUrl}${document.url}`} alt={document.name}/> : <span className="receipt-pdf-icon">PDF</span>}<a href={`${apiBaseUrl}${document.url}`} target="_blank" rel="noreferrer">{document.name}</a><button aria-label={`Xóa ${document.name}`} onClick={() => setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}</section>
        <section className="receipt-card"><h2>Ghi chú thêm</h2><textarea className="receipt-extra-note" rows={4} maxLength={500} value={additionalNote} onChange={(event) => setAdditionalNote(event.target.value)} placeholder="Thêm thông tin khác cho phiếu nhập..."/><small className="receipt-note-count">{additionalNote.length}/500</small></section>
      </aside>
    </div>

    {ruleModal && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRuleModal(false); }}><section className="inventory-modal receipt-rule-modal" role="dialog" aria-modal="true" aria-labelledby="skuRuleTitle"><header><div><span className="inventory-eyebrow">THIẾT LẬP KHO</span><h2 id="skuRuleTitle">Quy tắc mã hàng</h2></div><button onClick={() => setRuleModal(false)} aria-label="Đóng">×</button></header><p className="receipt-rule-intro">Tạo tiền tố theo danh mục và loại đá. Ví dụ <b>NSSR</b> + <b>EM</b> sẽ tạo mã dạng <b>NSSREM0001</b>.</p>{savedSkuRules.length > 0 ? <div className="receipt-saved-rules"><div className="receipt-saved-rules-heading"><strong>Quy tắc đã tạo</strong><span>{savedSkuRules.length}</span></div><div className="receipt-saved-rules-list">{savedSkuRules.map((rule) => <button key={rule.categoryId} type="button" className={`receipt-saved-rule${rule.categoryId === ruleCategoryId ? " active" : ""}`} onClick={() => { setRuleCategoryId(rule.categoryId); setRuleNotice(null); }}><span className="receipt-saved-rule-copy"><b>{rule.category ? categoryPath(rule.category, categoryOptions) : "Danh mục không còn hoạt động"}</b><small>{rule.prefix}{rule.materialSummary ? ` + ${rule.materialSummary}` : ""}</small></span><span className="receipt-saved-rule-action">{rule.categoryId === ruleCategoryId ? "Đang chọn" : "Chỉnh sửa →"}</span></button>)}</div></div> : <div className="receipt-saved-rules empty"><strong>Quy tắc đã tạo</strong><p>Chưa có quy tắc nào. Tạo tiền tố bên dưới rồi bấm “Lưu quy tắc”.</p></div>}<label>Danh mục đã tạo<select disabled={!ruleCategories.length} value={ruleCategoryId} onChange={(event) => setRuleCategoryId(event.target.value)}><option value="">{ruleCategories.length ? "Chọn danh mục" : "Chưa có danh mục sản phẩm đang hoạt động"}</option>{ruleCategories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category)}</option>)}</select></label><label>Tiền tố danh mục<input value={rulePrefix} onChange={(event) => setRulePrefix(event.target.value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, ""))} placeholder="Ví dụ: NSSR" maxLength={16}/><small>Chỉ chữ và số, tối đa 16 ký tự.</small></label>{ruleCategory && <div className="receipt-stone-prefixes"><strong>Loại đá áp dụng cho {ruleCategory.name}</strong><small>Chọn riêng loại đá được dùng cho danh mục này. Các danh mục cấp 3 khác có thể có danh sách riêng.</small>{ruleScopeMaterials.length ? ruleScopeMaterials.map((material) => <div className="receipt-stone-choice" key={material.id}><label><input type="checkbox" checked={stoneMaterialIdsDraft.includes(material.id)} onChange={(event) => setStoneMaterialIdsDraft((current) => event.target.checked ? [...new Set([...current, material.id])] : current.filter((id) => id !== material.id))}/><span>{material.name}</span></label>{stoneMaterialIdsDraft.includes(material.id) && <label className="receipt-stone-prefix-input"><span>Tiền tố SKU (không bắt buộc)</span><input value={stonePrefixDraft[material.id] || ""} maxLength={16} placeholder="Ví dụ: EM" onChange={(event) => setStonePrefixDraft((current) => ({ ...current, [material.id]: event.target.value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "") }))}/></label>}</div>) : <small>Chưa có loại đá hoạt động trong nhóm này. Bạn có thể thêm một loại bên dưới.</small>}{addingRuleMaterial ? <div className="receipt-rule-material-form"><input autoFocus value={ruleMaterialName} onChange={(event) => setRuleMaterialName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createRuleMaterial(); } }} placeholder="Tên loại đá mới" maxLength={120}/><div><button type="button" className="button button-quiet" onClick={() => { setAddingRuleMaterial(false); setRuleMaterialName(""); }}>Hủy</button><button type="button" className="button button-primary" onClick={() => void createRuleMaterial()} disabled={savingRuleMaterial || !ruleMaterialName.trim()}>{savingRuleMaterial ? "Đang lưu…" : "Lưu loại đá"}</button></div></div> : <button type="button" className="receipt-add-rule-material" onClick={() => { setRuleNotice(null); setAddingRuleMaterial(true); }}>＋ Thêm loại đá</button>}</div>}<div className="receipt-rule-preview">Mã sẽ có dạng <b>{rulePrefix || "MÃ DANH MỤC"}{ruleCategory && ruleMaterials.find((material) => stonePrefixDraft[material.id]) ? stonePrefixDraft[ruleMaterials.find((material) => stonePrefixDraft[material.id])!.id] : ""}0001</b></div>{ruleNotice && <div className={`receipt-rule-notice ${ruleNotice.kind}`} role={ruleNotice.kind === "error" ? "alert" : "status"}>{ruleNotice.text}</div>}<footer><button className="button button-quiet" onClick={() => void removeSkuRule()} disabled={ruleSaving || !skuRules.some((rule) => rule.categoryId === ruleCategoryId)}>Xóa quy tắc</button><button type="button" className="button button-quiet" onClick={() => setRuleModal(false)}>Đóng</button><button type="button" className="button button-primary" onClick={() => void saveSkuRule()} disabled={ruleSaving || !ruleCategoryId}>{ruleSaving ? "Đang lưu…" : "Lưu quy tắc"}</button></footer></section></div>}

    {newProductModal && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingOption) setNewProductModal(false); }}><section className="inventory-modal receipt-new-product-modal receipt-new-product-flow" role="dialog" aria-modal="true" aria-labelledby="newInventoryProductTitle"><header><div><span className="inventory-eyebrow">TẠO MẶT HÀNG NHẬP KHO</span><h2 id="newInventoryProductTitle">Thêm sản phẩm mới</h2></div><button type="button" onClick={() => setNewProductModal(false)} aria-label="Đóng">×</button></header>
      <label>Danh mục chính <b>*</b><select value={newProductKind} onChange={(event) => { const kind = event.target.value as "Trang sức" | "Đá quý"; setNewProductKind(kind); setNewProductCategoryId(""); setNewProductMaterialId(""); setNewProductVariants([]); setNewVariantSkuSuffix(""); setNewProductVariantChoice("SINGLE"); setCreatingCategory(false); setCreatingMaterial(false); setNewCategoryLevel(2); setNewCategoryParentId(categoryOptions.find((category) => category.kind === kind && category.level === 1 && category.status === "Hoạt động")?.id || ""); setNewCategoryPricingMode(kind === "Đá quý" ? "QUALITY" : "FIXED"); }}><option>Trang sức</option><option>Đá quý</option></select></label>
      <label>Danh mục sản phẩm <b>*</b><select value={newProductCategoryId} onChange={(event) => { if (event.target.value === "__create") { setCreatingCategory(true); setCreatingMaterial(false); setNewCategoryLevel(2); setNewCategoryParentId(categoryOptions.find((category) => category.kind === newProductKind && category.level === 1 && category.status === "Hoạt động")?.id || ""); setNewCategoryPricingMode(newProductKind === "Đá quý" ? "QUALITY" : "FIXED"); } else { setNewProductCategoryId(event.target.value); setNewProductMaterialId(""); setNewProductVariants([]); setNewVariantSkuSuffix(""); setNewProductVariantChoice(variantModeForCategory(newProductCategories.find((category) => category.id === event.target.value), categoryOptions) || "SINGLE"); setCreatingCategory(false); } }}><option value="">Chọn danh mục {newProductKind.toLocaleLowerCase("vi")}</option>{newProductCategories.map((category) => <option key={category.id} value={category.id}>{categoryPath(category, categoryOptions)}</option>)}<option value="__create">＋ Tạo danh mục mới</option></select></label>
      {creatingCategory && <div className="receipt-inline-option"><strong>Tạo danh mục {newProductKind.toLocaleLowerCase("vi")}</strong>
        <label>Cấp danh mục<select value={newCategoryLevel} onChange={(event) => { const level = Number(event.target.value) as 1 | 2 | 3; setNewCategoryLevel(level); const parent = level > 1 ? categoryOptions.find((category) => category.kind === newProductKind && category.level === level - 1 && category.status === "Hoạt động" && category.usage !== "stone") : undefined; setNewCategoryParentId(parent?.id || ""); if (level === 1) setNewCategoryPrefix(""); }}>{[1, 2, ...(newProductKind === "Trang sức" ? [3] : [])].map((level) => <option key={level} value={level}>Cấp {level} · {level === 1 ? "Nhóm chính" : level === 2 ? "Danh mục" : "Danh mục con"}</option>)}</select></label>
        {newCategoryLevel > 1 && <label>Danh mục cha cấp {newCategoryLevel - 1}<select value={newCategoryParents.some((category) => category.id === newCategoryParentId) ? newCategoryParentId : ""} onChange={(event) => setNewCategoryParentId(event.target.value)}><option value="">Chọn danh mục cha</option>{newCategoryParents.map((category) => <option key={category.id} value={category.id}>{categoryPath(category, categoryOptions)}</option>)}</select>{!newCategoryParents.length && <small>{newCategoryLevel === 2 ? `Chưa có nhóm cấp 1 “${newProductKind}”. Khi lưu, hệ thống sẽ tạo nhóm này cùng danh mục.` : `Chưa có danh mục cấp ${newCategoryLevel - 1}. Hãy tạo cấp đó trước.`}</small>}</label>}
        <label>Tên danh mục<input value={newCategoryName} onChange={(event) => { setNewCategoryName(event.target.value); if (!newCategorySlugEdited) setNewCategorySlug(categorySlug(event.target.value)); }} placeholder="Tên danh mục mới" maxLength={120}/></label>
        <label>Slug<input value={newCategorySlug} onChange={(event) => { setNewCategorySlugEdited(true); setNewCategorySlug(categorySlug(event.target.value)); }} placeholder="ten-danh-muc" maxLength={160}/><small>Slug tự tạo từ tên; có thể chỉnh lại.</small></label>
        {newCategoryLevel > 1 && <label>Cách định giá<select value={newCategoryPricingMode || "FIXED"} onChange={(event) => setNewCategoryPricingMode(event.target.value as AdminCategory["pricingMode"])}><option value="FIXED">Giá cố định</option><option value="QUALITY">Giá theo chất lượng</option><option value="QUALITY_AND_BEAD_SIZE">Giá theo chất lượng và size hạt</option></select></label>}
        {newCategoryLevel > 1 && <label>Mã nhận diện danh mục<input value={newCategoryPrefix} onChange={(event) => setNewCategoryPrefix(event.target.value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, ""))} placeholder="Ví dụ: NSSR" maxLength={16}/></label>}
        <small>{newCategoryLevel === 1 ? "Danh mục cấp 1 sẽ lưu làm nhóm chính. Sau đó có thể thêm cấp 2 và cấp 3 bên dưới để hiện các mục con trên menu." : "Danh mục được lưu vào database, xuất hiện trong trang Danh mục và menu website. Tiền tố sẽ lưu cùng quy tắc SKU."}</small>
        <button type="button" className="button button-primary" onClick={() => void createInventoryCategory()} disabled={creatingOption || !newCategoryName.trim() || (newCategoryLevel > 1 && (!newCategoryPrefix.trim() || (newCategoryLevel > 2 && !selectedNewCategoryParent)))}>{creatingOption ? "Đang lưu…" : newCategoryLevel === 1 ? "Lưu nhóm cấp 1" : newCategoryLevel === 2 && !selectedNewCategoryParent ? `Tạo nhóm ${newProductKind} & lưu danh mục` : "Lưu danh mục"}</button></div>}
      <label>Loại đá <b>*</b><select value={newProductMaterialId} disabled={!newProductCategoryId} onChange={(event) => { if (event.target.value === "__create") { setCreatingMaterial(true); setCreatingCategory(false); } else { setNewProductMaterialId(event.target.value); setCreatingMaterial(false); } }}><option value="">Chọn loại đá</option>{newProductMaterials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}<option value="__create">＋ Tạo loại đá mới</option></select><small>{newProductCategory ? newProductMaterials.length ? `Danh sách loại đá được giới hạn theo danh mục ${newProductCategory.name}.` : `Danh mục ${newProductCategory.name} chưa có loại đá áp dụng. Hãy thêm loại đá trong quy tắc mã hàng.` : "Chọn danh mục trước để tải đúng loại đá."}</small></label>
      {creatingMaterial && <div className="receipt-inline-option"><strong>Tạo loại đá mới</strong><label>Tên loại đá<input value={newMaterialName} onChange={(event) => setNewMaterialName(event.target.value)} placeholder="Tên loại đá" maxLength={120}/></label><label>Mã nhận diện (không bắt buộc)<input value={newMaterialPrefix} onChange={(event) => setNewMaterialPrefix(event.target.value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, ""))} placeholder="Ví dụ: OP" maxLength={16}/></label><small>Nếu nhập mã, mã sẽ được lưu ngay vào quy tắc của danh mục đang chọn. Có thể để trống và thêm sau trong Quy tắc mã hàng.</small><button type="button" className="button button-primary" onClick={() => void createInventoryMaterial()} disabled={creatingOption || !newMaterialName.trim() || !newProductCategoryId}>{creatingOption ? "Đang lưu…" : "Lưu loại đá"}</button></div>}
      {!newProductVariantMode && <label className="receipt-sku-sequence-field">Số thứ tự mã hàng <b>*</b><input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={64} value={newSkuSequence} onChange={(event) => setNewSkuSequence(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Nhập số nguyên dương, ví dụ: 1"/><small>Dùng để xác định SKU. Nếu SKU đã có, phiếu nhập sẽ cộng dồn tồn kho.</small></label>}
      <div className={`receipt-sku-preview${newSkuError ? " error" : ""}`}><span>{newProductVariantMode ? "Mã sản phẩm mẹ" : "Mã sản phẩm xem trước"}</span><strong>{newSkuPreview || newSkuError || (newProductVariantMode ? "Đang tạo mã mẹ…" : newSkuSequence ? "Đang kiểm tra mã…" : "Nhập số thứ tự để xem mã")}</strong><small>{newProductVariantMode ? "Mã mẹ lấy từ quy tắc danh mục và loại đá. SKU con đã có sẽ cộng dồn; SKU con mới sẽ được tạo." : "Mã giữ nguyên số đã nhập: 1 thành hậu tố 1, 001 thành hậu tố 001. Hệ thống không tự đệm hoặc tự tăng."}</small>{newSkuLookup?.existingProduct && <small className="receipt-sku-match" role="status">SKU đã tồn tại: {newSkuLookup.existingProduct.name}{newSkuLookup.existingProduct.variantCount ? ` · ${newSkuLookup.existingProduct.variantCount} biến thể · tổng tồn ${money(newSkuLookup.existingProduct.stock || 0)}` : ` · tồn hiện tại ${money(newSkuLookup.existingProduct.stock || 0)}`}. Phiếu sẽ cộng vào sản phẩm này.{newSkuLookup.existingProduct.variantCount && !newProductVariantMode ? " Hãy chọn quản lý theo biến thể." : !newSkuLookup.existingProduct.variantCount && newProductVariantMode ? " Sản phẩm hiện là một SKU duy nhất; hãy chọn một SKU duy nhất." : ""}</small>}{newSkuLookup?.existingVariant && <small className="receipt-sku-match error" role="status">Mã này đang là SKU con của {newSkuLookup.existingVariant.productName} ({newSkuLookup.existingVariant.productSku}); hãy dùng SKU mẹ để nhập biến thể.</small>}</div><label>Kiểu quản lý tồn<select value={newProductVariantChoice} onChange={(event) => { setNewProductVariantChoice(event.target.value as "SINGLE" | "SIZE" | "QUALITY" | "QUALITY_AND_BEAD_SIZE"); setNewProductVariants([]); setNewVariantSkuSuffix(""); setNewSkuSequence(""); }}><option value="SINGLE">Một SKU duy nhất</option><option value="SIZE">Nhiều size</option><option value="QUALITY">Nhiều chất lượng</option><option value="QUALITY_AND_BEAD_SIZE">Chất lượng và kích thước hạt</option></select><small>{newProductVariantMode ? `Mã mẹ là ${newSkuPreview || "đang tải"}; nhập hậu tố riêng để tạo mã cho từng biến thể.` : `Mã SKU là ${newSkuPreview || "mã sản phẩm"}.`}</small></label>
      {newProductVariantMode ? <section className="receipt-new-variants"><div><strong>{newProductVariantMode === "SIZE" ? "Biến thể theo size" : newProductVariantMode === "QUALITY" ? "Biến thể theo chất lượng" : "Biến thể chất lượng · kích thước hạt"}</strong><small>Nhập SKU con riêng bằng chữ/số và số lượng thực nhập. Giá bán được thiết lập sau ở trang Sản phẩm.</small></div><div className="receipt-new-variant-entry">
        {(newProductVariantMode === "QUALITY" || newProductVariantMode === "QUALITY_AND_BEAD_SIZE") && <label>Chất lượng<input list="receipt-quality-options" value={newVariantQuality} onChange={(event) => setNewVariantQuality(event.target.value)} placeholder="Chọn hoặc nhập chất lượng"/><datalist id="receipt-quality-options"><option value="A"/><option value="AA"/><option value="AAA"/><option value="AAAA"/><option value="A+"/><option value="Sưu tầm"/></datalist></label>}
        {newProductVariantMode !== "QUALITY" && <label>{newProductVariantMode === "SIZE" ? "Size vòng" : "Kích thước hạt"}<input list="receipt-size-options" value={newVariantSize} onChange={(event) => setNewVariantSize(event.target.value)} placeholder={newProductVariantMode === "SIZE" ? "Ví dụ: 16cm" : "Ví dụ: 8mm"}/><datalist id="receipt-size-options">{(newProductVariantMode === "SIZE" ? ["14cm", "15cm", "16cm", "17cm", "18cm", "19cm", "20cm"] : ["4mm", "6mm", "8mm", "10mm", "12mm"]).map((size) => <option value={size} key={size}/>)}</datalist></label>}
        <label>Mã SKU con<input value={newVariantSkuSuffix} onChange={(event) => setNewVariantSkuSuffix(event.target.value.toLocaleUpperCase("en").replace(/[^A-Z0-9]/g, "").slice(0, 48))} placeholder="Ví dụ: 105" maxLength={48}/><small>SKU hoàn chỉnh: {newSkuPreview}{newVariantSkuSuffix || "[mã phân biệt]"}</small></label>
        <label>Số lượng nhập<input type="number" min="1" max="100000" step="1" value={newVariantQuantity} onChange={(event) => setNewVariantQuantity(event.target.value)}/></label><label>Đơn giá nhập (VND)<input type="text" inputMode="numeric" pattern="[0-9]*" value={newVariantUnitCost} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setNewVariantUnitCost(event.target.value.replace(/\D/g, ""))}/></label><button type="button" className="button button-quiet" onClick={addNewProductVariant}>＋ Thêm biến thể</button>
      </div>{newProductVariants.length > 0 ? <div className="receipt-new-variant-list">{newProductVariants.map((variant, index) => <div key={`${variant.quality}:${variant.beadSize}`}><span><b>{[variant.quality !== "Kích thước" ? variant.quality : "", variant.beadSize].filter(Boolean).join(" · ")}</b><small>{money(variant.quantity)} cái · {money(variant.unitCost)} ₫ nhập/cái · SKU {newSkuPreview}{variant.skuSuffix}</small></span><button type="button" aria-label="Xóa biến thể" onClick={() => setNewProductVariants((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></div>)}</div> : <p className="receipt-new-variant-empty">Thêm ít nhất một biến thể để ghi tồn kho theo từng lựa chọn.</p>}<div className="receipt-new-variant-total"><span>Tổng số lượng nhập của sản phẩm</span><strong>{money(newProductVariants.reduce((sum, variant) => sum + variant.quantity, 0))} cái</strong></div></section> : <div className="receipt-new-product-pricing"><label>Số lượng nhập <b>*</b><input type="number" min="1" max="100000" step="1" value={newProductQuantity} onChange={(event) => setNewProductQuantity(event.target.value)}/></label><label>Đơn giá nhập (VND) <b>*</b><input type="text" inputMode="numeric" pattern="[0-9]*" value={newProductUnitCost} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setNewProductUnitCost(event.target.value.replace(/\D/g, ""))}/></label></div>}
      <footer><button type="button" className="button button-quiet" onClick={() => setNewProductModal(false)}>Hủy</button><button type="button" className="button button-primary" onClick={addNewProductLine} disabled={creatingOption || !newProductCategory || !newProductMaterialId || !newSkuPreview || Boolean(newSkuLookup?.existingVariant) || Boolean(newSkuLookup?.existingProduct && (newProductVariantMode ? !newSkuLookup.existingProduct.variantCount : newSkuLookup.existingProduct.variantCount > 0)) || (!newProductVariantMode && (!/^\d+$/.test(newSkuSequence) || Number(newSkuSequence) <= 0)) || (newProductVariantMode ? !newProductVariants.length : !Number.isInteger(Number(newProductQuantity)) || Number(newProductQuantity) < 1 || !Number.isInteger(Number(newProductUnitCost)) || Number(newProductUnitCost) < 0)}>Thêm vào phiếu</button></footer></section></div>}
  </div>;
}
