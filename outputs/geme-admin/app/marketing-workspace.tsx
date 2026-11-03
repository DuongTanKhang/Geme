"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./marketing-workspace.module.css";

type Props = { request: (path: string, method?: string, body?: unknown) => Promise<any>; canManage: boolean };
type Row = { source: string; medium?: string; campaign?: string; sessions: number; signups: number; paidOrders: number; paidRevenue: number; spend: number; cpa: number | null; conversionRate: number; pageViews?: number };
type Overview = { from: string; to: string; totals: { sessions: number; visitors: number; pageViews: number; signups: number; paidOrders: number; paidVisitors: number; spend: number; cpa: number | null; visitorToPaid: number; paidRevenue: number }; funnel: Array<{ key: string; label: string; count: number }>; channels: Row[]; campaigns: Row[]; cohorts: Array<{ cohort: string; size: number; months: Array<number | null> }>; spends: Array<{ id: string; spentOn: string; source: string; campaign: string; amount: number; note?: string | null }> };

const money = (value: number | null | undefined) => value == null ? "—" : `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const localDateInput = () => { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10); };
const empty: Overview = { from: "", to: "", totals: { sessions: 0, visitors: 0, pageViews: 0, signups: 0, paidOrders: 0, paidVisitors: 0, spend: 0, cpa: null, visitorToPaid: 0, paidRevenue: 0 }, funnel: [], channels: [], campaigns: [], cohorts: [], spends: [] };

export default function MarketingWorkspace({ request, canManage }: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ spentOn: localDateInput(), source: "Facebook", campaign: "", amount: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      setData(await request(`admin/marketing/overview?${query}`) as Overview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không tải được báo cáo Marketing.");
    } finally { setLoading(false); }
  }, [days, request]);

  useEffect(() => { void load(); }, [load]);

  const maxFunnel = Math.max(1, ...data.funnel.map((item) => item.count));
  const maxSpend = Math.max(1, ...data.campaigns.map((item) => item.spend));
  const cohortMonths = useMemo(() => ["T0", "T1", "T2", "T3", "T4", "T5", "T6"], []);

  async function addSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await request("admin/marketing/spend", "POST", { ...form, amount: Number(form.amount) });
      setForm((current) => ({ ...current, campaign: "", amount: "", note: "" }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không lưu được chi phí chiến dịch.");
    } finally { setSaving(false); }
  }

  return <div className={styles.workspace}>
    <div className={styles.toolbar}>
      <div><span className={styles.eyebrow}>NỘI DUNG & TIẾP THỊ</span><h2>Hiệu quả thu hút và chuyển đổi</h2><p>Số liệu được ghi nhận từ khi bật tracking trên website GEME.</p></div>
      <div className={styles.controls}><label htmlFor="marketing-period">Khoảng thời gian</label><select id="marketing-period" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option><option value={365}>12 tháng</option></select><button type="button" onClick={() => void load()} disabled={loading}>Làm mới</button></div>
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    <div className={styles.metrics} aria-busy={loading}>
      <article className={styles.metric}>
        <span>Khách truy cập ước tính</span><strong>{data.totals.visitors.toLocaleString("vi-VN")}</strong><small>Trình duyệt khác nhau đã ghé</small>
        <details className={styles.metricHelp}><summary>Giải thích</summary><p>GEME đếm theo trình duyệt ẩn danh, không phải tài khoản khách hàng. Một người dùng nhiều thiết bị có thể được tính thành nhiều khách.</p></details>
      </article>
      <article className={styles.metric}>
        <span>Lượt ghé thăm</span><strong>{data.totals.sessions.toLocaleString("vi-VN")}</strong><small>Một khách có thể ghé nhiều lần</small>
        <details className={styles.metricHelp}><summary>Giải thích</summary><p>Lượt mới được tính khi khách quay lại sau hơn 30 phút không hoạt động.</p></details>
      </article>
      <article className={styles.metric}>
        <span>Trang đã xem</span><strong>{data.totals.pageViews.toLocaleString("vi-VN")}</strong><small>Tính cả khi mở lại cùng một trang</small>
        <details className={styles.metricHelp}><summary>Giải thích</summary><p>Đây là tổng số lần trang được mở trong các lượt ghé thăm ở khoảng thời gian đã chọn.</p></details>
      </article>
      <article className={styles.metric}><span>Đăng ký đã xác minh</span><strong>{data.totals.signups.toLocaleString("vi-VN")}</strong><small>Ghi nhận sau khi xác minh OTP</small></article>
      <article className={styles.metric}><span>Chi phí / đơn đã trả tiền</span><strong>{money(data.totals.cpa)}</strong><small>Chi phí chiến dịch ÷ đơn đã thanh toán</small></article>
      <article className={styles.metric}><span>Khách truy cập → mua hàng</span><strong>{percent(data.totals.visitorToPaid)}</strong><small>{data.totals.paidVisitors.toLocaleString("vi-VN")} khách có đơn thanh toán</small></article>
    </div>
    <div className={styles.topGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h3>Phễu chuyển đổi</h3><p>Phiên truy cập → đăng ký xác minh → đơn đã thanh toán</p></div></div>
        <div className={styles.funnel}>{data.funnel.map((item, index) => <div className={styles.funnelRow} key={item.key}><div className={styles.funnelLabel}><span>{item.label}</span><strong>{item.count.toLocaleString("vi-VN")}</strong></div><div className={styles.track}><i style={{ width: `${Math.max(item.count ? 2 : 0, (item.count / maxFunnel) * 100)}%`, opacity: 1 - index * 0.13 }} /></div>{index > 0 && <small>{percent(data.funnel[index - 1]?.count ? item.count / data.funnel[index - 1].count : 0)} so với bước trước</small>}</div>)}</div>
        <div className={styles.revenueNote}>Doanh thu đã đối soát theo payment: <strong>{money(data.totals.paidRevenue)}</strong></div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h3>Chiến dịch</h3><p>Chi phí và đơn hàng được quy về campaign UTM</p></div></div>
        {data.campaigns.length ? <div className={styles.campaignList}>{data.campaigns.map((row) => <div className={styles.campaignRow} key={`${row.source}-${row.campaign}-${row.medium}`}><div className={styles.campaignCopy}><strong>{row.campaign}</strong><small>{row.source}{row.medium && row.medium !== "—" ? ` · ${row.medium}` : ""}</small></div><div className={styles.campaignBar}><i style={{ width: `${Math.max(4, (row.spend / maxSpend) * 100)}%` }} /></div><div className={styles.campaignNumbers}><strong>{row.paidOrders} đơn</strong><small>{money(row.spend)} · CPA {money(row.cpa)}</small></div></div>)}</div> : <div className={styles.empty}>Chưa có campaign UTM trong khoảng thời gian này.</div>}
      </section>
    </div>
    <div className={styles.bottomGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h3>Kênh thu hút</h3><p>Phân nhóm theo utm_source; nguồn thiếu UTM được gom riêng</p></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Kênh</th><th>Phiên</th><th>Đăng ký</th><th>Đơn trả tiền</th><th>Chi phí</th><th>CPA</th></tr></thead><tbody>{data.channels.map((row) => <tr key={row.source}><td><strong>{row.source}</strong><small>{row.medium || ""}</small></td><td>{row.sessions.toLocaleString("vi-VN")}</td><td>{row.signups.toLocaleString("vi-VN")}</td><td>{row.paidOrders.toLocaleString("vi-VN")}</td><td>{money(row.spend)}</td><td>{money(row.cpa)}</td></tr>)}{!data.channels.length && <tr><td colSpan={6} className={styles.emptyCell}>Chưa có nguồn truy cập được ghi nhận.</td></tr>}</tbody></table></div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h3>Duy trì sau đăng ký</h3><p>Tỷ lệ trình duyệt có đăng ký xác minh quay lại trong từng tháng</p></div></div>
        <div className={styles.tableWrap}><table className={styles.cohortTable}><thead><tr><th>Tháng đăng ký</th><th>Quy mô*</th>{cohortMonths.map((month) => <th key={month}>{month}</th>)}</tr></thead><tbody>{data.cohorts.map((row) => <tr key={row.cohort}><td>{new Date(`${row.cohort}-01T00:00:00`).toLocaleDateString("vi-VN", { month: "short", year: "numeric" })}</td><td>{row.size.toLocaleString("vi-VN")}</td>{row.months.map((rate, index) => <td key={index}>{rate == null ? "—" : <span style={{ background: `rgba(10, 114, 82, ${Math.max(.12, rate)})` }}>{percent(rate)}</span>}</td>)}</tr>)}{!data.cohorts.length && <tr><td colSpan={9} className={styles.emptyCell}>Chưa có đăng ký xác minh được tracking trong 7 tháng gần đây.</td></tr>}</tbody></table></div>
        <p className={styles.cohortNote}>* Quy mô là số mã trình duyệt ẩn danh có đăng ký xác minh, không phải số tài khoản duy nhất. Một lượt quay lại được tính khi có phiên truy cập được ghi nhận trong tháng; không nối người dùng giữa nhiều thiết bị. T0 là tháng đăng ký, tháng hiện tại còn tạm tính; “—” là tháng chưa diễn ra.</p>
      </section>
    </div>
    {canManage && <section className={`${styles.panel} ${styles.spendPanel}`}>
      <div className={styles.panelHeading}><div><h3>Ghi chi phí chiến dịch</h3><p>Nhập chi phí Meta, Google hoặc kênh khác để tính CPA. Hiện chưa đồng bộ spend tự động từ nền tảng quảng cáo.</p></div></div>
      <form className={styles.spendForm} onSubmit={addSpend}>
        <label>Ngày<input type="date" required value={form.spentOn} onChange={(event) => setForm({ ...form, spentOn: event.target.value })}/></label>
        <label>Kênh<input required maxLength={120} placeholder="Facebook, Google…" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}/></label>
        <label>Tên chiến dịch<input required maxLength={160} placeholder="Tên campaign / utm_campaign" value={form.campaign} onChange={(event) => setForm({ ...form, campaign: event.target.value })}/></label>
        <label>Chi phí (₫)<input required type="number" min="1" step="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })}/></label>
        <label>Ghi chú<input maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
        <button type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu chi phí"}</button>
      </form>
      {data.spends.length > 0 && <div className={styles.spendList}><strong>Chi phí đã ghi trong kỳ</strong>{data.spends.slice(0, 8).map((row) => <div key={row.id}><span>{row.spentOn} · {row.source} / {row.campaign}</span><strong>{money(row.amount)}</strong></div>)}</div>}
    </section>}
    <p className={styles.footnote}>Dữ liệu truy cập bắt đầu từ khi tracking được bật, không hồi tố. Khách được tính duy nhất bằng mã ẩn danh của trình duyệt; không lưu email, số điện thoại, nội dung URL query hoặc địa chỉ IP trong bảng Marketing.</p>
  </div>;
}
