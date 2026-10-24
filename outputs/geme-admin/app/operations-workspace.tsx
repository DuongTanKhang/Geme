"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./operations-workspace.module.css";

type Row = Record<string, any>;
type Props = { request: (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<any>; permissions: string[] };
type Tab = "overview" | "returns" | "cod" | "audit";
const tabs: Array<{ id: Tab; label: string; permission: string }> = [
  { id: "overview", label: "Tổng quan", permission: "dashboard.read" },
  { id: "returns", label: "Trả hàng & hoàn tiền", permission: "returns.read" },
  { id: "cod", label: "Đối soát COD", permission: "finance.read" },
  { id: "audit", label: "Nhật ký hoạt động", permission: "audit.read" },
];
const idempotencyKey = () => `ops-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const money = (value: unknown) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const date = (value: unknown) => { const parsed = new Date(String(value || "")); return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("vi-VN"); };
const stateLabel: Record<string, string> = { REQUESTED: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Từ chối", RECEIVED: "Đã nhận hàng", CLOSED: "Đã đóng", NONE: "Chưa hoàn", PARTIALLY_REFUNDED: "Hoàn một phần", REFUNDED: "Đã hoàn", OPEN: "Đang đối soát", RECONCILED: "Khớp", RECONCILED_WITH_VARIANCE: "Có chênh lệch", REVERSED: "Đã đảo", MATCHED: "Khớp", VARIANCE: "Chênh lệch" };

export default function OperationsWorkspace({ request, permissions }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Row | null>(null);
  const [returns, setReturns] = useState<Row[]>([]);
  const [returnOrders, setReturnOrders] = useState<Row[]>([]);
  const [codBatches, setCodBatches] = useState<Row[]>([]);
  const [codOrders, setCodOrders] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [returnOrderId, setReturnOrderId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [codSelected, setCodSelected] = useState<Record<string, boolean>>({});
  const [codReceived, setCodReceived] = useState<Record<string, number>>({});
  const [codFees, setCodFees] = useState<Record<string, number>>({});
  const [codRemitted, setCodRemitted] = useState<Record<string, number>>({});
  const [batchReference, setBatchReference] = useState("");
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [carrier, setCarrier] = useState("VIETTEL_POST");

  const selectedReturnOrder = useMemo(() => returnOrders.find((order) => order.id === returnOrderId), [returnOrders, returnOrderId]);
  const availableTabs = tabs.filter((item) => permissions.includes(item.permission));

  const refresh = useCallback(async (selected = tab) => {
    setLoading(true); setError("");
    try {
      if (selected === "overview") setOverview(await request("operations/dashboard"));
      if (selected === "returns") {
        const [cases, eligible] = await Promise.all([request("returns?limit=100"), request("operations/return-eligible-orders?limit=100")]);
        setReturns(Array.isArray(cases) ? cases : []); setReturnOrders(Array.isArray(eligible) ? eligible : []);
      }
      if (selected === "cod") {
        const [batches, eligible] = await Promise.all([request("cod-reconciliations?limit=100"), request("operations/cod-eligible-orders?limit=100")]);
        setCodBatches(Array.isArray(batches) ? batches : []); setCodOrders(Array.isArray(eligible) ? eligible : []);
      }
      if (selected === "audit") setAudit(await request("audit-logs?limit=100"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu vận hành."); }
    finally { setLoading(false); }
  }, [request, tab]);

  useEffect(() => { if (!availableTabs.some((item) => item.id === tab)) setTab(availableTabs[0]?.id || "overview"); }, [availableTabs, tab]);
  useEffect(() => { void refresh(tab); }, [tab, refresh]);

  const run = async (action: () => Promise<unknown>, success: string, selected = tab) => {
    setBusy(true); setError("");
    try { await action(); await refresh(selected); window.alert(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không hoàn tất được thao tác."); }
    finally { setBusy(false); }
  };

  const createReturn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedReturnOrder) return;
    const items = selectedReturnOrder.items.flatMap((item: Row) => {
      const quantity = Number(returnQuantities[item.id] || 0);
      return quantity > 0 ? [{ orderItemId: item.id, quantity }] : [];
    });
    if (!items.length || !returnReason.trim()) { setError("Chọn ít nhất một dòng hàng và nhập lý do trả."); return; }
    void run(() => request(`orders/${selectedReturnOrder.id}/returns`, "POST", { reason: returnReason, items, idempotencyKey: idempotencyKey() }), "Đã tạo yêu cầu trả hàng.", "returns").then(() => { setReturnReason(""); setReturnQuantities({}); });
  };

  const decideReturn = (item: Row, status: string) => {
    const note = status === "REJECTED" || status === "CLOSED" ? window.prompt(status === "REJECTED" ? "Lý do từ chối" : "Ghi chú đóng phiếu") || "" : window.prompt("Ghi chú xử lý (có thể để trống)") || "";
    if ((status === "REJECTED" || status === "CLOSED") && note.trim().length < 5) return;
    const body: Row = { status, note };
    if (status === "RECEIVED") body.items = item.items.map((line: Row) => ({ id: line.id, restock: Boolean(restock[line.id]), conditionNote: restock[line.id] ? "Đã kiểm tra, nhập lại kho" : "Không nhập lại kho" }));
    void run(() => request(`returns/${item.id}/status`, "PATCH", body), "Đã cập nhật phiếu trả hàng.", "returns");
  };

  const createCodBatch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = codOrders.filter((order) => codSelected[order.id]).map((order) => {
      const receivedAmount = Number(codReceived[order.id] ?? order.carrierCodAmount ?? order.totalAmount);
      const carrierFee = Number(codFees[order.id] || 0);
      return { orderId: order.id, receivedAmount, carrierFee, remittedAmount: Number(codRemitted[order.id] ?? Math.max(0, receivedAmount - carrierFee)) };
    });
    if (!batchReference.trim() || !entries.length) { setError("Nhập mã bảng kê và chọn ít nhất một đơn COD."); return; }
    void run(() => request("cod-reconciliations", "POST", { externalReference: batchReference.trim(), carrier, statementDate: batchDate, entries }), "Đã tạo bảng kê COD để kiểm tra.", "cod").then(() => { setBatchReference(""); setCodSelected({}); });
  };

  const reconcile = (batch: Row) => {
    const note = batch.status === "OPEN" && batch.items?.some((item: Row) => item.status === "VARIANCE") ? window.prompt("Ghi rõ quyết định xử lý chênh lệch") || "" : "Đã kiểm tra bảng kê và xác nhận khớp.";
    if (batch.items?.some((item: Row) => item.status === "VARIANCE") && note.trim().length < 5) return;
    void run(() => request(`cod-reconciliations/${batch.id}/reconcile`, "POST", { note }), "Đã hoàn tất đối soát.", "cod");
  };

  const reverseCod = (batch: Row) => {
    const reason = window.prompt("Lý do đảo bảng kê (tối thiểu 5 ký tự):")?.trim();
    if (!reason || reason.length < 5) { setError("Cần ghi lý do đảo bảng kê tối thiểu 5 ký tự."); return; }
    if (!window.confirm(`Đảo bảng kê ${batch.externalReference}? Bút toán thu COD đã xác nhận sẽ được giữ làm bằng chứng thu tiền; hãy lập bảng kê mới với mã tham chiếu khác để điều chỉnh.`)) return;
    void run(() => request(`cod-reconciliations/${batch.id}/reverse`, "POST", { reason }), "Đã đảo bảng kê và ghi nhật ký. Payment đã thu vẫn được giữ nguyên.", "cod");
  };

  const refund = (item: Row) => {
    const amountText = window.prompt("Số tiền hoàn (₫)");
    if (!amountText) return;
    const amount = Number(amountText.replace(/[^0-9]/g, ""));
    const externalReference = window.prompt("Mã giao dịch hoàn tiền thực tế từ ngân hàng/cổng thanh toán");
    if (!externalReference?.trim()) return;
    const note = window.prompt("Ghi chú giao dịch hoàn tiền") || "";
    if (!amount || note.trim().length < 5) { setError("Số tiền hoặc ghi chú hoàn tiền chưa hợp lệ."); return; }
    void run(() => request(`returns/${item.id}/refunds`, "POST", { amount, externalReference: externalReference.trim(), note, idempotencyKey: idempotencyKey() }), "Đã ghi nhận khoản hoàn có mã tham chiếu. Thao tác này chỉ ghi sổ GEME; tiền cần được chuyển riêng qua ngân hàng/cổng thanh toán.", "returns");
  };

  return <div className={styles.workspace}>
    <header className={styles.header}><div><span className={styles.eyebrow}>GEME · VẬN HÀNH</span><h1>Đơn hàng, tồn kho & thanh toán</h1><p>Theo dõi giữ tồn, xử lý trả hàng và đối soát COD trong một nơi.</p></div><button className="button button-quiet" type="button" onClick={() => void refresh()} disabled={loading}>Làm mới</button></header>
    <nav className={styles.tabs} aria-label="Các khu vực vận hành">{availableTabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? styles.activeTab : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <div className={styles.empty}>Đang tải dữ liệu vận hành…</div> : tab === "overview" ? <>
      <section className={styles.metrics}>
        {[
          ["Đơn chờ xử lý", overview?.pendingOrders ?? "—"],
          ["Khả dụng trong kho", overview?.inventory?.availableUnits ?? "—"],
          ["Đang giữ tồn", overview?.inventory?.reservedUnits ?? "—"],
          ["Tồn thực trong kho", overview?.inventory?.onHandUnits ?? "—"],
          ["Đang vận chuyển", overview?.inventory?.inTransitUnits ?? "—"],
          ["Giữ tồn sắp hết hạn", overview?.inventory?.expiringSoon ?? "—"],
          ["Sản phẩm dưới ngưỡng", overview?.inventory?.lowStockProducts ?? "—"],
          ["Phiếu trả đang mở", overview?.returns?.open ?? "—"],
          ["Bảng kê COD mở", overview?.cod?.openBatches ?? "—"],
          ["Dòng COD lệch", overview?.cod?.varianceLines ?? "—"],
          ["Email chưa rõ kết quả", overview?.orderEmail?.unknown ?? "—"],
        ].map(([label, value]) => <article className={styles.metric} key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}
      </section>
      <p className={styles.footnote}>Thời điểm tổng hợp: {date(overview?.generatedAt)}. Giữ tồn tự giải phóng sau thời hạn cấu hình nếu đơn chưa thanh toán.</p>
    </> : tab === "returns" ? <>
      <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Tạo yêu cầu trả hàng</h2><p>Chọn đơn đã giao hoặc kiện Viettel Post đang hoàn về. Hàng chỉ nhập lại kho sau khi nhận và kiểm tra.</p></div></div>
        <form className={styles.returnForm} onSubmit={createReturn}>
          <label>Đơn đã giao / kiện đang hoàn<select value={returnOrderId} onChange={(event) => { setReturnOrderId(event.target.value); setReturnQuantities({}); }}><option value="">Chọn đơn hàng</option>{returnOrders.map((order) => <option key={order.id} value={order.id}>{order.code} · {order.customerName} · {money(order.totalAmount)}{order.carrierShipmentStatus === "RETURNING" ? " · Hãng đang hoàn" : ""}</option>)}</select></label>
          {selectedReturnOrder && <div className={styles.lineList}>{selectedReturnOrder.items.map((line: Row) => {
            const previouslyReturned = selectedReturnOrder.returns.flatMap((entry: Row) => entry.items).filter((returned: Row) => returned.orderItemId === line.id).reduce((sum: number, returned: Row) => sum + returned.quantity, 0);
            const remaining = Math.max(0, line.quantity - previouslyReturned);
            return <label className={styles.returnLine} key={line.id}><span><strong>{line.productName}</strong><small>{line.productSku} · đã mua {line.quantity}, còn có thể trả {remaining}</small></span><input type="number" min="0" max={remaining} value={returnQuantities[line.id] || 0} disabled={!remaining} onChange={(event) => setReturnQuantities((state) => ({ ...state, [line.id]: Math.min(remaining, Number(event.target.value) || 0) }))}/></label>;
          })}</div>}
          <label>Lý do trả hàng<textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} minLength={5} maxLength={2000} rows={2} placeholder="Mô tả ngắn gọn lý do khách trả sản phẩm"/></label>
          <button className="button button-primary" disabled={busy || !selectedReturnOrder}>Tạo phiếu trả</button>
        </form>
      </section>
      <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Phiếu trả hàng</h2><p>{returns.length} phiếu gần đây</p></div></div>
        {returns.length ? <div className={styles.returnGrid}>{returns.map((item) => <article className={styles.returnCard} key={item.id}>
          <div className={styles.returnTitle}><strong>{item.code} · {item.order?.code}</strong><span>{stateLabel[item.status] || item.status}</span></div><p>{item.reason}</p>
          <div className={styles.lineList}>{item.items?.map((line: Row) => <label className={styles.returnLine} key={line.id}><span><strong>{line.productName}</strong><small>{line.productSku} · số lượng trả {line.quantity}{line.restockedAt ? " · đã nhập kho" : ""}</small></span>{item.status === "APPROVED" && <input type="checkbox" aria-label={`Nhập lại ${line.productName} vào kho`} checked={Boolean(restock[line.id])} onChange={(event) => setRestock((state) => ({ ...state, [line.id]: event.target.checked }))}/>}</label>)}</div>
          <div className={styles.actions}>{item.status === "REQUESTED" && <><button className="button button-primary" disabled={busy} onClick={() => decideReturn(item, "APPROVED")}>Duyệt</button><button className="button button-quiet" disabled={busy} onClick={() => decideReturn(item, "REJECTED")}>Từ chối</button></>}{item.status === "APPROVED" && <button className="button button-primary" disabled={busy} onClick={() => decideReturn(item, "RECEIVED")}>Xác nhận đã nhận hàng</button>}{["RECEIVED", "CLOSED"].includes(item.status) && item.refundStatus !== "REFUNDED" && <button className="button button-quiet" disabled={busy} onClick={() => refund(item)}>Ghi nhận hoàn tiền</button>}{item.status === "RECEIVED" && <button className="button button-quiet" disabled={busy} onClick={() => decideReturn(item, "CLOSED")}>Đóng phiếu</button>}</div>
          {item.refunds?.length > 0 && <small>Đã ghi nhận hoàn: {money(item.refunds.reduce((sum: number, value: Row) => sum + Number(value.amount), 0))}</small>}
        </article>)}</div> : <div className={styles.empty}>Chưa có phiếu trả hàng.</div>}
      </section>
    </> : tab === "cod" ? <>
      <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Lập bảng kê COD</h2><p>Chọn đơn đã giao chưa đối soát. Đơn khớp được ghi nhận đã thu tiền; dòng lệch cần kiểm tra riêng.</p></div></div>
        <form className={styles.codForm} onSubmit={createCodBatch}><label>Mã bảng kê<input required value={batchReference} onChange={(event) => setBatchReference(event.target.value)} placeholder="VDN-2026-10-001"/></label><label>Đơn vị<select value={carrier} onChange={(event) => setCarrier(event.target.value)}><option value="VIETTEL_POST">Viettel Post</option><option value="MANUAL">Khác / nhập tay</option></select></label><label>Ngày bảng kê<input type="date" value={batchDate} onChange={(event) => setBatchDate(event.target.value)} required/></label>
          <div className={styles.codOrders}>{codOrders.map((order) => { const received = Number(codReceived[order.id] ?? order.carrierCodAmount ?? order.totalAmount); const fee = Number(codFees[order.id] || 0); return <div className={styles.codOrder} key={order.id}><label className={styles.checkOrder}><input type="checkbox" checked={Boolean(codSelected[order.id])} onChange={(event) => setCodSelected((state) => ({ ...state, [order.id]: event.target.checked }))}/><span><strong>{order.code}</strong><small>{order.customerName} · COD dự kiến {money(order.carrierCodAmount ?? order.totalAmount)}</small></span></label><label>Khách đã trả<input type="number" min="0" value={received} onChange={(event) => setCodReceived((state) => ({ ...state, [order.id]: Number(event.target.value) || 0 }))}/></label><label>Phí hãng<input type="number" min="0" value={fee} onChange={(event) => setCodFees((state) => ({ ...state, [order.id]: Number(event.target.value) || 0 }))}/></label><label>Thực chuyển về<input type="number" min="0" value={codRemitted[order.id] ?? Math.max(0, received - fee)} onChange={(event) => setCodRemitted((state) => ({ ...state, [order.id]: Number(event.target.value) || 0 }))}/></label></div>; })}{!codOrders.length && <div className={styles.empty}>Không có đơn COD đã giao đang chờ đối soát.</div>}</div><button className="button button-primary" disabled={busy || !codOrders.length}>Tạo bảng kê</button>
        </form>
      </section>
      <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Bảng kê gần đây</h2><p>{codBatches.length} bảng kê</p></div></div>{codBatches.length ? <div className={styles.batchList}>{codBatches.map((batch) => <article className={styles.batch} key={batch.id}><div><strong>{batch.externalReference}</strong><small>{batch.carrier} · {date(batch.statementDate)} · {batch.items?.length || 0} đơn</small><small>COD dự kiến {money(batch.expectedTotal)} · khách trả {money(batch.receivedTotal)} · phí hãng {money(batch.feeTotal)} · thực chuyển {batch.remittedTotal == null ? "Chưa ghi nhận (phiếu cũ)" : money(batch.remittedTotal)}</small></div><span>{stateLabel[batch.status] || batch.status}</span>{batch.status === "OPEN" && <button className="button button-quiet" disabled={busy} onClick={() => reconcile(batch)}>Đối soát & chốt</button>}{batch.status !== "REVERSED" && <button className="button button-quiet" disabled={busy} onClick={() => reverseCod(batch)}>Đảo bảng kê</button>}</article>)}</div> : <div className={styles.empty}>Chưa có bảng kê COD.</div>}</section>
    </> : <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Nhật ký thay đổi</h2><p>Chỉ hiển thị metadata của thao tác quản trị, không lưu nội dung khách hàng hay bí mật cấu hình.</p></div></div>{audit.length ? <div className={styles.auditList}>{audit.map((entry) => <article key={entry.id}><div><strong>{entry.action}</strong><small>{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ""}</small></div><div><span>{entry.admin?.displayName || "Hệ thống"}</span><small>{date(entry.createdAt)}</small></div></article>)}</div> : <div className={styles.empty}>Chưa có nhật ký hoặc tài khoản không có quyền xem.</div>}</section>}
  </div>;
}
