"use client";

import type { OrderReceiptData } from "./order-receipt-modal";

type Props = {
  order: OrderReceiptData;
  onClose: () => void;
  onConfirm: () => void;
  onDispatch: () => void;
  onDelivered: () => void;
  onShowBill: () => void;
  onCustomerHistory: () => void;
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

export default function OrderDetailPanel({ order, onClose, onConfirm, onDispatch, onDelivered, onShowBill, onCustomerHistory }: Props) {
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
        <section className="drawer-info-section"><h3><SectionIcon name="truck"/>Vận chuyển</h3><p>{order.shipping || "Bán trực tiếp tại cửa hàng"}{order.trackingCode ? ` · ${order.trackingCode}` : ""}</p></section>
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
          ? <button className="button button-primary" type="button" onClick={onDispatch}>✓ Đã xử lý xong · Chuyển sang giao</button>
          : order.status === "Đang giao"
            ? <button className="button button-primary" type="button" onClick={onDelivered}>✓ Xác nhận đã giao</button>
            : <button className="button button-quiet" type="button" onClick={onShowBill}>Chi tiết hóa đơn</button>}
      <button className="button button-quiet" type="button" onClick={onShowBill}>▤ In đơn</button>
      {order.phone ? <a className="button button-quiet" href={`tel:${order.phone}`}>☎ Liên hệ khách</a> : <button className="button button-quiet" type="button" disabled>☎ Liên hệ khách</button>}
    </div>
  </aside>;
}
