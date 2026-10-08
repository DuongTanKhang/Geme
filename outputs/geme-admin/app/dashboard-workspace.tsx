"use client";

import type { AdminProduct } from "./products-workspace";

type DashboardOrder = {
  id: string;
  customer: string;
  product: string;
  total: number;
  status: string;
  date: string;
  time: string;
};

export type DashboardReport = {
  revenue: number;
  orderCount: number;
  customerCount: number;
  newCustomers: number;
  productsSold: number;
  averageOrderValue: number;
  timeline: Array<{ date: string; revenue: number; orders: number }>;
  categories: Array<{ name: string; revenue: number }>;
  products: Array<{ product: string; sku: string; image: string; sold: number; revenue: number; category: string }>;
  payments: Array<{ method: string; amount: number }>;
  salesChannels: Array<{ channel: string; revenue: number; orders: number }>;
  promotionPerformance: Array<{ name: string; code: string; orders: number; discount: number }>;
  topOrders: Array<{ code: string; customer: string; total: number; placedAt: string }>;
};

type Props = {
  products: AdminProduct[];
  orders: DashboardOrder[];
  promotions: Record<string, any>[];
  posts: Record<string, any>[];
  customerCount: number;
  report: DashboardReport | null;
  reportLoading: boolean;
  onOpen: (view: "products" | "orders" | "promotions" | "posts") => void;
  onSelectOrder: (id: string) => void;
};

const money = (value: number | string) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
};

function Status({ value }: { value: string }) {
  const tone = /Đã xuất bản|Đang hoạt động|Đang diễn ra|Hoạt động|Còn hàng/i.test(value)
    ? "green"
    : /Bản nháp|Đã lên lịch|Tạm ẩn|Sắp diễn ra|Sắp hết/i.test(value)
      ? "amber"
      : /Đã gỡ bài|Đã kết thúc|Hết hàng|Tạm dừng/i.test(value)
        ? "red"
        : "blue";
  return <span className={`status-pill ${tone}`}>{value || "—"}</span>;
}

function ImageThumb({ src, alt }: { src?: string; alt: string }) {
  return <span className="dashboard-thumb"><span aria-hidden="true">◇</span>{src && <img src={src} alt={alt} loading="lazy" onError={(event) => event.currentTarget.remove()} />}</span>;
}

export default function DashboardWorkspace({ products, orders, promotions, posts, customerCount, report, reportLoading, onOpen, onSelectOrder }: Props) {
  const recentProducts = products.slice(0, 5);
  const recentOrders = orders.slice(0, 5);
  const recentPromotions = promotions.slice(0, 5);
  const recentPosts = posts.slice(0, 5);
  const timeline = report?.timeline || [];
  const chartWidth = 640;
  const chartHeight = 180;
  const chartPadding = 12;
  const maxRevenue = Math.max(...timeline.map((point) => Number(point.revenue) || 0), 1);
  const chartPoints = timeline.map((point, index) => ({
    x: chartPadding + (timeline.length <= 1 ? 0 : index * (chartWidth - chartPadding * 2) / (timeline.length - 1)),
    y: chartHeight - chartPadding - (Number(point.revenue) || 0) / maxRevenue * (chartHeight - chartPadding * 2),
  }));
  const chartLine = chartPoints.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const chartArea = chartPoints.length ? `${chartLine} L${chartPoints[chartPoints.length - 1].x},${chartHeight - chartPadding} L${chartPoints[0].x},${chartHeight - chartPadding} Z` : "";

  return <>
    <section className="kpi-grid">
      {[
        { label: "Đơn hàng · 30 ngày", value: report ? report.orderCount : "—", icon: "cart", tone: "green" },
        { label: "Doanh thu · 30 ngày", value: report ? money(report.revenue) : "—", icon: "coins", tone: "amber" },
        { label: "Khách hàng", value: customerCount, icon: "person", tone: "purple" },
        { label: "Sản phẩm", value: products.length, icon: "cube", tone: "blue" },
      ].map((card) => <article className="kpi-card" key={card.label}>
        <span className={`kpi-icon ${card.tone}`}><span aria-hidden="true">{card.icon === "cart" ? "▣" : card.icon === "coins" ? "◉" : card.icon === "person" ? "♙" : "◇"}</span></span>
        <div className="kpi-copy"><span className="kpi-label">{card.label}</span><strong className="kpi-value">{card.value}</strong></div>
      </article>)}
    </section>

    <section className="dashboard-middle">
      <article className="panel dashboard-activity-panel">
        <div className="panel-heading"><div><h2>Hoạt động kinh doanh</h2><small>Doanh thu theo ngày · 30 ngày gần nhất</small></div></div>
        {reportLoading ? <div className="dashboard-empty">Đang tải báo cáo…</div> : timeline.length ? <>
          <div className="dashboard-report-summary"><span>Đã bán <strong>{report?.productsSold ?? 0}</strong> sản phẩm</span><span>Giá trị đơn trung bình <strong>{money(report?.averageOrderValue ?? 0)}</strong></span></div>
          <div className="chart-wrap dashboard-chart-wrap">
            <svg className="chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Biểu đồ doanh thu theo ngày trong 30 ngày gần nhất">
              <defs><linearGradient id="dashboardChartWash" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#84b39b" stopOpacity=".28"/><stop offset="100%" stopColor="#84b39b" stopOpacity=".02"/></linearGradient></defs>
              <g className="chart-grid"><line x1="0" y1="24" x2={chartWidth} y2="24"/><line x1="0" y1="88" x2={chartWidth} y2="88"/><line x1="0" y1="152" x2={chartWidth} y2="152"/></g>
              {chartArea && <path d={chartArea} fill="url(#dashboardChartWash)"/>}
              {chartLine && <path d={chartLine} className="chart-line"/>}
              {chartPoints.map((point, index) => <circle key={`${timeline[index].date}-${index}`} className="chart-dot" cx={point.x} cy={point.y} r="4"/>)}
            </svg>
          </div>
          <div className="dashboard-chart-dates"><span>{dateLabel(timeline[0].date)}</span><span>{dateLabel(timeline[timeline.length - 1].date)}</span></div>
        </> : <div className="dashboard-empty">Chưa có đơn hàng trong 30 ngày gần nhất.</div>}
      </article>

      <article className="panel dashboard-orders-panel">
        <div className="panel-heading"><h2>Đơn hàng gần đây</h2><button className="panel-link" onClick={() => onOpen("orders")}>Mở đơn hàng →</button></div>
        <div className="page-table-wrap"><table className="orders-table dashboard-orders-table"><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng tiền</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody>
          {recentOrders.length ? recentOrders.map((order) => <tr key={order.id} className="dashboard-order-clickable" tabIndex={0} aria-label={`Xem hóa đơn ${order.id}`} onClick={() => onSelectOrder(order.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectOrder(order.id); } }}><td className="order-id">{order.id}</td><td>{order.customer || "Khách lẻ"}</td><td className="dashboard-order-product">{order.product || "—"}</td><td className="amount">{money(order.total)}</td><td><Status value={order.status}/></td><td>{order.date} {order.time}</td></tr>) : <tr><td className="table-empty" colSpan={6}>Chưa có đơn hàng.</td></tr>}
        </tbody></table></div>
      </article>
    </section>

    <section className="dashboard-bottom">
      <article className="panel mini-panel dashboard-list-panel">
        <div className="panel-heading"><div><h2>Sản phẩm mới cập nhật</h2><small>Hiển thị {recentProducts.length} / {products.length}</small></div><button className="panel-link" onClick={() => onOpen("products")}>Mở danh sách →</button></div>
        <div className="dashboard-list">{recentProducts.length ? recentProducts.map((product) => <div className="dashboard-list-item" key={product.apiId || product.id}>
          <ImageThumb src={product.image} alt={product.name}/><div className="dashboard-list-copy"><strong>{product.name}</strong><small>{product.id} · {product.category || product.productType || "Chưa phân loại"}</small><span className="dashboard-list-meta"><Status value={product.status}/><span>Tồn {product.stock}</span></span></div><div className="dashboard-list-value"><strong>{money(product.price)}</strong></div>
        </div>) : <div className="dashboard-empty">Chưa có sản phẩm.</div>}</div>
      </article>

      <article className="panel mini-panel dashboard-list-panel">
        <div className="panel-heading"><div><h2>Khuyến mãi gần đây</h2><small>Hiển thị {recentPromotions.length} / {promotions.length}</small></div><button className="panel-link" onClick={() => onOpen("promotions")}>Mở danh sách →</button></div>
        <div className="dashboard-list">{recentPromotions.length ? recentPromotions.map((promotion, index) => <div className="dashboard-list-item dashboard-no-image" key={String(promotion.apiId || promotion.id || promotion.code || index)}>
          <span className="dashboard-promotion-mark">%</span><div className="dashboard-list-copy"><strong>{String(promotion.name || "Chương trình khuyến mãi")}</strong><small>{String(promotion.code || "Không có mã")}{promotion.startDate ? ` · ${promotion.startDate}` : ""}</small><span className="dashboard-list-meta"><Status value={String(promotion.status || "")}/><span>{String(promotion.discount || "")}</span></span></div>
        </div>) : <div className="dashboard-empty">Chưa có khuyến mãi.</div>}</div>
      </article>

      <article className="panel mini-panel dashboard-list-panel">
        <div className="panel-heading"><div><h2>Bài viết mới cập nhật</h2><small>Hiển thị {recentPosts.length} / {posts.length}</small></div><button className="panel-link" onClick={() => onOpen("posts")}>Mở danh sách →</button></div>
        <div className="dashboard-list">{recentPosts.length ? recentPosts.map((post, index) => {
          const image = String(post.coverImageUrl || post.images?.[0] || "");
          const date = String(post.date || (post.createdAt ? new Date(post.createdAt).toLocaleDateString("vi-VN") : ""));
          return <div className="dashboard-list-item" key={String(post.apiId || post.id || index)}>
            <ImageThumb src={image} alt={String(post.name || post.title || "Ảnh bìa bài viết")}/><div className="dashboard-list-copy"><strong>{String(post.name || post.title || "Bài viết chưa có tiêu đề")}</strong><small>{String(post.category || "Chưa phân loại")}{date ? ` · ${date}` : ""}</small>{post.summary && <span className="dashboard-post-summary">{String(post.summary)}</span>}<span className="dashboard-list-meta"><Status value={String(post.status || "Bản nháp")}/><span>{String(post.author || "Admin")}</span></span></div>
          </div>;
        }) : <div className="dashboard-empty">Chưa có bài viết.</div>}</div>
      </article>
    </section>
  </>;
}
