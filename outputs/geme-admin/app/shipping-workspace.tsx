"use client";

import { useMemo, useState } from "react";
import type { OrderReceiptData } from "./order-receipt-modal";

type ShippingOrder = OrderReceiptData & { product?: string; sku?: string; quantity?: number };
type ShipmentFilter = "READY" | "PICKUP" | "TRANSIT" | "DELIVERED" | "ISSUES" | "ALL";
type Props = { orders: ShippingOrder[]; onOpenOrder: (id: string) => void };

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const isStoreSale = (order: ShippingOrder) => order.shipping === "Bán trực tiếp tại cửa hàng";

function shipmentStage(order: ShippingOrder): Exclude<ShipmentFilter, "ALL"> | "OTHER" {
  const carrierStatus = String(order.carrierShipmentStatus || "").toUpperCase();
  const carrierName = String(order.carrierStatusName || "").toLocaleLowerCase("vi");
  if (order.status === "Đã giao" || carrierStatus === "DELIVERED") return "DELIVERED";
  if (["FAILED", "EXCEPTION", "RETURNING", "CANCELLED"].includes(carrierStatus) || /thất bại|không giao được|hoàn hàng|trả hàng|hủy vận đơn|huỷ vận đơn/.test(carrierName)) return "ISSUES";
  if (order.status === "Đang giao") return "TRANSIT";
  if (order.trackingCode || carrierStatus === "AWAITING_PICKUP") return "PICKUP";
  if (order.status === "Đang xử lý" && !isStoreSale(order) && (order.payment.includes("COD") || order.paymentStatus === "PAID")) return "READY";
  return "OTHER";
}

const filters: Array<{ id: ShipmentFilter; label: string }> = [
  { id: "ALL", label: "Tất cả" },
  { id: "READY", label: "Cần tạo vận đơn" },
  { id: "PICKUP", label: "Chờ lấy hàng" },
  { id: "TRANSIT", label: "Đang giao" },
  { id: "ISSUES", label: "Giao lỗi / hoàn" },
  { id: "DELIVERED", label: "Đã giao" },
];

export default function ShippingWorkspace({ orders, onOpenOrder }: Props) {
  const [filter, setFilter] = useState<ShipmentFilter>("ALL");
  const [search, setSearch] = useState("");
  const shippableOrders = useMemo(() => orders.filter((order) => !isStoreSale(order)), [orders]);
  const counts = useMemo(() => {
    const values = shippableOrders.map((order) => shipmentStage(order));
    return {
      READY: values.filter((value) => value === "READY").length,
      PICKUP: values.filter((value) => value === "PICKUP").length,
      TRANSIT: values.filter((value) => value === "TRANSIT").length,
      ISSUES: values.filter((value) => value === "ISSUES").length,
      DELIVERED: values.filter((value) => value === "DELIVERED").length,
      ALL: shippableOrders.length,
    };
  }, [shippableOrders]);
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return shippableOrders
      .filter((order) => filter === "ALL" || shipmentStage(order) === filter)
      .filter((order) => !query || `${order.id} ${order.customer} ${order.phone} ${order.address} ${order.trackingCode} ${order.product} ${(order.items || []).map((item) => `${item.productName} ${item.productSku}`).join(" ")}`.toLocaleLowerCase("vi").includes(query))
      .sort((a, b) => (b.placedAt ? new Date(b.placedAt).getTime() : 0) - (a.placedAt ? new Date(a.placedAt).getTime() : 0));
  }, [shippableOrders, filter, search]);

  return <section className="shipping-workspace" aria-label="Quản lý giao hàng">
    <div className="shipping-intro"><div><h2>Chuẩn bị và theo dõi vận đơn</h2><p>Đơn mới sẽ ở danh sách cần xử lý. Tạo vận đơn sau khi đóng gói; hành trình được cập nhật từ Viettel Post.</p></div></div>
    <div className="shipping-stat-grid">
      {filters.map((item) => <button key={item.id} type="button" className={`shipping-stat-card${filter === item.id ? " is-selected" : ""}`} onClick={() => setFilter(item.id)}><span>{item.label}</span><strong>{counts[item.id]}</strong></button>)}
    </div>
    <section className="shipping-list-panel">
      <div className="shipping-list-heading"><div><h3>{filters.find((item) => item.id === filter)?.label}</h3><span>{rows.length} đơn</span></div><label className="shipping-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã đơn, khách, số điện thoại, mã vận đơn" aria-label="Tìm đơn giao hàng"/></label></div>
      <div className="shipping-filter-tabs" role="tablist" aria-label="Lọc đơn giao hàng">{filters.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}</div>
      <div className="shipping-table-wrap"><table className="shipping-table"><thead><tr><th>Đơn hàng</th><th>Người nhận</th><th>Thu hộ / thanh toán</th><th>Đơn vị và hành trình</th><th>Ngày đặt</th><th></th></tr></thead><tbody>
        {rows.length ? rows.map((order) => {
          const stage = shipmentStage(order);
          const stageName: Record<string, string> = { READY: "Chờ đóng gói / tạo vận đơn", PICKUP: "Chờ Viettel Post lấy hàng", TRANSIT: "Đang vận chuyển", DELIVERED: "Giao thành công", ISSUES: "Cần xử lý với hãng", OTHER: order.status === "Đang xử lý" && !order.payment.includes("COD") && order.paymentStatus !== "PAID" ? "Chờ thanh toán" : order.status };
          const codAmount = order.payment.includes("COD") && order.paymentStatus !== "PAID" ? order.carrierCodAmount ?? order.total : 0;
          const codLabel = order.carrierFreightPayment === "RECEIVER" ? "COD tiền hàng · cước thu riêng" : order.carrierFreightPayment === "SENDER" ? "COD theo tổng đơn" : "COD dự kiến theo đơn";
          return <tr key={order.apiId || order.id}>
            <td><strong>#{order.id}</strong><small>{order.items.slice(0, 2).map((item) => `${item.productName} × ${item.quantity}`).join(", ")}{order.items.length > 2 ? ` +${order.items.length - 2} sản phẩm` : ""}</small></td>
            <td><strong>{order.customer || "Khách lẻ"}</strong><small>{order.phone || "Chưa có số điện thoại"}</small><small className="shipping-address">{order.address || "Chưa có địa chỉ"}</small></td>
            <td><strong>{codAmount ? money(codAmount) : order.paymentStatus === "PAID" ? "Đã thanh toán" : money(order.total)}</strong><small>{order.payment.includes("COD") && order.paymentStatus !== "PAID" ? codLabel : order.payment}</small></td>
            <td><span className={`shipping-stage-badge stage-${stage.toLocaleLowerCase("en")}`}>{stageName[stage]}</span><small>{order.trackingCode ? `Viettel Post · ${order.trackingCode}` : order.carrierShipmentError ? order.carrierShipmentError : order.status}</small>{order.carrierLocation && <small>{order.carrierLocation}</small>}</td>
            <td>{order.date}<small>{order.time}</small></td>
            <td><button className="button button-quiet shipping-open-button" type="button" onClick={() => onOpenOrder(order.id)}>{stage === "READY" ? "Đóng gói / tạo vận đơn" : "Mở chi tiết đơn"} →</button></td>
          </tr>;
        }) : <tr><td className="shipping-empty" colSpan={6}>{search ? "Không tìm thấy đơn phù hợp." : "Chưa có đơn trong bước này."}</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}
