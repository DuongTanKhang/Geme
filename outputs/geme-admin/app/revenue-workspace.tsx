"use client";

import type { DashboardReport } from "./dashboard-workspace";

type Props = { report: DashboardReport | null; loading: boolean };
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const empty = <div className="revenue-empty-state">Chưa có dữ liệu doanh thu trong khoảng thời gian này.</div>;
const paymentName: Record<string, string> = { COD: "COD / tiền mặt", BANK_TRANSFER: "Chuyển khoản", MOMO: "MoMo", CREDIT_CARD: "Thẻ ngân hàng", OTHER: "Khác" };

export default function RevenueWorkspace({ report, loading }: Props) {
  const timeline = report?.timeline || [];
  const maxRevenue = Math.max(...timeline.map((point) => Number(point.revenue) || 0), 1);
  const stats = [
    ["Tổng doanh thu", money(report?.revenue || 0)],
    ["Tổng đơn hàng", new Intl.NumberFormat("vi-VN").format(report?.orderCount || 0)],
    ["Khách hàng mới", new Intl.NumberFormat("vi-VN").format(report?.newCustomers || 0)],
    ["Giá trị đơn hàng TB", money(report?.averageOrderValue || 0)],
    ["Sản phẩm bán ra", new Intl.NumberFormat("vi-VN").format(report?.productsSold || 0)],
  ];
  return <div className="revenue-workspace">
    <div className="revenue-heading"><div><h1>Báo cáo theo doanh thu</h1><p>Dữ liệu lấy từ đơn hàng, sản phẩm và thanh toán GEME; không tính đơn đã hủy.</p></div></div>
    <section className="revenue-kpis" aria-label="Chỉ số doanh thu">{stats.map(([label, value]) => <article key={label}><span className="revenue-kpi-icon">₫</span><div><small>{label}</small><strong>{loading ? "Đang tải…" : value}</strong></div></article>)}</section>
    <div className="revenue-primary-grid">
      <section className="revenue-panel revenue-chart-panel" id="revenue-timeline"><div className="revenue-panel-heading"><h2>Doanh thu theo thời gian</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : timeline.length ? <div className="report-data-bars revenue-data-bars" role="img" aria-label="Doanh thu theo từng ngày">{timeline.slice(-14).map((point) => <div className="report-data-bar" key={point.date} title={`${point.date}: ${money(point.revenue)}`}><span style={{ height: `${Math.max(5, (Number(point.revenue) / maxRevenue) * 100)}%` }}/><small>{new Date(`${point.date}T00:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</small></div>)}</div> : empty}</section>
      <section className="revenue-panel revenue-category-panel" id="revenue-categories"><div className="revenue-panel-heading"><h2>Doanh thu theo danh mục</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : report?.categories.length ? <div className="report-ranking-list">{report.categories.map((row) => <div key={row.name}><span>{row.name}</span><strong>{money(row.revenue)}</strong><i><b style={{ width: `${Math.max(2, row.revenue / Math.max(1, ...report.categories.map((item) => item.revenue)) * 100)}%` }}/></i></div>)}</div> : empty}</section>
    </div>
    <div className="revenue-lower-grid">
      <section className="revenue-panel revenue-products-panel" id="revenue-products"><div className="revenue-panel-heading"><h2>Doanh thu theo sản phẩm</h2></div><div className="revenue-table-wrap"><table><thead><tr><th>#</th><th>Sản phẩm</th><th>Đã bán</th><th>Doanh thu</th></tr></thead><tbody>{loading ? <tr><td colSpan={4}>Đang tải báo cáo…</td></tr> : report?.products.length ? report.products.map((product, index) => <tr key={`${product.sku}-${index}`}><td>{index + 1}</td><td>{product.product}<small className="report-subtext">{product.sku}</small></td><td>{product.sold}</td><td>{money(product.revenue)}</td></tr>) : <tr><td colSpan={4}>{empty}</td></tr>}</tbody></table></div></section>
      <div className="revenue-middle-column">
        <section className="revenue-panel revenue-channels-panel"><div className="revenue-panel-heading"><h2>Doanh thu theo kênh bán hàng</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : report?.salesChannels.length ? <div className="report-ranking-list">{report.salesChannels.map((row) => <div key={row.channel}><span>{row.channel}<small className="report-subtext">{row.orders} đơn</small></span><strong>{money(row.revenue)}</strong></div>)}</div> : empty}</section>
        <section className="revenue-panel revenue-orders-panel" id="revenue-orders"><div className="revenue-panel-heading"><h2>Đơn hàng doanh thu cao</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : report?.topOrders.length ? <div className="report-ranking-list">{report.topOrders.map((order) => <div key={order.code}><span>{order.code}<small className="report-subtext">{order.customer || "Khách lẻ"}</small></span><strong>{money(order.total)}</strong></div>)}</div> : empty}</section>
      </div>
      <div className="revenue-right-column">
        <section className="revenue-panel revenue-payment-panel"><div className="revenue-panel-heading"><h2>Doanh thu theo phương thức thanh toán</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : report?.payments.length ? <div className="report-ranking-list">{report.payments.map((payment) => <div key={payment.method}><span>{paymentName[payment.method] || payment.method}</span><strong>{money(payment.amount)}</strong></div>)}</div> : empty}</section>
        <section className="revenue-panel revenue-insights-panel"><div className="revenue-insights-title"><h2>Nhận xét &amp; đề xuất</h2></div>{loading ? <div className="revenue-empty-state">Đang tải báo cáo…</div> : report?.orderCount ? <ul className="revenue-insights-list"><li>Giá trị đơn hàng trung bình: <strong>{money(report.averageOrderValue)}</strong>.</li>{report.categories[0] && <li>Danh mục tạo doanh thu cao nhất: <strong>{report.categories[0].name}</strong>.</li>}{report.products[0] && <li>Sản phẩm dẫn đầu doanh thu: <strong>{report.products[0].product}</strong>.</li>}</ul> : empty}</section>
      </div>
    </div>
  </div>;
}
