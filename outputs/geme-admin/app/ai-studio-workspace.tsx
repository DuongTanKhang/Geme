"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiBaseUrl } from "../lib/api";
import AiImageStudioWorkspace from "./ai-image-studio";

type AiTaskType = "CONTENT_DRAFT" | "IMAGE_GENERATION" | "IMAGE_STUDIO_PROCESSING" | "PRODUCT_PUBLICATION_PROPOSAL";
type AiStatus = "QUEUED" | "RUNNING" | "AWAITING_APPROVAL" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "APPROVED" | "REJECTED";
type AiTask = {
  id: string;
  type: AiTaskType;
  status: AiStatus;
  title: string;
  input: { prompt?: string };
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  attemptCount: number;
  createdAt: string;
  completedAt?: string | null;
  approval?: { id: string; status: "PENDING" | "APPROVED" | "REJECTED"; decisionNote?: string | null } | null;
};
type AiOverview = {
  agents: { id: string; name: string; capability: string; status: string }[];
  taskCounts: Record<AiStatus, number>;
  queue: { waiting: number; active: number; delayed: number; failed: number; completed: number };
};
type AiApproval = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote?: string | null;
  requestedAt: string;
  task: AiTask & { requestedBy?: { displayName: string } };
  reviewedBy?: { displayName: string } | null;
};
type StudioTab = "command" | "images" | "history" | "agents" | "approvals";

const tabs: { id: StudioTab; label: string; mark: string }[] = [
  { id: "command", label: "Không gian lệnh", mark: "✦" },
  { id: "images", label: "Image Studio", mark: "▧" },
  { id: "history", label: "Lịch sử tác vụ", mark: "◷" },
  { id: "agents", label: "AI Agents", mark: "◇" },
  { id: "approvals", label: "Trung tâm duyệt", mark: "✓" },
];

const typeLabel: Record<AiTaskType, string> = {
  CONTENT_DRAFT: "Bản nháp nội dung",
  IMAGE_GENERATION: "Yêu cầu hình ảnh",
  IMAGE_STUDIO_PROCESSING: "GEME Visual Agent",
  PRODUCT_PUBLICATION_PROPOSAL: "Đề xuất xuất bản sản phẩm",
};

const statusLabel: Record<AiStatus, string> = {
  QUEUED: "Đang chờ",
  RUNNING: "Đang xử lý",
  AWAITING_APPROVAL: "Chờ duyệt",
  SUCCEEDED: "Hoàn tất",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || `API trả về lỗi ${response.status}.`);
  return body as T;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function resultMessage(result?: Record<string, unknown> | null) {
  if (!result) return "Chưa có kết quả.";
  if (typeof result.message === "string") return result.message;
  if (typeof result.state === "string") return result.state;
  if (result.imageWorker && typeof result.imageWorker === "object") return "Hợp đồng Image Worker đã sẵn sàng; nhà cung cấp đang tắt.";
  return "Đã lưu kết quả xử lý.";
}

function StatusBadge({ status }: { status: AiStatus }) {
  return <span className={`ai-status ai-status-${status.toLowerCase()}`}><i />{statusLabel[status]}</span>;
}

export default function AiStudioWorkspace() {
  const [tab, setTab] = useState<StudioTab>("command");
  const [taskType, setTaskType] = useState<AiTaskType>("CONTENT_DRAFT");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [overview, setOverview] = useState<AiOverview | null>(null);
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [approvals, setApprovals] = useState<AiApproval[]>([]);
  const [selectedTask, setSelectedTask] = useState<AiTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyTask, setBusyTask] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const idempotencyKey = useRef("");
  const loadInFlight = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const [nextOverview, nextTasks, nextApprovals] = await Promise.all([
        request<AiOverview>("ai-studio/overview"),
        request<AiTask[]>("ai-studio/tasks?limit=30"),
        request<AiApproval[]>("ai-studio/approvals?limit=30"),
      ]);
      setOverview(nextOverview);
      setTasks(nextTasks);
      setApprovals(nextApprovals);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu AI Studio.");
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasActiveTasks = tasks.some((task) => task.status === "QUEUED" || task.status === "RUNNING");
  useEffect(() => {
    if (!hasActiveTasks) return;
    const interval = window.setInterval(() => void refresh(true), 4000);
    return () => window.clearInterval(interval);
  }, [hasActiveTasks, refresh]);

  const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === "PENDING"), [approvals]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !prompt.trim()) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    if (!idempotencyKey.current) idempotencyKey.current = window.crypto.randomUUID();
    try {
      const createdTask = await request<AiTask>("ai-studio/tasks", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ type: taskType, title: title.trim(), prompt: prompt.trim() }),
      });
      idempotencyKey.current = "";
      setTitle("");
      setPrompt("");
      setTasks((current) => [createdTask, ...current.filter((task) => task.id !== createdTask.id)].slice(0, 50));
      setNotice("Tác vụ đã được ghi nhận vào hàng đợi bền vững.");
      void refresh(true);
    } catch (reason) {
      // Keep the same key after a timeout so retrying the form cannot duplicate a task.
      setError(reason instanceof Error ? reason.message : "Không tạo được tác vụ AI.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelTask(taskId: string) {
    setBusyTask(taskId);
    setError("");
    try {
      await request(`ai-studio/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", body: "{}" });
      setNotice("Đã ghi nhận yêu cầu hủy tác vụ.");
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không hủy được tác vụ.");
    } finally {
      setBusyTask("");
    }
  }

  async function decide(taskId: string, decision: "approve" | "reject") {
    setBusyTask(taskId);
    setError("");
    try {
      await request(`ai-studio/tasks/${encodeURIComponent(taskId)}/${decision}`, { method: "POST", body: JSON.stringify({}) });
      setNotice(decision === "approve" ? "Đã lưu quyết định phê duyệt." : "Đã lưu quyết định từ chối.");
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được quyết định.");
    } finally {
      setBusyTask("");
    }
  }

  async function openTask(taskId: string) {
    try {
      setSelectedTask(await request<AiTask>(`ai-studio/tasks/${encodeURIComponent(taskId)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được chi tiết tác vụ.");
    }
  }

  const openTasks = tasks.filter((task) => task.status === "QUEUED" || task.status === "RUNNING");

  return <section className="ai-studio-page">
    <header className="ai-studio-hero">
      <div className="ai-studio-hero-copy"><span className="ai-studio-eyebrow"><i /> GEME INTELLIGENCE · PHASE 2</span><h2>AI Studio</h2><p>Một không gian an toàn để điều phối bản nháp, hình ảnh và các quyết định cần con người phê duyệt.</p><div className="ai-studio-hero-note"><span>✦</span> AI chỉ đề xuất. Dữ liệu thương mại vẫn do GEME API quản lý.</div></div>
      <div className="ai-studio-hero-art" aria-hidden="true"><span className="ai-orbit ai-orbit-one"/><span className="ai-orbit ai-orbit-two"/><span className="ai-orbit ai-orbit-three"/><span className="ai-gem-mark">G</span><span className="ai-star ai-star-one">✦</span><span className="ai-star ai-star-two">✧</span></div>
    </header>

    <div className="ai-studio-stat-grid">
      <article className="ai-studio-stat"><span>Đang trong hàng đợi</span><strong>{overview?.queue.waiting ?? "—"}</strong><small>{overview?.queue.active ?? 0} worker đang xử lý</small></article>
      <article className="ai-studio-stat"><span>Chờ phê duyệt</span><strong>{overview?.taskCounts.AWAITING_APPROVAL ?? "—"}</strong><small>Chỉ quản trị viên mới quyết định</small></article>
      <article className="ai-studio-stat"><span>Hoàn tất</span><strong>{overview?.taskCounts.SUCCEEDED ?? "—"}</strong><small>Task history lưu trong PostgreSQL</small></article>
      <article className="ai-studio-stat"><span>Agents khả dụng</span><strong>{overview?.agents.length ?? "—"}</strong><small>Image Worker chưa kết nối nhà cung cấp</small></article>
    </div>

    <nav className="ai-studio-tabs" role="tablist" aria-label="Khu vực AI Studio">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}><span>{item.mark}</span>{item.label}{item.id === "approvals" && pendingApprovals.length > 0 && <b>{pendingApprovals.length}</b>}</button>)}
      <button className="ai-studio-refresh" type="button" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới dữ liệu">↻</button>
    </nav>

    {error && <div className="ai-studio-alert ai-studio-alert-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="ai-studio-alert ai-studio-alert-success" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice("")}>Đóng</button></div>}

    {tab === "command" && <div className="ai-studio-command-layout">
      <form className="ai-command-card" onSubmit={(event) => void createTask(event)}>
        <div className="ai-section-heading"><div><span className="ai-section-kicker">WORKSPACE</span><h3>Giao nhiệm vụ mới</h3><p>Yêu cầu được xếp hàng xử lý riêng, không chặn request của cửa hàng.</p></div><span className="ai-command-mark">✦</span></div>
        <label className="ai-form-field"><span>Agent / loại tác vụ</span><select value={taskType} onChange={(event) => setTaskType(event.target.value as AiTaskType)}><option value="CONTENT_DRAFT">Content Atelier · bản nháp nội dung</option><option value="IMAGE_GENERATION">Image Worker · yêu cầu hình ảnh</option><option value="PRODUCT_PUBLICATION_PROPOSAL">Catalog Reviewer · đề xuất xuất bản</option></select></label>
        <label className="ai-form-field"><span>Tên tác vụ <small>Không bắt buộc</small></span><input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Bộ sưu tập đá quý mùa thu" /></label>
        <label className="ai-form-field"><span>Chỉ dẫn <b>Bắt buộc</b></span><textarea required maxLength={5000} rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Mô tả mục tiêu, phong cách hoặc đầu ra bạn muốn…"/><small className="ai-character-count">{prompt.length.toLocaleString("vi-VN")} / 5.000 ký tự</small></label>
        <div className="ai-safety-note"><span>◇</span><p>{taskType === "IMAGE_GENERATION" ? "Phase 1 chỉ tạo hợp đồng Image Worker; chưa gọi API hình ảnh trả phí." : taskType === "PRODUCT_PUBLICATION_PROPOSAL" ? "Đề xuất sẽ chờ duyệt. Bấm duyệt chỉ lưu quyết định, chưa tự xuất bản sản phẩm." : "Kết quả hiện là scaffold vì chưa bật nhà cung cấp AI."}</p></div>
        <button className="ai-submit-button" type="submit" disabled={submitting || !prompt.trim()}><span>{submitting ? "Đang gửi vào hàng đợi…" : "Tạo tác vụ"}</span><b>→</b></button>
      </form>
      <aside className="ai-command-aside">
        <div className="ai-side-card"><div className="ai-side-heading"><div><span className="ai-section-kicker">LIVE QUEUE</span><h3>Đang xử lý</h3></div><span className="ai-live-dot"/></div>{openTasks.length ? openTasks.slice(0, 5).map((task) => <div className="ai-mini-task" key={task.id}><span className={`ai-mini-icon ai-mini-${task.type.toLowerCase()}`}>✦</span><div><strong>{task.title}</strong><small>{typeLabel[task.type]} · {formatDate(task.createdAt)}</small></div><StatusBadge status={task.status}/></div>) : <div className="ai-empty-mini"><span>◷</span><p>{loading ? "Đang tải hàng đợi…" : "Chưa có tác vụ đang chạy"}</p></div>}</div>
        <div className="ai-side-card ai-guardrail-card"><span className="ai-guardrail-icon">⌑</span><span className="ai-section-kicker">GEME SAFEGUARD</span><h3>Quyền kiểm soát luôn ở bạn</h3><p>AI Studio không được phép thay đổi giá, tồn kho hoặc đơn hàng. Nội dung xuất bản cần được quản trị viên phê duyệt rõ ràng.</p><button type="button" onClick={() => setTab("approvals")}>Mở trung tâm duyệt <span>→</span></button></div>
      </aside>
    </div>}

    {tab === "images" && <AiImageStudioWorkspace />}

    {tab === "history" && <section className="ai-list-card"><div className="ai-section-heading ai-list-heading"><div><span className="ai-section-kicker">ACTIVITY LOG</span><h3>Lịch sử tác vụ</h3><p>Task state bền vững trong PostgreSQL; Redis xử lý công việc nền.</p></div><span className="ai-count-pill">{tasks.length} tác vụ</span></div>{tasks.length ? <div className="ai-task-list">{tasks.map((task) => <article className="ai-task-row" key={task.id}><span className={`ai-task-type-icon type-${task.type.toLowerCase()}`}>✦</span><div className="ai-task-copy"><strong>{task.title}</strong><p>{task.input?.prompt || typeLabel[task.type]}</p><small>{typeLabel[task.type]} · {formatDate(task.createdAt)} · thử {task.attemptCount} lần</small></div><StatusBadge status={task.status}/><div className="ai-task-actions"><button type="button" onClick={() => void openTask(task.id)}>Chi tiết</button>{(task.status === "QUEUED" || task.status === "RUNNING") && <button type="button" className="is-danger" disabled={busyTask === task.id} onClick={() => void cancelTask(task.id)}>{busyTask === task.id ? "Đang hủy…" : "Hủy"}</button>}</div></article>)}</div> : <div className="ai-empty-state"><span>◷</span><h4>{loading ? "Đang tải lịch sử" : "Chưa có tác vụ nào"}</h4><p>Tác vụ mới sẽ xuất hiện tại đây.</p></div>}</section>}

    {tab === "agents" && <section className="ai-agent-grid">{(overview?.agents || []).map((agent, index) => <article className="ai-agent-card" key={agent.id}><div className={`ai-agent-visual agent-visual-${index}`}><span>{index === 0 ? "Aa" : index === 1 ? "✧" : "✓"}</span><i/><b/></div><div className="ai-agent-body"><div className="ai-agent-topline"><span className="ai-section-kicker">AGENT 0{index + 1}</span><span className={`ai-agent-state ${agent.status.toLowerCase()}`}>{agent.status === "PROVIDER_DISABLED" ? "Nhà cung cấp đang tắt" : agent.status === "APPROVAL_REQUIRED" ? "Luôn cần duyệt" : "Scaffold sẵn sàng"}</span></div><h3>{agent.name}</h3><p>{agent.capability}</p><div className="ai-agent-foot"><span><i/> Hàng đợi riêng</span><span>Phase 1</span></div></div></article>)}</section>}

    {tab === "approvals" && <section className="ai-list-card"><div className="ai-section-heading ai-list-heading"><div><span className="ai-section-kicker">HUMAN IN THE LOOP</span><h3>Trung tâm phê duyệt</h3><p>Quyết định được ghi lại cùng người duyệt và thời gian.</p></div><span className="ai-count-pill">{pendingApprovals.length} đang chờ</span></div>{approvals.length ? <div className="ai-approval-list">{approvals.map((approval) => <article className={`ai-approval-card ${approval.status !== "PENDING" ? "is-reviewed" : ""}`} key={approval.id}><div className="ai-approval-top"><div><span className="ai-approval-icon">✓</span><div><span className="ai-section-kicker">{approval.task.type === "PRODUCT_PUBLICATION_PROPOSAL" ? "ĐỀ XUẤT XUẤT BẢN" : "YÊU CẦU PHÊ DUYỆT"}</span><h4>{approval.task.title}</h4></div></div><span className={`ai-approval-status ${approval.status.toLowerCase()}`}>{approval.status === "PENDING" ? "Chờ quyết định" : approval.status === "APPROVED" ? "Đã duyệt" : "Đã từ chối"}</span></div><p className="ai-approval-prompt">{approval.task.input?.prompt || "Không có chỉ dẫn."}</p><div className="ai-approval-result">{resultMessage(approval.task.result)}</div><div className="ai-approval-foot"><span>Đề xuất bởi {approval.task.requestedBy?.displayName || "Admin"} · {formatDate(approval.requestedAt)}</span>{approval.status === "PENDING" ? <div><button type="button" className="ai-reject-button" disabled={busyTask === approval.task.id} onClick={() => void decide(approval.task.id, "reject")}>Từ chối</button><button type="button" className="ai-approve-button" disabled={busyTask === approval.task.id} onClick={() => void decide(approval.task.id, "approve")}>{busyTask === approval.task.id ? "Đang lưu…" : "Phê duyệt"}</button></div> : <span>{approval.reviewedBy?.displayName ? `Quyết định bởi ${approval.reviewedBy.displayName}` : "Đã ghi nhận quyết định"}{approval.decisionNote ? ` · ${approval.decisionNote}` : ""}</span>}</div></article>)}</div> : <div className="ai-empty-state"><span>✓</span><h4>Không có đề xuất chờ duyệt</h4><p>Đề xuất cần con người phê duyệt sẽ được hiển thị ở đây.</p></div>}</section>}

    {selectedTask && <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null); }}><section className="ai-task-modal" role="dialog" aria-modal="true" aria-labelledby="aiTaskTitle"><button type="button" className="ai-modal-close" aria-label="Đóng" onClick={() => setSelectedTask(null)}>×</button><span className="ai-section-kicker">TASK DETAIL · {selectedTask.id.slice(0, 8)}</span><h3 id="aiTaskTitle">{selectedTask.title}</h3><StatusBadge status={selectedTask.status}/><h4>Chỉ dẫn</h4><p className="ai-modal-prompt">{selectedTask.input?.prompt || "Không có chỉ dẫn."}</p><h4>Kết quả</h4><p className="ai-modal-result">{selectedTask.errorMessage || resultMessage(selectedTask.result)}</p>{selectedTask.result && <pre>{JSON.stringify(selectedTask.result, null, 2)}</pre>}<small>Tạo lúc {formatDate(selectedTask.createdAt)} · đã thử {selectedTask.attemptCount} lần</small></section></div>}
  </section>;
}
