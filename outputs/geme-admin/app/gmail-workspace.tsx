"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./gmail-workspace.module.css";

type ApiRequest = (path: string, method?: string, body?: unknown) => Promise<any>;
type GmailStatus = { configured: boolean; missingConfiguration: string[]; invalidConfiguration: string[]; encryptionConfigured: boolean; redirectUri: string | null; requiredScopes: string[]; connection: null | { id: string; email: string; status: string; scopes: string[]; createdAt: string } };
type MailItem = { id: string; draftId?: string; threadId?: string; labelIds: string[]; snippet: string; internalDate: string | null; from: string; to: string; subject: string; date: string; isUnread: boolean; isStarred: boolean; hasAttachment?: boolean };
type MailFolder = { id: string; label: string; icon: string; labelId?: string };
type ComposeDraft = { draftId?: string; to: string; subject: string; body: string };

const folders: MailFolder[] = [
  { id: "inbox", label: "Hộp thư đến", icon: "▱" },
  { id: "starred", label: "Có gắn dấu sao", icon: "☆" },
  { id: "sent", label: "Đã gửi", icon: "➤" },
  { id: "drafts", label: "Thư nháp", icon: "▤" },
  { id: "trash", label: "Thùng rác", icon: "▣" },
];

function errorText(error: unknown) { return error instanceof Error ? error.message : "Không thể hoàn tất thao tác Gmail."; }
function dateText(value: string | null, fallback: string) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function GmailWorkspace({ request }: { request: ApiRequest }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [items, setItems] = useState<MailItem[]>([]);
  const [folder, setFolder] = useState("inbox");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<(MailItem & { bodyText?: string; attachments?: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> }) | null>(null);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const connected = status?.connection?.status === "ACTIVE";
  const currentFolder = useMemo(() => folders.find((item) => item.id === folder)?.label || (folder.startsWith("label:") ? labels.find((item) => item.id === folder.slice(6))?.name : "") || "Nhãn Gmail", [folder, labels]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await request("admin/gmail/status") as GmailStatus;
      setStatus(result);
      setError("");
      return result;
    } catch (reason) {
      setError(errorText(reason));
      return null;
    } finally { setStatusLoading(false); }
  }, [request]);

  const loadMessages = useCallback(async (options?: { reset?: boolean; folderId?: string; search?: string; pageToken?: string | null }) => {
    const selectedFolder = options?.folderId ?? folder;
    const selectedQuery = options?.search ?? appliedQuery;
    const token = options?.reset ? null : options?.pageToken || null;
    setLoading(true);
    setError("");
    try {
      if (selectedFolder === "drafts") {
        const params = new URLSearchParams({ maxResults: "25" });
        if (selectedQuery) params.set("q", selectedQuery);
        if (token) params.set("pageToken", token);
        const result = await request(`admin/gmail/drafts?${params.toString()}`);
        setItems((current) => options?.reset ? result.drafts || [] : [...current, ...(result.drafts || [])]);
        setNextPageToken(result.nextPageToken || null);
      } else {
        const labelFolder = selectedFolder.startsWith("label:");
        const params = new URLSearchParams({ folder: labelFolder ? "label" : selectedFolder, maxResults: "25" });
        if (selectedQuery) params.set("q", selectedQuery);
        if (labelFolder) params.set("labelId", selectedFolder.slice(6));
        if (token) params.set("pageToken", token);
        const result = await request(`admin/gmail/messages?${params.toString()}`);
        setItems((current) => options?.reset ? result.messages || [] : [...current, ...(result.messages || [])]);
        setNextPageToken(result.nextPageToken || null);
      }
    } catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }, [appliedQuery, folder, request]);

  const loadLabels = useCallback(async () => {
    try {
      const result = await request("admin/gmail/labels");
      setLabels((result.labels || []).filter((label: { id: string; name: string; type?: string }) => label.type === "user" && label.id && label.name));
    } catch { setLabels([]); }
  }, [request]);

  const refresh = useCallback(async () => {
    const fresh = await loadStatus();
    if (fresh?.connection?.status === "ACTIVE") {
      await loadMessages({ reset: true });
      await loadLabels();
    } else { setItems([]); setLabels([]); }
  }, [loadLabels, loadMessages, loadStatus]);

  useEffect(() => {
    let callbackNotice = "";
    const url = new URL(window.location.href);
    const result = url.searchParams.get("gmail");
    if (result === "connected") callbackNotice = "Đã kết nối hộp thư Gmail.";
    else if (result === "denied") callbackNotice = "Bạn đã từ chối cấp quyền Gmail.";
    else if (result === "error") callbackNotice = "Kết nối Gmail chưa hoàn tất. Kiểm tra cấu hình và thử lại.";
    if (result) {
      setNotice(callbackNotice);
      url.searchParams.delete("gmail");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (connected) void loadMessages({ reset: true });
  }, [folder, appliedQuery, connected, loadMessages]);

  useEffect(() => { if (connected) void loadLabels(); }, [connected, loadLabels]);

  async function startConnect() {
    setWorking(true); setError(""); setNotice("");
    try {
      const result = await request("admin/gmail/authorize", "POST", {});
      if (typeof result.authorizationUrl !== "string" || !result.authorizationUrl.startsWith("https://accounts.google.com/")) throw new Error("API không trả URL OAuth Google hợp lệ.");
      window.location.assign(result.authorizationUrl);
    } catch (reason) { setError(errorText(reason)); setWorking(false); }
  }

  async function disconnect() {
    if (!window.confirm(`Ngắt hộp thư ${status?.connection?.email || "Gmail"} khỏi GEME Admin?`)) return;
    setWorking(true); setError("");
    try { await request("admin/gmail/connection", "DELETE"); setSelected(null); setItems([]); await loadStatus(); setNotice("Đã ngắt kết nối Gmail."); }
    catch (reason) { setError(errorText(reason)); }
    finally { setWorking(false); }
  }

  async function openItem(item: MailItem) {
    setError(""); setSelected(null);
    try {
      const detail = folder === "drafts" && item.draftId
        ? await request(`admin/gmail/drafts/${encodeURIComponent(item.draftId)}`)
        : await request(`admin/gmail/messages/${encodeURIComponent(item.id)}`);
      setSelected({ ...item, ...detail });
      if (folder !== "drafts" && item.isUnread) {
        await request(`admin/gmail/messages/${encodeURIComponent(item.id)}/modify`, "POST", { isRead: true });
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isUnread: false } : entry));
      }
    } catch (reason) { setError(errorText(reason)); }
  }

  async function mutateMessage(action: "star" | "unstar" | "archive" | "trash" | "restore" | "unread") {
    if (!selected) return;
    setWorking(true); setError("");
    try {
      if (action === "archive") await request(`admin/gmail/messages/${encodeURIComponent(selected.id)}/archive`, "POST", {});
      else if (action === "trash") await request(`admin/gmail/messages/${encodeURIComponent(selected.id)}/trash`, "POST", {});
      else if (action === "restore") await request(`admin/gmail/messages/${encodeURIComponent(selected.id)}/restore`, "POST", {});
      else await request(`admin/gmail/messages/${encodeURIComponent(selected.id)}/modify`, "POST", action === "unread" ? { isRead: false } : { isStarred: action === "star" });
      setSelected(null);
      await loadMessages({ reset: true });
    } catch (reason) { setError(errorText(reason)); }
    finally { setWorking(false); }
  }

  function beginCompose(draft?: ComposeDraft) { setCompose(draft || { to: "", subject: "", body: "" }); setError(""); }

  async function saveComposeDraft(event?: FormEvent) {
    event?.preventDefault();
    if (!compose) return;
    setWorking(true); setError("");
    try {
      const payload = { to: compose.to, subject: compose.subject, body: compose.body };
      const result = compose.draftId
        ? await request(`admin/gmail/drafts/${encodeURIComponent(compose.draftId)}`, "PUT", payload)
        : await request("admin/gmail/drafts", "POST", payload);
      const draftId = result.draftId || result.id || compose.draftId;
      setCompose({ ...compose, draftId });
      setNotice("Đã lưu thư nháp.");
      if (folder === "drafts") await loadMessages({ reset: true });
    } catch (reason) { setError(errorText(reason)); }
    finally { setWorking(false); }
  }

  async function sendCompose(event: FormEvent) {
    event.preventDefault();
    if (!compose) return;
    if (!window.confirm(`Gửi thư đến ${compose.to}?`)) return;
    setWorking(true); setError("");
    try {
      const payload = { to: compose.to, subject: compose.subject, body: compose.body };
      if (compose.draftId) {
        await request(`admin/gmail/drafts/${encodeURIComponent(compose.draftId)}`, "PUT", payload);
        await request(`admin/gmail/drafts/${encodeURIComponent(compose.draftId)}/send`, "POST", {});
      } else await request("admin/gmail/messages/send", "POST", payload);
      setCompose(null); setNotice("Đã gửi thư qua Gmail.");
      if (folder === "sent" || folder === "drafts") await loadMessages({ reset: true });
    } catch (reason) { setError(errorText(reason)); }
    finally { setWorking(false); }
  }

  async function deleteDraft() {
    if (!compose?.draftId || !window.confirm("Xóa thư nháp này?")) return;
    setWorking(true);
    try { await request(`admin/gmail/drafts/${encodeURIComponent(compose.draftId)}`, "DELETE"); setCompose(null); setNotice("Đã xóa thư nháp."); await loadMessages({ reset: true }); }
    catch (reason) { setError(errorText(reason)); }
    finally { setWorking(false); }
  }

  function submitSearch(event: FormEvent) { event.preventDefault(); setAppliedQuery(query.trim()); setItems([]); }

  return (
    <section className={styles.page} aria-labelledby="gmail-heading">
      <div className={styles.toolbar}>
        <div><span className={styles.eyebrow}>KẾT NỐI & QUẢN TRỊ</span><h1 id="gmail-heading">Gmail</h1><p>Hộp thư Gmail của GEME, tách riêng khỏi tin nhắn gửi từ website.</p></div>
        <div className={styles.toolbarActions}>
          {connected ? <><span className={`${styles.status} ${styles.connected}`}><i />{status?.connection?.email}</span><button className={styles.secondaryButton} type="button" onClick={() => void refresh()} disabled={statusLoading || loading}>Làm mới</button><button className={styles.secondaryButton} type="button" onClick={() => void disconnect()} disabled={working}>Ngắt kết nối</button></> : <span className={styles.status}><i />{statusLoading ? "Đang kiểm tra" : status?.connection?.status === "REAUTH_REQUIRED" ? "Cần cấp quyền lại" : "Chưa kết nối"}</span>}
        </div>
      </div>

      {notice && <div className={styles.success} role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Đóng">×</button></div>}
      {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Đóng">×</button></div>}

      {!connected ? <div className={styles.setupCard}>
        <div className={styles.emptyIcon} aria-hidden="true">✉</div>
        <h2>{status?.connection?.status === "REAUTH_REQUIRED" ? "Cần cấp quyền Gmail lại" : "Kết nối hộp thư Gmail"}</h2>
        <p>Kết nối một hộp thư Gmail để đọc, tìm kiếm, soạn và gửi thư trực tiếp trong Admin.</p>
        {status?.missingConfiguration?.length || status?.invalidConfiguration?.length ? <div className={styles.configNotice}><strong>API cần cấu hình trên server</strong><span>{[...(status.missingConfiguration || []), ...(status.invalidConfiguration || [])].join(" · ")}</span></div> : null}
        {status?.connection?.status === "REAUTH_REQUIRED" && <p className={styles.subtle}>Phiên ủy quyền đã hết hạn hoặc bị thu hồi. Kết nối lại để cấp quyền.</p>}
        <button className={styles.primaryButton} type="button" onClick={() => void startConnect()} disabled={working || statusLoading || !status?.configured}>{working ? "Đang chuyển đến Google…" : "Kết nối với Google"}</button>
        <p className={styles.scopeNote}>GEME yêu cầu quyền quản lý thư Gmail. Token được mã hóa ở server; Admin chỉ nhận nội dung hiển thị cần thiết.</p>
      </div> : <div className={styles.mailFrame}>
        <aside className={styles.sidebar} aria-label="Thư mục Gmail">
          <button className={styles.compose} type="button" onClick={() => beginCompose()}>＋　Soạn thư</button>
          <nav>{folders.map((item) => <button key={item.id} type="button" className={`${styles.folder} ${folder === item.id ? styles.active : ""}`} onClick={() => { setFolder(item.id); setSelected(null); setItems([]); }}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
            {labels.map((item) => <button key={item.id} type="button" className={`${styles.folder} ${folder === `label:${item.id}` ? styles.active : ""}`} onClick={() => { setFolder(`label:${item.id}`); setSelected(null); setItems([]); }}><span aria-hidden="true">◇</span>{item.name}</button>)}
          </nav>
          <p className={styles.separation}>Thư và nội dung đồng bộ trực tiếp qua Gmail API.</p>
        </aside>

        <div className={styles.inbox}>
          <div className={styles.inboxToolbar}>
            <strong>{currentFolder}</strong>
            <form className={styles.search} onSubmit={submitSearch}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kiếm trong Gmail" aria-label="Tìm kiếm trong Gmail"/><button type="submit">Tìm</button></form>
            <button className={styles.refreshButton} type="button" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới thư mục">↻</button>
          </div>
          {selected ? <article className={styles.messageDetail}>
            <div className={styles.messageActions}><button type="button" onClick={() => setSelected(null)}>← Quay lại</button>{folder === "trash" ? <button type="button" disabled={working} onClick={() => void mutateMessage("restore")}>Khôi phục</button> : <><button type="button" disabled={working} onClick={() => void mutateMessage(selected.isStarred ? "unstar" : "star")}>{selected.isStarred ? "★ Bỏ sao" : "☆ Đánh dấu sao"}</button><button type="button" disabled={working} onClick={() => void mutateMessage("unread")}>Đánh dấu chưa đọc</button><button type="button" disabled={working} onClick={() => void mutateMessage("archive")}>Lưu trữ</button><button type="button" disabled={working} onClick={() => void mutateMessage("trash")}>Chuyển vào thùng rác</button></>}</div>
            <h2>{selected.subject}</h2><p className={styles.messageMeta}><strong>{selected.from || "(không rõ người gửi)"}</strong><span>Đến: {selected.to || "hộp thư GEME"}</span><time>{dateText(selected.internalDate, selected.date)}</time></p>
            <div className={styles.messageBody}>{selected.bodyText || "(Thư không có nội dung văn bản.)"}</div>
            {selected.attachments?.length ? <div className={styles.attachments}><strong>Tệp đính kèm</strong>{selected.attachments.map((item) => <span key={`${item.filename}-${item.attachmentId}`}>📎 {item.filename} · {Math.ceil(item.size / 1024)} KB</span>)}</div> : null}
          </article> : <>
            <div className={styles.messageList} aria-live="polite">
              {items.map((item) => <button key={item.draftId || item.id} type="button" className={`${styles.messageRow} ${item.isUnread ? styles.unread : ""}`} onClick={() => folder === "drafts" && item.draftId ? void request(`admin/gmail/drafts/${encodeURIComponent(item.draftId)}`).then((draft) => beginCompose({ draftId: item.draftId, to: draft.to || "", subject: draft.subject || "", body: draft.bodyText || "" })).catch((reason) => setError(errorText(reason))) : void openItem(item)}>
                <span className={styles.star}>{item.isStarred ? "★" : ""}</span><span className={styles.sender}>{item.from || item.to || "(không rõ người gửi)"}</span><span className={styles.messageCopy}><strong>{item.subject}</strong><span> — {item.snippet}</span></span>{item.hasAttachment && <span className={styles.attachmentMark} aria-label="Có tệp đính kèm">📎</span>}<time>{dateText(item.internalDate, item.date)}</time>
              </button>)}
              {!loading && !items.length && <div className={styles.listEmpty}>{error ? "Không tải được thư." : "Không có thư trong thư mục này."}</div>}
              {loading && <div className={styles.listEmpty}>Đang tải thư…</div>}
            </div>
            {nextPageToken && <div className={styles.pagination}><span>{items.length} thư đã tải</span><button type="button" onClick={() => void loadMessages({ pageToken: nextPageToken })} disabled={loading}>Tải thư cũ hơn</button></div>}
          </>}
        </div>
      </div>}

      {compose && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setCompose(null); }}>
        <form className={styles.composeModal} onSubmit={(event) => void sendCompose(event)}>
          <header><strong>{compose.draftId ? "Chỉnh sửa thư nháp" : "Thư mới"}</strong><button type="button" onClick={() => setCompose(null)} aria-label="Đóng" disabled={working}>×</button></header>
          <label>Đến<input type="text" value={compose.to} onChange={(event) => setCompose({ ...compose, to: event.target.value })} placeholder="email@example.com" autoFocus required/></label>
          <label>Tiêu đề<input type="text" value={compose.subject} onChange={(event) => setCompose({ ...compose, subject: event.target.value })} maxLength={998} required/></label>
          <label>Nội dung<textarea value={compose.body} onChange={(event) => setCompose({ ...compose, body: event.target.value })} rows={12} maxLength={100000} required/></label>
          <p className={styles.composeHint}>Hiện hỗ trợ thư văn bản thuần. Tệp đính kèm sẽ bổ sung sau.</p>
          <footer>{compose.draftId && <button type="button" className={styles.dangerButton} disabled={working} onClick={() => void deleteDraft()}>Xóa nháp</button>}<span/><button type="button" className={styles.secondaryButton} disabled={working} onClick={() => void saveComposeDraft()}>Lưu nháp</button><button type="submit" className={styles.primaryButton} disabled={working}>{working ? "Đang xử lý…" : "Gửi thư"}</button></footer>
        </form>
      </div>}
    </section>
  );
}
