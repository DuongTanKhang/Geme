"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderReceiptData } from "./order-receipt-modal";
import VietMapDeliveryMap from "./vietmap-delivery-map";

type ShippingOrder = OrderReceiptData & { product?: string; sku?: string; quantity?: number };
type ShipmentFilter = "READY" | "PICKUP" | "TRANSIT" | "ISSUES" | "DELIVERED" | "CANCELLED" | "ALL";
type DeliveryWard = { key: string; name: string; orderCount: number; paidAmount: number };
type DeliveryDistrict = { key: string; name: string; orderCount: number; paidAmount: number; latitude: number; longitude: number; wards: DeliveryWard[] };
type DeliveryPoint = { code: string; latitude: number; longitude: number; districtKey: string };
type DeliveryMap = {
  generatedAt: string;
  basis: string;
  summary: { eligibleOrders: number; eligiblePaidAmount: number; hcmcOrders: number; hcmcPaidAmount: number; mappedOrders: number; unknownDistrictOrders: number; unknownWardOrders: number; unclassifiedOrders?: number; outsideHcmcOrders: number; outsideHcmcPaidAmount: number; coordinateConfirmedOrders: number };
  districts: DeliveryDistrict[];
  deliveryPoints: DeliveryPoint[];
  deliveryPointsLimited: boolean;
  unclassified: { hcmcOrders: number; hcmcPaidAmount: number; unknownDistrictOrders: number; unknownWardOrders: number; outsideHcmcOrders: number; outsideHcmcPaidAmount: number };
};
type ApiRequest = (path: string, method?: string, body?: unknown, extraHeaders?: Record<string, string>) => Promise<any>;
type Props = { orders: ShippingOrder[]; onOpenOrder: (id: string) => void; request: ApiRequest };

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const isStoreSale = (order: ShippingOrder) => order.shipping === "Bán trực tiếp tại cửa hàng";

function shipmentStage(order: ShippingOrder): Exclude<ShipmentFilter, "ALL"> | "OTHER" {
  const carrierStatus = String(order.carrierShipmentStatus || "").toUpperCase();
  const carrierName = String(order.carrierStatusName || "").toLocaleLowerCase("vi");
  if (order.status === "Đã hủy") return "CANCELLED";
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
  { id: "CANCELLED", label: "Đơn đã hủy" },
];

export default function ShippingWorkspace({ orders, onOpenOrder, request }: Props) {
  const [filter, setFilter] = useState<ShipmentFilter>("ALL");
  const [search, setSearch] = useState("");
  const [deliveryMap, setDeliveryMap] = useState<DeliveryMap | null>(null);
  const [deliveryMapLoading, setDeliveryMapLoading] = useState(true);
  const [deliveryMapError, setDeliveryMapError] = useState("");
  const [selectedDistrictKey, setSelectedDistrictKey] = useState("");
  const loadDeliveryMap = useCallback(async () => {
    setDeliveryMapLoading(true);
    setDeliveryMapError("");
    try {
      const result = await request("shipping/delivery-map") as DeliveryMap;
      setDeliveryMap(result);
      setSelectedDistrictKey((current) => result.districts.some((district) => district.key === current) ? current : result.districts.find((district) => district.orderCount > 0)?.key || result.districts[0]?.key || "");
    } catch (error) {
      setDeliveryMapError(error instanceof Error ? error.message : "Không tải được dữ liệu bản đồ giao hàng.");
    } finally {
      setDeliveryMapLoading(false);
    }
  }, [request]);
  useEffect(() => { void loadDeliveryMap(); }, [loadDeliveryMap]);
  const selectedDistrict = deliveryMap?.districts.find((district) => district.key === selectedDistrictKey) || null;
  const leadingWardCount = selectedDistrict?.wards[0]?.orderCount || 0;
  const leadingWards = selectedDistrict && leadingWardCount > 0
    ? selectedDistrict.wards.filter((ward) => ward.orderCount === leadingWardCount)
    : [];
  const shippableOrders = useMemo(() => orders.filter((order) => !isStoreSale(order)), [orders]);
  const counts = useMemo(() => {
    const values = shippableOrders.map((order) => shipmentStage(order));
    return {
      READY: values.filter((value) => value === "READY").length,
      PICKUP: values.filter((value) => value === "PICKUP").length,
      TRANSIT: values.filter((value) => value === "TRANSIT").length,
      ISSUES: values.filter((value) => value === "ISSUES").length,
      DELIVERED: values.filter((value) => value === "DELIVERED").length,
      CANCELLED: values.filter((value) => value === "CANCELLED").length,
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
    <section className="shipping-delivery-map-panel" aria-label="Bản đồ khu vực giao hàng">
      <header className="shipping-delivery-map-heading">
        <div><span className="eyebrow">PHÂN BỐ ĐƠN GIAO</span><h3>Đơn giao theo tỉnh/thành, quận/huyện</h3><p>{deliveryMap?.basis || "Tổng hợp đơn có tọa độ giao hàng đã xác nhận, trừ đơn mua tại cửa hàng và đơn đã hủy."}</p></div>
        <button type="button" className="button button-quiet" onClick={() => void loadDeliveryMap()} disabled={deliveryMapLoading}>{deliveryMapLoading ? "Đang tải…" : "↻ Làm mới"}</button>
      </header>
      {deliveryMapError ? <div className="shipping-map-error" role="alert">{deliveryMapError}</div> : deliveryMapLoading && !deliveryMap ? <div className="shipping-map-loading" role="status">Đang tổng hợp đơn giao có vị trí đã xác nhận…</div> : deliveryMap && <>
        <div className="shipping-map-summary">
          <article><span>Đơn đủ điều kiện</span><strong>{deliveryMap.summary.eligibleOrders.toLocaleString("vi-VN")}</strong><small>Có vị trí giao hàng đã xác nhận</small></article>
          <article><span>Trong TP.HCM</span><strong>{deliveryMap.summary.hcmcOrders.toLocaleString("vi-VN")}</strong><small>{money(deliveryMap.summary.hcmcPaidAmount)} đã thu ròng</small></article>
          <article><span>Xác định được phường</span><strong>{deliveryMap.summary.mappedOrders.toLocaleString("vi-VN")}</strong><small>Quận/huyện và phường đều nhận diện được</small></article>
          <article><span>Chưa rõ khu vực</span><strong>{(deliveryMap.summary.unclassifiedOrders ?? deliveryMap.summary.unknownDistrictOrders + deliveryMap.summary.unknownWardOrders).toLocaleString("vi-VN")}</strong><small>Thiếu quận/huyện hoặc phường/xã trong địa chỉ</small></article>
        </div>
        <div className="shipping-map-content">
          <div className="shipping-map-visual-wrap">
            <div className="shipping-map-legend"><span>Xếp hạng khu vực</span><i/><i/><i/><i/><span>Nhiều đơn hơn · màu đậm hơn</span><small>Chấm nhỏ là đơn giao có tọa độ đã xác nhận</small></div>
            <VietMapDeliveryMap districts={deliveryMap.districts} deliveryPoints={deliveryMap.deliveryPoints} selectedKey={selectedDistrictKey} onSelect={setSelectedDistrictKey}/>
            <small className="shipping-map-footnote">Đang hiển thị {deliveryMap.summary.coordinateConfirmedOrders.toLocaleString("vi-VN")} đơn giao tại các tỉnh/thành trong Việt Nam có tọa độ đã xác nhận. Chấm màu đậm hơn là khu vực có thứ hạng giao hàng cao hơn.</small>
          </div>
          <section className="shipping-ward-detail" aria-live="polite">
            {selectedDistrict ? <>
              <header><div><span className="eyebrow">CHI TIẾT KHU VỰC</span><h4>{selectedDistrict.name}</h4></div><strong>{selectedDistrict.orderCount.toLocaleString("vi-VN")} đơn</strong></header>
              <p className="shipping-ward-total">{money(selectedDistrict.paidAmount)} đã thu ròng</p>
              {leadingWards.length > 0 && <div className="shipping-ward-leader"><span>Phường có nhiều đơn nhất</span><strong>{leadingWards.map((ward) => ward.name).join(", ")}</strong><small>{leadingWardCount.toLocaleString("vi-VN")} đơn có vị trí giao đã xác nhận</small></div>}
              {selectedDistrict.wards.length ? <div className="shipping-ward-list" role="table" aria-label={`Đơn giao theo phường ${selectedDistrict.name}`}>
                <div className="shipping-ward-row shipping-ward-head" role="row"><span role="columnheader">Phường</span><span role="columnheader">Đơn giao</span><span role="columnheader">Đã thu</span></div>
                {selectedDistrict.wards.map((ward) => <div className="shipping-ward-row" role="row" key={ward.key}><strong role="cell">{ward.name}</strong><span role="cell">{ward.orderCount.toLocaleString("vi-VN")}</span><span role="cell">{money(ward.paidAmount)}</span></div>)}
              </div> : <div className="shipping-ward-empty">Chưa có đơn nào trong khu vực này khớp điều kiện lọc.</div>}
            </> : <div className="shipping-ward-empty">Chọn một quận/huyện để xem số đơn theo phường.</div>}
          </section>
        </div>
        {(deliveryMap.summary.unknownDistrictOrders > 0 || deliveryMap.summary.unknownWardOrders > 0) && <footer className="shipping-map-unclassified">Có {deliveryMap.summary.unknownDistrictOrders.toLocaleString("vi-VN")} đơn chưa nhận diện được quận/huyện và {deliveryMap.summary.unknownWardOrders.toLocaleString("vi-VN")} đơn chưa nhận diện được phường/xã từ địa chỉ; các đơn vẫn được đặt trên bản đồ theo tọa độ đã xác nhận.</footer>}
      </>}
    </section>
    <section className="shipping-list-panel">
      <div className="shipping-list-heading"><div><h3>{filters.find((item) => item.id === filter)?.label}</h3><span>{rows.length} đơn</span></div><label className="shipping-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã đơn, khách, số điện thoại, mã vận đơn" aria-label="Tìm đơn giao hàng"/></label></div>
      <div className="shipping-filter-tabs" role="tablist" aria-label="Lọc đơn giao hàng">{filters.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}</div>
      <div className="shipping-table-wrap"><table className="shipping-table"><thead><tr><th>Đơn hàng</th><th>Người nhận</th><th>Thu hộ / thanh toán</th><th>Đơn vị và hành trình</th><th>Ngày đặt</th><th></th></tr></thead><tbody>
        {rows.length ? rows.map((order) => {
          const stage = shipmentStage(order);
          const stageName: Record<string, string> = { READY: "Chờ đóng gói / tạo vận đơn", PICKUP: "Chờ Viettel Post lấy hàng", TRANSIT: "Đang vận chuyển", DELIVERED: "Giao thành công", CANCELLED: "Đơn hàng đã hủy", ISSUES: "Cần xử lý với hãng", OTHER: order.status === "Đang xử lý" && !order.payment.includes("COD") && order.paymentStatus !== "PAID" ? "Chờ thanh toán" : order.status };
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
