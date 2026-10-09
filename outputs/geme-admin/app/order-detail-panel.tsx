"use client";

import { useEffect, useState } from "react";
import type { OrderReceiptData } from "./order-receipt-modal";

type VtpStatus = { configured: boolean; enabled: boolean; environment: string | null; senderConfigured: boolean; webhookConfigured: boolean; missing: string[] };
type VtpService = { code: string; name: string; price: number; deliveryTime: string; exchangeWeight: number };
type FreightPayment = "SENDER" | "RECEIVER";

type Props = {
  order: OrderReceiptData;
  onClose: () => void;
  onConfirm: () => void;
  onDispatch: () => void;
  onDelivered: () => void;
  onShowBill: () => void;
  onCustomerHistory: () => void;
  onGetViettelPostStatus: () => Promise<VtpStatus>;
  onGetViettelPostPrintUrl: () => Promise<{ url: string }>;
  onQuoteViettelPost: (body: Record<string, unknown>) => Promise<{ services: VtpService[] }>;
  onCreateViettelPostShipment: (body: Record<string, unknown>) => Promise<OrderReceiptData>;
  onRefreshOrders: () => Promise<void>;
};

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const iconPaths: Record<string, string> = {
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  truck: '<path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="17.5" cy="19" r="1.5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  note: '<path d="M5 3h14v18l-7-4-7 4V3Z"/><path d="M8 8h8M8 11h8"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function SectionIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconPaths[name] }} />;
}

function paymentName(method: string) {
  return ({
    COD: "Thanh toán khi nhận hàng (COD)",
    "Tiền mặt tại quầy": "Thanh toán tiền mặt tại quầy",
    BANK_TRANSFER: "Chuyển khoản",
    MOMO: "Ví MoMo",
    CREDIT_CARD: "Thẻ ngân hàng",
  } as Record<string, string>)[method] || method || "Chưa ghi nhận";
}

function paymentStatusName(status: string) {
  return ({ PAID: "Đã thanh toán", PENDING: "Chưa thanh toán", FAILED: "Thanh toán thất bại", REFUNDED: "Đã hoàn tiền" } as Record<string, string>)[status] || status || "Chưa ghi nhận";
}

function posSyncName(status?: string | null) {
  return ({ PENDING: "Đang chờ gửi", SYNCING: "Đang đồng bộ", RETRYING: "Sẽ tự thử lại", SYNCED: "Đã đồng bộ", BLOCKED: "Cần cấu hình thanh toán" } as Record<string, string>)[status || ""] || "Chưa gửi lên POS365";
}

export default function OrderDetailPanel({ order, onClose, onConfirm, onDispatch, onDelivered, onShowBill, onCustomerHistory, onGetViettelPostStatus, onGetViettelPostPrintUrl, onQuoteViettelPost, onCreateViettelPostShipment, onRefreshOrders }: Props) {
  const defaultWeight = Math.round(order.items.reduce((sum, item) => sum + (Number(item.weightGrams) || 0) * item.quantity, 0));
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [shipmentStatus, setShipmentStatus] = useState<VtpStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState("");
  const [printUrl, setPrintUrl] = useState("");
  const [shipmentError, setShipmentError] = useState("");
  const [packageWeightGrams, setPackageWeightGrams] = useState(defaultWeight ? String(defaultWeight) : "");
  const [freightPayment, setFreightPayment] = useState<FreightPayment>(order.shippingFee > 0 ? "SENDER" : "RECEIVER");
  const [lengthCm, setLengthCm] = useState("0");
  const [widthCm, setWidthCm] = useState("0");
  const [heightCm, setHeightCm] = useState("0");
  const [shippingNote, setShippingNote] = useState(order.note || "");
  const [services, setServices] = useState<VtpService[]>([]);
  const [serviceCode, setServiceCode] = useState("");
  const [refreshError, setRefreshError] = useState("");

  useEffect(() => {
    setShipmentOpen(false);
    setShipmentStatus(null);
    setShipmentError("");
    setServices([]);
    setServiceCode("");
    setPackageWeightGrams(defaultWeight ? String(defaultWeight) : "");
    setFreightPayment(order.shippingFee > 0 ? "SENDER" : "RECEIVER");
    setShippingNote(order.note || "");
    setRefreshError("");
    setPrintError("");
    setPrintUrl("");
  }, [order.id, defaultWeight, order.note]);

  const parcelValues = () => ({ packageWeightGrams: Number(packageWeightGrams), lengthCm: Number(lengthCm) || 0, widthCm: Number(widthCm) || 0, heightCm: Number(heightCm) || 0 });
  const openViettelPost = async () => {
    setShipmentOpen(true);
    setShipmentError("");
    setStatusLoading(true);
    try { setShipmentStatus(await onGetViettelPostStatus()); }
    catch (error) { setShipmentError(error instanceof Error ? error.message : "Không tải được cấu hình Viettel Post."); }
    finally { setStatusLoading(false); }
  };
  const loadServices = async () => {
    setQuoteLoading(true);
    setShipmentError("");
    setServices([]);
    setServiceCode("");
    try {
      const result = await onQuoteViettelPost({ ...parcelValues(), shippingNote, freightPayment });
      setServices(result.services || []);
      if (!result.services?.length) setShipmentError("Viettel Post chưa tìm thấy dịch vụ phù hợp với địa chỉ này.");
    } catch (error) { setShipmentError(error instanceof Error ? error.message : "Không tải được dịch vụ Viettel Post."); }
    finally { setQuoteLoading(false); }
  };
  const createViettelPostOrder = async () => {
    setCreateLoading(true);
    setShipmentError("");
    try {
      await onCreateViettelPostShipment({ ...parcelValues(), shippingNote, serviceCode, freightPayment });
      setShipmentOpen(false);
      setServices([]);
      setServiceCode("");
    } catch (error) { setShipmentError(error instanceof Error ? error.message : "Không tạo được vận đơn Viettel Post."); }
    finally { setCreateLoading(false); }
  };
  const refreshTracking = async () => {
    setRefreshLoading(true);
    setRefreshError("");
    try { await onRefreshOrders(); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : "Không tải được trạng thái vận đơn mới."); }
    finally { setRefreshLoading(false); }
  };
  const createPrintUrl = async () => {
    setPrintLoading(true);
    setPrintError("");
    setPrintUrl("");
    try { setPrintUrl((await onGetViettelPostPrintUrl()).url); }
    catch (error) { setPrintError(error instanceof Error ? error.message : "Không tạo được link in vận đơn."); }
    finally { setPrintLoading(false); }
  };

  const statusSteps = ["Đặt hàng", "Chờ xác nhận", "Đang xử lý", "Đang giao", "Đã giao", "Đã hủy"];
  const statusIndex = Math.max(0, statusSteps.indexOf(order.status));

  return <aside className="order-drawer" aria-label={`Chi tiết đơn hàng ${order.id}`}>
    <div className="drawer-title"><h2>Chi tiết đơn hàng #{order.id}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Đóng chi tiết"><SectionIcon name="close" /></button></div>
    <div className="drawer-meta"><span className="status-pill amber">{order.status}</span><span>Đặt hàng lúc {order.date} {order.time}</span></div>
    <div className={`pos365-order-sync ${order.pos365SyncStatus === "SYNCED" ? "is-synced" : order.pos365SyncStatus === "BLOCKED" ? "is-blocked" : ""}`}><strong>POS365</strong><span>{posSyncName(order.pos365SyncStatus)}</span>{order.pos365SyncError && <small>{order.pos365SyncError}</small>}</div>

    <div className="drawer-info-timeline">
      <div className="drawer-info-card">
        <section className="drawer-info-section"><h3><SectionIcon name="person"/>Thông tin khách hàng</h3><strong>{order.customer || "Khách lẻ"}</strong>{order.phone && <p>SĐT: {order.phone}</p>}{order.email && <p>Email: {order.email}</p>}{order.phone && <button type="button" onClick={onCustomerHistory}>Xem lịch sử mua hàng</button>}</section>
        {order.address && <section className="drawer-info-section"><h3><SectionIcon name="pin"/>Địa chỉ giao hàng</h3><p>{order.address}</p></section>}
        <section className="drawer-info-section"><h3><SectionIcon name="card"/>Phương thức thanh toán</h3><p>{paymentName(order.payment)}</p></section>
        <section className="drawer-info-section"><h3><SectionIcon name="truck"/>Vận chuyển</h3><p>{order.shipping || "Chưa chọn đơn vị vận chuyển"}</p>
          {order.trackingCode && <div className="vtp-tracking-info"><p>Mã vận đơn: <strong>{order.trackingCode}</strong></p>{order.carrierStatusName && <p>Hành trình: <strong>{order.carrierStatusName}</strong></p>}{order.carrierLocation && <p>Vị trí: {order.carrierLocation}</p>}{order.carrierFee != null && <p>Phí Viettel Post: {money(order.carrierFee)}</p>}{order.carrierStatusAt && <small>Cập nhật {new Date(order.carrierStatusAt).toLocaleString("vi-VN")}</small>}<button type="button" onClick={refreshTracking} disabled={refreshLoading}>{refreshLoading ? "Đang tải…" : "Tải lại trạng thái"}</button><button type="button" onClick={createPrintUrl} disabled={printLoading}>{printLoading ? "Đang tạo link in…" : "Tạo link in vận đơn"}</button>{printUrl && <a className="vtp-print-link" href={printUrl} target="_blank" rel="noreferrer">Mở nhãn Viettel Post ↗</a>}{refreshError && <small className="vtp-error">{refreshError}</small>}{printError && <small className="vtp-error">{printError}</small>}</div>}
          {order.carrierShipmentStatus === "FAILED" && order.carrierShipmentError && <p className="vtp-error">Tạo vận đơn lần trước chưa thành công: {order.carrierShipmentError}</p>}
          {!order.trackingCode && order.shipping !== "Bán trực tiếp tại cửa hàng" && ["Đang xử lý", "Đang giao"].includes(order.status) && (order.payment.includes("COD") || order.paymentStatus === "PAID") && <button className="vtp-open-button" type="button" onClick={openViettelPost}>＋ Tạo vận đơn Viettel Post</button>}
          {!order.trackingCode && order.status === "Đang xử lý" && !order.payment.includes("COD") && order.paymentStatus !== "PAID" && <small className="vtp-dev-note">Cần xác nhận thanh toán trước khi gửi Viettel Post.</small>}
          {shipmentOpen && <div className="vtp-shipment-form">
            {statusLoading ? <p>Đang đọc cấu hình Viettel Post…</p> : shipmentStatus && !shipmentStatus.configured ? <div className="vtp-config-message"><strong>Viettel Post chưa được cấu hình</strong><span>Thêm token Partner và địa chỉ người gửi ở backend, sau đó bật VIETTELPOST_ENABLED=true. Chọn môi trường development để chạy thử.</span>{shipmentStatus.missing?.length > 0 && <small>Còn thiếu: {shipmentStatus.missing.join(", ")}</small>}</div> : <>
              {shipmentStatus?.environment === "development" && <small className="vtp-dev-note">Đang nối môi trường phát triển Viettel Post.</small>}
              <div className="vtp-recipient-summary"><strong>{order.customer}</strong><span>{order.phone || "Thiếu số điện thoại"}</span><span>{order.address || "Thiếu địa chỉ nhận"}</span><span>{order.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</span></div>
              <label>Khối lượng kiện hàng (gram)<input type="number" min="1" max="100000" step="1" value={packageWeightGrams} onChange={(event) => { setPackageWeightGrams(event.target.value); setServices([]); setServiceCode(""); }} placeholder="Nhập cân nặng kiện hàng" required/></label>
              <div className="vtp-dimensions"><label>Dài (cm)<input type="number" min="0" max="300" value={lengthCm} onChange={(event) => { setLengthCm(event.target.value); setServices([]); setServiceCode(""); }}/></label><label>Rộng (cm)<input type="number" min="0" max="300" value={widthCm} onChange={(event) => { setWidthCm(event.target.value); setServices([]); setServiceCode(""); }}/></label><label>Cao (cm)<input type="number" min="0" max="300" value={heightCm} onChange={(event) => { setHeightCm(event.target.value); setServices([]); setServiceCode(""); }}/></label></div>
              <label>Người trả phí vận chuyển<select value={freightPayment} onChange={(event) => { setFreightPayment(event.target.value as FreightPayment); setServices([]); setServiceCode(""); }}><option value="RECEIVER">Người nhận trả cước Viettel Post</option><option value="SENDER">GEME trả cước Viettel Post</option></select></label>
              <small>{freightPayment === "RECEIVER" ? "COD thu tiền hàng; Viettel Post thu cước giao riêng từ người nhận." : "GEME thanh toán cước cho Viettel Post; COD thu số tiền còn phải trả theo tổng đơn."}</small>
              {order.payment.includes("COD") && order.paymentStatus !== "PAID" && <div className="vtp-cod-summary"><span>Tiền COD sẽ ghi trên vận đơn</span><strong>{money(freightPayment === "SENDER" ? order.total : Math.max(0, order.subtotal - order.discountAmount))}</strong></div>}
              <label>Ghi chú vận chuyển<textarea rows={2} maxLength={150} value={shippingNote} onChange={(event) => setShippingNote(event.target.value)} placeholder="Ghi chú cho Viettel Post (không bắt buộc)"/></label>
              {services.length > 0 && <label>Dịch vụ Viettel Post<select value={serviceCode} onChange={(event) => setServiceCode(event.target.value)}><option value="">Chọn dịch vụ</option>{services.map((service) => <option key={service.code} value={service.code}>{service.name} · {money(service.price)}{service.deliveryTime ? ` · ${service.deliveryTime}` : ""}</option>)}</select></label>}
              <small>Khi tải dịch vụ hoặc tạo vận đơn, thông tin nhận hàng và kiện hàng của đơn sẽ được gửi tới Viettel Post.</small>
              <div className="vtp-form-actions"><button type="button" className="button button-quiet" onClick={() => { setShipmentOpen(false); setShipmentError(""); }}>Đóng</button><button type="button" className="button button-quiet" onClick={loadServices} disabled={statusLoading || quoteLoading || createLoading || !packageWeightGrams}>{quoteLoading ? "Đang lấy dịch vụ…" : "Lấy dịch vụ và cước"}</button>{services.length > 0 && <button type="button" className="button button-primary" onClick={createViettelPostOrder} disabled={!serviceCode || createLoading || quoteLoading}>{createLoading ? "Đang tạo vận đơn…" : "Tạo vận đơn"}</button>}</div>
            </>}
            {shipmentError && <p className="vtp-error" role="alert">{shipmentError}</p>}
          </div>}
        </section>
      </div>
      <ol className="order-timeline" aria-label="Tiến trình đơn hàng">
        {statusSteps.map((step, index) => {
          const cancelled = order.status === "Đã hủy";
          const done = cancelled ? index < statusIndex && index < 5 : index < statusIndex;
          const current = step === order.status;
          if (step === "Đã hủy" && !cancelled) return null;
          return <li key={step} className={`timeline-step${done ? " done" : ""}${current ? " current" : ""}`}><span className="timeline-dot">{done ? "✓" : current ? "•" : ""}</span><span>{step}{(done || current) && <small>{order.date}{current ? ` ${order.time}` : ""}</small>}</span></li>;
        })}
      </ol>
    </div>

    <section className="drawer-products"><div className="drawer-products-title"><h3>Sản phẩm trong đơn</h3><span>{order.items.length} sản phẩm</span></div>
      {order.items.map((item) => <div className="drawer-product-row" key={item.id}>{item.image ? <img className="product-thumb" src={item.image} alt=""/> : <span className="product-thumb" aria-hidden="true">◇</span>}<span className="drawer-product-name">{item.productName}<small>{[item.productSku, item.quality, item.beadSize].filter(Boolean).join(" · ")}</small></span><span>x{item.quantity}</span><strong>{money(item.lineTotal)}</strong></div>)}
      <div className="drawer-total"><div><span>Tạm tính</span><strong>{money(order.subtotal)}</strong></div><div><span>Phí vận chuyển</span><strong>{money(order.shippingFee)}</strong></div><div><span>Giảm giá</span><strong>− {money(order.discountAmount)}</strong></div><strong><span>Tổng tiền</span><span>{money(order.total)}</span></strong><div className="payment-status"><span>Trạng thái thanh toán</span><span className={"status-pill "+(order.paymentStatus === "PAID" ? "green" : order.paymentStatus === "FAILED" ? "red" : "amber")}>{paymentStatusName(order.paymentStatus)}</span><button className="row-action" type="button" onClick={onShowBill}>Xem hóa đơn</button></div></div>
    </section>

    {order.note && <section className="drawer-note"><h3><SectionIcon name="note"/>Ghi chú đơn hàng</h3><p>{order.note}</p></section>}
    <div className="drawer-actions">
      {order.status === "Chờ xác nhận"
        ? <button className="button button-primary" type="button" onClick={onConfirm}>✓ Xác nhận đơn</button>
        : order.status === "Đang xử lý"
          ? order.shippingProvider === "VIETTEL_POST" && order.trackingCode
            ? <button className="button button-quiet" type="button" disabled>Đã tạo vận đơn · chờ lấy hàng</button>
            : <button className="button button-primary" type="button" onClick={onDispatch}>✓ Đã xử lý xong · Chuyển sang giao</button>
          : order.status === "Đang giao"
            ? order.shippingProvider === "VIETTEL_POST"
              ? <button className="button button-quiet" type="button" disabled>{order.carrierShipmentStatus === "IN_TRANSIT" ? "Viettel Post đang vận chuyển" : order.carrierStatusName || "Chờ Viettel Post cập nhật"}</button>
              : <button className="button button-primary" type="button" onClick={onDelivered}>✓ Xác nhận đã giao</button>
            : <button className="button button-quiet" type="button" onClick={onShowBill}>Chi tiết hóa đơn</button>}
      <button className="button button-quiet" type="button" onClick={onShowBill}>▤ In đơn</button>
      {order.phone ? <a className="button button-quiet" href={`tel:${order.phone}`}>☎ Liên hệ khách</a> : <button className="button button-quiet" type="button" disabled>☎ Liên hệ khách</button>}
    </div>
  </aside>;
}
