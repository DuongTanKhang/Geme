"use client";

import { useMemo, useState } from "react";

type Purchase = { id: string; date: string; product: string; image?: string; price: number; status: string };
export type CustomerRecord = {
  id: string; name: string; email: string; phone: string; orders: number; total: number;
  status: string; segment: string; joined: string; address: string; note: string; reviews: number;
  avatar?: string; history: Purchase[]; [key: string]: unknown;
};
type Props = { customers: Record<string, any>[]; onAdd: () => void; onNotify: (message: string) => void };
const formatMoney = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value || 0)} ₫`;

function Avatar({ customer, large = false }: { customer: CustomerRecord; large?: boolean }) {
  const initials = customer.avatar || customer.name.split(" ").map((part) => part[0]).slice(-2).join("");
  return <span className={`customer-avatar ${large ? "large" : ""} avatar-${customer.id.slice(-1)}`} aria-hidden="true">{initials}</span>;
}
function Segment({ value }: { value: string }) {
  const variant = value === "VIP" ? "vip" : value === "Khách quen" || value === "Thành viên" ? "regular" : "new";
  return <span className={`customer-segment ${variant}`}>{value === "Thành viên" ? "Khách quen" : value === "Mới" ? "Khách mới" : value}</span>;
}

export default function CustomersWorkspace({ customers, onAdd, onNotify }: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("Tất cả nhóm khách hàng");
  const [status, setStatus] = useState("Tất cả trạng thái");
  const [page, setPage] = useState(1);
  const allCustomers = useMemo(() => customers.map((customer, index) => ({
    ...customer,
    id: String(customer.id || `KH-${index + 1}`),
    name: String(customer.name || ""),
    email: String(customer.email || ""),
    phone: String(customer.phone || ""),
    orders: Number(customer.orders) || 0,
    total: Number(customer.total) || 0,
    status: customer.status === "Inactive" || customer.status === "Không hoạt động" ? "Inactive" : "Active",
    segment: String(customer.segment || "Khách mới"),
    joined: String(customer.joined || ""),
    address: String(customer.address || ""),
    note: String(customer.note || ""),
    reviews: Number(customer.reviews) || 0,
    history: Array.isArray(customer.history) ? customer.history : [],
  } as CustomerRecord)), [customers]);
  const filtered = useMemo(() => allCustomers.filter((customer) => {
    const q = search.trim().toLocaleLowerCase("vi");
    const matchesSearch = !q || `${customer.id} ${customer.name} ${customer.phone} ${customer.email}`.toLocaleLowerCase("vi").includes(q);
    return matchesSearch && (segment === "Tất cả nhóm khách hàng" || customer.segment === segment) && (status === "Tất cả trạng thái" || customer.status === status);
  }), [allCustomers, search, segment, status]);
  const selected = filtered.find((customer) => customer.id === selectedId);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const pageRows = filtered.slice((page - 1) * 10, page * 10);
  const stats = [
    { label: "Tổng khách hàng", value: allCustomers.length, tone: "mint" },
    { label: "Khách hàng mới", value: allCustomers.filter((item) => item.segment === "Khách mới" || item.segment === "Mới").length, tone: "blue" },
    { label: "Khách hàng quay lại", value: allCustomers.filter((item) => item.orders > 1).length, tone: "amber" },
    { label: "Không hoạt động", value: allCustomers.filter((item) => item.status === "Inactive").length, tone: "lilac" },
  ];

  return <div className="customers-workspace">
    <main className="customers-main">
      <div className="customers-heading"><div><h1>Khách hàng</h1><p>Quản lý danh sách khách hàng và lịch sử mua hàng.</p></div></div>
      <section className="customer-stats" aria-label="Thống kê khách hàng">
        {stats.map((item) => <article className="customer-stat" key={item.label}><span className={`customer-stat-icon ${item.tone}`}>♙</span><div><small>{item.label}</small><strong>{item.value.toLocaleString("vi-VN")}</strong></div></article>)}
      </section>
      <section className="customer-list-panel">
        <div className="customer-toolbar">
          <label className="customer-search"><span>⌕</span><input aria-label="Tìm kiếm khách hàng" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm kiếm tên, số điện thoại, email..."/></label>
          <select aria-label="Nhóm khách hàng" value={segment} onChange={(event) => { setSegment(event.target.value); setPage(1); }}><option>Tất cả nhóm khách hàng</option><option>Khách mới</option><option>Khách quen</option><option>VIP</option></select>
          <select aria-label="Trạng thái khách hàng" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option>Tất cả trạng thái</option><option>Active</option><option>Inactive</option></select>
          <button className="button button-primary customer-add-button" onClick={onAdd}><span>＋</span>Thêm khách hàng</button>
        </div>
        <div className="customer-table-scroll"><table className="customer-table"><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả khách hàng"/></th><th>Khách hàng</th><th>Số điện thoại</th><th>Email</th><th>Tổng đơn hàng</th><th>Tổng chi tiêu</th><th>Trạng thái</th><th>Ngày đăng ký</th><th>Thao tác</th></tr></thead><tbody>
          {pageRows.length ? pageRows.map((customer) => <tr key={customer.id} className={selected?.id === customer.id ? "selected" : ""} onClick={() => setSelectedId(customer.id)}>
            <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${customer.name}`}/></td>
            <td><div className="customer-table-person"><Avatar customer={customer}/><span><strong>{customer.name || "Chưa có tên"}</strong><Segment value={customer.segment}/></span></div></td>
            <td>{customer.phone || "—"}</td><td className="customer-email-cell">{customer.email || "—"}</td><td>{customer.orders}</td><td className="customer-spend-cell">{formatMoney(customer.total)}</td>
            <td><span className={`customer-state ${customer.status === "Active" ? "active" : "inactive"}`}>{customer.status}</span></td><td className="customer-date-cell">{customer.joined || "—"}</td>
            <td onClick={(event) => event.stopPropagation()}><button className="customer-row-more" aria-label={`Tùy chọn ${customer.name}`} onClick={() => onNotify(`Thao tác khách hàng ${customer.name}.`)}>•••</button></td>
          </tr>) : <tr><td colSpan={9} className="customer-empty">{allCustomers.length ? "Không tìm thấy khách hàng phù hợp." : "Chưa có khách hàng."}</td></tr>}
        </tbody></table></div>
        <div className="customer-pagination"><span>Hiển thị {filtered.length ? (page - 1) * 10 + 1 : 0} - {Math.min(page * 10, filtered.length)} / {filtered.length} khách hàng</span><div><button aria-label="Trang trước" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={page === number ? "current" : ""} onClick={() => setPage(number)}>{number}</button>)}<button aria-label="Trang sau" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></div>
      </section>
    </main>
    <aside className="customer-detail-panel">
      {selected ? <>
        <div className="customer-detail-heading"><h2>Thông tin khách hàng</h2><button aria-label="Đóng chi tiết khách hàng" onClick={() => setSelectedId("")}>×</button></div>
        <section className="customer-profile"><Avatar customer={selected} large/><div className="customer-profile-copy"><div className="customer-profile-title"><strong>{selected.name}</strong><Segment value={selected.segment}/></div><p><span>⌕</span>{selected.phone || "Chưa có số điện thoại"}</p><p><span>✉</span>{selected.email || "Chưa có email"}</p><p><span>▦</span>{selected.joined || "Chưa có ngày đăng ký"}</p></div></section>
        <div className="customer-detail-metrics"><div><strong>{selected.orders}</strong><span>Tổng đơn hàng</span></div><div><strong>{formatMoney(selected.total)}</strong><span>Tổng chi tiêu</span></div><div><strong>{selected.reviews}</strong><span>Đánh giá</span></div></div>
        <section className="customer-detail-section customer-address-section"><div className="customer-section-heading"><h3><span>⌖</span> Địa chỉ giao hàng</h3></div><p>{selected.address || "Chưa có địa chỉ giao hàng."}</p></section>
        <section className="customer-detail-section customer-history-section"><div className="customer-section-heading"><h3><span>▣</span> Lịch sử mua hàng</h3></div>{selected.history.length ? selected.history.slice(0, 3).map((purchase) => <article className="customer-purchase" key={purchase.id}>{purchase.image ? <img src={purchase.image} alt=""/> : <span className="product-thumb">◇</span>}<div className="customer-purchase-name"><strong>{purchase.id} · {purchase.product}</strong><Segment value={purchase.status}/></div><time>{purchase.date}</time><b>{formatMoney(purchase.price)}</b></article>) : <p className="customer-no-history">Chưa có lịch sử mua hàng.</p>}</section>
        <section className="customer-detail-section customer-note-section"><div className="customer-section-heading"><h3><span>☑</span> Ghi chú</h3></div><p>{selected.note || "Chưa có ghi chú."}</p></section>
        <div className="customer-detail-actions"><button className="button button-quiet" onClick={() => onNotify("Tính năng nhắn tin sẽ hoạt động khi kết nối backend.")}><span>☏</span>Gửi tin nhắn</button><button className="button button-primary" onClick={() => onNotify("Tạo đơn hàng sẽ hoạt động khi kết nối backend.")}><span>▣</span>Tạo đơn hàng</button></div>
      </> : <div className="customer-detail-empty"><strong>{allCustomers.length ? "Chọn khách hàng" : "Chưa có dữ liệu khách hàng"}</strong><span>{allCustomers.length ? "Chọn một dòng trong danh sách để xem thông tin chi tiết." : "Thông tin sẽ xuất hiện tại đây sau khi có khách hàng."}</span></div>}
    </aside>
  </div>;
}
