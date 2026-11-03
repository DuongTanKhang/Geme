"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Grain = "day" | "week" | "month" | "quarter" | "year";
type Report = {
  revenue: number; capturedPayments: number; refundAmount: number; returnedGoodsValue: number; grossOrderValue: number;
  orderCount: number; customerCount: number; newCustomers: number; productsSold: number; averageOrderValue: number;
  buyerCounts?: { firstTime: number; returning: number };
  lifetimeCustomerValue?: { buyers: number; averageOrderValue: number; averageOrders: number };
  orderStatuses?: Array<{ status: string; count: number }>;
  timeline?: Array<{ date: string; revenue: number; orders: number }>;
  categories: Array<{ name: string; revenue: number }>;
  products: Array<{ product: string; sku: string; image: string; sold: number; revenue: number; category: string }>;
  payments: Array<{ method: string; amount: number }>;
  salesChannels?: Array<{ channel: string; revenue: number; orders: number }>;
  promotionPerformance: Array<{ name: string; code: string | null; orders: number; discount: number }>;
};
type Profit = { profit: number; cost: number; missingCostLines: number; missingCostRevenue: number; timeline: Array<{ bucket: string; revenue: number; profit: number; soldQuantity: number }> };
type Marketing = { totals: { sessions: number; visitors: number; pageViews: number; signups: number; spend: number; visitorSegments?: { firstTime: number; returning: number }; settledSessions?: number; bouncedSessions?: number; bounceRate?: number | null; cartSessions?: number; cartConvertedSessions?: number; cartAbandonmentRate?: number | null; paidOrders: number; paidRevenue: number; paidVisitors?: number; visitorToPaid?: number }; channels: Array<{ source: string; sessions: number; signups: number; paidOrders: number; paidRevenue: number; spend: number; cpa: number | null; conversionRate: number }>; campaigns: Array<{ source: string; campaign: string; sessions: number; signups: number; paidOrders: number; paidRevenue: number; spend: number; cpa: number | null; conversionRate: number }> };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<unknown> };
type TrendPoint = { key: string; label: string; revenue: number; profit: number; orders: number; units: number };

const emptyProfit: Profit = { profit: 0, cost: 0, missingCostLines: 0, missingCostRevenue: 0, timeline: [] };
const emptyMarketing: Marketing = { totals: { sessions: 0, visitors: 0, pageViews: 0, signups: 0, spend: 0, visitorSegments: { firstTime: 0, returning: 0 }, settledSessions: 0, bouncedSessions: 0, bounceRate: null, cartSessions: 0, cartConvertedSessions: 0, cartAbandonmentRate: null, paidOrders: 0, paidRevenue: 0, paidVisitors: 0, visitorToPaid: 0 }, channels: [], campaigns: [] };
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const number = (value: number) => new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
const todayVN = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDays = (date: string, count: number) => { const [y, m, d] = date.split("-").map(Number); const moved = new Date(Date.UTC(y, m - 1, d + count)); return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(moved.getUTCDate()).padStart(2, "0")}`; };
const addMonths = (date: string, count: number) => { const [y, m] = date.split("-").map(Number); const moved = new Date(Date.UTC(y, m - 1 + count, 1)); return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-01`; };
const vnMidnight = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, -7)); };
function startFor(anchor: string, grain: Grain) {
  if (grain === "week") { const [y, m, d] = anchor.split("-").map(Number); const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return shiftDays(anchor, -((weekday + 6) % 7)); }
  if (grain === "month") return `${anchor.slice(0, 7)}-01`;
  if (grain === "quarter") return `${anchor.slice(0, 4)}-${String(Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  if (grain === "year") return `${anchor.slice(0, 4)}-01-01`;
  return anchor;
}
function shiftPeriod(anchor: string, grain: Grain, direction: number) { return grain === "day" ? shiftDays(anchor, direction) : grain === "week" ? shiftDays(anchor, direction * 7) : addMonths(anchor, direction * (grain === "quarter" ? 3 : grain === "year" ? 12 : 1)); }
function labelFor(key: string, grain: Grain) {
  if (grain === "quarter") { const [y, m] = key.split("-").map(Number); return `Th ${m}/${y}`; }
  if (grain === "year") return key;
  const date = new Date(`${key}T12:00:00Z`);
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...(grain === "month" ? { month: "short" } : { day: "2-digit", month: "2-digit" }) }).format(date);
}
function moneyAxis(value: number) { const abs = Math.abs(value); return abs >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} tr` : abs >= 1_000 ? `${Math.round(value / 1_000)} k` : `${Math.round(value)}`; }
const statusLabel: Record<string, string> = { PENDING_CONFIRMATION: "Chờ xác nhận", PENDING_PAYMENT: "Chờ thanh toán", PROCESSING: "Đang xử lý", SHIPPING: "Đang giao", DELIVERED: "Đã giao", CANCELLED: "Đã hủy", RETURN_REQUESTED: "Yêu cầu trả", RETURNED: "Đã trả" };
const methodLabel: Record<string, string> = { COD: "COD / tiền mặt", BANK_TRANSFER: "Chuyển khoản", MOMO: "MoMo", CREDIT_CARD: "Thẻ", OTHER: "Khác" };

export default function ReportsWorkspace({ request }: Props) {
  const [grain, setGrain] = useState<Grain>("month");
  const [anchor, setAnchor] = useState(todayVN);
  const [report, setReport] = useState<Report | null>(null);
  const [profit, setProfit] = useState<Profit | null>(null);
  const [marketing, setMarketing] = useState<Marketing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const rangeStart = startFor(anchor, grain);
  const rangeNext = grain === "day" ? shiftDays(rangeStart, 1) : grain === "week" ? shiftDays(rangeStart, 7) : addMonths(rangeStart, grain === "quarter" ? 3 : grain === "year" ? 12 : 1);
  const rangeEnd = new Date(vnMidnight(rangeNext).getTime() - 1);
  const rangeStartDate = vnMidnight(rangeStart);
  const rangeLabel = grain === "day"
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "long" }).format(rangeStartDate)
    : grain === "quarter" ? `Quý ${Math.floor((Number(rangeStart.slice(5, 7)) - 1) / 3) + 1}/${rangeStart.slice(0, 4)}`
      : grain === "year" ? rangeStart.slice(0, 4)
        : `${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(rangeStartDate)} – ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(rangeEnd)}`;
  const isCurrentPeriod = startFor(todayVN(), grain) === rangeStart;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const from = vnMidnight(rangeStart).toISOString();
    const endExclusive = vnMidnight(rangeNext).toISOString();
    const to = new Date(new Date(endExclusive).getTime() - 1).toISOString();
    const marketingTo = endExclusive;
    try {
      const [reportData, profitData, marketingData] = await Promise.all([
        request(`reports/overview?${new URLSearchParams({ from, to })}`),
        request(`reports/gross-profit?${new URLSearchParams({ grain: "day", from, to })}`),
        request(`admin/marketing/overview?${new URLSearchParams({ from, to: marketingTo, cohorts: "false" })}`),
      ]);
      setReport(reportData as Report); setProfit(profitData as Profit); setMarketing(marketingData as Marketing);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được dữ liệu phân tích."); }
    finally { setLoading(false); }
  }, [request, rangeStart, rangeNext]);
  useEffect(() => { void load(); }, [load]);

  const chartGrain: Grain = grain === "quarter" || grain === "year" ? grain : "day";
  const trend = useMemo(() => {
    const grouped = new Map<string, TrendPoint>();
    const get = (key: string) => {
      let row = grouped.get(key);
      if (!row) { row = { key, label: labelFor(key, chartGrain), revenue: 0, profit: 0, orders: 0, units: 0 }; grouped.set(key, row); }
      return row;
    };
    for (const row of profit?.timeline || []) {
      const key = chartGrain === "quarter" ? `${row.bucket.slice(0, 4)}-${String(Math.floor((Number(row.bucket.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
        : chartGrain === "year" ? `${row.bucket.slice(0, 4)}-01-01` : row.bucket;
      const bucket = get(key); bucket.revenue += Number(row.revenue) || 0; bucket.profit += Number(row.profit) || 0; bucket.units += Number(row.soldQuantity) || 0;
    }
    for (const row of report?.timeline || []) {
      const key = chartGrain === "quarter" ? `${row.date.slice(0, 4)}-${String(Math.floor((Number(row.date.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
        : chartGrain === "year" ? `${row.date.slice(0, 4)}-01-01` : row.date;
      get(key).orders += Number(row.orders) || 0;
    }
    return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [report, profit, chartGrain]);

  const buyers = report?.buyerCounts || { firstTime: 0, returning: 0 };
  const visitors = marketing?.totals.visitorSegments || { firstTime: 0, returning: 0 };
  const marketingTotals = marketing?.totals || emptyMarketing.totals;
  const identifiedBuyers = buyers.firstTime + buyers.returning;
  const returningBuyerRate = identifiedBuyers ? buyers.returning / identifiedBuyers : null;
  const topSource = marketing?.channels.filter((item) => item.sessions > 0).sort((a, b) => b.sessions - a.sessions)[0];
  const acquisitionCost = buyers.firstTime ? marketingTotals.spend / buyers.firstTime : null;
  const metrics: Array<{ name: string; value: string; explanation: string; state?: "unavailable" }> = [
    { name: "Tỷ lệ chuyển đổi", value: marketingTotals.visitors ? `${((marketingTotals.visitorToPaid || 0) * 100).toFixed(2)}%` : "Chưa đủ dữ liệu", explanation: "Trình duyệt có đơn đã thanh toán ÷ trình duyệt truy cập được ghi nhận." },
    { name: "Giá trị đơn trung bình", value: report?.orderCount ? money(report.averageOrderValue) : "Chưa đủ dữ liệu", explanation: "Giá trị đơn không bị hủy ÷ số đơn trong kỳ." },
    { name: "Giá trị mua tích lũy / khách (proxy lịch sử)", value: report?.lifetimeCustomerValue?.buyers ? money(report.lifetimeCustomerValue.averageOrderValue) : "Chưa đủ dữ liệu", explanation: "Tổng giá trị đơn đang xử lý/đang giao/đã giao trung bình trên khách nhận diện được đến hết kỳ; chưa phải CLV dự báo theo vòng đời." },
    { name: "Chi phí có khách mới (ước tính)", value: acquisitionCost == null ? "Chưa đủ dữ liệu" : money(acquisitionCost), explanation: "Chi phí Marketing đã nhập ÷ khách mua lần đầu có định danh trong kỳ." },
    { name: "Tỷ lệ bỏ giỏ", value: marketingTotals.cartAbandonmentRate == null ? "Chưa đủ dữ liệu" : `${(marketingTotals.cartAbandonmentRate * 100).toFixed(1)}%`, explanation: `${number(marketingTotals.cartSessions || 0)} phiên có thêm giỏ; chỉ ghi nhận từ khi tracking giỏ được bật.` },
    { name: "Tỷ lệ khách mua quay lại", value: returningBuyerRate == null ? "Chưa đủ dữ liệu" : `${(returningBuyerRate * 100).toFixed(1)}%`, explanation: `${number(buyers.returning)} khách có đơn hợp lệ trước kỳ / ${number(identifiedBuyers)} khách mua nhận diện được.` },
    { name: "Phiên chỉ xem một trang (xấp xỉ bounce)", value: marketingTotals.bounceRate == null ? "Chưa đủ dữ liệu" : `${(marketingTotals.bounceRate * 100).toFixed(1)}%`, explanation: `${number(marketingTotals.bouncedSessions || 0)} phiên một pageview / ${number(marketingTotals.settledSessions || 0)} phiên đã chờ đủ 30 phút; tương tác ngoài chuyển trang chưa được đo.` },
    { name: "NPS – mức sẵn lòng giới thiệu", value: "Chưa đo", explanation: "Cần khảo sát khách hàng theo thang điểm NPS; đánh giá sao sản phẩm không thay thế được." , state: "unavailable" },
    { name: "CTR – tỷ lệ nhấp quảng cáo", value: "Chưa đo", explanation: "Cần dữ liệu lượt hiển thị và lượt nhấp từ nền tảng quảng cáo/email." , state: "unavailable" },
    { name: "Nguồn truy cập chính", value: topSource ? topSource.source : "Chưa đủ dữ liệu", explanation: topSource ? `${number(topSource.sessions)} phiên trong kỳ; xem biểu đồ kênh để so sánh.` : "Nguồn truy cập chỉ có sau khi website ghi nhận phiên." },
  ];
  const topRevenue = Math.max(1, ...trend.map((row) => row.revenue));
  const maxOrders = Math.max(1, ...trend.map((row) => row.orders));
  const statuses = report?.orderStatuses || [];
  const statusTotal = statuses.reduce((sum, row) => sum + row.count, 0);
  const topProducts = report?.products.slice(0, showAllProducts ? 20 : 8) || [];
  const ranges: Array<[Grain, string]> = [["day", "Ngày"], ["week", "Tuần"], ["month", "Tháng"], ["quarter", "Quý"], ["year", "Năm"]];

  return <div className="reports-workspace ecommerce-analytics-workspace">
    <div className="reports-heading ecommerce-analytics-heading">
      <div><span className="eyebrow">GEME · PHÂN TÍCH KINH DOANH</span><h1>Báo cáo thương mại điện tử</h1><p>10 metrics vận hành cùng các biểu đồ doanh thu, lợi nhuận, đơn hàng và khách hàng từ dữ liệu thật. Múi giờ Việt Nam · {rangeLabel}.</p></div>
      <div className="ecommerce-analytics-controls"><div className="report-ranges" role="tablist" aria-label="Chọn kỳ thống kê">{ranges.map(([value, label]) => <button type="button" role="tab" aria-selected={grain === value} className={grain === value ? "active" : ""} key={value} onClick={() => setGrain(value)}>{label}</button>)}</div><div className="ecommerce-period-nav"><button type="button" className="button button-quiet" aria-label="Kỳ trước" onClick={() => setAnchor((value) => shiftPeriod(value, grain, -1))}>‹</button><strong>{rangeLabel}</strong><button type="button" className="button button-quiet" aria-label="Kỳ tiếp theo" onClick={() => setAnchor((value) => shiftPeriod(value, grain, 1))} disabled={isCurrentPeriod}>›</button><button type="button" className="button button-quiet" onClick={() => setAnchor(todayVN())}>Hiện tại</button><button type="button" className="button button-quiet" onClick={() => void load()} disabled={loading}>{loading ? "Đang tải…" : "Làm mới"}</button></div></div>
    </div>
    {error && <div className="ecommerce-analytics-error" role="alert">Không tải đủ dữ liệu phân tích: {error}</div>}

    <section className="ecommerce-analytics-kpis" aria-label="Chỉ số chính">
      <article><small>Tiền thu thuần</small><strong>{loading ? "Đang tải…" : money(report?.revenue || 0)}</strong><span>Tiền đã nhận trừ tiền hoàn trong kỳ</span></article>
      <article className="is-profit"><small>Lợi nhuận gộp đã tính được</small><strong>{loading ? "Đang tải…" : money(profit?.profit || 0)}</strong><span>Sau giá vốn nhập kho đã có</span></article>
      <article><small>Đơn hàng</small><strong>{loading ? "Đang tải…" : number(report?.orderCount || 0)}</strong><span>Đơn không ở trạng thái đã hủy</span></article>
      <article><small>Khách mua lần đầu</small><strong>{loading ? "Đang tải…" : number(buyers.firstTime)}</strong><span>Đơn đang xử lý, giao hoặc đã giao</span></article>
      <article><small>Khách quay lại</small><strong>{loading ? "Đang tải…" : number(buyers.returning)}</strong><span>Đã có đơn hợp lệ trước kỳ này</span></article>
      <article><small>Giá trị đơn trung bình</small><strong>{loading ? "Đang tải…" : money(report?.averageOrderValue || 0)}</strong><span>Giá trị đơn không hủy / số đơn không hủy</span></article>
      <article><small>Tiền hoàn</small><strong>{loading ? "Đang tải…" : money(report?.refundAmount || 0)}</strong><span>Khoản hoàn ghi nhận trong kỳ</span></article>
      <article><small>Giá trị hàng khách đã trả</small><strong>{loading ? "Đang tải…" : money(report?.returnedGoodsValue || 0)}</strong><span>Hàng trả đã được nhận vào kho</span></article>
    </section>

    <section className="report-panel ecommerce-analytics-panel ecommerce-metrics-panel" aria-labelledby="ecommerce-metrics-title">
      <div className="report-panel-heading"><div><h2 id="ecommerce-metrics-title">10 chỉ số thương mại điện tử</h2><p>Công thức và trạng thái dữ liệu được ghi rõ để phân biệt số đo thực tế với chỉ số chưa thể đo.</p></div><a href="https://www.mastering-da.com/top-10-metrics-quan-trong-can-theo-doi-trong-thuong-mai-dien-tu" target="_blank" rel="noreferrer">Nguồn tham khảo ↗</a></div>
      <div className="ecommerce-metrics-grid">{metrics.map((metric) => <article key={metric.name} className={metric.state === "unavailable" ? "is-unavailable" : ""}><small>{metric.name}</small><strong>{loading ? "Đang tải…" : metric.value}</strong><span>{metric.explanation}</span></article>)}</div>
      <p className="ecommerce-metrics-note">NPS và CTR đang để “Chưa đo”, không hiển thị số giả. Chi phí có khách mới là ước tính vì chi phí Marketing được nhập thủ công và chưa nối trực tiếp từng quảng cáo với từng khách mua.</p>
    </section>

    <div className="ecommerce-analytics-grid ecommerce-analytics-grid-main">
      <section className="report-panel ecommerce-analytics-panel ecommerce-trend-panel"><div className="report-panel-heading"><div><h2>Doanh thu hàng bán & lợi nhuận gộp</h2><p>Gộp theo {grain === "quarter" || grain === "year" ? "tháng" : "ngày"}; giá vốn lấy từ phiếu nhập hoàn tất.</p></div><div className="ecommerce-legend"><span><i className="legend-revenue"/>Doanh thu hàng bán</span><span><i className="legend-profit"/>Lợi nhuận gộp</span></div></div>
        {loading ? <div className="report-empty-state">Đang tải biểu đồ…</div> : trend.length ? <div className="ecommerce-trend-scroll"><div className="ecommerce-trend-chart" role="img" aria-label="Biểu đồ doanh thu hàng bán và lợi nhuận gộp theo thời gian"><div className="ecommerce-trend-axis"><span>{moneyAxis(topRevenue)}</span><span>{moneyAxis(topRevenue * .66)}</span><span>{moneyAxis(topRevenue * .33)}</span><span>0</span></div><div className="ecommerce-trend-plot"><div className="ecommerce-trend-grid"><i/><i/><i/><i/></div><div className="ecommerce-trend-bars">{trend.map((row) => <div className="ecommerce-trend-column" key={row.key} title={`${row.label}: doanh thu ${money(row.revenue)}, lãi gộp ${money(row.profit)}`}><span className="ecommerce-revenue-bar" style={{ height: `${Math.max(row.revenue > 0 ? 2 : 0, row.revenue / topRevenue * 100)}%` }}/><span className={`ecommerce-profit-bar ${row.profit < 0 ? "is-negative" : ""}`} style={{ height: `${Math.max(row.profit !== 0 ? 2 : 0, Math.min(100, Math.abs(row.profit) / topRevenue * 100))}%` }}/><small>{row.label}</small></div>)}</div></div></div></div> : <div className="report-empty-state">Chưa có giao dịch bán hoặc giá vốn trong kỳ này.</div>}
      </section>
      <section className="report-panel ecommerce-analytics-panel ecommerce-orders-panel"><div className="report-panel-heading"><div><h2>Đơn hàng theo trạng thái</h2><p>{number(statusTotal)} đơn được tạo trong kỳ, tính cả đơn hủy.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : statuses.length ? <div className="ecommerce-status-list">{statuses.map((row) => <div key={row.status}><div><span>{statusLabel[row.status] || row.status}</span><strong>{number(row.count)}</strong></div><i><b style={{ width: `${statusTotal ? row.count / statusTotal * 100 : 0}%` }}/></i></div>)}</div> : <div className="report-empty-state">Chưa có đơn hàng.</div>}</section>
    </div>

    <div className="ecommerce-analytics-grid">
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Khách truy cập mới & quay lại</h2><p>Thiết bị/trình duyệt được nhận diện ẩn danh, không đồng nhất tuyệt đối với từng người.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : <div className="ecommerce-comparison"><div><span>Trình duyệt mới trong kỳ</span><strong>{number(visitors.firstTime)}</strong><i><b style={{ width: `${visitors.firstTime + visitors.returning ? visitors.firstTime / (visitors.firstTime + visitors.returning) * 100 : 0}%` }}/></i></div><div><span>Trình duyệt quay lại</span><strong>{number(visitors.returning)}</strong><i><b className="is-returning" style={{ width: `${visitors.firstTime + visitors.returning ? visitors.returning / (visitors.firstTime + visitors.returning) * 100 : 0}%` }}/></i></div><small>{number(marketing?.totals.sessions || 0)} phiên · {number(marketing?.totals.pageViews || 0)} lượt xem trang · {number(marketing?.totals.signups || 0)} đăng ký xác minh</small></div>}</section>
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Đăng ký & khách mua</h2><p>Đăng ký tài khoản và đơn hàng là hai hành vi khác nhau.</p></div></div><div className="ecommerce-small-stats"><div><span>Tài khoản đăng ký mới</span><strong>{loading ? "…" : number(report?.newCustomers || 0)}</strong></div><div><span>Khách mua lần đầu</span><strong>{loading ? "…" : number(buyers.firstTime)}</strong></div><div><span>Khách mua quay lại</span><strong>{loading ? "…" : number(buyers.returning)}</strong></div><div><span>Sản phẩm đã bán</span><strong>{loading ? "…" : number(report?.productsSold || 0)}</strong></div></div></section>
    </div>

    <section className="report-panel ecommerce-analytics-panel ecommerce-funnel-panel"><div className="report-panel-heading"><div><h2>Phễu mua hàng</h2><p>Theo phiên có tracking: truy cập → thêm giỏ → phiên có đơn đã thanh toán.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : marketing ? <div className="ecommerce-funnel">{[
      { label: "Phiên truy cập", count: marketingTotals.sessions, className: "is-visits", rate: "100%" },
      { label: "Phiên có thêm giỏ", count: marketingTotals.cartSessions || 0, className: "is-cart", rate: marketingTotals.sessions ? `${((marketingTotals.cartSessions || 0) / marketingTotals.sessions * 100).toFixed(1)}% phiên truy cập` : "Chưa có mẫu số" },
      { label: "Phiên thêm giỏ rồi mua", count: marketingTotals.cartConvertedSessions || 0, className: "is-paid", rate: marketingTotals.cartSessions ? `${((marketingTotals.cartConvertedSessions || 0) / marketingTotals.cartSessions * 100).toFixed(1)}% phiên thêm giỏ` : "Chưa có phiên thêm giỏ" },
    ].map((step) => <div className="ecommerce-funnel-step" key={step.label}><div><span>{step.label}</span><strong>{number(step.count)}</strong><small>{step.rate}</small></div><i><b className={step.className} style={{ width: `${marketingTotals.sessions ? Math.max(step.count > 0 ? 2 : 0, step.count / marketingTotals.sessions * 100) : 0}%` }}/></i></div>)}<p>Tỷ lệ theo phiên, không phải số lượng món hàng trong giỏ. Phiên mua được quy cho phiên có mã tracking GEME.</p></div> : <div className="report-empty-state">Chưa có dữ liệu Marketing tracking.</div>}</section>

    <div className="ecommerce-analytics-grid ecommerce-analytics-grid-lower">
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Doanh thu hàng bán theo danh mục</h2><p>Giá trị dòng hàng từ đơn đang xử lý, giao hoặc đã giao.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : report?.categories.length ? <div className="ecommerce-ranking">{report.categories.map((row) => <div key={row.name}><span>{row.name}</span><strong>{money(row.revenue)}</strong><i><b style={{ width: `${Math.max(2, row.revenue / Math.max(1, ...report.categories.map((item) => item.revenue)) * 100)}%` }}/></i></div>)}</div> : <div className="report-empty-state">Chưa có dữ liệu phân loại.</div>}</section>
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Phương thức thanh toán</h2><p>Tiền thu đã trừ khoản hoàn trong kỳ.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : report?.payments.length ? <div className="ecommerce-ranking ecommerce-payment-list">{report.payments.map((row) => <div key={row.method}><span>{methodLabel[row.method] || row.method}</span><strong>{money(row.amount)}</strong></div>)}</div> : <div className="report-empty-state">Chưa có khoản thanh toán.</div>}</section>
    </div>

    <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Kênh bán hàng</h2><p>Doanh thu đã thu theo cửa hàng trực tiếp và website; không nhầm với nguồn Marketing.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : report?.salesChannels?.length ? <div className="ecommerce-channel-cards">{report.salesChannels.map((row) => <article key={row.channel}><span>{row.channel}</span><strong>{money(row.revenue)}</strong><small>{number(row.orders)} đơn</small><i><b style={{ width: `${Math.max(2, row.revenue / Math.max(1, ...report.salesChannels!.map((item) => item.revenue)) * 100)}%` }}/></i></article>)}</div> : <div className="report-empty-state">Chưa có khoản thanh toán theo kênh.</div>}</section>

    <section className="report-panel ecommerce-analytics-panel ecommerce-products-panel"><div className="report-panel-heading"><div><h2>Sản phẩm bán chạy</h2><p>Xếp theo doanh thu hàng bán trong kỳ.</p></div><button type="button" onClick={() => setShowAllProducts((value) => !value)}>{showAllProducts ? "Thu gọn" : "Xem tối đa 20"}</button></div>{loading ? <div className="report-empty-state">Đang tải…</div> : topProducts.length ? <div className="ecommerce-product-table-wrap"><table><thead><tr><th>#</th><th>Sản phẩm / SKU</th><th>Danh mục</th><th>Số lượng</th><th>Doanh thu hàng bán</th></tr></thead><tbody>{topProducts.map((row, index) => <tr key={`${row.sku}-${index}`}><td>{index + 1}</td><td><strong>{row.product}</strong><small>{row.sku}</small></td><td>{row.category}</td><td>{number(row.sold)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div> : <div className="report-empty-state">Chưa có sản phẩm bán ra trong kỳ.</div>}</section>

    <div className="ecommerce-analytics-grid ecommerce-analytics-grid-lower">
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Kênh truy cập & chuyển đổi</h2><p>Chỉ tính lượt truy cập đã được website tracking ghi nhận.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : marketing?.channels.length ? <div className="ecommerce-channel-table-wrap"><table><thead><tr><th>Kênh</th><th>Phiên</th><th>Đăng ký</th><th>Đơn trả phí*</th><th>Chi phí</th><th>CPA*</th></tr></thead><tbody>{marketing.channels.slice(0, 10).map((row) => <tr key={row.source}><td>{row.source}</td><td>{number(row.sessions)}</td><td>{number(row.signups)}</td><td>{number(row.paidOrders)}</td><td>{money(row.spend)}</td><td>{row.cpa == null ? "—" : money(row.cpa)}</td></tr>)}</tbody></table><small>* Đơn trả phí được gắn với phiên truy cập; CPA = chi phí / đơn được gắn nguồn. Không đại diện cho mọi đơn của cửa hàng.</small></div> : <div className="report-empty-state">Chưa có lượt truy cập được tracking trong kỳ.</div>}</section>
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Hiệu quả khuyến mãi</h2><p>Mã đã sử dụng trên đơn hợp lệ trong kỳ.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : report?.promotionPerformance.length ? <div className="ecommerce-ranking">{report.promotionPerformance.slice(0, 8).map((row) => <div key={`${row.code}-${row.name}`}><span>{row.name}<small>{row.code || "Khuyến mãi tự động"} · {row.orders} đơn</small></span><strong>−{money(row.discount)}</strong></div>)}</div> : <div className="report-empty-state">Chưa có khuyến mãi được sử dụng.</div>}</section>
    </div>

    {!!profit?.missingCostLines && <div className="ecommerce-analytics-warning" role="status"><strong>{number(profit.missingCostLines)} dòng bán chưa có giá nhập.</strong> Lợi nhuận gộp chỉ gồm phần tính được; {money(profit.missingCostRevenue)} doanh thu hàng bán chưa đủ dữ liệu giá vốn. Hãy bổ sung giá nhập bằng phiếu kho.</div>}
    <p className="ecommerce-analytics-footnote">Cách đọc: “tiền thu thuần” là khoản thanh toán đã thu trừ hoàn tiền; “doanh thu hàng bán” tính theo đơn xử lý/giao/đã giao; “lợi nhuận gộp” trừ giá vốn đã biết. Khách mua mới/quay lại dựa trên số điện thoại, email hoặc tài khoản đã lưu trong đơn. Khách truy cập là mã trình duyệt ẩn danh; có thể khác số người thật khi đổi thiết bị hoặc xóa cookie. Số liệu tracking chỉ có từ khi tính năng được bật. CLV hiện là giá trị mua lịch sử trung bình, chưa đủ dữ liệu thời gian gắn bó để dự báo; CAC là ước tính từ chi phí nhập tay; NPS/CTR chưa đo; phiên xem một trang là proxy bounce vì chưa theo dõi toàn bộ tương tác.</p>
  </div>;
}
