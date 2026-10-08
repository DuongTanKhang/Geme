"use client";

import { useEffect } from "react";

export type OrderReceiptLine = {
  id: string;
  productName: string;
  productSku: string;
  quality?: string | null;
  beadSize?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  image?: string;
};

export type OrderReceiptData = {
  id: string;
  date: string;
  time: string;
  placedAt?: string;
  customer: string;
  phone: string;
  email: string;
  status: string;
  payment: string;
  paymentStatus: string;
  shipping: string;
  address: string;
  trackingCode: string;
  note: string;
  pos365SyncStatus?: string | null;
  pos365SyncError?: string | null;
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  total: number;
  items: OrderReceiptLine[];
};

type Props = { order: OrderReceiptData; onClose: () => void };

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;

function paymentLabel(value: string) {
  return ({
    COD: "Tiền mặt / COD",
    BANK_TRANSFER: "Chuyển khoản",
    MOMO: "MoMo",
    CREDIT_CARD: "Thẻ ngân hàng",
    OTHER: "Khác",
  } as Record<string, string>)[value] || value || "—";
}

function paymentStatusLabel(value: string) {
  return ({
    PAID: "Đã thanh toán",
    PENDING: "Chưa thanh toán",
    FAILED: "Thanh toán thất bại",
    REFUNDED: "Đã hoàn tiền",
    PARTIALLY_REFUNDED: "Đã hoàn một phần",
  } as Record<string, string>)[value] || value || "—";
}

export default function OrderReceiptModal({ order, onClose }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="order-receipt-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="order-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="orderReceiptTitle">
      <header className="order-receipt-heading no-print">
        <div><span>GEME · ĐƠN HÀNG</span><h2 id="orderReceiptTitle">Hóa đơn bán hàng</h2></div>
        <div className="order-receipt-actions"><button className="order-receipt-print" type="button" onClick={() => window.print()}>In hóa đơn</button><button className="order-receipt-close" type="button" onClick={onClose} aria-label="Đóng hóa đơn">×</button></div>
      </header>

      <div className="order-receipt-paper">
        <div className="order-receipt-title">
          <div><strong>GEME</strong><span>SILVER &amp; GEMSTONE JEWELRY</span><small>HÓA ĐƠN BÁN HÀNG</small></div>
          <div><b>{order.id}</b><span>Ngày tạo: {order.date} · {order.time}</span><span>Trạng thái: {order.status}</span></div>
        </div>

        <div className="order-receipt-parties">
          <section><small>KHÁCH HÀNG</small><strong>{order.customer || "Khách lẻ"}</strong>{order.phone && <span>{order.phone}</span>}{order.email && <span>{order.email}</span>}</section>
          <section><small>GIAO HÀNG</small><strong>{order.shipping || "Chưa ghi nhận"}</strong>{order.address && <span>{order.address}</span>}{order.trackingCode && <span>Mã vận đơn: {order.trackingCode}</span>}</section>
          <section><small>THANH TOÁN</small><strong>{paymentLabel(order.payment)}</strong><span>{paymentStatusLabel(order.paymentStatus)}</span></section>
        </div>

        <div className="order-receipt-items-wrap"><table className="order-receipt-items">
          <thead><tr><th>#</th><th>Sản phẩm / SKU</th><th>Biến thể</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
          <tbody>{order.items.length ? order.items.map((item, index) => <tr key={item.id}>
            <td>{index + 1}</td>
            <td><span className="order-receipt-product">{item.image ? <img src={item.image} alt=""/> : <span aria-hidden="true">◇</span>}<span><strong>{item.productName}</strong><small>{item.productSku}</small></span></span></td>
            <td>{[item.quality, item.beadSize].filter(Boolean).join(" · ") || "Tiêu chuẩn"}</td>
            <td>{new Intl.NumberFormat("vi-VN").format(item.quantity)}</td>
            <td>{money(item.unitPrice)}</td>
            <td>{money(item.lineTotal)}</td>
          </tr>) : <tr><td colSpan={6} className="order-receipt-empty">Không có sản phẩm trong đơn.</td></tr>}</tbody>
        </table></div>

        <div className="order-receipt-totals">
          <div><span>Tiền hàng</span><strong>{money(order.subtotal)}</strong></div>
          <div><span>Giảm giá</span><strong>− {money(order.discountAmount)}</strong></div>
          <div><span>Phí giao hàng</span><strong>{money(order.shippingFee)}</strong></div>
          <div className="order-receipt-grand"><span>Tổng thanh toán</span><strong>{money(order.total)}</strong></div>
        </div>
        {order.note && <div className="order-receipt-note"><strong>Ghi chú đơn hàng</strong><p>{order.note}</p></div>}
        <footer className="order-receipt-thanks">Cảm ơn Quý khách đã mua sắm tại GEME.</footer>
      </div>
      <footer className="order-receipt-dialog-footer no-print"><button className="button button-quiet" type="button" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>;
}
