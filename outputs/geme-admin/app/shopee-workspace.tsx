"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./shopee-workspace.css";

type Tab = "overview" | "orders" | "mappings" | "history";
type Row = Record<string, any>;
type Page<T> = { items: T[]; page: number; limit: number; total: number; pages: number };

const statusLabels: Record<string, string> = {
  UNPAID: "Chưa thanh toán", READY_TO_SHIP: "Chờ gửi hàng", PROCESSED: "Đang xử lý",
  SHIPPED: "Đã gửi", COMPLETED: "Hoàn tất", IN_CANCEL: "Đang yêu cầu hủy",
  CANCELLED: "Đã hủy", INVOICE_PENDING: "Chờ hóa đơn", QUEUED: "Đang chờ",
  RUNNING: "Đang đồng bộ", RETRYING: "Đang thử lại", SUCCEEDED: "Hoàn tất", FAILED: "Thất bại",
  REAUTH_REQUIRED: "Cần cấp quyền lại", DISCONNECTED: "Đã ngắt kết nối", ACTIVE: "Đã kết nối",
};
const statusTone = (status: string) => status === "SUCCEEDED" || status === "COMPLETED" || status === "ACTIVE" ? "success" : status === "FAILED" || status === "CANCELLED" || status === "DISCONNECTED" || status === "REAUTH_REQUIRED" ? "danger" : "pending";
const money = (amount: unknown, currency?: string | null) => amount == null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(amount))} ${currency || ""}`.trim();
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const shortenError = (value: unknown) => String(value || "").replaceAll("_", " ").toLocaleLowerCase("vi") || "—";

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/shopee/${path}`, {
    method, cache: "no-store", credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(" ") : payload?.message || `API Shopee trả về lỗi ${response.status}.`);
  return payload as T;
}

export default function ShopeeWorkspace({ initialTab = "overview" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<Row | null>(null);
  const [orders, setOrders] = useState<Page<Row>>({ items: [], page: 1, limit: 50, total: 0, pages: 0 });
  const [runs, setRuns] = useState<Row[]>([]);
  const [unmatched, setUnmatched] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({ status: true, orders: true, runs: true, unmatched: true });
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderEnvironment, setOrderEnvironment] = useState("");
  const [orderShopId, setOrderShopId] = useState("");
  const [orderFrom, setOrderFrom] = useState("");
  const [orderTo, setOrderTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Row | null>(null);
  const [catalogRows, setCatalogRows] = useState<Record<string, Row[]>>({});
  const [catalogSearch, setCatalogSearch] = useState<Record<string, string>>({});
  const [catalogSelection, setCatalogSelection] = useState<Record<string, string>>({});
  const ordersRequestId = useRef(0);
  const orderDetailRequestId = useRef(0);

  const activeConnection = useMemo(() => (status?.connections || []).find((connection: Row) => connection.status === "ACTIVE") as Row | undefined, [status]);
  const canConnect = Boolean(status?.enabled && status?.configurationStatus === "ready");

  const loadSection = useCallback(async <T,>(section: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setSectionLoading(old => ({ ...old, [section]: true }));
    setSectionErrors(old => ({ ...old, [section]: "" }));
    try { return await operation(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không tải được dữ liệu.";
      setSectionErrors(old => ({ ...old, [section]: message }));
      return undefined;
    } finally { setSectionLoading(old => ({ ...old, [section]: false })); }
  }, []);
  const refreshStatus = useCallback(async () => {
    const result = await loadSection<Row>("status", () => api<Row>("status"));
    if (result) setStatus(result);
    return Boolean(result);
  }, [loadSection]);
  const refreshOrders = useCallback(async (nextPage = page) => {
    const requestId = ++ordersRequestId.current;
    setSectionLoading(old => ({ ...old, orders: true }));
    setSectionErrors(old => ({ ...old, orders: "" }));
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "50" });
      if (orderSearch.trim()) params.set("q", orderSearch.trim());
      if (orderStatus) params.set("status", orderStatus);
      if (orderEnvironment) params.set("environment", orderEnvironment);
      if (orderShopId) params.set("shopId", orderShopId);
      if (orderFrom) params.set("from", new Date(`${orderFrom}T00:00:00+07:00`).toISOString());
      if (orderTo) params.set("to", new Date(`${orderTo}T23:59:59.999+07:00`).toISOString());
      const result = await api<Page<Row>>(`orders?${params.toString()}`);
      if (requestId === ordersRequestId.current) setOrders(result);
      return true;
    } catch (cause) {
      if (requestId === ordersRequestId.current) setSectionErrors(old => ({ ...old, orders: cause instanceof Error ? cause.message : "Không tải được danh sách đơn." }));
      return false;
    } finally {
      if (requestId === ordersRequestId.current) setSectionLoading(old => ({ ...old, orders: false }));
    }
  }, [orderSearch, orderStatus, orderEnvironment, orderShopId, orderFrom, orderTo, page]);
  const refreshRuns = useCallback(async () => {
    const result = await loadSection<Row[]>("runs", () => api<Row[]>("sync-runs?limit=30"));
    if (result) setRuns(result);
    return Boolean(result);
  }, [loadSection]);
  const refreshUnmatched = useCallback(async () => {
    const result = await loadSection<Row[]>("unmatched", () => api<Row[]>("mappings/unmatched?limit=50"));
    if (result) setUnmatched(result);
    return Boolean(result);
  }, [loadSection]);

  const refresh = useCallback(async (showNotice = false) => {
    setBusy("refresh"); setError("");
    try {
      const results = await Promise.all([refreshStatus(), refreshOrders(1), refreshRuns(), refreshUnmatched()]);
      setPage(1);
      if (showNotice && results.every(Boolean)) setNotice("Đã cập nhật dữ liệu từ GEME.");
    } finally { setBusy(""); }
  }, [refreshStatus, refreshOrders, refreshRuns, refreshUnmatched]);

  useEffect(() => { void refresh(); }, []); // initial load only
  useEffect(() => {
    const url = new URL(window.location.href);
    const callback = url.searchParams.get("shopee");
    if (callback) {
      url.searchParams.delete("shopee");
      window.history.replaceState({}, "", url.toString());
      void (async () => {
        try {
          if (callback === "connected") {
            const refreshed = await api<Row>("status");
            setStatus(refreshed);
            const connected = (refreshed.connections || []).some((connection: Row) => connection.status === "ACTIVE" && connection.environment === refreshed.environment);
            setNotice(connected ? "Shopee đã xác nhận cấp quyền cho shop." : "Shopee trả về callback nhưng GEME chưa xác nhận được kết nối. Mở phần chi tiết để kiểm tra.");
          } else setNotice(callback === "denied" ? "Bạn đã từ chối cấp quyền Shopee." : "Kết nối Shopee chưa thành công. Kiểm tra cấu hình/callback rồi thử lại.");
        } catch { setError("Đã quay về từ Shopee nhưng chưa tải được trạng thái kết nối."); }
      })();
    }
  }, []);

  const connect = async () => {
    setBusy("connect"); setError("");
    try {
      const result = await api<{ authorizationUrl: string }>("authorize", "POST", {});
      window.location.assign(result.authorizationUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được liên kết cấp quyền."); setBusy(""); }
  };
  const copyCallback = async () => {
    try { await navigator.clipboard.writeText(String(status?.redirectUri || "")); setNotice("Đã sao chép callback URL."); }
    catch { setError("Trình duyệt không cho phép sao chép. Hãy chọn và sao chép callback URL thủ công."); }
  };
  const sync = async (connectionId: string) => {
    setBusy(`sync-${connectionId}`); setError(""); setNotice("");
    try {
      const result = await api<{ queued: boolean }>(`connections/${encodeURIComponent(connectionId)}/sync`, "POST", {});
      setNotice(result.queued ? "Đã đưa đồng bộ đơn Shopee vào hàng đợi." : "Đang có tác vụ đồng bộ cho shop này.");
      await Promise.all([refreshStatus(), refreshRuns()]);
      setTab("history");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được tác vụ đồng bộ."); }
    finally { setBusy(""); }
  };
  const disconnect = async (connectionId: string) => {
    if (!window.confirm("Ngắt kết nối Shopee tại GEME? Lịch sử đơn và mapping sẽ được giữ lại.")) return;
    setBusy(`disconnect-${connectionId}`); setError("");
    try {
      await api(`connections/${encodeURIComponent(connectionId)}`, "DELETE");
      setNotice("Đã ngắt kết nối tại GEME. Đơn và lịch sử đã nhập vẫn được giữ.");
      await refreshStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không ngắt được kết nối."); }
    finally { setBusy(""); }
  };
  const openOrder = async (id: string) => {
    const requestId = ++orderDetailRequestId.current;
    setBusy(`order-${id}`); setError("");
    try { const result = await api<Row>(`orders/${encodeURIComponent(id)}`); if (requestId === orderDetailRequestId.current) setSelectedOrder(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được chi tiết đơn."); }
    finally { setBusy(""); }
  };

  useEffect(() => {
    if (!runs.some(run => ["QUEUED", "RUNNING", "RETRYING"].includes(run.status))) return;
    const timer = window.setInterval(() => { void refreshRuns().catch(() => undefined); void refreshStatus().catch(() => undefined); }, 4_000);
    return () => window.clearInterval(timer);
  }, [runs, refreshRuns, refreshStatus]);
  const loadCatalog = async (row: Row) => {
    setBusy(`catalog-${row.id}`); setError("");
    try {
      const params = new URLSearchParams();
      const q = (catalogSearch[row.id] || row.modelSku || row.itemSku || "").trim();
      if (q) params.set("q", q);
      const result = await api<Row[]>(`mappings/catalog?${params.toString()}`);
      setCatalogRows(old => ({ ...old, [row.id]: result }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được danh sách SKU GEME."); }
    finally { setBusy(""); }
  };
  const saveMapping = async (row: Row) => {
    const selected = (catalogRows[row.id] || []).find(item => `${item.productId}:${item.variantId || "product"}` === catalogSelection[row.id]);
    if (!selected) return;
    setBusy(`map-${row.id}`); setError("");
    try {
      await api(`mappings/${encodeURIComponent(row.id)}`, "POST", { connectionId: row.connectionId, productId: selected.productId, variantId: selected.variantId });
      setNotice(`Đã ghép ${row.modelSku || row.itemSku || row.itemId} với SKU ${selected.sku}.`);
      await Promise.all([refreshUnmatched(), refreshOrders(page), refreshStatus()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được mapping SKU."); }
    finally { setBusy(""); }
  };
  const retryRun = async (runId: string) => {
    setBusy(`retry-${runId}`); setError("");
    try {
      await api(`sync-runs/${encodeURIComponent(runId)}/retry`, "POST", {});
      setNotice("Đã tạo tác vụ thử lại.");
      await refreshRuns();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể thử lại."); }
    finally { setBusy(""); }
  };

  return <div className="shopee-workspace">
    <header className="shopee-hero">
      <div><span className="shopee-eyebrow">MARKETPLACE · READ ONLY</span><h2>Kết nối Shopee</h2><p>Đưa đơn hàng và trạng thái từ Shopee vào GEME, tách riêng khỏi đơn website.</p></div>
      <div className="shopee-hero-actions"><button className="shopee-button is-quiet" onClick={() => void refresh(true)} disabled={busy === "refresh"}>{busy === "refresh" ? "Đang làm mới…" : "Làm mới"}</button><button className="shopee-button is-primary" onClick={() => void connect()} disabled={!canConnect || Boolean(busy)}>{busy === "connect" ? "Đang mở Shopee…" : activeConnection ? "Kết nối thêm shop" : "Kết nối shop"}</button></div>
    </header>
    <div className="shopee-readonly"><strong>Chỉ đồng bộ dữ liệu đơn hàng.</strong> GEME không cập nhật giá/tồn Shopee, không xác nhận hoặc hủy đơn, không tạo vận đơn, không trừ tồn GEME và không gửi đơn sang POS365/Viettel Post.</div>
    {error && <div className="shopee-alert is-error" role="alert">{error}<button onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="shopee-alert is-note" role="status">{notice}<button onClick={() => setNotice("")}>Đóng</button></div>}
    <nav className="shopee-tabs" aria-label="Khu vực Shopee">
      {([["overview", "Kết nối"], ["orders", "Đơn Shopee"], ["mappings", "Ghép SKU"], ["history", "Lịch sử đồng bộ"]] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{label}{key === "mappings" && unmatched.length > 0 && <b>{unmatched.length}</b>}</button>)}
    </nav>

    {tab === "overview" && <section className="shopee-overview-grid">
      {sectionErrors.status && <div className="shopee-alert is-error" role="alert">Không tải được trạng thái kết nối: {sectionErrors.status}<button onClick={() => void refreshStatus()}>Thử lại</button></div>}
      {sectionLoading.status && !status && <div className="shopee-empty" role="status">Đang tải cấu hình và trạng thái kết nối…</div>}
      <article className="shopee-panel shopee-config-panel"><div className="shopee-panel-heading"><div><span className="shopee-eyebrow">APPLICATION</span><h3>Cấu hình ứng dụng</h3></div><span className={`shopee-pill ${canConnect ? "success" : "pending"}`}>{!status?.enabled ? "Đang tắt" : status?.configurationStatus === "ready" ? "Sẵn sàng" : status?.configurationStatus === "invalid_configuration" ? "Cấu hình sai" : "Thiếu cấu hình"}</span></div>
        <div className="shopee-config-list"><div><span>Tích hợp</span><strong>{status?.enabled ? "Đã bật" : "Đang tắt (SHOPEE_ENABLED=false)"}</strong></div><div><span>Môi trường</span><strong>{status?.environment === "sandbox" ? "Sandbox" : "Production"}</strong></div><div><span>Partner ID / Key</span><strong>{status?.partnerConfigured ? "Đã có ở backend" : "Chưa cấu hình"}</strong></div><div><span>Mã hóa token</span><strong>{status?.encryptionConfigured ? "Sẵn sàng" : "Thiếu hoặc sai khóa mã hóa"}</strong></div><div><span>Callback URL</span><code>{status?.redirectUri || "Chưa cấu hình"}</code><button className="shopee-text-button" onClick={() => void copyCallback()} disabled={!status?.redirectUri}>Sao chép</button></div><div><span>Đồng bộ lần đầu</span><strong>{status?.initialSyncDays ?? "—"} ngày gần nhất</strong></div><div><span>Polling</span><strong>Mỗi {status?.pollIntervalMinutes ?? "—"} phút</strong></div></div>
        {((status?.missingConfiguration || []).length > 0 || (status?.invalidConfiguration || []).length > 0) && <div className="shopee-help"><strong>Cần chỉnh trong file env:</strong> {[...(status?.missingConfiguration || []), ...(status?.invalidConfiguration || [])].join(", ")}</div>}
        <p className="shopee-help">Partner Key và token chỉ nằm ở API/worker. Trang Admin chỉ nhận trạng thái cấu hình, không nhận secret.</p>
      </article>
      <article className="shopee-panel"><div className="shopee-panel-heading"><div><span className="shopee-eyebrow">SHOP</span><h3>Shop đã cấp quyền</h3></div></div>
        {(status?.connections || []).length ? <div className="shopee-connections">{(status?.connections || []).map((connection: Row) => <div className="shopee-connection" key={connection.id}><div><strong>{connection.shopName || `Shop ID ${connection.shopId}`}</strong><small>Shop ID {connection.shopId} · {connection.environment === "sandbox" ? "Sandbox" : "Production"}</small><small>{Number(connection._count?.orders) || 0} đơn đã nhập · Đồng bộ gần nhất {dateTime(connection.lastSyncCompletedAt)}</small>{connection.lastErrorCode && <small className="shopee-error-code">Lỗi gần nhất: {shortenError(connection.lastErrorCode)}</small>}</div><span className={`shopee-pill ${statusTone(connection.status)}`}>{statusLabels[connection.status] || connection.status}</span><div className="shopee-inline-actions">{connection.status === "ACTIVE" && <button className="shopee-button is-quiet" onClick={() => void sync(connection.id)} disabled={Boolean(busy)}>{busy === `sync-${connection.id}` ? "Đang xếp hàng…" : "Đồng bộ ngay"}</button>}{connection.status === "REAUTH_REQUIRED" && <button className="shopee-button is-quiet" onClick={() => void connect()} disabled={!canConnect || Boolean(busy)}>Kết nối lại</button>}{connection.status !== "DISCONNECTED" && <button className="shopee-button is-danger-quiet" onClick={() => void disconnect(connection.id)} disabled={Boolean(busy)}>Ngắt kết nối</button>}</div></div>)}</div> : <div className="shopee-empty">Chưa có shop Shopee nào được cấp quyền.</div>}
      </article>
      <article className="shopee-panel shopee-stat-panel"><span className="shopee-eyebrow">SYNC QUEUE</span><h3>Trạng thái worker</h3>{status?.queue?.available ? <><div className="shopee-config-list"><div><span>Worker</span><strong>{({ online: "Đang hoạt động", offline: "Không hoạt động", disabled: "Đang tắt", not_configured: "Chưa cấu hình" } as Record<string, string>)[status.queue.workerStatus] || status.queue.workerStatus}</strong></div></div><div className="shopee-stat-grid">{[["Đang chờ", status?.queue?.waiting], ["Đang chạy", status?.queue?.active], ["Thất bại", status?.queue?.failed], ["Đơn đã nhập", orders.total]].map(([label, number]) => <div key={String(label)}><small>{label}</small><strong>{number ?? "—"}</strong></div>)}</div>{status.queue.workerWarning && <p className="shopee-alert is-error">Worker không hoạt động trong khi còn tác vụ chờ ({status.queue.oldestWaitingSeconds}s).</p>}</> : <div className="shopee-alert is-error">Chưa kiểm tra được trạng thái đồng bộ. Hãy kiểm tra Redis và worker.</div>}<p className="shopee-help">Đơn marketplace được lưu riêng và không thay đổi tồn kho GEME.</p></article>
    </section>}

    {tab === "orders" && <section className="shopee-panel"><div className="shopee-panel-heading"><div><span className="shopee-eyebrow">IMPORTED ORDERS</span><h3>Đơn Shopee <small>{orders.total}</small></h3></div></div>{sectionErrors.orders && <div className="shopee-alert is-error" role="alert">Không tải được danh sách đơn: {sectionErrors.orders}<button onClick={() => void refreshOrders(page)}>Thử lại</button></div>}<div className="shopee-inline-actions shopee-order-filters"><input className="shopee-input" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { setPage(1); void refreshOrders(1); } }} placeholder="Tìm mã đơn, SKU, tên sản phẩm"/><select className="shopee-input" value={orderStatus} onChange={event => { setOrderStatus(event.target.value); setPage(1); }}><option value="">Mọi trạng thái</option>{["UNPAID", "READY_TO_SHIP", "PROCESSED", "SHIPPED", "COMPLETED", "IN_CANCEL", "CANCELLED", "INVOICE_PENDING"].map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select><select className="shopee-input" value={orderEnvironment} onChange={event => { setOrderEnvironment(event.target.value); setPage(1); }}><option value="">Mọi môi trường</option><option value="sandbox">Sandbox</option><option value="production">Production</option></select><select className="shopee-input" value={orderShopId} onChange={event => { setOrderShopId(event.target.value); setPage(1); }}><option value="">Mọi shop</option>{(status?.connections || []).map((connection: Row) => <option key={connection.id} value={connection.shopId}>Shop ID {connection.shopId} · {connection.environment}</option>)}</select><input className="shopee-input" type="date" aria-label="Từ ngày" value={orderFrom} onChange={event => { setOrderFrom(event.target.value); setPage(1); }}/><input className="shopee-input" type="date" aria-label="Đến ngày" value={orderTo} onChange={event => { setOrderTo(event.target.value); setPage(1); }}/><button className="shopee-button is-quiet" onClick={() => { setPage(1); void refreshOrders(1); }}>Lọc</button></div>
      <div className="shopee-table-wrap"><table><thead><tr><th>Mã đơn Shopee</th><th>Shop</th><th>Sản phẩm / SKU</th><th>Thời gian đặt</th><th>Trạng thái</th><th>Tổng tiền</th><th>Ghép SKU</th><th></th></tr></thead><tbody>{orders.items.map(order => <tr key={order.id} onClick={() => void openOrder(order.id)}><td><strong>{order.orderSn}</strong></td><td>{order.connection?.shopName || order.connection?.shopId || "—"}</td><td><div className="shopee-order-item-list">{(order.items || []).slice(0, 2).map((item: Row) => <span key={item.id}>{item.itemName}<small>{item.mappedSku || item.modelSku || item.itemSku || "Chưa có SKU"} · SL {item.quantity}</small></span>)}{(order.items || []).length > 2 && <small>+{order.items.length - 2} mặt hàng</small>}</div></td><td>{dateTime(order.createTime)}</td><td><span className={`shopee-pill ${statusTone(order.status)}`}>{statusLabels[order.status] || order.status}</span></td><td>{money(order.totalAmount, order.currency)}</td><td>{(order.items || []).every((item: Row) => item.mappedSku) ? <span className="shopee-pill success">Đã ghép</span> : <span className="shopee-pill pending">Chưa ghép SKU</span>}</td><td><button className="shopee-text-button" onClick={event => { event.stopPropagation(); void openOrder(order.id); }}>Chi tiết</button></td></tr>)}{!orders.items.length && <tr><td colSpan={8}><div className="shopee-empty">{sectionLoading.orders ? "Đang tải đơn…" : sectionErrors.orders ? "Danh sách đơn chưa tải được." : "Chưa có đơn Shopee. Hãy kết nối shop và chạy đồng bộ."}</div></td></tr>}</tbody></table></div>
      <div className="shopee-pagination"><span>Trang {orders.page || page} / {orders.pages || 1} · {orders.total} đơn</span><div><button className="shopee-button is-quiet" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); void refreshOrders(next); }}>Trước</button><button className="shopee-button is-quiet" disabled={!orders.pages || page >= orders.pages} onClick={() => { const next = page + 1; setPage(next); void refreshOrders(next); }}>Sau</button></div></div>
    </section>}

    {tab === "mappings" && <section className="shopee-panel"><div className="shopee-panel-heading"><div><span className="shopee-eyebrow">SKU MATCHING</span><h3>Sản phẩm chưa ghép SKU</h3><p>Chỉ tự ghép khi SKU Shopee khớp chính xác và duy nhất. Bạn có thể chọn đúng SKU/biến thể GEME ở đây.</p></div><button className="shopee-button is-quiet" onClick={() => void refreshUnmatched()}>Làm mới</button></div>{sectionErrors.unmatched && <div className="shopee-alert is-error" role="alert">Không tải được danh sách cần ghép: {sectionErrors.unmatched}<button onClick={() => void refreshUnmatched()}>Thử lại</button></div>}
      <div className="shopee-mapping-list">{unmatched.map(row => <div className="shopee-mapping-row" key={row.id}><div className="shopee-mapping-remote"><strong>{row.itemName}</strong><small>Đơn {row.order?.orderSn} · Shop {row.shopId}</small><small>Item {row.itemId}{row.modelId ? ` · Model ${row.modelId}` : ""}</small><small>SKU Shopee: {row.modelSku || row.itemSku || "Chưa cung cấp"}</small></div><div className="shopee-mapping-controls"><div className="shopee-mapping-search"><input className="shopee-input" value={catalogSearch[row.id] || ""} onChange={event => setCatalogSearch(old => ({ ...old, [row.id]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter") void loadCatalog(row); }} placeholder="Tìm SKU/tên GEME"/><button className="shopee-button is-quiet" onClick={() => void loadCatalog(row)} disabled={Boolean(busy)}>Tìm</button></div>{catalogRows[row.id] && <><select className="shopee-input" value={catalogSelection[row.id] || ""} onChange={event => setCatalogSelection(old => ({ ...old, [row.id]: event.target.value }))}><option value="">Chọn sản phẩm hoặc biến thể</option>{catalogRows[row.id].map(item => <option key={`${item.productId}:${item.variantId || "product"}`} value={`${item.productId}:${item.variantId || "product"}`}>{item.label}</option>)}</select><button className="shopee-button is-primary" onClick={() => void saveMapping(row)} disabled={!catalogSelection[row.id] || busy === `map-${row.id}`}>{busy === `map-${row.id}` ? "Đang lưu…" : "Lưu mapping"}</button></>}</div></div>)}{!unmatched.length && <div className="shopee-empty">{sectionLoading.unmatched ? "Đang tải mặt hàng cần ghép…" : sectionErrors.unmatched ? "Danh sách cần ghép chưa tải được." : "Không có mặt hàng cần ghép SKU."}</div>}</div>
    </section>}

    {tab === "history" && <section className="shopee-panel"><div className="shopee-panel-heading"><div><span className="shopee-eyebrow">DURABLE JOBS</span><h3>Lịch sử đồng bộ</h3></div><button className="shopee-button is-quiet" onClick={() => void refreshRuns()}>Làm mới</button></div>{sectionErrors.runs && <div className="shopee-alert is-error" role="alert">Không tải được lịch sử đồng bộ: {sectionErrors.runs}<button onClick={() => void refreshRuns()}>Thử lại</button></div>}<div className="shopee-table-wrap"><table><thead><tr><th>Thời điểm</th><th>Shop</th><th>Trạng thái</th><th>Khoảng truy vấn</th><th>Đơn đọc / tạo / cập nhật</th><th>Lỗi</th><th></th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td>{dateTime(run.createdAt)}</td><td>{run.connection?.shopName || run.connection?.shopId || "—"}</td><td><span className={`shopee-pill ${statusTone(run.status)}`}>{statusLabels[run.status] || run.status}</span></td><td>{run.fromTime ? dateTime(run.fromTime) : "—"} → {run.toTime ? dateTime(run.toTime) : "—"}</td><td>{run.ordersRead} / {run.ordersCreated} / {run.ordersUpdated}</td><td>{shortenError(run.errorCode)}</td><td>{run.status === "FAILED" && <button className="shopee-button is-quiet" onClick={() => void retryRun(run.id)} disabled={Boolean(busy)}>{busy === `retry-${run.id}` ? "Đang thử…" : "Thử lại"}</button>}</td></tr>)}{!runs.length && <tr><td colSpan={7}><div className="shopee-empty">{sectionLoading.runs ? "Đang tải lịch sử đồng bộ…" : sectionErrors.runs ? "Lịch sử đồng bộ chưa tải được." : "Chưa có lịch sử đồng bộ."}</div></td></tr>}</tbody></table></div></section>}

    {selectedOrder && <div className="shopee-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedOrder(null); }}><section className="shopee-order-modal" role="dialog" aria-modal="true" aria-labelledby="shopeeOrderTitle"><header><div><span className="shopee-eyebrow">SHOPEE ORDER</span><h3 id="shopeeOrderTitle">{selectedOrder.orderSn}</h3></div><button className="shopee-button is-quiet" onClick={() => setSelectedOrder(null)}>Đóng</button></header><div className="shopee-order-meta"><div><small>Trạng thái Shopee</small><strong>{statusLabels[selectedOrder.status] || selectedOrder.status}</strong></div><div><small>Đặt lúc</small><strong>{dateTime(selectedOrder.createTime)}</strong></div><div><small>Cập nhật từ Shopee</small><strong>{dateTime(selectedOrder.shopeeUpdatedAt)}</strong></div><div><small>Tổng đơn Shopee</small><strong>{money(selectedOrder.totalAmount, selectedOrder.currency)}</strong></div><div><small>Thanh toán</small><strong>{selectedOrder.paymentMethod || "—"}</strong></div><div><small>Đơn vị vận chuyển</small><strong>{selectedOrder.shippingCarrier || "—"}</strong></div></div><h4>Sản phẩm</h4><div className="shopee-table-wrap"><table><thead><tr><th>Sản phẩm</th><th>SKU Shopee</th><th>SKU GEME</th><th>SL</th><th>Giá gốc</th><th>Giá sau giảm</th></tr></thead><tbody>{(selectedOrder.items || []).map((item: Row) => <tr key={item.id}><td>{item.itemName}</td><td>{item.modelSku || item.itemSku || "—"}</td><td>{item.mappedSku || <span className="shopee-pill pending">Chưa ghép SKU</span>}</td><td>{item.quantity}</td><td>{money(item.modelOriginalPrice ?? item.unitPrice, item.currency || selectedOrder.currency)}</td><td>{money(item.modelDiscountedPrice ?? item.variationDiscountedPrice, item.currency || selectedOrder.currency)}</td></tr>)}</tbody></table></div><details className="shopee-detail-address"><summary>Thông tin giao hàng (nếu Shopee trả về)</summary><pre>{selectedOrder.recipientAddress ? JSON.stringify(selectedOrder.recipientAddress, null, 2) : "Shopee không trả dữ liệu địa chỉ cho đơn này."}</pre></details><h4>Lịch sử trạng thái Shopee</h4><div className="shopee-status-history">{(selectedOrder.statusHistory || []).map((entry: Row) => <div key={entry.id}><span className={`shopee-dot ${statusTone(entry.status)}`}/><strong>{statusLabels[entry.status] || entry.status}</strong><small>{dateTime(entry.shopeeUpdatedAt)} · nhận tại GEME {dateTime(entry.observedAt)}</small></div>)}</div><p className="shopee-help">Thông tin này chỉ đọc. Không có thao tác xác nhận, hủy đơn hoặc tạo vận đơn từ GEME.</p></section></div>}
  </div>;
}
