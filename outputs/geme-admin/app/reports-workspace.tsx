"use client";

import type { DashboardReport } from "./dashboard-workspace";

type Props = { report: DashboardReport | null; loading: boolean };
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const empty = <div className="report-empty-state">Chưa có dữ liệu trong khoảng thời gian này.</div>;
const methodName: Record<string, string> = { COD: "COD / tiền mặt", BANK_TRANSFER: "Chuyển khoản", MOMO: "MoMo", CREDIT_CARD: "Thẻ ngân hàng", OTHER: "Khác" };

export default function ReportsWorkspace({ report, loading }: Props) {
  const stats = [
    ["wallet", "Tiền thu thuần", money(report?.revenue || 0), "green"],
    ["bag", "Tổng đơn hàng", new Intl.NumberFormat("vi-VN").format(report?.orderCount || 0), "mint"],
    ["person", "Khách hàng mới", new Intl.NumberFormat("vi-VN").format(report?.newCustomers || 0), "purple"],
    ["cube", "Sản phẩm bán ra", new Intl.NumberFormat("vi-VN").format(report?.productsSold || 0), "blue"],
  ];
  const timeline = report?.timeline || [];
  const maxRevenue = Math.max(...timeline.map((row) => Number(row.revenue) || 0), 1);
  return <div className="reports-workspace">
    <div className="reports-heading"><div><h1>Báo cáo tổng quan</h1><p>Tiền thu thuần = khoản đã thu trừ tiền hoàn trong kỳ. Đơn chờ thanh toán không được tính là doanh thu thu tiền.</p></div></div>
    <section className="report-stats" aria-label="Chỉ số kinh doanh">{stats.map(([icon, label, value, tone]) => <article key={label}><span className={`report-stat-icon ${tone}`} aria-hidden="true">{icon === "wallet" ? "₫" : icon === "bag" ? "▢" : icon === "person" ? "♙" : "◇"}</span><div><small>{label}</small><strong>{loading ? "Đang tải…" : value}</strong></div></article>)}</section>
    <section className="report-money-breakdown" aria-label="Định nghĩa số liệu tiền">
      <article><span>Tổng giá trị đơn hợp lệ</span><strong>{loading ? "…" : money(report?.grossOrderValue || 0)}</strong><small>Tổng đơn sau giảm giá và phí giao hàng, theo ngày đặt; không gồm đơn hủy.</small></article>
      <article><span>Tiền đã thu</span><strong>{loading ? "…" : money(report?.capturedPayments || 0)}</strong><small>Giao dịch có thời điểm thu và trạng thái đã thu trong kỳ.</small></article>
      <article><span>Tiền đã hoàn</span><strong>{loading ? "…" : money(report?.refundAmount || 0)}</strong><small>Ghi nhận theo ngày lập bút toán hoàn, gồm hoàn một phần/toàn bộ.</small></article>
      <article><span>Giá trị hàng trả</span><strong>{loading ? "…" : money(report?.returnedGoodsValue || 0)}</strong><small>Giá trị dòng hàng đã nhận, phân bổ theo số lượng mua; theo ngày nhận hàng.</small></article>
      <article><span>COD chưa có bảng kê</span><strong>{loading ? "…" : money(report?.codUnreconciled || 0)}</strong><small>COD của đơn đã giao nhưng chưa có bảng kê đang hiệu lực; chưa xác nhận đã thu.</small></article>
      <article><span>Hãng còn phải chuyển</span><strong>{loading ? "…" : money(report?.codRemittanceOutstanding || 0)}</strong><small>Chênh lệch chuyển tiền có đủ số thực chuyển; phiếu cũ chưa ghi số này: {report?.codUnverifiedRemittanceLines || 0} dòng chưa xác minh.</small></article>
    </section>
    <div className="report-primary-grid">
      <section className="report-panel report-chart-panel" id="report-revenue"><div className="report-panel-heading"><h2>Doanh thu theo thời gian</h2></div>{loading ? <div className="report-empty-state">Đang tải báo cáo…</div> : timeline.length ? <div className="report-data-bars" role="img" aria-label="Doanh thu theo từng ngày">{timeline.slice(-14).map((row) => <div className="report-data-bar" key={row.date} title={`${row.date}: ${money(row.revenue)}`}><span style={{ height: `${Math.max(5, (Number(row.revenue) / maxRevenue) * 100)}%` }}/><small>{new Date(`${row.date}T00:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</small></div>)}</div> : empty}</section>
      <section className="report-panel report-category-panel"><div className="report-panel-heading"><h2>Giá trị hàng theo danh mục</h2></div>{loading ? <div className="report-empty-state">Đang tải báo cáo…</div> : report?.categories.length ? <div className="report-ranking-list">{report.categories.map((row) => <div key={row.name}><span>{row.name}</span><strong>{money(row.revenue)}</strong><i><b style={{ width: `${Math.max(2, row.revenue / Math.max(1, ...report.categories.map((item) => item.revenue)) * 100)}%` }}/></i></div>)}</div> : empty}</section>
    </div>
    <div className="report-lower-grid">
      <section className="report-panel report-sales-table" id="report-products"><div className="report-panel-heading"><h2>Giá trị hàng theo sản phẩm</h2></div><div className="report-table-scroll"><table><thead><tr><th>#</th><th>Sản phẩm</th><th>Đã bán</th><th>Doanh thu</th></tr></thead><tbody>{loading ? <tr><td colSpan={4}>Đang tải báo cáo…</td></tr> : report?.products.length ? report.products.map((product, index) => <tr key={`${product.sku}-${index}`}><td>{index + 1}</td><td>{product.product}<small className="report-subtext">{product.sku}</small></td><td>{product.sold}</td><td>{money(product.revenue)}</td></tr>) : <tr><td colSpan={4}>{empty}</td></tr>}</tbody></table></div></section>
      <div className="report-center-column">
        <section className="report-panel report-source-panel" id="report-customers"><div className="report-panel-heading"><h2>Nguồn khách hàng</h2></div><div className="report-empty-state">Hệ thống chưa lưu nguồn khách hàng để thống kê chính xác.</div></section>
        <section className="report-panel report-promo-panel" id="report-promotions"><div className="report-panel-heading"><h2>Hiệu quả khuyến mãi</h2></div>{loading ? <div className="report-empty-state">Đang tải báo cáo…</div> : report?.promotionPerformance.length ? <div className="report-ranking-list">{report.promotionPerformance.slice(0, 5).map((promo) => <div key={`${promo.code}-${promo.name}`}><span>{promo.name}<small className="report-subtext">{promo.code || "Khuyến mãi tự động"} · {promo.orders} đơn</small></span><strong>−{money(promo.discount)}</strong></div>)}</div> : empty}</section>
      </div>
      <section className="report-panel report-best-panel" id="report-best-sellers"><div className="report-panel-heading"><h2>Sản phẩm bán chạy</h2></div>{loading ? <div className="report-empty-state">Đang tải báo cáo…</div> : report?.products.length ? <div className="report-best-list">{report.products.slice(0, 5).map((product, index) => <article key={`${product.sku}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{product.image ? <img src={product.image} alt="" loading="lazy"/> : <span className="report-product-placeholder" aria-hidden="true">◇</span>}<div><strong>{product.product}</strong><small>{product.category} · {product.sold} sản phẩm</small></div><b>{money(product.revenue)}</b></article>)}</div> : empty}</section>
    </div>
    <section className="report-panel report-payment-summary"><div className="report-panel-heading"><h2>Doanh thu theo phương thức thanh toán</h2></div>{loading ? <div className="report-empty-state">Đang tải báo cáo…</div> : report?.payments.length ? <div className="report-payment-list">{report.payments.map((payment) => <div key={payment.method}><span>{methodName[payment.method] || payment.method}</span><strong>{money(payment.amount)}</strong></div>)}</div> : empty}</section>
  </div>;
}
