"use client";

import { useCallback, useEffect, useState } from "react";

type Grain = "day" | "week" | "month" | "quarter";
type ProfitRow = { bucket: string; revenue: number; cost: number; profit: number; soldQuantity: number; missingCostLines: number; missingCostRevenue: number; returnedQuantity: number };
type ProfitReport = { revenue: number; cost: number; profit: number; soldQuantity: number; missingCostLines: number; missingCostRevenue: number; returnedQuantity: number; costMethod: string; timeline: ProfitRow[] };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<unknown> };

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(Number(value) || 0)} ₫`;
const todayInVietnam = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateOnly = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
const shiftDate = (date: string, days: number) => { const [year, month, day] = date.split("-").map(Number); return dateOnly(new Date(Date.UTC(year, month - 1, day + days))); };
const dateAtVietnamMidnight = (date: string) => { const [year, month, day] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day, -7)); };

function boundsFor(anchor: string, grain: Grain) {
  let start = anchor;
  if (grain === "week") {
    const [year, month, day] = anchor.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    start = shiftDate(anchor, -((weekday + 6) % 7));
  } else if (grain === "month") start = `${anchor.slice(0, 7)}-01`;
  else if (grain === "quarter") {
    const month = Number(anchor.slice(5, 7));
    start = `${anchor.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  }
  const [year, month, day] = start.split("-").map(Number);
  const next = grain === "day" ? shiftDate(start, 1)
    : grain === "week" ? shiftDate(start, 7)
      : grain === "month" ? dateOnly(new Date(Date.UTC(year, month, 1)))
        : dateOnly(new Date(Date.UTC(year, month - 1 + 3, 1)));
  return { start, next, from: dateAtVietnamMidnight(start), to: new Date(dateAtVietnamMidnight(next).getTime() - 1) };
}

function shiftAnchor(anchor: string, grain: Grain, direction: number) {
  if (grain === "day") return shiftDate(anchor, direction);
  if (grain === "week") return shiftDate(anchor, direction * 7);
  const [year, month, day] = anchor.split("-").map(Number);
  const delta = grain === "month" ? 1 : 3;
  const moved = new Date(Date.UTC(year, month - 1 + direction * delta, day));
  return dateOnly(moved);
}

function periodLabel(anchor: string, grain: Grain) {
  const { start, next } = boundsFor(anchor, grain);
  const startDate = dateAtVietnamMidnight(start);
  const endDate = new Date(dateAtVietnamMidnight(next).getTime() - 1);
  const formatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
  return grain === "day" ? formatter.format(startDate)
    : grain === "quarter" ? `Quý ${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1}/${start.slice(0, 4)}`
      : `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function bucketLabel(bucket: string, grain: Grain) {
  const date = new Date(`${bucket}T12:00:00Z`);
  if (grain === "month") return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", month: "2-digit", year: "numeric" }).format(date);
  if (grain === "quarter") return `Quý ${Math.floor(date.getUTCMonth() / 3) + 1}/${date.getUTCFullYear()}`;
  if (grain === "week") return `Tuần từ ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(date)}`;
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(date);
}

export default function ProfitReportWorkspace({ request }: Props) {
  const [grain, setGrain] = useState<Grain>("month");
  const [anchor, setAnchor] = useState(todayInVietnam);
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { from, to } = boundsFor(anchor, grain);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ grain, from: from.toISOString(), to: to.toISOString() });
    try { setReport(await request(`reports/gross-profit?${params.toString()}`) as ProfitReport); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được báo cáo lợi nhuận."); }
    finally { setLoading(false); }
  }, [grain, from.getTime(), to.getTime(), request]);

  useEffect(() => { void load(); }, [load]);

  const ranges: Array<[Grain, string]> = [["day", "Ngày"], ["week", "Tuần"], ["month", "Tháng"], ["quarter", "Quý"]];
  return <div className="profit-report-workspace">
    <div className="profit-report-heading"><div><span className="eyebrow">BÁO CÁO · GIÁ VỐN</span><h1>Lợi nhuận sau giá nhập</h1><p>Doanh thu hàng bán trừ giá nhập; đơn hủy không tính. Hàng trả được hoàn giá vốn khi đã nhập lại kho.</p></div><div className="profit-report-controls"><div className="profit-grain-tabs" role="tablist" aria-label="Kỳ báo cáo">{ranges.map(([value, label]) => <button type="button" role="tab" aria-selected={grain === value} className={grain === value ? "active" : ""} key={value} onClick={() => setGrain(value)}>{label}</button>)}</div><div className="profit-period-nav"><button className="button button-quiet" type="button" aria-label="Kỳ trước" onClick={() => setAnchor((value) => shiftAnchor(value, grain, -1))}>‹</button><strong>{periodLabel(anchor, grain)}</strong><button className="button button-quiet" type="button" aria-label="Kỳ tiếp theo" onClick={() => setAnchor((value) => shiftAnchor(value, grain, 1))}>›</button><button className="button button-quiet" type="button" onClick={() => setAnchor(todayInVietnam())}>Hôm nay</button></div></div></div>
    {error && <div className="profit-report-error" role="alert">{error}</div>}
    <section className="profit-report-kpis" aria-label="Tổng kết kỳ báo cáo">
      <article><small>Doanh thu hàng bán</small><strong>{loading ? "Đang tải…" : money(report?.revenue || 0)}</strong><span>Đã trừ giá trị hàng trả trong kỳ</span></article>
      <article><small>Giá nhập đã biết</small><strong>{loading ? "Đang tải…" : money(report?.cost || 0)}</strong><span>Từ phiếu nhập hoàn tất trước ngày bán</span></article>
      <article className="profit-highlight"><small>Lợi nhuận sau giá nhập</small><strong>{loading ? "Đang tải…" : money(report?.profit || 0)}</strong><span>Lãi gộp đã biết trong kỳ</span></article>
      <article><small>Sản phẩm bán ra</small><strong>{loading ? "Đang tải…" : new Intl.NumberFormat("vi-VN").format(report?.soldQuantity || 0)}</strong><span>Đã trả: {report?.returnedQuantity || 0}</span></article>
    </section>
    <section className="profit-report-panel"><header><div><h2>Chi tiết theo {grain === "day" ? "ngày" : grain === "week" ? "tuần" : grain === "month" ? "tháng" : "quý"}</h2><span>{periodLabel(anchor, grain)}</span></div><button className="button button-quiet" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Đang tải…" : "Làm mới"}</button></header><div className="profit-report-table-wrap"><table><thead><tr><th>Kỳ</th><th>Đã bán</th><th>Doanh thu</th><th>Giá nhập</th><th>Lợi nhuận gộp</th><th>Thiếu giá nhập</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="profit-table-empty">Đang tải báo cáo…</td></tr> : report?.timeline.length ? report.timeline.map((row) => <tr key={row.bucket}><td>{bucketLabel(row.bucket, grain)}</td><td>{row.soldQuantity}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td className={row.profit >= 0 ? "profit-value" : "loss-value"}>{money(row.profit)}</td><td>{row.missingCostLines ? <span className="profit-missing">{row.missingCostLines} dòng · {money(row.missingCostRevenue)}</span> : "—"}</td></tr>) : <tr><td colSpan={6} className="profit-table-empty">Chưa có giao dịch trong kỳ.</td></tr>}</tbody></table></div></section>
    {!!report?.missingCostLines && <div className="profit-report-warning" role="status"><strong>{report.missingCostLines} dòng bán chưa có giá nhập.</strong> Lợi nhuận trên là phần tính được từ dữ liệu đã có; doanh thu {money(report.missingCostRevenue)} chưa đủ giá vốn để tính chính xác. Hãy bổ sung giá nhập bằng phiếu kho để báo cáo đầy đủ.</div>}
    <p className="profit-report-method">Cách tính: {report?.costMethod || "Giá vốn dùng bình quân có trọng số từ phiếu nhập hoàn tất trước ngày bán."} Báo cáo theo giờ Việt Nam.</p>
  </div>;
}
