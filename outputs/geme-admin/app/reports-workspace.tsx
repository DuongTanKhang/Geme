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
type CustomerSegment = { channel: string; cohort: "NEW" | "RETURNING"; detailType: string; customers: number; orders: number; captured: number; refunded: number; netSpend: number; inferredCustomers: number; averageSpend: number };
type AnonymousSegment = { channel: string; orders: number; captured: number; refunded: number; netSpend: number };
type CustomerRow = { name: string | null; contact: string; channels: string; hasWebAccount: boolean; firstPurchaseAt: string; cohort: "NEW" | "RETURNING"; orders: number; captured: number; refunded: number; netSpend: number; lifetimeSpend: number };
type CustomerDetail = { from: string; to: string; page: number; pageSize: number; customerTotal: number; segments: CustomerSegment[]; anonymous: AnonymousSegment[]; customers: CustomerRow[] };

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
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [customerSearchDraft, setCustomerSearchDraft] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
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

  const loadCustomerDetail = useCallback(async () => {
    setCustomerLoading(true); setCustomerError("");
    const from = vnMidnight(rangeStart).toISOString();
    const endExclusive = vnMidnight(rangeNext).toISOString();
    const to = new Date(new Date(endExclusive).getTime() - 1).toISOString();
    try {
      const params = new URLSearchParams({ from, to, page: String(customerPage), pageSize: "25", search: customerSearch });
      setCustomerDetail(await request(`reports/customer-detail?${params}`) as CustomerDetail);
    } catch (caught) { setCustomerError(caught instanceof Error ? caught.message : "Không tải được báo cáo khách hàng."); }
    finally { setCustomerLoading(false); }
  }, [request, rangeStart, rangeNext, customerPage, customerSearch]);
  useEffect(() => { void loadCustomerDetail(); }, [loadCustomerDetail]);

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
  const segments = customerDetail?.segments || [];
  const anonymousSegments = customerDetail?.anonymous || [];
  const segmentTotal = (channel: string, cohort: "NEW" | "RETURNING", detailType?: string) => segments
    .filter((row) => row.channel === channel && row.cohort === cohort && (detailType == null || row.detailType === detailType))
    .reduce((total, row) => ({ customers: total.customers + row.customers, orders: total.orders + row.orders, captured: total.captured + row.captured, refunded: total.refunded + row.refunded, netSpend: total.netSpend + row.netSpend, inferredCustomers: total.inferredCustomers + row.inferredCustomers }), { customers: 0, orders: 0, captured: 0, refunded: 0, netSpend: 0, inferredCustomers: 0 });
  const channelName = (channel: string) => ({ DIRECT: "Bán trực tiếp", STORE: "Bán trực tiếp", WEBSITE: "Website", SHOPEE: "Shopee", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", TIKTOK: "TikTok" }[channel] || channel.replaceAll("_", " "));
  const channelPieColors = ["#4f8066", "#c49a57", "#6e91a5", "#9b7ba8", "#c97868", "#79a5a0"];
  const channelPieData = (report?.salesChannels || []).map((row, index) => ({ ...row, revenue: Number(row.revenue) || 0, color: channelPieColors[index % channelPieColors.length] }));
  const channelPieTotal = channelPieData.reduce((total, row) => total + Math.max(0, row.revenue), 0);
  const channelPieOrders = channelPieData.reduce((total, row) => total + (Number(row.orders) || 0), 0);
  const channelPieCircumference = 2 * Math.PI * 84;
  let channelPieOffset = 0;
  const channelPieSegments = channelPieData.map((row) => {
    const share = channelPieTotal > 0 ? Math.max(0, row.revenue) / channelPieTotal : 0;
    const length = channelPieCircumference * share;
    const offset = channelPieOffset;
    channelPieOffset += length;
    return { ...row, share, length, offset };
  });
  const totalRecognized = segments.reduce((total, row) => ({ customers: total.customers, orders: total.orders + row.orders, captured: total.captured + row.captured, refunded: total.refunded + row.refunded, netSpend: total.netSpend + row.netSpend }), { customers: 0, orders: 0, captured: 0, refunded: 0, netSpend: 0 });
  const totalAnonymous = anonymousSegments.reduce((total, row) => ({ orders: total.orders + row.orders, captured: total.captured + row.captured, refunded: total.refunded + row.refunded, netSpend: total.netSpend + row.netSpend }), { orders: 0, captured: 0, refunded: 0, netSpend: 0 });
  const customerPageCount = Math.max(1, Math.ceil((customerDetail?.customerTotal || 0) / (customerDetail?.pageSize || 25)));
  const channelNames = [...new Set(segments.map((row) => row.channel))].sort((a, b) => (a === "DIRECT" ? -1 : b === "DIRECT" ? 1 : a === "WEBSITE" ? -1 : b === "WEBSITE" ? 1 : a.localeCompare(b)));
  const customerChannelStats = channelNames.map((channel) => ({ channel, first: segmentTotal(channel, "NEW"), repeat: segmentTotal(channel, "RETURNING") }));
  const customerChartWidth = Math.max(600, customerChannelStats.length * 150 + 120);
  const customerChartHeight = 300;
  const customerChartBounds = { left: 72, right: customerChartWidth - 24, top: 22, bottom: 238 };
  const customerChartMax = Math.max(1, ...customerChannelStats.flatMap((row) => [row.first.customers, row.repeat.customers]));
  const customerChartTickCount = Math.min(4, customerChartMax);
  const customerChartX = (index: number) => customerChannelStats.length <= 1
    ? (customerChartBounds.left + customerChartBounds.right) / 2
    : customerChartBounds.left + index * (customerChartBounds.right - customerChartBounds.left) / (customerChannelStats.length - 1);
  const customerChartY = (value: number) => customerChartBounds.bottom - value / customerChartMax * (customerChartBounds.bottom - customerChartBounds.top);
  const customerChartPath = (cohort: "first" | "repeat") => customerChannelStats.map((row, index) => `${customerChartX(index)},${customerChartY(row[cohort].customers)}`).join(" ");
  const customerSegmentRows = customerChannelStats.flatMap(({ channel }) => {
    const row = (cohort: "NEW" | "RETURNING", label: string, detailType?: string, depth = 0) => ({ key: `${channel}-${cohort}-${detailType || "ALL"}`, channel, cohort, label, depth, ...segmentTotal(channel, cohort, detailType) });
    if (channel === "DIRECT") {
      const returning = ["MEMBER", "GUEST", "UNKNOWN"].map((type) => row("RETURNING", type === "MEMBER" ? "Đã có tài khoản web" : type === "GUEST" ? "Chưa có tài khoản web" : "Chưa xác định tài khoản", type, 1)).filter((item) => item.customers || item.orders);
      return [row("NEW", "Khách mới"), row("RETURNING", "Khách quay lại", undefined), ...returning];
    }
    if (channel === "WEBSITE") {
      const newBreakdown = ["MEMBER", "GUEST", "UNKNOWN"].map((type) => row("NEW", type === "MEMBER" ? "Có tài khoản đăng nhập" : type === "GUEST" ? "Đặt hàng không đăng nhập" : "Không xác định", type, 1)).filter((item) => item.customers || item.orders);
      return [row("NEW", "Khách mua lần đầu trên toàn hệ thống"), ...newBreakdown, row("RETURNING", "Khách quay lại")];
    }
    return [row("NEW", "Khách mới"), row("RETURNING", "Khách quay lại")];
  }).filter((item) => item.customers || item.orders);

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

    <section className="report-panel ecommerce-analytics-panel customer-detail-panel" aria-labelledby="customer-detail-title">
      <div className="report-panel-heading"><div><h2 id="customer-detail-title">Khách mua hàng & chi tiêu theo kênh</h2><p>Khách mới là lần đầu có khoản thanh toán thành công đến hết kỳ; khách quay lại đã có lần mua thành công trước kỳ. Đơn website được ghi nhận là thành viên/khách vãng lai ngay lúc đặt.</p></div><button type="button" onClick={() => void loadCustomerDetail()} disabled={customerLoading}>{customerLoading ? "Đang tải…" : "Làm mới"}</button></div>
      {customerError && <div className="ecommerce-analytics-error customer-detail-error" role="alert">Không tải được báo cáo khách mua: {customerError}</div>}
      <div className="customer-report-kpis">
        <article><small>Khách có định danh</small><strong>{customerLoading ? "…" : number(customerDetail?.customerTotal || 0)}</strong><span>Khách duy nhất trong kỳ sau khi gộp theo số điện thoại/email</span></article>
        <article><small>Đơn có định danh</small><strong>{customerLoading ? "…" : number(totalRecognized.orders)}</strong><span>Đơn thuộc các kênh có thể xác định khách</span></article>
        <article><small>Chi tiêu ròng có định danh</small><strong>{customerLoading ? "…" : money(totalRecognized.netSpend)}</strong><span>Tiền đã thu trừ tiền hoàn trong kỳ</span></article>
        <article><small>Giao dịch chưa định danh</small><strong>{customerLoading ? "…" : number(totalAnonymous.orders)}</strong><span>{money(totalAnonymous.netSpend)} ròng; không quy thành số khách giả</span></article>
      </div>
      <div className="customer-report-chart-area">
        <div className="customer-report-chart-heading"><div><h3>Khách mới và quay lại theo kênh bán</h3><p>Một khách mua ở nhiều kênh được tính trong từng kênh; tổng khách duy nhất ở trên không bị cộng lặp.</p></div><div className="customer-report-legend"><span><i className="is-new"/>Mới</span><span><i className="is-returning"/>Quay lại</span></div></div>
        {customerLoading && !customerDetail ? <div className="report-empty-state">Đang tải báo cáo khách…</div> : customerChannelStats.length ? <div className="customer-channel-chart-scroll" role="region" aria-label="Biểu đồ khách mới và khách quay lại theo kênh bán" tabIndex={0}><svg className="customer-channel-chart" width={customerChartWidth} height={customerChartHeight} viewBox={`0 0 ${customerChartWidth} ${customerChartHeight}`} role="img" aria-label="Số khách mới và khách quay lại theo kênh bán">
          <title>Khách mới và quay lại theo từng kênh bán</title>
          {Array.from({ length: customerChartTickCount + 1 }, (_, step) => { const value = Math.round(customerChartMax * (customerChartTickCount - step) / customerChartTickCount); const y = customerChartY(value); return <g className="customer-channel-chart-grid" key={step}><line x1={customerChartBounds.left} y1={y} x2={customerChartBounds.right} y2={y}/><text x={customerChartBounds.left - 10} y={y + 4} textAnchor="end">{number(value)}</text></g>; })}
          {customerChannelStats.length > 1 && <><polyline className="customer-channel-line is-new" points={customerChartPath("first")}/><polyline className="customer-channel-line is-returning" points={customerChartPath("repeat")}/></>}
          {customerChannelStats.map(({ channel, first, repeat }, index) => { const x = customerChartX(index); return <g key={channel}><line className="customer-channel-chart-tick" x1={x} y1={customerChartBounds.top} x2={x} y2={customerChartBounds.bottom}/><circle className="customer-channel-point is-new" cx={x} cy={customerChartY(first.customers)} r="5"><title>{channelName(channel)}: {number(first.customers)} khách mới</title></circle><circle className="customer-channel-point is-returning" cx={x} cy={customerChartY(repeat.customers)} r="5"><title>{channelName(channel)}: {number(repeat.customers)} khách quay lại</title></circle><text className="customer-channel-chart-label" x={x} y={customerChartBounds.bottom + 25} textAnchor="middle">{channelName(channel)}</text><text className="customer-channel-chart-value" x={x} y={customerChartBounds.bottom + 44} textAnchor="middle">{number(first.customers)} mới · {number(repeat.customers)} quay lại</text></g>; })}
        </svg></div> : <div className="report-empty-state">Chưa có đơn đã thanh toán có thể thống kê trong kỳ.</div>}
      </div>
      <div className="customer-report-segment-heading"><div><h3>Phân nhóm khách và dòng tiền</h3><p>Số tiền trung bình = chi tiêu ròng ÷ số khách trong nhóm.</p></div></div>
      <div className="customer-report-table-wrap"><table><thead><tr><th>Kênh / nhóm khách</th><th>Khách</th><th>Đơn</th><th>Đã thu</th><th>Đã hoàn</th><th>Chi tiêu ròng</th><th>TB / khách</th></tr></thead><tbody>
        {customerSegmentRows.map((row) => <tr key={row.key} className={row.depth ? "is-subgroup" : ""}><td><span>{row.depth ? "↳ " : ""}{channelName(row.channel)} · {row.label}</span>{row.inferredCustomers > 0 && <small>{number(row.inferredCustomers)} khách suy luận từ dữ liệu đơn cũ</small>}</td><td>{number(row.customers)}</td><td>{number(row.orders)}</td><td>{money(row.captured)}</td><td>{money(row.refunded)}</td><td><strong>{money(row.netSpend)}</strong></td><td>{row.customers ? money(row.netSpend / row.customers) : "—"}</td></tr>)}
        {!customerLoading && !customerSegmentRows.length && <tr><td colSpan={7} className="customer-report-empty">Chưa có khoản thanh toán trong kỳ này.</td></tr>}
      </tbody></table></div>
      {anonymousSegments.length > 0 && <div className="customer-anonymous-block"><strong>Giao dịch không đủ thông tin để nhận diện khách</strong><p>Các đơn này có tiền thu nhưng không có số điện thoại, email, hồ sơ khách hàng hoặc mã khách từ nền tảng. Chúng được giữ trong tổng dòng tiền nhưng không được tính thành khách mới/quay lại.</p><div className="customer-anonymous-list">{anonymousSegments.map((row) => <article key={row.channel}><b>{channelName(row.channel)}</b><span>{number(row.orders)} đơn</span><span>Thu {money(row.captured)}</span><span>Hoàn {money(row.refunded)}</span><strong>Ròng {money(row.netSpend)}</strong></article>)}</div></div>}
      <div className="customer-directory-heading"><div><h3>Chi tiêu từng khách</h3><p>Danh sách khách nhận diện được trong kỳ; thông tin liên hệ đã che bớt.</p></div><form onSubmit={(event) => { event.preventDefault(); setCustomerPage(1); setCustomerSearch(customerSearchDraft.trim()); }}><input value={customerSearchDraft} onChange={(event) => setCustomerSearchDraft(event.target.value)} placeholder="Tìm tên, số điện thoại, kênh…" aria-label="Tìm khách hàng"/><button type="submit">Tìm</button></form></div>
      <div className="customer-report-table-wrap customer-directory-table"><table><thead><tr><th>Khách hàng</th><th>Nhóm</th><th>Kênh đã mua</th><th>Tài khoản web</th><th>Đơn trong kỳ</th><th>Chi tiêu ròng kỳ</th><th>Chi tiêu ròng tích lũy</th></tr></thead><tbody>
        {customerDetail?.customers.map((row, index) => <tr key={`${row.contact}-${row.firstPurchaseAt}-${index}`}><td><strong>{row.name || "Khách hàng"}</strong><small>{row.contact}</small></td><td><span className={`customer-cohort-pill ${row.cohort === "NEW" ? "is-new" : "is-returning"}`}>{row.cohort === "NEW" ? "Mới" : "Quay lại"}</span><small>Lần mua đầu: {row.firstPurchaseAt ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(new Date(row.firstPurchaseAt)) : "—"}</small></td><td>{row.channels.split(", ").map(channelName).join(", ")}</td><td>{row.hasWebAccount ? "Có tài khoản" : "Khách vãng lai"}</td><td>{number(row.orders)}</td><td><strong>{money(row.netSpend)}</strong><small>Thu {money(row.captured)} · Hoàn {money(row.refunded)}</small></td><td>{money(row.lifetimeSpend)}</td></tr>)}
        {!customerLoading && !customerDetail?.customers.length && <tr><td colSpan={7} className="customer-report-empty">{customerSearch ? "Không tìm thấy khách phù hợp." : "Chưa có khách mua hàng được nhận diện trong kỳ."}</td></tr>}
      </tbody></table></div>
      <footer className="customer-directory-footer"><span>{customerLoading ? "Đang tải khách hàng…" : `Hiển thị ${customerDetail?.customers.length || 0} / ${number(customerDetail?.customerTotal || 0)} khách`}</span><div><button type="button" onClick={() => setCustomerPage((page) => Math.max(1, page - 1))} disabled={customerPage <= 1 || customerLoading}>‹ Trước</button><span>Trang {customerPage} / {customerPageCount}</span><button type="button" onClick={() => setCustomerPage((page) => Math.min(customerPageCount, page + 1))} disabled={customerPage >= customerPageCount || customerLoading}>Sau ›</button></div></footer>
      <p className="customer-report-note">Quy tắc: website dùng trạng thái thành viên/khách vãng lai đã chụp tại thời điểm đặt hàng; bán trực tiếp đối chiếu số điện thoại/email với tài khoản web hiện có. Đơn của nền tảng khác cần có mã khách hàng do nền tảng cung cấp hoặc số điện thoại/email để gộp khách. Đơn cũ chưa có nhãn nguồn được suy luận theo dữ liệu còn lưu; số khách và tiền chỉ dựa trên thanh toán đã ghi nhận, không tính đơn chưa trả tiền.</p>
    </section>

    <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Kênh bán hàng</h2><p>Tỷ trọng doanh thu đã thu theo cửa hàng trực tiếp, website và các nền tảng đã gắn nhãn.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : channelPieSegments.length ? <div className="sales-channel-pie-layout"><div className="sales-channel-pie-chart"><svg viewBox="0 0 240 240" role="img" aria-label={`Biểu đồ tròn doanh thu theo ${channelPieSegments.length} kênh bán hàng`}><title>Doanh thu theo kênh bán hàng</title><circle cx="120" cy="120" r="84" className="sales-channel-pie-track"/>{channelPieTotal > 0 && channelPieSegments.filter((row) => row.revenue > 0).map((row) => <circle key={row.channel} cx="120" cy="120" r="84" fill="none" stroke={row.color} strokeWidth="28" strokeDasharray={channelPieSegments.filter((item) => item.revenue > 0).length === 1 ? undefined : `${row.length} ${channelPieCircumference - row.length}`} strokeDashoffset={-row.offset} transform="rotate(-90 120 120)"><title>{channelName(row.channel)}: {money(row.revenue)} ({(row.share * 100).toFixed(1)}%)</title></circle>)}<text x="120" y="112" textAnchor="middle" className="sales-channel-pie-total-label">Tổng doanh thu</text><text x="120" y="137" textAnchor="middle" className="sales-channel-pie-total-value">{money(channelPieTotal)}</text></svg></div><div className="sales-channel-pie-legend">{channelPieSegments.map((row) => <article key={row.channel} className="sales-channel-pie-legend-row"><span className="sales-channel-pie-swatch" style={{ backgroundColor: row.color }}/><div><strong>{channelName(row.channel)}</strong><small>{number(row.orders)} đơn · {channelPieTotal > 0 && row.revenue > 0 ? `${(row.share * 100).toFixed(1)}% doanh thu` : "chưa có doanh thu dương"}</small></div><b>{money(row.revenue)}</b></article>)}<p>{number(channelPieOrders)} đơn trong kỳ. Tỷ trọng chỉ tính trên doanh thu dương; kênh có doanh thu bằng 0 hoặc âm vẫn được liệt kê.</p></div></div> : <div className="report-empty-state">Chưa có khoản thanh toán theo kênh.</div>}</section>

    <section className="report-panel ecommerce-analytics-panel ecommerce-products-panel"><div className="report-panel-heading"><div><h2>Sản phẩm bán chạy</h2><p>Xếp theo doanh thu hàng bán trong kỳ.</p></div><button type="button" onClick={() => setShowAllProducts((value) => !value)}>{showAllProducts ? "Thu gọn" : "Xem tối đa 20"}</button></div>{loading ? <div className="report-empty-state">Đang tải…</div> : topProducts.length ? <div className="ecommerce-product-table-wrap"><table><thead><tr><th>#</th><th>Sản phẩm / SKU</th><th>Danh mục</th><th>Số lượng</th><th>Doanh thu hàng bán</th></tr></thead><tbody>{topProducts.map((row, index) => <tr key={`${row.sku}-${index}`}><td>{index + 1}</td><td><strong>{row.product}</strong><small>{row.sku}</small></td><td>{row.category}</td><td>{number(row.sold)}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></div> : <div className="report-empty-state">Chưa có sản phẩm bán ra trong kỳ.</div>}</section>

    <div className="ecommerce-analytics-grid ecommerce-analytics-grid-lower">
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Kênh truy cập & chuyển đổi</h2><p>Chỉ tính lượt truy cập đã được website tracking ghi nhận.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : marketing?.channels.length ? <div className="ecommerce-channel-table-wrap"><table><thead><tr><th>Kênh</th><th>Phiên</th><th>Đăng ký</th><th>Đơn trả phí*</th><th>Chi phí</th><th>CPA*</th></tr></thead><tbody>{marketing.channels.slice(0, 10).map((row) => <tr key={row.source}><td>{row.source}</td><td>{number(row.sessions)}</td><td>{number(row.signups)}</td><td>{number(row.paidOrders)}</td><td>{money(row.spend)}</td><td>{row.cpa == null ? "—" : money(row.cpa)}</td></tr>)}</tbody></table><small>* Đơn trả phí được gắn với phiên truy cập; CPA = chi phí / đơn được gắn nguồn. Không đại diện cho mọi đơn của cửa hàng.</small></div> : <div className="report-empty-state">Chưa có lượt truy cập được tracking trong kỳ.</div>}</section>
      <section className="report-panel ecommerce-analytics-panel"><div className="report-panel-heading"><div><h2>Hiệu quả khuyến mãi</h2><p>Mã đã sử dụng trên đơn hợp lệ trong kỳ.</p></div></div>{loading ? <div className="report-empty-state">Đang tải…</div> : report?.promotionPerformance.length ? <div className="ecommerce-ranking">{report.promotionPerformance.slice(0, 8).map((row) => <div key={`${row.code}-${row.name}`}><span>{row.name}<small>{row.code || "Khuyến mãi tự động"} · {row.orders} đơn</small></span><strong>−{money(row.discount)}</strong></div>)}</div> : <div className="report-empty-state">Chưa có khuyến mãi được sử dụng.</div>}</section>
    </div>

    {!!profit?.missingCostLines && <div className="ecommerce-analytics-warning" role="status"><strong>{number(profit.missingCostLines)} dòng bán chưa có giá nhập.</strong> Lợi nhuận gộp chỉ gồm phần tính được; {money(profit.missingCostRevenue)} doanh thu hàng bán chưa đủ dữ liệu giá vốn. Hãy bổ sung giá nhập bằng phiếu kho.</div>}
    <p className="ecommerce-analytics-footnote">Cách đọc: “tiền thu thuần” là khoản thanh toán đã thu trừ hoàn tiền; “doanh thu hàng bán” tính theo đơn xử lý/giao/đã giao; “lợi nhuận gộp” trừ giá vốn đã biết. Khách mua mới/quay lại dựa trên số điện thoại, email hoặc tài khoản đã lưu trong đơn. Khách truy cập là mã trình duyệt ẩn danh; có thể khác số người thật khi đổi thiết bị hoặc xóa cookie. Số liệu tracking chỉ có từ khi tính năng được bật. CLV hiện là giá trị mua lịch sử trung bình, chưa đủ dữ liệu thời gian gắn bó để dự báo; CAC là ước tính từ chi phí nhập tay; NPS/CTR chưa đo; phiên xem một trang là proxy bounce vì chưa theo dõi toàn bộ tương tác.</p>
  </div>;
}
