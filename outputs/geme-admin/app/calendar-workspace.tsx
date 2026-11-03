"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type AdminCalendarEvent = { id: string; title: string; description?: string | null; location?: string | null; startsAt: string; endsAt: string; allDay: boolean; createdByAdminId?: string | null };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<unknown>; canManage: boolean };
type Draft = { title: string; description: string; location: string; startsAt: string; endsAt: string; allDay: boolean };
const viDate = (date: Date, options: Intl.DateTimeFormatOptions = {}) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...options }).format(date);
const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const vnDateKey = (isoDate: string) => dateTimeLocalValue(new Date(isoDate)).slice(0, 10);
const dateOnly = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
const shiftDate = (date: string, amount: number) => { const [year, month, day] = date.split("-").map(Number); return dateOnly(new Date(Date.UTC(year, month - 1, day + amount))); };
const vnMidnight = (date: string) => { const [year, month, day] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day, -7)); };
const dateTimeLocalValue = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key: string) => parts.find((part) => part.type === key)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};
const emptyDraft = (date: string): Draft => ({ title: "", description: "", location: "", startsAt: `${date}T10:00`, endsAt: `${date}T11:00`, allDay: false });
const draftFrom = (event: AdminCalendarEvent): Draft => ({ title: event.title, description: event.description || "", location: event.location || "", startsAt: dateTimeLocalValue(new Date(event.startsAt)), endsAt: dateTimeLocalValue(new Date(event.endsAt)), allDay: event.allDay });
const bodyFrom = (draft: Draft) => ({ title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), startsAt: new Date(`${draft.startsAt}:00+07:00`).toISOString(), endsAt: new Date(`${draft.endsAt}:00+07:00`).toISOString(), allDay: draft.allDay });
const monthName = (date: string) => viDate(vnMidnight(date), { month: "long", year: "numeric" });

export default function CalendarWorkspace({ request, canManage }: Props) {
  const [month, setMonth] = useState(() => vnToday().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(vnToday);
  const [events, setEvents] = useState<AdminCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const days = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(Date.UTC(year, monthNumber - 1, 1));
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    const gridStart = dateOnly(new Date(Date.UTC(year, monthNumber - 1, 1 - mondayOffset)));
    return Array.from({ length: 42 }, (_, index) => shiftDate(gridStart, index));
  }, [month]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const from = vnMidnight(days[0]);
    const to = vnMidnight(shiftDate(days[days.length - 1], 1));
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    try { setEvents(await request(`admin/calendar/events?${query}`) as AdminCalendarEvent[]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được lịch sự kiện."); }
    finally { setLoading(false); }
  }, [days, request]);
  useEffect(() => { void load(); }, [load]);

  const selectedEvents = events.filter((event) => vnDateKey(event.startsAt) <= selectedDate && vnDateKey(event.endsAt) >= selectedDate).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const openCreate = (date = selectedDate) => { setSelectedDate(date); setEditingId(""); setDraft(emptyDraft(date)); setNotice(""); };
  const openEdit = (event: AdminCalendarEvent) => { setEditingId(event.id); setDraft(draftFrom(event)); setNotice(""); };
  const moveMonth = (delta: number) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const save = async (form: Draft) => {
    if (saving) return;
    setSaving(true); setNotice("");
    try {
      const route = editingId ? `admin/calendar/events/${encodeURIComponent(editingId)}` : "admin/calendar/events";
      await request(route, editingId ? "PATCH" : "POST", bodyFrom(form));
      setDraft(null); setEditingId(""); setNotice("Đã lưu sự kiện."); await load();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Không thể lưu sự kiện."); }
    finally { setSaving(false); }
  };
  const remove = async (event: AdminCalendarEvent) => {
    if (!window.confirm(`Xóa sự kiện “${event.title}”?`)) return;
    setNotice("");
    try { await request(`admin/calendar/events/${encodeURIComponent(event.id)}`, "DELETE"); setNotice("Đã xóa sự kiện."); await load(); }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : "Không thể xóa sự kiện."); }
  };

  return <div className="admin-calendar-workspace">
    <div className="admin-calendar-heading"><div><span className="eyebrow">KẾ HOẠCH &amp; NHẮC VIỆC · GIỜ VIỆT NAM</span><h1>Lịch sự kiện</h1><p>Lên lịch công việc và sự kiện. Các lịch trong ngày sẽ hiện khi quản trị viên mở Admin lần đầu trong ngày.</p></div><div className="admin-calendar-heading-actions"><button type="button" className="button button-quiet" onClick={() => void load()} disabled={loading}>{loading ? "Đang tải…" : "Làm mới"}</button>{canManage && <button type="button" className="button button-primary" onClick={() => openCreate()}>+ Thêm sự kiện</button>}</div></div>
    {error && <div className="calendar-error" role="alert">{error}</div>}{notice && <div className="calendar-notice" role="status">{notice}</div>}
    <div className="admin-calendar-layout">
      <section className="admin-calendar-month panel" aria-label="Lịch tháng">
        <header className="admin-calendar-month-header"><div><span className="eyebrow">LỊCH THÁNG</span><h2>{monthName(`${month}-01`)}</h2></div><div><button type="button" className="button button-quiet" aria-label="Tháng trước" onClick={() => moveMonth(-1)}>‹</button><button type="button" className="button button-quiet" onClick={() => { setMonth(vnToday().slice(0, 7)); setSelectedDate(vnToday()); }}>Hôm nay</button><button type="button" className="button button-quiet" aria-label="Tháng sau" onClick={() => moveMonth(1)}>›</button></div></header>
        <div className="admin-calendar-grid" role="grid"><div className="calendar-weekdays">{["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((name) => <span role="columnheader" key={name}>{name}</span>)}</div>{days.map((day) => {
          const [dayYear, dayMonth] = day.split("-");
          const dateEvents = events.filter((event) => vnDateKey(event.startsAt) <= day && vnDateKey(event.endsAt) >= day);
          return <button type="button" role="gridcell" key={day} className={`calendar-day ${dayMonth !== month.slice(5, 7) ? "is-outside" : ""} ${day === selectedDate ? "is-selected" : ""} ${day === vnToday() ? "is-today" : ""}`} onClick={() => setSelectedDate(day)} aria-label={`${Number(day.slice(8))} ${dayMonth}/${dayYear}, ${dateEvents.length} sự kiện`}><span>{Number(day.slice(8))}</span>{dateEvents.slice(0, 2).map((event) => <small key={event.id} title={event.title}>{event.title}</small>)}{dateEvents.length > 2 && <small className="calendar-more">+{dateEvents.length - 2} sự kiện</small>}</button>;
        })}</div>
        {loading && <p className="calendar-loading">Đang tải lịch…</p>}
      </section>
      <aside className="admin-calendar-agenda panel"><header><div><span className="eyebrow">LỊCH TRONG NGÀY</span><h2>{viDate(vnMidnight(selectedDate), { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</h2></div>{canManage && <button type="button" className="button button-primary" onClick={() => openCreate()}>+ Sự kiện</button>}</header>
        {selectedEvents.length ? <div className="calendar-event-list">{selectedEvents.map((event) => <article className="calendar-event-card" key={event.id}><div className="calendar-event-time">{event.allDay ? "Cả ngày" : `${viDate(new Date(event.startsAt), { hour: "2-digit", minute: "2-digit" })} – ${viDate(new Date(event.endsAt), { hour: "2-digit", minute: "2-digit" })}`}</div><h3>{event.title}</h3>{event.location && <p className="calendar-event-location">{event.location}</p>}{event.description && <p>{event.description}</p>}{canManage && <div className="calendar-event-actions"><button type="button" className="button button-quiet" onClick={() => openEdit(event)}>Sửa</button><button type="button" className="button button-quiet calendar-delete-button" onClick={() => void remove(event)}>Xóa</button></div>}</article>)}</div> : <div className="calendar-empty-state"><span aria-hidden="true">▦</span><strong>Chưa có sự kiện</strong><p>{canManage ? "Thêm sự kiện cho ngày này; Admin sẽ nhắc khi mở trang trong ngày." : "Chưa có lịch nào được tạo cho ngày này."}</p>{canManage && <button type="button" className="button button-quiet" onClick={() => openCreate()}>Tạo sự kiện</button>}</div>}
      </aside>
    </div>
    {draft && <div className="calendar-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setDraft(null); setEditingId(""); } }}><section className="calendar-event-dialog" role="dialog" aria-modal="true" aria-labelledby="calendarEventTitle"><header><div><span className="eyebrow">GEME ADMIN · LỊCH SỰ KIỆN</span><h2 id="calendarEventTitle">{editingId ? "Sửa sự kiện" : "Thêm sự kiện"}</h2></div><button type="button" className="icon-button" aria-label="Đóng" onClick={() => { setDraft(null); setEditingId(""); }}>×</button></header><form onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
      <label className="calendar-form-field">Tên sự kiện<input value={draft.title} onChange={(event) => setDraft((current) => current && ({ ...current, title: event.target.value }))} maxLength={160} required autoFocus placeholder="Ví dụ: Kiểm kê kho"/></label>
      <div className="calendar-form-row"><label className="calendar-form-field">Bắt đầu<input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft((current) => current && ({ ...current, startsAt: event.target.value }))} required/></label><label className="calendar-form-field">Kết thúc<input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft((current) => current && ({ ...current, endsAt: event.target.value }))} required/></label></div>
      <label className="calendar-form-field">Địa điểm (nếu có)<input value={draft.location} onChange={(event) => setDraft((current) => current && ({ ...current, location: event.target.value }))} maxLength={160} placeholder="Địa điểm"/></label>
      <label className="calendar-form-field">Ghi chú<textarea value={draft.description} onChange={(event) => setDraft((current) => current && ({ ...current, description: event.target.value }))} maxLength={2000} rows={3} placeholder="Thông tin thêm"/></label>
      <label className="calendar-all-day"><input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft((current) => current && ({ ...current, allDay: event.target.checked }))}/> Cả ngày</label>
      {notice && <div className="calendar-error" role="alert">{notice}</div>}<footer><button type="button" className="button button-quiet" disabled={saving} onClick={() => { setDraft(null); setEditingId(""); }}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu sự kiện"}</button></footer>
      </form></section></div>}
  </div>;
}

export function TodayEventsModal({ events, date, onClose }: { events: AdminCalendarEvent[]; date: string; onClose: () => void }) {
  if (!events.length) return null;
  return <div className="calendar-modal-backdrop calendar-reminder-backdrop"><section className="calendar-reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="calendarReminderTitle"><span className="calendar-reminder-icon" aria-hidden="true">▦</span><span className="eyebrow">NHẮC LỊCH · {date}</span><h2 id="calendarReminderTitle">Sự kiện hôm nay</h2><p className="calendar-reminder-subtitle">Admin đang có {events.length} lịch cần lưu ý.</p><div className="calendar-reminder-list">{events.map((event) => <article key={event.id}><strong>{event.allDay ? "Cả ngày" : viDate(new Date(event.startsAt), { hour: "2-digit", minute: "2-digit" })}</strong><div><b>{event.title}</b>{event.location && <small>{event.location}</small>}{event.description && <p>{event.description}</p>}</div></article>)}</div><button type="button" className="button button-primary" onClick={onClose}>Đã xem</button></section></div>;
}
