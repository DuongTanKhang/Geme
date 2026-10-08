"use client";

import { useEffect, useMemo, useState } from "react";
import { apiBaseUrl } from "../lib/api";

type ReceiptSummary = {
  id: string;
  receiptNo: string;
  receivedAt: string;
  supplierName?: string | null;
  receiver?: string | null;
  warehouseName: string;
  totalQuantity: number;
  totalAmount: number | string;
  status: string;
  pos365SyncStatus?: "PENDING" | "SYNCING" | "RETRYING" | "SYNCED" | null;
  pos365SyncCode?: string | null;
  pos365SyncError?: string | null;
  pos365SyncedAt?: string | null;
};

type ReceiptItem = {
  id: string;
  productName: string;
  productSku: string;
  categoryName?: string | null;
  stoneName?: string | null;
  kind: string;
  quantity: number;
  unitCost: number | string;
  lineTotal: number | string;
  variant?: { sku?: string | null; quality?: string | null; beadSize?: string | null } | null;
};

type ReceiptDetail = ReceiptSummary & {
  paymentMethod?: string | null;
  note?: string | null;
  additionalNote?: string | null;
  documentUrls: string[];
  subtotalAmount: number | string;
  discountPercent: number | string;
  discountAmount: number | string;
  vatPercent: number | string;
  vatAmount: number | string;
  items: ReceiptItem[];
};

const amount = (value: number | string | null | undefined) => new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
const dateTime = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const dateOnly = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
const kindName = (value: string) => value === "GEMSTONE" ? "Đá quý" : "Trang sức";
const pos365SyncLabel = (status?: ReceiptSummary["pos365SyncStatus"]) => status === "SYNCED" ? "Đã nhận" : status === "SYNCING" ? "Đang gửi" : status === "RETRYING" ? "Đang thử lại" : status === "PENDING" ? "Đang chờ" : "Chưa đồng bộ";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${path}`, { cache: "no-store" });
  if (!response.ok) {
    let message = `API trả về lỗi ${response.status}.`;
    try { const body = await response.json(); message = Array.isArray(body.message) ? body.message.join(" ") : body.message || message; } catch { /* empty response */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export default function InventoryReceiptsWorkspace() {
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const reload = async () => {
    setLoading(true);
    setError("");
    try { setReceipts(await request<ReceiptSummary[]>("inventory/receipts?limit=500")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được danh sách phiếu nhập."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("vi");
    return receipts.filter((receipt) => {
      const receivedDate = dateOnly(receipt.receivedAt);
      const matchesText = !term || `${receipt.receiptNo} ${receipt.supplierName || ""} ${receipt.receiver || ""} ${receipt.warehouseName || ""}`.toLocaleLowerCase("vi").includes(term);
      return matchesText && (!from || receivedDate >= from) && (!to || receivedDate <= to);
    });
  }, [receipts, search, from, to]);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalQuantity = filtered.reduce((sum, receipt) => sum + (Number(receipt.totalQuantity) || 0), 0);
  const totalAmount = filtered.reduce((sum, receipt) => sum + (Number(receipt.totalAmount) || 0), 0);

  const openReceipt = async (receipt: ReceiptSummary) => {
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try { setDetail(await request<ReceiptDetail>(`inventory/receipts/${encodeURIComponent(receipt.id)}`)); }
    catch (cause) { setDetailError(cause instanceof Error ? cause.message : "Không tải được nội dung phiếu nhập."); }
    finally { setDetailLoading(false); }
  };

  const updateSearch = (value: string) => { setSearch(value); setPage(1); };
  const updateDate = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); };

  return <section className="inventory-history-panel inventory-receipts-panel">
    <div className="inventory-panel-title"><div><h2>Danh sách phiếu nhập</h2><p>Tra cứu lại thông tin nhà cung cấp, người nhận, mặt hàng và tổng tiền từng lần nhập.</p></div><button className="button button-quiet" onClick={() => void reload()} disabled={loading}>{loading ? "Đang tải…" : "↻ Làm mới"}</button></div>

    <div className="inventory-receipt-stats"><article><small>Số phiếu đang lọc</small><strong>{loading ? "—" : amount(filtered.length)}</strong></article><article><small>Tổng số lượng nhập</small><strong>{loading ? "—" : amount(totalQuantity)}</strong></article><article><small>Tổng tiền nhập</small><strong>{loading ? "—" : `${amount(totalAmount)} ₫`}</strong></article></div>

    <div className="inventory-receipt-filters"><label className="inventory-search"><span>⌕</span><input type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Tìm mã phiếu, nhà cung cấp, người nhập, kho…"/></label><label>Từ ngày<input type="date" value={from} onChange={(event) => updateDate(setFrom)(event.target.value)}/></label><label>Đến ngày<input type="date" value={to} onChange={(event) => updateDate(setTo)(event.target.value)}/></label><button className="button button-quiet" type="button" onClick={() => { setFrom(""); setTo(""); updateSearch(""); }}>Xóa lọc</button></div>
    {error && <div className="inventory-error" role="alert">{error}<button onClick={() => void reload()}>Thử tải lại</button></div>}

    <div className="inventory-receipt-table-wrap"><table className="inventory-receipt-table"><thead><tr><th>Mã phiếu nhập</th><th>Ngày nhập</th><th>Nhà cung cấp</th><th>Người nhập</th><th>Kho</th><th>Số lượng</th><th>Tổng tiền</th><th>POS365</th><th></th></tr></thead><tbody>
      {loading ? <tr><td colSpan={9} className="inventory-empty">Đang tải phiếu nhập…</td></tr> : pageRows.length ? pageRows.map((receipt) => <tr key={receipt.id} onClick={() => void openReceipt(receipt)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openReceipt(receipt); } }}>
        <td><button type="button" className="inventory-receipt-number" onClick={() => void openReceipt(receipt)}>{receipt.receiptNo}</button></td><td>{dateTime(receipt.receivedAt)}</td><td>{receipt.supplierName || "—"}</td><td>{receipt.receiver || "—"}</td><td>{receipt.warehouseName || "Kho chính"}</td><td>{amount(receipt.totalQuantity)}</td><td className="inventory-receipt-money">{amount(Number(receipt.totalAmount))} ₫</td><td><span className={`inventory-pos365-status ${receipt.pos365SyncStatus === "SYNCED" ? "is-synced" : receipt.pos365SyncStatus ? "is-pending" : "is-off"}`} title={receipt.pos365SyncError || receipt.pos365SyncCode || undefined}>{pos365SyncLabel(receipt.pos365SyncStatus)}</span></td><td><button type="button" className="inventory-receipt-view" aria-label={`Xem phiếu ${receipt.receiptNo}`} onClick={() => void openReceipt(receipt)}>Xem chi tiết →</button></td>
      </tr>) : <tr><td colSpan={9} className="inventory-empty">{error ? "Không lấy được danh sách phiếu nhập." : "Không tìm thấy phiếu nhập phù hợp."}</td></tr>}
    </tbody></table></div>
    <div className="inventory-pagination"><span>Hiển thị {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} / {amount(filtered.length)} phiếu nhập</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>‹</button><strong>{page}</strong><button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>›</button></div></div>

    {(detailLoading || detailError || detail) && <div className="inventory-receipt-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !detailLoading) { setDetail(null); setDetailError(""); } }}>
      <section className="inventory-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="inventoryReceiptTitle">
        {detailLoading ? <div className="inventory-receipt-loading">Đang tải chi tiết phiếu nhập…</div> : detailError ? <div className="inventory-receipt-loading error" role="alert">{detailError}<button type="button" className="button button-quiet" onClick={() => { setDetailError(""); }}>Đóng</button></div> : detail && <>
          <header className="inventory-receipt-dialog-heading no-print"><div><span>GEME · QUẢN LÝ KHO</span><h2 id="inventoryReceiptTitle">Phiếu nhập {detail.receiptNo}</h2><small className={`inventory-pos365-status ${detail.pos365SyncStatus === "SYNCED" ? "is-synced" : detail.pos365SyncStatus ? "is-pending" : "is-off"}`} title={detail.pos365SyncError || undefined}>POS365: {pos365SyncLabel(detail.pos365SyncStatus)}{detail.pos365SyncCode ? ` · ${detail.pos365SyncCode}` : ""}{detail.pos365SyncError ? ` · ${detail.pos365SyncError}` : ""}</small></div><div><button className="button button-quiet" type="button" onClick={() => window.print()}>▣ In phiếu</button><button className="inventory-receipt-close" type="button" onClick={() => setDetail(null)} aria-label="Đóng">×</button></div></header>
          <div className="inventory-receipt-paper">
            <div className="inventory-receipt-paper-title"><div><strong>GEME</strong><span>PHIẾU NHẬP KHO</span></div><div><b>{detail.receiptNo}</b><small>Ngày nhập: {dateTime(detail.receivedAt)}</small><small>Trạng thái: {detail.status === "COMPLETED" ? "Hoàn thành" : detail.status}</small></div></div>
            <div className="inventory-receipt-parties"><div><small>NHÀ CUNG CẤP</small><strong>{detail.supplierName || "Không ghi nhận"}</strong></div><div><small>NGƯỜI NHẬP</small><strong>{detail.receiver || "Không ghi nhận"}</strong></div><div><small>KHO NHẬP</small><strong>{detail.warehouseName || "Kho chính"}</strong></div><div><small>THANH TOÁN</small><strong>{detail.paymentMethod || "Không ghi nhận"}</strong></div></div>
            <div className="inventory-receipt-paper-table-wrap"><table className="inventory-receipt-paper-table"><thead><tr><th>#</th><th>Sản phẩm / SKU</th><th>Phân loại / biến thể</th><th>Nhóm hàng</th><th>Số lượng</th><th>Đơn giá nhập</th><th>Thành tiền</th></tr></thead><tbody>{detail.items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.productName}</strong><small>{item.productSku}</small></td><td>{[item.variant?.quality, item.variant?.beadSize].filter(Boolean).join(" · ") || item.variant?.sku || "Tiêu chuẩn"}</td><td>{[kindName(item.kind), item.categoryName, item.stoneName].filter(Boolean).join(" · ")}</td><td>{amount(item.quantity)}</td><td>{amount(Number(item.unitCost))} ₫</td><td>{amount(Number(item.lineTotal))} ₫</td></tr>)}</tbody></table></div>
            <div className="inventory-receipt-calculation"><div><span>Tổng số lượng</span><strong>{amount(detail.totalQuantity)} món</strong></div><div><span>Tiền hàng</span><strong>{amount(Number(detail.subtotalAmount))} ₫</strong></div><div><span>Chiết khấu ({amount(Number(detail.discountPercent))}%)</span><strong>− {amount(Number(detail.discountAmount))} ₫</strong></div><div><span>VAT ({amount(Number(detail.vatPercent))}%)</span><strong>+ {amount(Number(detail.vatAmount))} ₫</strong></div><div className="grand"><span>Tổng thanh toán</span><strong>{amount(Number(detail.totalAmount))} ₫</strong></div></div>
            {(detail.note || detail.additionalNote) && <div className="inventory-receipt-notes"><strong>Ghi chú</strong>{detail.note && <p>{detail.note}</p>}{detail.additionalNote && <p>{detail.additionalNote}</p>}</div>}
            {detail.documentUrls?.length > 0 && <div className="inventory-receipt-documents"><strong>Chứng từ đính kèm</strong><div>{detail.documentUrls.map((url, index) => <a key={`${url}-${index}`} href={`${apiBaseUrl}${url}`} target="_blank" rel="noreferrer">{url.toLocaleLowerCase("vi").endsWith(".pdf") ? "PDF" : "Ảnh"} chứng từ {index + 1} · Mở</a>)}</div></div>}
            <footer className="inventory-receipt-signatures"><div>Người lập phiếu<span>{detail.receiver || ""}</span></div><div>Người giao hàng<span>{detail.supplierName || ""}</span></div><div>Người nhận hàng<span>{detail.receiver || ""}</span></div></footer>
          </div>
          <div className="inventory-receipt-dialog-actions no-print"><button className="button button-quiet" type="button" onClick={() => setDetail(null)}>Đóng</button><button className="button button-primary" type="button" onClick={() => window.print()}>▣ In phiếu nhập</button></div>
        </>}
      </section>
    </div>}
  </section>;
}
