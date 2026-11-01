"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  const [noteDialog, setNoteDialog] = useState<{ item: Inquiry; status: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await request("admin/contact-inquiries?limit=100"); setItems(Array.isArray(result) ? result : []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được tin nhắn liên hệ."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const saveStatus = async (item: Inquiry, status: string, note = "") => {
    setBusy(item.id); setError("");
    try { await request(`admin/contact-inquiries/${item.id}/status`, "PATCH", { status, note }); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái."); return false; }
    finally { setBusy(""); }
  };

  const changeStatus = (item: Inquiry, status: string) => {
    if (status === "RESOLVED" || status === "ARCHIVED") {
      setNoteDraft(""); setNoteError(""); setNoteDialog({ item, status });
      return;
    }
    void saveStatus(item, status);
  };

  const submitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!noteDialog) return;
    const note = noteDraft.trim();
    if (note.length < 5) { setNoteError("Vui lòng nhập ghi chú ít nhất 5 ký tự."); return; }
    if (await saveStatus(noteDialog.item, noteDialog.status, note)) setNoteDialog(null);
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
    {noteDialog && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setNoteDialog(null); }}>
      <section className={styles.noteDialog} role="dialog" aria-modal="true" aria-labelledby="contact-note-title" aria-describedby="contact-note-description">
        <span className={styles.dialogEyebrow}>HỖ TRỢ KHÁCH HÀNG</span>
        <h2 id="contact-note-title">{noteDialog.status === "RESOLVED" ? "Ghi chú xử lý" : "Lý do lưu trữ"}</h2>
        <p id="contact-note-description">{noteDialog.status === "RESOLVED" ? "Ghi lại nội dung xử lý để lưu cùng tin nhắn liên hệ." : "Nhập lý do lưu trữ tin nhắn này."} Tối thiểu 5 ký tự.</p>
        <form onSubmit={(event) => void submitNote(event)}>
          <label htmlFor="contact-resolution-note">Nội dung ghi chú</label>
          <textarea id="contact-resolution-note" autoFocus rows={4} maxLength={1000} value={noteDraft} onChange={(event) => { setNoteDraft(event.target.value); setNoteError(""); }} placeholder="Nhập ghi chú…" aria-invalid={Boolean(noteError)} aria-describedby={noteError ? "contact-note-error" : undefined} />
          {noteError && <small id="contact-note-error" className={styles.dialogError} role="alert">{noteError}</small>}
          <footer>
            <button className="button button-quiet" type="button" onClick={() => setNoteDialog(null)} disabled={Boolean(busy)}>Hủy</button>
            <button className="button button-primary" type="submit" disabled={Boolean(busy)}>{busy ? "Đang lưu…" : "Xác nhận"}</button>
          </footer>
        </form>
      </section>
    </div>}
  </div>;
}
