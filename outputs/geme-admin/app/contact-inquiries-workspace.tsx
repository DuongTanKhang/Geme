"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./contact-inquiries-workspace.module.css";

type Inquiry = { id: string; name: string; email: string; phone: string; subject: string; message: string; status: string; resolutionNote: string | null; createdAt: string; handledAt: string | null; handledBy?: { displayName: string } | null };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<any>; canManage: boolean };
const labels: Record<string, string> = { NEW: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã giải quyết", ARCHIVED: "Đã lưu trữ" };
const dates = (value: string) => new Date(value).toLocaleString("vi-VN");

export default function ContactInquiriesWorkspace({ request, canManage }: Props) {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await request("admin/contact-inquiries?limit=100"); setItems(Array.isArray(result) ? result : []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được tin nhắn liên hệ."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const changeStatus = async (item: Inquiry, status: string) => {
    let note = "";
    if (status === "RESOLVED" || status === "ARCHIVED") {
      note = window.prompt(status === "RESOLVED" ? "Ghi chú xử lý (tối thiểu 5 ký tự)" : "Lý do lưu trữ (tối thiểu 5 ký tự)")?.trim() || "";
      if (note.length < 5) return;
    }
    setBusy(item.id); setError("");
    try { await request(`admin/contact-inquiries/${item.id}/status`, "PATCH", { status, note }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái."); }
    finally { setBusy(""); }
  };

  return <div className={styles.workspace}>
    <header className={styles.header}><div><span className={styles.eyebrow}>GEME · HỖ TRỢ KHÁCH HÀNG</span><h1>Tin nhắn liên hệ</h1><p>Biểu mẫu trên website được lưu tại đây; việc gửi biểu mẫu không đồng nghĩa đã gửi email.</p></div><button className="button button-quiet" type="button" onClick={() => void load()} disabled={loading}>Làm mới</button></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <div className={styles.empty}>Đang tải tin nhắn…</div> : items.length ? <section className={styles.list} aria-label="Danh sách tin nhắn">
      {items.map((item) => <article className={styles.card} key={item.id}>
        <div className={styles.cardHead}><div><span className={styles.subject}>{item.subject}</span><h2>{item.name}</h2><small>{dates(item.createdAt)}</small></div><span className={`${styles.status} ${styles[item.status.toLowerCase()] || ""}`}>{labels[item.status] || item.status}</span></div>
        <div className={styles.contacts}><a href={`mailto:${encodeURIComponent(item.email)}`}>{item.email}</a><a href={`tel:${encodeURIComponent(item.phone)}`}>{item.phone}</a></div>
        <p className={styles.message}>{item.message}</p>
        {item.resolutionNote && <small className={styles.note}>Ghi chú xử lý: {item.resolutionNote}</small>}
        <div className={styles.actions}><a className="button button-quiet" href={`mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent("GEME · " + item.subject)}`}>Trả lời email</a>{canManage && item.status === "NEW" && <button className="button button-primary" disabled={busy === item.id} onClick={() => void changeStatus(item, "IN_PROGRESS")}>Nhận xử lý</button>}{canManage && ["NEW", "IN_PROGRESS"].includes(item.status) && <button className="button button-primary" disabled={busy === item.id} onClick={() => void changeStatus(item, "RESOLVED")}>Đánh dấu đã giải quyết</button>}{canManage && item.status !== "ARCHIVED" && <button className="button button-quiet" disabled={busy === item.id} onClick={() => void changeStatus(item, "ARCHIVED")}>Lưu trữ</button>}</div>
      </article>)}
    </section> : <div className={styles.empty}>Chưa có tin nhắn liên hệ.</div>}
  </div>;
}
