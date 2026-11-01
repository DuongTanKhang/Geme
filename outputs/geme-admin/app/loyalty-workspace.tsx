"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./loyalty-workspace.module.css";

type Settings = { enabled: boolean; spendPerPoint: number; pointsPerSpend: number; pointValueVnd: number; minimumRedeemPoints: number; maximumRedeemPercent: number };
type Customer = { id: string; name: string; email: string; phone: string; points: number };
type Ledger = { id: string; type: string; status: string; points: number; amountVnd?: number | string | null; note?: string | null; createdAt: string; customer?: { name?: string; email?: string; phone?: string } };
type Overview = { settings: Settings; customers: Customer[]; ledger: Ledger[] };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<any>; canManage: boolean; onNotify: (message: string) => void };

const initial: Settings = { enabled: false, spendPerPoint: 10000, pointsPerSpend: 1, pointValueVnd: 100, minimumRedeemPoints: 500, maximumRedeemPercent: 20 };
const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value || 0)} ₫`;

export default function LoyaltyWorkspace({ request, canManage, onNotify }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await request("loyalty?limit=100") as Overview;
      setOverview(result);
      setSettings(result.settings || initial);
      setCustomerId((current) => current || result.customers?.[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được dữ liệu điểm thưởng."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function saveSettings() {
    setSaving(true); setError("");
    try { await request("loyalty/settings", "PATCH", settings); onNotify("Đã lưu cấu hình điểm thưởng."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không lưu được cấu hình."); }
    finally { setSaving(false); }
  }

  async function adjust() {
    const amount = Number(points);
    if (!customerId || !Number.isSafeInteger(amount) || amount === 0 || note.trim().length < 5) { setError("Chọn khách hàng, nhập số điểm khác 0 và lý do tối thiểu 5 ký tự."); return; }
    setAdjusting(true); setError("");
    try {
      await request(`loyalty/customers/${encodeURIComponent(customerId)}/adjustment`, "POST", { points: amount, note: note.trim() });
      onNotify("Đã điều chỉnh điểm và ghi vào sổ kiểm toán."); setPoints(""); setNote(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không điều chỉnh được điểm."); }
    finally { setAdjusting(false); }
  }

  const customers = overview?.customers || [];
  const totalPoints = customers.reduce((sum, customer) => sum + Number(customer.points || 0), 0);
  const activeMembers = customers.filter((customer) => Number(customer.points) > 0).length;
  return <div className={styles.workspace}>
    <div className="page-heading"><div><h1>Điểm thưởng</h1><p>Cấu hình tích điểm, đổi điểm và kiểm tra lịch sử giao dịch của thành viên.</p></div><button className="button button-quiet" type="button" onClick={() => void load()} disabled={loading}>Làm mới</button></div>
    <section className={styles.cards} aria-label="Tổng quan điểm thưởng"><article className={styles.card}><span>Thành viên có điểm</span><strong>{activeMembers.toLocaleString("vi-VN")}</strong></article><article className={styles.card}><span>Điểm khả dụng trong danh sách</span><strong>{totalPoints.toLocaleString("vi-VN")}</strong></article><article className={styles.card}><span>Giao dịch gần đây</span><strong>{overview?.ledger.length || 0}</strong></article></section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.panel}>
      <h2>Quy tắc chương trình</h2>
      <p>Điểm chỉ được cộng cho đơn phát sinh từ ngày bật chương trình, sau khi giao thành công và thu đủ tiền. Đơn cũ không được cộng hồi tố. Điểm đổi được giữ chỗ khi đặt đơn và chỉ trừ khi thanh toán đủ.</p>
      <label className={styles.toggle}><input type="checkbox" checked={settings.enabled} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}/> Bật chương trình tích điểm</label>
      <div className={styles.settings}>
        <label className={styles.field}>Chi tiêu để nhận điểm (₫)<input type="number" min={1} max={100000000} value={settings.spendPerPoint} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, spendPerPoint: Number(event.target.value) }))}/></label>
        <label className={styles.field}>Điểm nhận mỗi mốc<input type="number" min={1} value={settings.pointsPerSpend} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, pointsPerSpend: Number(event.target.value) }))}/></label>
        <label className={styles.field}>Giá trị mỗi điểm (₫)<input type="number" min={1} value={settings.pointValueVnd} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, pointValueVnd: Number(event.target.value) }))}/></label>
        <label className={styles.field}>Tối thiểu để đổi điểm<input type="number" min={1} value={settings.minimumRedeemPoints} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, minimumRedeemPoints: Number(event.target.value) }))}/></label>
        <label className={styles.field}>Tối đa giá trị đơn được giảm (%)<input type="number" min={1} max={100} value={settings.maximumRedeemPercent} disabled={!canManage} onChange={(event) => setSettings((current) => ({ ...current, maximumRedeemPercent: Number(event.target.value) }))}/></label>
      </div>
      {canManage && <div className={styles.actions}><button className={styles.button} type="button" onClick={() => void saveSettings()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu quy tắc"}</button></div>}
    </section>
    <section className={styles.panel}>
      <h2>Điều chỉnh điểm thủ công</h2><p>Ghi điểm cộng hoặc trừ có lý do; mỗi thay đổi được lưu vào sổ giao dịch và audit log.</p>
      <div className={styles.adjust}>
        <label>Khách hàng<select value={customerId} disabled={!canManage || !customers.length} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.email || customer.phone || customer.id} · {customer.points.toLocaleString("vi-VN")} điểm</option>)}</select></label>
        <label>Điểm (+/−)<input type="number" step={1} value={points} disabled={!canManage} onChange={(event) => setPoints(event.target.value)} placeholder="Ví dụ 100 hoặc -50"/></label>
        <label>Lý do<textarea rows={1} maxLength={500} value={note} disabled={!canManage} onChange={(event) => setNote(event.target.value)} placeholder="Nhập lý do điều chỉnh"/></label>
        {canManage && <button className={styles.button} type="button" onClick={() => void adjust()} disabled={adjusting}>{adjusting ? "Đang lưu…" : "Điều chỉnh"}</button>}
      </div>
    </section>
    <section className={styles.panel}>
      <h2>Sổ điểm gần đây</h2>
      {loading && <p>Đang tải dữ liệu…</p>}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Thời gian</th><th>Khách hàng</th><th>Giao dịch</th><th>Điểm</th><th>Giá trị</th><th>Trạng thái</th></tr></thead><tbody>
        {overview?.ledger.length ? overview.ledger.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("vi-VN")}</td><td>{entry.customer?.name || entry.customer?.email || entry.customer?.phone || "—"}</td><td title={entry.note || ""}>{entry.note || entry.type}</td><td className={entry.points >= 0 ? styles.positive : styles.negative}>{entry.points > 0 ? "+" : ""}{entry.points.toLocaleString("vi-VN")}</td><td>{entry.amountVnd == null ? "—" : money(Number(entry.amountVnd))}</td><td>{entry.status}</td></tr>) : !loading && <tr><td colSpan={6}>Chưa có giao dịch điểm thưởng.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
