"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiBaseUrl } from "../lib/api";

type Mode = "sales" | "marketing";
type Status = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type SalesProduct = { id: string; sku: string; name: string; slug: string; category: string | null; gemstone: string | null; material: string | null; availableQuantity: number };
type SalesKnowledge = { id: string; documentKey: string; version: number; title: string; topic: string; sourceLabel: string; content: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; effectiveFrom: string | null; expiresAt: string | null };
type SalesCitation = { id: string; version: number; title: string; topic: string; source: string };
type SalesTask = { id: string; status: Status; result?: Record<string, unknown> | null; errorMessage?: string | null; input?: { catalog?: SalesProduct[]; knowledge?: SalesKnowledge[] } };
type RecommendedProduct = { id: string; name: string; sku: string; slug: string; category: string | null; gemstone: string | null; material: string | null; price: number | null; availableQuantity: number; publicPath: string };
type MarketingDraft = { id: string; revision: number; status: string; channel: string; objective: string; title: string; caption: string; body: string; callToAction: string; seoTitle: string; seoDescription: string; altText: string; hashtags: string[]; sourceProductIds: string[]; sourceFacts: Record<string, unknown>[]; factWarnings: string[]; createdAt: string; decisionNote?: string | null; errorCode?: string | null; task: { id: string; status: string; errorMessage?: string | null }; reviewedBy?: { displayName: string } | null };
type Analytics = { periodDays: number; sales: { totalQuestions: number; handoffCount: number; unresolvedCount: number; productClicks: number }; marketing: { draftCount: number; approvedCount: number } };

const channelLabels: Record<string, string> = { THREADS: "Threads", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", BLOG: "Blog GEME", EMAIL: "Email draft", BANNER: "Banner" };
const statusLabels: Record<string, string> = { QUEUED: "Đang chờ", RUNNING: "Đang tạo", GENERATING: "Đang tạo", DRAFT: "Chờ rà soát", APPROVED: "Đã duyệt nội dung", REJECTED: "Cần chỉnh sửa", FAILED: "Tạo thất bại", CANCELLED: "Đã hủy", ACTIVE: "Đang áp dụng", ARCHIVED: "Lưu phiên bản cũ" };

function marketingFailureMessage(draft: MarketingDraft) {
  if (draft.errorCode === "OPENAI_AGENT_REQUEST_REJECTED") return "OpenAI từ chối yêu cầu (HTTP 400), không phải lỗi hết tín dụng. Cần kiểm tra log AI Core để xem mã lỗi hoặc tham số bị từ chối.";
  if (draft.errorCode === "OPENAI_AGENT_QUOTA_EXCEEDED") return "OpenAI báo hết quota/tín dụng hoặc chạm giới hạn ngân sách của project.";
  if (draft.errorCode === "OPENAI_AGENT_AUTH_FAILED") return "OpenAI từ chối API key đang cấu hình cho AI Core.";
  return draft.task?.errorMessage || draft.errorCode || "Không tạo được nội dung.";
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/admin/ai-studio/phase4/${path.replace(/^\//, "")}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (!response.ok) throw new ApiRequestError(Array.isArray(body.message) ? body.message.join(" ") : body.message || `API trả về lỗi ${response.status}.`, response.status);
  return body as T;
}

function taskRequest<T>(path: string): Promise<T> {
  return fetch(`${apiBaseUrl}/admin/${path.replace(/^\//, "")}`, { cache: "no-store", credentials: "include" }).then(async (response) => {
    const body = await response.json().catch(() => ({})) as { message?: string | string[] };
    if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || `API trả về lỗi ${response.status}.`);
    return body as T;
  });
}

function useNotice() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const clear = useCallback(() => { setError(""); setNotice(""); }, []);
  return useMemo(() => ({ error, setError, notice, setNotice, clear }), [error, notice, clear]);
}

export function AiPhaseFourWorkspace({ mode }: { mode: Mode }) {
  const [subtab, setSubtab] = useState(mode === "sales" ? "consult" : "create");
  const alerts = useNotice();
  return <section className="ai-phase4">
    <header className="ai-phase4-hero"><div><span className="ai-section-kicker">GEME INTELLIGENCE · PHASE 4</span><h3>{mode === "sales" ? "Sales Agent" : "Marketing Agent"}</h3><p>{mode === "sales" ? "Tư vấn thử nghiệm nội bộ từ sản phẩm đang bán và chính sách GEME đã được kích hoạt." : "Tạo nội dung theo dữ liệu sản phẩm đã duyệt, sau đó chỉnh sửa và duyệt trước khi sử dụng."}</p></div><span className="ai-phase4-mark">{mode === "sales" ? "✦" : "Aa"}</span></header>
    <div className="ai-phase4-alerts">{alerts.error && <div className="ai-studio-alert ai-studio-alert-error" role="alert"><span>!</span><p>{alerts.error}</p><button type="button" onClick={() => alerts.setError("")}>Đóng</button></div>}{alerts.notice && <div className="ai-studio-alert ai-studio-alert-success" role="status"><span>✓</span><p>{alerts.notice}</p><button type="button" onClick={() => alerts.setNotice("")}>Đóng</button></div>}</div>
    <nav className="ai-phase4-tabs" aria-label={mode === "sales" ? "Sales Agent" : "Marketing Agent"}>
      {mode === "sales" ? <><button className={subtab === "consult" ? "is-active" : ""} onClick={() => setSubtab("consult")} type="button">Tư vấn nội bộ</button><button className={subtab === "knowledge" ? "is-active" : ""} onClick={() => setSubtab("knowledge")} type="button">FAQ & chính sách</button></> : <><button className={subtab === "create" ? "is-active" : ""} onClick={() => setSubtab("create")} type="button">Tạo nội dung</button><button className={subtab === "drafts" ? "is-active" : ""} onClick={() => setSubtab("drafts")} type="button">Rà soát bản nháp</button></>}
    </nav>
    {mode === "sales" ? subtab === "consult" ? <SalesConsole alerts={alerts} /> : <KnowledgeEditor alerts={alerts} /> : subtab === "create" ? <MarketingComposer alerts={alerts} onOpenDrafts={() => setSubtab("drafts")} /> : <MarketingReview alerts={alerts} />}
  </section>;
}

type Alerts = ReturnType<typeof useNotice>;

function SalesConsole({ alerts }: { alerts: Alerts }) {
  const [status, setStatus] = useState<{ mode: string; providerConfigured: boolean; publicChatEnabled: boolean } | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [question, setQuestion] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [task, setTask] = useState<SalesTask | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef("");

  const refresh = useCallback(async () => {
    const [nextStatus, nextAnalytics] = await Promise.all([request<typeof status>("sales/status"), request<Analytics>("sales/analytics")]);
    setStatus(nextStatus);
    setAnalytics(nextAnalytics);
  }, []);
  useEffect(() => { void refresh().catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được Sales Agent.")); }, [alerts.setError, refresh]);

  useEffect(() => {
    if (!task || !["QUEUED", "RUNNING"].includes(task.status)) return;
    const interval = window.setInterval(() => {
      void taskRequest<SalesTask>(`ai-studio/tasks/${encodeURIComponent(task.id)}`).then((latest) => {
        setTask(latest);
        if (!["QUEUED", "RUNNING"].includes(latest.status)) void refresh().catch(() => undefined);
      }).catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được kết quả tư vấn."));
    }, 1800);
    return () => window.clearInterval(interval);
  }, [task, alerts.setError, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || question.trim().length < 4) return;
    setBusy(true); alerts.clear(); setTask(null);
    if (!pollRef.current) pollRef.current = window.crypto.randomUUID();
    try {
      const result = await request<SalesTask>("sales/answer", { method: "POST", headers: { "Idempotency-Key": pollRef.current }, body: JSON.stringify({ question: question.trim(), maxBudget: maxBudget ? Number(maxBudget) : null }) });
      pollRef.current = "";
      setTask(result);
      alerts.setNotice("Câu hỏi đã vào hàng đợi. Sales Agent chỉ đọc dữ liệu sản phẩm và chính sách hiện có.");
    } catch (error) {
      alerts.setError(error instanceof Error ? error.message : "Không gửi được câu hỏi.");
    } finally { setBusy(false); }
  }

  const result = task?.result || {};
  const answer = typeof result.answer === "string" ? result.answer : "";
  const products = Array.isArray(result.recommended_products) ? result.recommended_products as RecommendedProduct[] : [];
  const knowledge = Array.isArray(result.cited_sources) ? result.cited_sources as SalesCitation[] : [];
  const waiting = task && ["QUEUED", "RUNNING"].includes(task.status);

  return <div className="ai-phase4-layout">
    <main className="ai-phase4-panel">
      <div className="ai-phase4-section-head"><div><span className="ai-section-kicker">INTERNAL PILOT</span><h4>Thử một câu tư vấn</h4><p>Không tra cứu đơn hàng, tài khoản khách hoặc thông tin thanh toán.</p></div><span className={`ai-phase4-provider ${status?.providerConfigured ? "is-ready" : ""}`}><i />{status?.providerConfigured ? "AI Core đã cấu hình" : "Chưa cấu hình provider"}</span></div>
      <form className="ai-phase4-form" onSubmit={(event) => void submit(event)}>
        <label className="ai-form-field"><span>Câu hỏi</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} maxLength={1200} placeholder="Ví dụ: Tôi muốn tìm nhẫn Emerald trong khoảng 5 triệu…" required /></label>
        <div className="ai-phase4-form-row"><label className="ai-form-field"><span>Ngân sách tối đa <small>Không bắt buộc · đồng</small></span><input inputMode="numeric" type="number" min="1" max="2000000000" value={maxBudget} onChange={(event) => setMaxBudget(event.target.value)} placeholder="Ví dụ: 5000000" /></label><button className="ai-submit-button" type="submit" disabled={busy || question.trim().length < 4}>{busy ? "Đang gửi…" : "Hỏi Sales Agent"}<b>→</b></button></div>
      </form>
      {waiting && <div className="ai-phase4-running"><span className="ai-product-spinner"/> Sales Agent đang đối chiếu dữ liệu đã duyệt…</div>}
      {task?.status === "FAILED" && <div className="ai-phase4-inline-error">{task.errorMessage || "Không tạo được câu trả lời."}</div>}
      {answer && <article className="ai-phase4-answer"><div className="ai-phase4-answer-head"><span>GEME SALES AGENT</span><strong>{result.needs_handoff ? "Cần nhân viên hỗ trợ" : "Đề xuất có nguồn"}</strong></div><p>{answer}</p>{typeof result.handoff_reason === "string" && <small>Mã chuyển hỗ trợ: {result.handoff_reason}</small>}
        {products.length > 0 && <div className="ai-phase4-recommendations"><h5>Sản phẩm còn hàng được gợi ý</h5>{products.map((product) => <a key={product.id} href={product.publicPath} target="_blank" rel="noreferrer" onClick={() => void request(`sales/answers/${encodeURIComponent(task!.id)}/product-click`, { method: "POST", body: JSON.stringify({ productId: product.id }) }).catch(() => undefined)}><span><strong>{product.name}</strong><small>{[product.category, product.gemstone, product.material, product.price !== null ? `${product.price.toLocaleString("vi-VN")} ₫` : "Giá xem tại trang sản phẩm", `Còn ${product.availableQuantity}`].filter(Boolean).join(" · ")}</small></span><b>↗</b></a>)}</div>}
        {knowledge.length > 0 && <div className="ai-phase4-sources"><h5>Nguồn chính sách được trích</h5>{knowledge.map((item) => <div key={item.id}><strong>{item.title} · v{item.version}</strong><small>{item.topic} · {item.source}</small></div>)}</div>}
      </article>}
    </main>
    <aside className="ai-phase4-aside">
      <section className="ai-phase4-panel"><span className="ai-section-kicker">30 NGÀY GẦN ĐÂY</span><div className="ai-phase4-metric"><strong>{analytics?.sales.totalQuestions ?? "—"}</strong><span>Câu tư vấn</span></div><div className="ai-phase4-metric"><strong>{analytics?.sales.handoffCount ?? "—"}</strong><span>Chuyển nhân viên</span></div><div className="ai-phase4-metric"><strong>{analytics?.sales.productClicks ?? "—"}</strong><span>Lượt mở sản phẩm</span></div><small className="ai-phase4-privacy">Chỉ lưu số liệu tổng hợp; không lưu nội dung câu hỏi trong bảng analytics.</small></section>
      <section className="ai-phase4-panel ai-phase4-safeguard"><span className="ai-section-kicker">GIỚI HẠN AN TOÀN</span><h4>Pilot nội bộ</h4><p>Chưa có chat công khai trên storefront. Không đưa email, số điện thoại, mã đơn hay dữ liệu khách vào câu hỏi.</p><p>Agent chỉ được gợi ý sản phẩm ACTIVE, còn hàng và trích dẫn chính sách đang hiệu lực. Nếu nguồn thiếu, câu trả lời phải chuyển nhân viên.</p></section>
    </aside>
  </div>;
}

function KnowledgeEditor({ alerts }: { alerts: Alerts }) {
  const [items, setItems] = useState<SalesKnowledge[]>([]);
  const [selected, setSelected] = useState<SalesKnowledge | null>(null);
  const [form, setForm] = useState({ documentKey: "", title: "", topic: "", sourceLabel: "", content: "", effectiveFrom: "", expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setItems(await request<SalesKnowledge[]>("sales/knowledge?archived=true")), []);
  useEffect(() => { void reload().catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được chính sách.")); }, [alerts.setError, reload]);

  function beginRevision(item: SalesKnowledge) {
    setSelected(item);
    setForm({ documentKey: item.documentKey, title: item.title, topic: item.topic, sourceLabel: item.sourceLabel, content: item.content, effectiveFrom: item.effectiveFrom?.slice(0, 16) || "", expiresAt: item.expiresAt?.slice(0, 16) || "" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); alerts.clear();
    try {
      const path = selected ? `sales/knowledge/${encodeURIComponent(selected.id)}/revisions` : "sales/knowledge";
      await request(path, { method: "POST", body: JSON.stringify(form) });
      setSelected(null); setForm({ documentKey: "", title: "", topic: "", sourceLabel: "", content: "", effectiveFrom: "", expiresAt: "" });
      alerts.setNotice("Đã lưu phiên bản chính sách dạng nháp. Cần kích hoạt rõ ràng để Sales Agent sử dụng.");
      await reload();
    } catch (error) { alerts.setError(error instanceof Error ? error.message : "Không lưu được chính sách."); } finally { setBusy(false); }
  }

  async function statusAction(item: SalesKnowledge, action: "activate" | "archive") {
    setBusy(true); alerts.clear();
    try { await request(`sales/knowledge/${encodeURIComponent(item.id)}/${action}`, { method: "POST", body: "{}" }); alerts.setNotice(action === "activate" ? "Đã kích hoạt phiên bản mới; phiên bản cũ được lưu lại." : "Đã lưu trữ phiên bản chính sách."); await reload(); }
    catch (error) { alerts.setError(error instanceof Error ? error.message : "Không cập nhật được trạng thái chính sách."); } finally { setBusy(false); }
  }

  return <div className="ai-phase4-layout">
    <section className="ai-phase4-panel"><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">SOURCES · VERSIONED</span><h4>FAQ & chính sách GEME</h4><p>Chỉ tài liệu đã kích hoạt và còn hiệu lực được đưa vào nguồn tư vấn.</p></div><span className="ai-count-pill">{items.filter((item) => item.status === "ACTIVE").length} đang dùng</span></div>{items.length ? <div className="ai-phase4-knowledge-list">{items.map((item) => <article key={item.id} className="ai-phase4-knowledge-card"><div><span className={`ai-phase4-tag ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span><strong>{item.title}</strong><small>{item.topic} · {item.sourceLabel} · v{item.version}</small><p>{item.content}</p></div><div className="ai-phase4-row-actions">{item.status !== "ARCHIVED" && <button type="button" onClick={() => beginRevision(item)}>Tạo phiên bản mới</button>}{item.status === "DRAFT" && <button type="button" className="is-primary" disabled={busy} onClick={() => void statusAction(item, "activate")}>Kích hoạt</button>}{item.status === "ACTIVE" && <button type="button" className="is-warn" disabled={busy} onClick={() => void statusAction(item, "archive")}>Ngừng dùng</button>}</div></article>)}</div> : <div className="ai-phase4-empty">Chưa có chính sách/FAQ. Tạo tài liệu đã được GEME xác nhận rồi kích hoạt.</div>}</section>
    <form className="ai-phase4-panel ai-phase4-form" onSubmit={(event) => void save(event)}><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">{selected ? `REVISION · v${selected.version + 1}` : "NEW SOURCE"}</span><h4>{selected ? "Tạo bản sửa đổi" : "Thêm chính sách"}</h4><p>Mỗi lần sửa tạo phiên bản mới; phiên bản đang chạy giữ nguyên đến khi kích hoạt bản mới.</p></div></div><div className="ai-phase4-fields"><label className="ai-form-field"><span>Mã tài liệu</span><input required maxLength={100} disabled={Boolean(selected)} value={form.documentKey} onChange={(e) => setForm({ ...form, documentKey: e.target.value })} placeholder="doi-tra-hang" /></label><label className="ai-form-field"><span>Chủ đề</span><input required maxLength={80} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Đổi trả" /></label><label className="ai-form-field wide"><span>Tiêu đề</span><input required maxLength={180} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Chính sách đổi trả GEME" /></label><label className="ai-form-field wide"><span>Nguồn được xác nhận</span><input required maxLength={200} value={form.sourceLabel} onChange={(e) => setForm({ ...form, sourceLabel: e.target.value })} placeholder="Quy định cửa hàng · cập nhật 10/2026" /></label><label className="ai-form-field wide"><span>Nội dung đã kiểm chứng</span><textarea required minLength={10} maxLength={20000} rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Nhập chính xác điều khoản mà nhân viên được phép tư vấn…" /></label><label className="ai-form-field"><span>Hiệu lực từ</span><input type="datetime-local" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label><label className="ai-form-field"><span>Hết hiệu lực</span><input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label></div><button className="ai-submit-button" disabled={busy} type="submit">{busy ? "Đang lưu…" : selected ? "Lưu phiên bản nháp" : "Tạo tài liệu nháp"}<b>→</b></button><button className="ai-phase4-cancel" type="button" onClick={() => { setSelected(null); setForm({ documentKey: "", title: "", topic: "", sourceLabel: "", content: "", effectiveFrom: "", expiresAt: "" }); }}>Làm mới biểu mẫu</button></form>
  </div>;
}

function MarketingComposer({ alerts, onOpenDrafts }: { alerts: Alerts; onOpenDrafts: () => void }) {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("INSTAGRAM");
  const [objective, setObjective] = useState("");
  const [keywords, setKeywords] = useState("");
  const [callToAction, setCallToAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MarketingDraft | null>(null);
  const [taskStatus, setTaskStatus] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const idempotencyKey = useRef("");

  useEffect(() => {
    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(() => { void request<SalesProduct[]>(`marketing/products?search=${encodeURIComponent(search)}`).then((rows) => { if (active) setProducts(rows); }).catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được sản phẩm." )).finally(() => { if (active) setSearchLoading(false); }); }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, alerts.setError]);

  useEffect(() => {
    if (!draft || !["QUEUED", "GENERATING"].includes(draft.status)) return;
    const timer = window.setInterval(() => { void request<MarketingDraft>(`marketing/drafts/${encodeURIComponent(draft.id)}`).then((fresh) => { setDraft(fresh); if (fresh.task?.status) setTaskStatus(fresh.task.status); }).catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được bản nháp.")); }, 1800);
    return () => window.clearInterval(timer);
  }, [draft, alerts.setError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !objective.trim() || selectedIds.length === 0) return;
    setBusy(true); alerts.clear(); setDraft(null); setTaskStatus("");
    if (!idempotencyKey.current) idempotencyKey.current = window.crypto.randomUUID();
    try {
      const response = await request<{ task: { id: string; status: string }; draft: MarketingDraft }>("marketing/drafts", { method: "POST", headers: { "Idempotency-Key": idempotencyKey.current }, body: JSON.stringify({ channel, objective: objective.trim(), productIds: selectedIds, keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean), callToAction }) });
      idempotencyKey.current = ""; setDraft(response.draft); setTaskStatus(response.task.status); alerts.setNotice("Marketing Agent đã nhận brief. Kết quả chỉ được lưu dưới dạng nháp để rà soát.");
    } catch (error) { alerts.setError(error instanceof Error ? error.message : "Không tạo được nội dung."); }
    finally { setBusy(false); }
  }

  async function retryLatest() {
    if (!draft || draft.status !== "FAILED" || busy) return;
    setBusy(true); alerts.clear();
    try {
      const response = await request<{ task: { status: string }; draft: MarketingDraft }>(`marketing/drafts/${encodeURIComponent(draft.id)}/retry`, { method: "POST", body: "{}" });
      setDraft(response.draft); setTaskStatus(response.task.status);
      alerts.setNotice("Đã thử lại bản nháp hiện tại. Tác vụ đang được xử lý.");
    } catch (error) { alerts.setError(error instanceof Error ? error.message : "Không thử lại được bản nháp."); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 12 ? current : [...current, id]); }

  return <div className="ai-phase4-layout ai-phase4-marketing-layout">
    <form className="ai-phase4-panel ai-phase4-form" onSubmit={(event) => void submit(event)}><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">CONTENT BRIEF</span><h4>Tạo bản nháp Marketing</h4><p>Chọn sản phẩm ACTIVE còn hàng và yêu cầu nội dung cụ thể.</p></div><span className="ai-count-pill">{selectedIds.length}/12 sản phẩm</span></div>
      <label className="ai-form-field"><span>Kênh nội dung</span><select value={channel} onChange={(e) => setChannel(e.target.value)}>{Object.entries(channelLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="ai-form-field"><span>Mục tiêu nội dung</span><textarea required minLength={3} maxLength={800} rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Giới thiệu vẻ đẹp của bộ sưu tập mới…" /></label>
      <label className="ai-form-field"><span>Từ khóa <small>Phân tách bằng dấu phẩy</small></span><input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="nhẫn Emerald, trang sức thủ công" /></label>
      <label className="ai-form-field"><span>Lời mời hành động <small>Không bắt buộc</small></span><input maxLength={240} value={callToAction} onChange={(e) => setCallToAction(e.target.value)} placeholder="Khám phá bộ sưu tập" /></label>
      <div className="ai-phase4-product-picker"><div className="ai-phase4-picker-head"><strong>Chọn sản phẩm có thể bán</strong><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên, SKU hoặc loại đá…" /></div>{searchLoading ? <div className="ai-phase4-empty">Đang tải…</div> : products.length ? <div className="ai-phase4-product-list">{products.map((product) => <label key={product.id} className={selectedIds.includes(product.id) ? "is-selected" : ""}><input type="checkbox" checked={selectedIds.includes(product.id)} disabled={!selectedIds.includes(product.id) && selectedIds.length >= 12} onChange={() => toggle(product.id)} /><span><strong>{product.name}</strong><small>{product.sku} · {[product.category, product.gemstone, product.material].filter(Boolean).join(" · ")}</small></span><em>Còn {product.availableQuantity}</em></label>)}</div> : <div className="ai-phase4-empty">Không tìm thấy sản phẩm ACTIVE còn hàng.</div>}</div>
      <div className="ai-phase4-safety"><b>◇</b><span>Nội dung chỉ là nháp. Agent không đăng bài, gửi email, thay giá hoặc tồn kho. Kiểm tra kỹ thông tin đá/chất liệu trước khi sử dụng.</span></div><button className="ai-submit-button" type="submit" disabled={busy || selectedIds.length < 1 || !objective.trim()}>{busy ? "Đang gửi vào hàng đợi…" : "Tạo bản nháp"}<b>→</b></button>
    </form>
    <aside className="ai-phase4-aside"><section className="ai-phase4-panel"><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">LATEST RESULT</span><h4>Kết quả tạo nội dung</h4></div></div>{draft ? <div className="ai-phase4-latest"><span className={`ai-phase4-tag ${draft.status.toLowerCase()}`}>{statusLabels[draft.status] || draft.status}</span>{draft.status === "FAILED" ? <><p>{marketingFailureMessage(draft)}</p><button type="button" className="ai-phase4-link-button" onClick={() => void retryLatest()} disabled={busy}>{busy ? "Đang thử lại…" : "Thử lại tác vụ này →"}</button></> : draft.status === "QUEUED" || draft.status === "GENERATING" ? <div className="ai-phase4-running"><span className="ai-product-spinner"/> {statusLabels[draft.status]}</div> : <><strong>{draft.title || "Bản nháp đã sẵn sàng"}</strong><p>{draft.caption || draft.body}</p><button type="button" className="ai-phase4-link-button" onClick={onOpenDrafts}>Mở khu vực rà soát →</button></>}</div> : <div className="ai-phase4-empty">Bản nháp mới sẽ xuất hiện tại đây.</div>}{taskStatus && <small className="ai-phase4-muted">Tác vụ: {statusLabels[taskStatus] || taskStatus}</small>}</section><section className="ai-phase4-panel ai-phase4-safeguard"><span className="ai-section-kicker">TONE OF VOICE</span><h4>Thanh lịch, tự nhiên, tiết chế</h4><p>Đặt vẻ đẹp thật của sản phẩm làm trọng tâm. Không dùng từ ngữ phóng đại, lời hứa không có nguồn hoặc nhồi từ khóa.</p></section></aside>
  </div>;
}

function MarketingReview({ alerts }: { alerts: Alerts }) {
  const [drafts, setDrafts] = useState<MarketingDraft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [edited, setEdited] = useState<Partial<MarketingDraft>>({});
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => drafts.find((item) => item.id === selectedId) || null, [drafts, selectedId]);
  const hasUnsavedEdits = Boolean(selected && JSON.stringify(edited) !== JSON.stringify({ title: selected.title, caption: selected.caption, body: selected.body, callToAction: selected.callToAction, seoTitle: selected.seoTitle, seoDescription: selected.seoDescription, altText: selected.altText, hashtags: selected.hashtags }));
  const reload = useCallback(async () => setDrafts(await request<MarketingDraft[]>("marketing/drafts?limit=60")), []);
  useEffect(() => { void reload().catch((error) => alerts.setError(error instanceof Error ? error.message : "Không tải được bản nháp.")); }, [alerts.setError, reload]);
  useEffect(() => { if (selected) setEdited({ title: selected.title, caption: selected.caption, body: selected.body, callToAction: selected.callToAction, seoTitle: selected.seoTitle, seoDescription: selected.seoDescription, altText: selected.altText, hashtags: selected.hashtags }); }, [selected]);

  async function save() {
    if (!selected) return; setBusy(true); alerts.clear();
    try { const updated = await request<MarketingDraft>(`marketing/drafts/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ ...edited, expectedRevision: selected.revision }) }); setDrafts((rows) => rows.map((row) => row.id === updated.id ? updated : row)); alerts.setNotice("Đã lưu nội dung chỉnh sửa; trạng thái quay về nháp chờ rà soát."); }
    catch (error) { if (error instanceof ApiRequestError && error.status === 409) { await refreshConflictedDraft(selected.id); alerts.setError("Bản nháp vừa được người khác cập nhật. Đã tải lại phiên bản mới nhất; hãy kiểm tra trước khi sửa tiếp."); } else alerts.setError(error instanceof Error ? error.message : "Không lưu được nội dung."); } finally { setBusy(false); }
  }

  async function decide(decision: "approve" | "reject") {
    if (!selected) return; setBusy(true); alerts.clear();
    try { const updated = await request<MarketingDraft>(`marketing/drafts/${encodeURIComponent(selected.id)}/${decision}`, { method: "POST", body: JSON.stringify({ expectedRevision: selected.revision }) }); setDrafts((rows) => rows.map((row) => row.id === updated.id ? updated : row)); alerts.setNotice(decision === "approve" ? "Đã duyệt nội dung. Nội dung vẫn chưa được đăng hoặc gửi." : "Đã từ chối bản nháp."); }
    catch (error) { if (error instanceof ApiRequestError && error.status === 409) { await refreshConflictedDraft(selected.id); alerts.setError("Bản nháp vừa được người khác cập nhật. Đã tải lại phiên bản mới nhất; hãy kiểm tra trước khi quyết định."); } else alerts.setError(error instanceof Error ? error.message : "Không lưu được quyết định."); } finally { setBusy(false); }
  }

  async function refreshConflictedDraft(id: string) {
    try {
      const latest = await request<MarketingDraft>(`marketing/drafts/${encodeURIComponent(id)}`);
      setDrafts((rows) => rows.map((row) => row.id === latest.id ? latest : row));
    } catch {
      await reload();
    }
  }

  async function retry() {
    if (!selected) return; setBusy(true); alerts.clear();
    try { const result = await request<{ draft: MarketingDraft }>(`marketing/drafts/${encodeURIComponent(selected.id)}/retry`, { method: "POST", body: "{}" }); setDrafts((rows) => rows.map((row) => row.id === result.draft.id ? result.draft : row)); alerts.setNotice("Đã xếp lại tác vụ vào hàng đợi với trạng thái nháp."); }
    catch (error) { alerts.setError(error instanceof Error ? error.message : "Không xếp lại được tác vụ."); } finally { setBusy(false); }
  }

  function downloadDraft() {
    if (!selected) return;
    const content = `# ${edited.title || selected.title}\n\n${edited.caption || selected.caption}\n\n${edited.body || selected.body}\n\n${(edited.hashtags || selected.hashtags || []).map((tag) => `#${tag}`).join(" ")}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `geme-marketing-${selected.channel.toLowerCase()}-${selected.id.slice(0, 8)}.md`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="ai-phase4-review-layout"><section className="ai-phase4-panel ai-phase4-draft-list-panel"><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">HUMAN REVIEW</span><h4>Bản nháp Marketing</h4><p>Chỉ nội dung đã được admin duyệt mới được xuất ra dùng.</p></div><button type="button" className="ai-phase4-refresh" onClick={() => void reload()}>↻</button></div>{drafts.length ? <div className="ai-phase4-draft-list">{drafts.map((draft) => <button type="button" key={draft.id} className={selectedId === draft.id ? "is-selected" : ""} onClick={() => setSelectedId(draft.id)}><span className={`ai-phase4-tag ${draft.status.toLowerCase()}`}>{statusLabels[draft.status] || draft.status}</span><strong>{draft.title || channelLabels[draft.channel]}</strong><small>{channelLabels[draft.channel]} · {new Date(draft.createdAt).toLocaleDateString("vi-VN")}</small></button>)}</div> : <div className="ai-phase4-empty">Chưa có bản nháp nào.</div>}</section>
    {selected ? <section className="ai-phase4-panel ai-phase4-editor"><div className="ai-phase4-section-head"><div><span className="ai-section-kicker">{channelLabels[selected.channel]} · {selected.id.slice(0, 8)}</span><h4>{selected.status === "QUEUED" || selected.status === "GENERATING" ? "Đang tạo nội dung" : "Chỉnh sửa và duyệt"}</h4></div><span className={`ai-phase4-tag ${selected.status.toLowerCase()}`}>{statusLabels[selected.status] || selected.status}</span></div>{selected.status === "FAILED" ? <><div className="ai-phase4-inline-error">{selected.task?.errorMessage || selected.errorCode || "Tạo bản nháp thất bại."}</div><div className="ai-phase4-review-actions"><button type="button" onClick={() => void retry()} disabled={busy}>Thử lại</button></div></> : selected.status === "QUEUED" || selected.status === "GENERATING" ? <div className="ai-phase4-running"><span className="ai-product-spinner"/> Tác vụ đang được xử lý, tải lại sau ít phút.</div> : <>
      {selected.factWarnings?.length > 0 && <div className="ai-phase4-safety"><b>!</b><span>Đối chiếu dữ kiện trước khi dùng: {selected.factWarnings.join(" · ")}</span></div>}
      <div className="ai-phase4-fields"><label className="ai-form-field"><span>Tiêu đề</span><input maxLength={180} value={edited.title || ""} onChange={(e) => setEdited({ ...edited, title: e.target.value })} /></label><label className="ai-form-field"><span>Lời mời hành động</span><input maxLength={240} value={edited.callToAction || ""} onChange={(e) => setEdited({ ...edited, callToAction: e.target.value })} /></label><label className="ai-form-field wide"><span>Caption</span><textarea rows={4} maxLength={1200} value={edited.caption || ""} onChange={(e) => setEdited({ ...edited, caption: e.target.value })} /></label><label className="ai-form-field wide"><span>Nội dung dài / mô tả blog</span><textarea rows={8} maxLength={12000} value={edited.body || ""} onChange={(e) => setEdited({ ...edited, body: e.target.value })} /></label><label className="ai-form-field"><span>SEO title</span><input maxLength={180} value={edited.seoTitle || ""} onChange={(e) => setEdited({ ...edited, seoTitle: e.target.value })} /></label><label className="ai-form-field"><span>SEO meta description</span><textarea rows={2} maxLength={320} value={edited.seoDescription || ""} onChange={(e) => setEdited({ ...edited, seoDescription: e.target.value })} /></label><label className="ai-form-field wide"><span>Alt text</span><input maxLength={500} value={edited.altText || ""} onChange={(e) => setEdited({ ...edited, altText: e.target.value })} /></label><label className="ai-form-field wide"><span>Hashtag <small>Phân tách bằng dấu phẩy</small></span><input value={(edited.hashtags || []).join(", ")} onChange={(e) => setEdited({ ...edited, hashtags: e.target.value.split(",").map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).slice(0, 12) })} /></label></div>
      <div className="ai-phase4-source-box"><strong>Sản phẩm/dữ kiện nguồn</strong><p>{(selected.sourceFacts || []).map((fact) => typeof fact.name === "string" ? fact.name : "Sản phẩm GEME").join(" · ")}</p><small>Không thay đổi giá, tồn kho hoặc trạng thái sản phẩm.</small></div>
      <div className="ai-phase4-review-actions"><button type="button" onClick={downloadDraft} disabled={selected.status !== "APPROVED"}>Tải Markdown đã duyệt</button><button type="button" onClick={() => void save()} disabled={busy}>Lưu thay đổi</button><button type="button" className="is-reject" onClick={() => void decide("reject")} disabled={busy || selected.status !== "DRAFT" || hasUnsavedEdits}>Từ chối</button><button type="button" className="is-primary" onClick={() => void decide("approve")} disabled={busy || selected.status !== "DRAFT" || hasUnsavedEdits}>Duyệt nội dung</button></div>{hasUnsavedEdits && selected.status === "DRAFT" && <p className="ai-phase4-no-publish">Hãy lưu nội dung trước khi duyệt hoặc từ chối để quyết định gắn với đúng phiên bản.</p>}<p className="ai-phase4-no-publish">Đang xem phiên bản {selected.revision}. Duyệt chỉ ghi nhận quyết định nội bộ; nội dung không tự đăng hoặc gửi email.</p>
      </>}</section> : <section className="ai-phase4-panel ai-phase4-empty">Chọn một bản nháp ở danh sách để rà soát.</section>}</div>;
}
