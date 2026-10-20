"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiBaseUrl } from "../lib/api";

type ProductDraftStatus = "QUEUED" | "RUNNING" | "NEEDS_REVIEW" | "READY_FOR_REVIEW" | "APPROVED" | "REJECTED" | "FAILED" | "CANCELLED";
type ProductDraft = {
  id: string;
  batchId: string;
  taskId: string;
  sourceImageItemId: string;
  status: ProductDraftStatus;
  productName: string;
  shortDescription: string;
  detailedDescription: string;
  categorySuggestion: string | null;
  materialSuggestion: string | null;
  gemstoneSuggestion: string | null;
  seoTitle: string;
  seoMetaDescription: string;
  altText: string;
  confidenceScore: number;
  categoryConfidence: number | null;
  materialConfidence: number | null;
  gemstoneConfidence: number | null;
  needsReview: boolean;
  reviewReasons: string[];
  evidence: unknown;
  createdAt: string;
  reviewedAt: string | null;
  previewUrl?: string;
  task: { status: string; errorCode?: string | null; errorMessage?: string | null; attemptCount?: number };
  batch: { id: string; status: string; createdAt?: string };
  sourceImageItem: { id: string; originalFilename: string; batch?: { id: string; name: string } };
  reviewedBy?: { displayName: string } | null;
};
type ApprovedImage = {
  id: string;
  originalFilename: string;
  relativePath: string;
  qcStatus: "PENDING" | "PASS" | "REVIEW" | "FAIL";
  createdAt: string;
  previewUrl: string;
  batch: { id: string; name: string; createdAt: string };
  latestDraft: { id: string; status: ProductDraftStatus; createdAt: string } | null;
};
type CursorPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean; total: number };
type DraftBatch = { id: string; status: string; createdAt: string; drafts: ProductDraft[] };
type ProductAgentStatus = { provider: string; configured: boolean; maxFilesPerBatch: number; maxImageBytes: number; sideEffects: string };
type DraftFields = Pick<ProductDraft, "productName" | "shortDescription" | "detailedDescription" | "categorySuggestion" | "materialSuggestion" | "gemstoneSuggestion" | "seoTitle" | "seoMetaDescription" | "altText">;

const statusLabels: Record<ProductDraftStatus, string> = {
  QUEUED: "Đang chờ",
  RUNNING: "Đang tạo nội dung",
  NEEDS_REVIEW: "Cần kiểm tra dữ kiện",
  READY_FOR_REVIEW: "Chờ admin duyệt",
  APPROVED: "Đã duyệt bản nháp",
  REJECTED: "Đã từ chối",
  FAILED: "Tạo thất bại",
  CANCELLED: "Đã hủy",
};

const reasonLabels: Record<string, string> = {
  CATEGORY_NOT_IN_ACTIVE_CATALOG: "Gợi ý danh mục không khớp danh mục đang hoạt động.",
  CATEGORY_REQUIRES_MANUAL_CHECK: "Cần xác nhận danh mục sản phẩm.",
  MATERIAL_NOT_IN_ACTIVE_CATALOG: "Gợi ý chất liệu không khớp danh mục hiện có.",
  GEMSTONE_NOT_IN_ACTIVE_CATALOG: "Gợi ý loại đá không khớp danh mục hiện có.",
  MATERIAL_AND_GEMSTONE_REQUIRE_VERIFIED_PRODUCT_DATA: "Ảnh không xác minh được chất liệu hoặc loại đá; cần đối chiếu hồ sơ thật.",
  MATERIAL_IDENTITY_UNCERTAIN: "Chưa đủ căn cứ xác định chất liệu.",
  GEMSTONE_IDENTITY_UNCERTAIN: "Chưa đủ căn cứ xác định loại đá.",
  UNVERIFIED_PRODUCT_CLAIM_REMOVED: "Đã bỏ nội dung có thể là khẳng định chưa được xác minh.",
  PRODUCT_CONTENT_REQUIRES_ADMIN_REVIEW: "Mọi nội dung cần admin kiểm tra trước khi sử dụng.",
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/admin/ai-studio/${path.replace(/^\//, "")}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as { message?: string | string[]; detail?: string };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || body.detail || `API trả về lỗi ${response.status}.`);
  return body as T;
}

function statusClass(status: ProductDraftStatus) { return `ai-product-status-${status.toLowerCase()}`; }
function labelReason(reason: string) { return reasonLabels[reason] || reason.replaceAll("_", " ").toLocaleLowerCase("vi-VN"); }
function imagePreviewUrl(itemId: string) {
  return `${apiBaseUrl}/admin/ai-studio/image-studio/items/${encodeURIComponent(itemId)}/preview?variant=output`;
}

export default function AiProductAgentWorkspace() {
  const [images, setImages] = useState<ApprovedImage[]>([]);
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [draftsTotal, setDraftsTotal] = useState(0);
  const [draftCursor, setDraftCursor] = useState<string | null>(null);
  const [draftsHaveMore, setDraftsHaveMore] = useState(false);
  const [imagesCursor, setImagesCursor] = useState<string | null>(null);
  const [imagesHaveMore, setImagesHaveMore] = useState(false);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [draftStatusFilter, setDraftStatusFilter] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [draftSearchQuery, setDraftSearchQuery] = useState("");
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [expandedDrafts, setExpandedDrafts] = useState<string[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProductAgentStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, DraftFields>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const idempotency = useRef<{ manifest: string; key: string } | null>(null);
  const requestInFlight = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const statusQuery = draftStatusFilter ? `&status=${encodeURIComponent(draftStatusFilter)}` : "";
      const searchQuery = draftSearchQuery ? `&q=${encodeURIComponent(draftSearchQuery)}` : "";
      const [nextImages, nextDrafts, nextStatus] = await Promise.all([
        request<CursorPage<ApprovedImage>>("product-agent/approved-images?limit=100"),
        request<CursorPage<ProductDraft>>(`product-agent/drafts?limit=50${statusQuery}${searchQuery}`),
        request<ProductAgentStatus>("product-agent/status"),
      ]);
      setImages(nextImages.items);
      setImagesCursor(nextImages.nextCursor);
      setImagesHaveMore(nextImages.hasMore);
      setImagesTotal(nextImages.total);
      setDrafts((current) => {
        if (!silent) return nextDrafts.items;
        const merged = [...nextDrafts.items, ...current.filter((draft) => !nextDrafts.items.some((item) => item.id === draft.id))];
        return draftStatusFilter ? merged.filter((draft) => draft.status === draftStatusFilter) : merged;
      });
      if (!silent) {
        setDraftCursor(nextDrafts.nextCursor);
        setDraftsHaveMore(nextDrafts.hasMore);
      setDraftsTotal(nextDrafts.total);
      }
      if (!silent) setSelectedDrafts([]);
      setProviderStatus(nextStatus);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được Product Agent.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [draftStatusFilter, draftSearchQuery]);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasActiveDrafts = useMemo(() => drafts.some((draft) => draft.status === "QUEUED" || draft.status === "RUNNING"), [drafts]);
  useEffect(() => {
    if (!hasActiveDrafts) return;
    const interval = window.setInterval(() => void refresh(true), 3500);
    return () => window.clearInterval(interval);
  }, [hasActiveDrafts, refresh]);

  const filteredDrafts = drafts;
  const reviewableDrafts = filteredDrafts.filter((draft) => ["NEEDS_REVIEW", "READY_FOR_REVIEW"].includes(draft.status));
  const batches = useMemo(() => {
    const grouped = new Map<string, DraftBatch>();
    for (const draft of filteredDrafts) {
      const batch = grouped.get(draft.batchId) || { id: draft.batch.id, status: draft.batch.status, createdAt: draft.batch.createdAt || draft.createdAt, drafts: [] };
      batch.drafts.push(draft);
      grouped.set(draft.batchId, batch);
    }
    return [...grouped.values()];
  }, [filteredDrafts]);
  function toggleImage(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 5 ? current : [...current, id]);
    idempotency.current = null;
  }

  async function loadMoreImages() {
    if (!imagesCursor || busy) return;
    setBusy("images-page");
    try {
      const page = await request<CursorPage<ApprovedImage>>(`product-agent/approved-images?limit=100&cursor=${encodeURIComponent(imagesCursor)}`);
      setImages((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setImagesCursor(page.nextCursor);
      setImagesHaveMore(page.hasMore);
      setImagesTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải thêm được ảnh.");
    } finally { setBusy(""); }
  }

  async function loadMoreDrafts() {
    if (!draftCursor || busy) return;
    setBusy("drafts-page");
    try {
      const statusQuery = draftStatusFilter ? `&status=${encodeURIComponent(draftStatusFilter)}` : "";
      const searchQuery = draftSearchQuery ? `&q=${encodeURIComponent(draftSearchQuery)}` : "";
      const page = await request<CursorPage<ProductDraft>>(`product-agent/drafts?limit=50&cursor=${encodeURIComponent(draftCursor)}${statusQuery}${searchQuery}`);
      setDrafts((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setDraftCursor(page.nextCursor);
      setDraftsHaveMore(page.hasMore);
      setDraftsTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải thêm được bản nháp.");
    } finally { setBusy(""); }
  }

  async function bulkDecide(decision: "APPROVED" | "REJECTED") {
    if (!selectedDrafts.length || busy) return;
    const actionLabel = decision === "APPROVED" ? "duyệt" : "từ chối";
    if (!window.confirm(`Xác nhận ${actionLabel} ${selectedDrafts.length} bản nháp đã chọn? Thao tác này không xuất bản sản phẩm.`)) return;
    setBusy("bulk-decision"); setError(""); setNotice("");
    try {
      const result = await request<{ updatedCount: number }>("product-agent/drafts/bulk-decision", {
        method: "POST", body: JSON.stringify({ draftIds: selectedDrafts, decision }),
      });
      setSelectedDrafts([]);
      setNotice(`Đã ${actionLabel} ${result.updatedCount} bản nháp. Không có sản phẩm nào được xuất bản.`);
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể xử lý hàng loạt bản nháp.");
    } finally { setBusy(""); }
  }

  function toggleDraftSelection(id: string) {
    setSelectedDrafts((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length >= 100 ? current : [...current, id]);
  }

  async function createDraftBatch() {
    if (!selected.length || busy) return;
    if (providerStatus && !providerStatus.configured) {
      setError("Chưa cấu hình GEME_OPENAI_API_KEY trong .env.docker; Product Agent chưa thể tạo nội dung.");
      return;
    }
    setBusy("create"); setError(""); setNotice("");
    const manifest = [...selected].sort().join(":");
    if (!idempotency.current || idempotency.current.manifest !== manifest) idempotency.current = { manifest, key: window.crypto.randomUUID() };
    try {
      const batch = await request<DraftBatch>("product-agent/batches", {
        method: "POST",
        headers: { "Idempotency-Key": idempotency.current.key },
        body: JSON.stringify({ imageItemIds: selected }),
      });
      idempotency.current = null;
      setSelected([]);
      setNotice(`Đã gửi ${batch.drafts.length} ảnh vào Product Agent. Bản nháp sẽ xuất hiện tại khu vực rà soát.`);
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được lô Product Agent.");
    } finally { setBusy(""); }
  }

  function editValue(draft: ProductDraft, key: keyof DraftFields, value: string) {
    setEdits((current) => ({
      ...current,
      [draft.id]: {
        ...(current[draft.id] || {
          productName: draft.productName,
          shortDescription: draft.shortDescription,
          detailedDescription: draft.detailedDescription,
          categorySuggestion: draft.categorySuggestion,
          materialSuggestion: draft.materialSuggestion,
          gemstoneSuggestion: draft.gemstoneSuggestion,
          seoTitle: draft.seoTitle,
          seoMetaDescription: draft.seoMetaDescription,
          altText: draft.altText,
        }),
        [key]: value,
      },
    }));
  }

  async function runDraftAction(draft: ProductDraft, action: "save" | "approve" | "reject" | "cancel" | "retry") {
    setBusy(draft.id); setError(""); setNotice("");
    try {
      if (action === "save") {
        const saved = await request<ProductDraft>(`product-agent/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify(edits[draft.id] || {}) });
        setEdits((current) => { const next = { ...current }; delete next[draft.id]; return next; });
        setNotice("Đã lưu nội dung bản nháp. Cần phê duyệt lại sau khi chỉnh sửa.");
        setDrafts((current) => current.map((item) => item.id === saved.id ? { ...item, ...saved } : item));
      } else {
        const path = action === "approve" ? "approve" : action === "reject" ? "reject" : action;
        const changed = await request<ProductDraft>(`product-agent/drafts/${draft.id}/${path}`, { method: "POST", body: "{}" });
        setDrafts((current) => current.map((item) => item.id === changed.id ? { ...item, ...changed } : item));
        setNotice(action === "approve" ? "Đã duyệt bản nháp nội dung. Sản phẩm chưa được xuất bản." : action === "reject" ? "Đã từ chối bản nháp." : action === "cancel" ? "Đã hủy tác vụ." : "Đã đưa bản nháp thất bại vào hàng đợi thử lại.");
      }
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thực hiện được thao tác.");
    } finally { setBusy(""); }
  }

  return <section className="ai-product-agent">
    <header className="ai-product-hero">
      <div><span className="ai-section-kicker">GEME INTELLIGENCE · PHASE 3</span><h3>Product Agent</h3><p>Chuyển ảnh sản phẩm đã duyệt thành bản nháp nội dung có cấu trúc để admin rà soát.</p></div>
      <div className="ai-product-hero-side"><span className={`ai-product-provider ${providerStatus?.configured ? "is-ready" : "is-offline"}`}><i/>{providerStatus?.configured ? "AI đã cấu hình" : providerStatus ? "Cần cấu hình AI key" : "Đang kiểm tra AI"}</span><div className="ai-product-hero-mark" aria-hidden="true"><span>G</span><i>✧</i></div></div>
    </header>

    <div className="ai-product-safeguard"><span>◇</span><p><strong>Chỉ tạo bản nháp nội dung.</strong> Agent không tạo sản phẩm đang bán, không sửa giá hoặc tồn kho và không thể xuất bản. Ảnh không xác minh được chất liệu hay loại đá; các trường đó sẽ để trống cho đến khi admin bổ sung dữ liệu đáng tin cậy.</p></div>

    {error && <div className="ai-studio-alert ai-studio-alert-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="ai-studio-alert ai-studio-alert-success" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice("")}>Đóng</button></div>}

    <section className="ai-product-source-panel">
      <div className="ai-product-section-head"><div><span className="ai-section-kicker">APPROVED VISUALS</span><h4>Chọn ảnh đã duyệt</h4><p>Chỉ hiện ảnh sản phẩm đã duyệt trong Phase 2; bản vẽ kỹ thuật và ảnh đang chờ duyệt bị loại.</p></div><button type="button" className="ai-image-refresh" onClick={() => void refresh()} disabled={loading} aria-label="Làm mới ảnh">↻</button></div>
      {!images.length ? <div className="ai-product-empty"><span>▧</span><strong>{loading ? "Đang tải ảnh đã duyệt…" : "Chưa có ảnh sản phẩm đã duyệt"}</strong><p>Hãy duyệt ảnh ở Image Studio trước khi đưa sang Product Agent.</p></div> : <div className="ai-product-source-grid">{images.map((image) => {
        const active = image.latestDraft && ["QUEUED", "RUNNING", "NEEDS_REVIEW", "READY_FOR_REVIEW"].includes(image.latestDraft.status);
        return <label className={`ai-product-source-card ${selected.includes(image.id) ? "is-selected" : ""}`} key={image.id}>
          <input type="checkbox" checked={selected.includes(image.id)} disabled={Boolean(active) && !selected.includes(image.id)} onChange={() => toggleImage(image.id)} />
          <span className="ai-product-source-check">✓</span>
          <img src={imagePreviewUrl(image.id)} alt={`Ảnh đã duyệt: ${image.originalFilename}`} loading="lazy" />
          <span className="ai-product-source-copy"><strong>{image.originalFilename}</strong><small>{image.batch.name} · QC {image.qcStatus === "PASS" ? "đạt" : "cần xem lại"}</small>{active ? <em>Đang có bản nháp cần xử lý</em> : image.latestDraft?.status === "APPROVED" ? <em>Đã duyệt bản nháp trước</em> : null}</span>
        </label>;
      })}</div>}
      <div className="ai-product-source-footer"><span>Đã tải {images.length}/{imagesTotal} ảnh · {selected.length}/5 ảnh mỗi lô</span><button type="button" className="ai-submit-button" disabled={!selected.length || busy === "create" || providerStatus?.configured === false} onClick={() => void createDraftBatch()}><span>{busy === "create" ? "Đang đưa vào hàng đợi…" : `Tạo ${selected.length || ""} bản nháp`}</span><b>→</b></button></div>
      {imagesHaveMore && <button type="button" className="ai-product-load-more" onClick={() => void loadMoreImages()} disabled={busy === "images-page"}>{busy === "images-page" ? "Đang tải ảnh…" : "Tải thêm 100 ảnh đã duyệt"}</button>}
    </section>

    <section className="ai-product-batches">
      <div className="ai-product-section-head"><div><span className="ai-section-kicker">DRAFT REVIEW</span><h4>Bản nháp sản phẩm</h4><p>Rà soát theo trạng thái, tìm toàn bộ theo tên sản phẩm/tệp ảnh, rồi duyệt tối đa 100 bản mỗi lần. Duyệt không xuất bản sản phẩm.</p></div><span className="ai-count-pill">{drafts.length}/{draftsTotal} bản</span></div>
      <div className="ai-product-review-toolbar">
        <input aria-label="Tìm bản nháp" placeholder="Tìm tên sản phẩm hoặc tên tệp ảnh…" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setDraftSearchQuery(draftSearch.trim()); setSelectedDrafts([]); } }} />
        <button type="button" onClick={() => { setDraftSearchQuery(draftSearch.trim()); setSelectedDrafts([]); }}>Tìm</button>
        <select aria-label="Lọc trạng thái bản nháp" value={draftStatusFilter} onChange={(event) => { setDraftStatusFilter(event.target.value); setSelectedDrafts([]); }}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </select>
        <button type="button" onClick={() => setSelectedDrafts((current) => reviewableDrafts.length && reviewableDrafts.every((draft) => current.includes(draft.id))
          ? current.filter((id) => !reviewableDrafts.some((draft) => draft.id === id))
          : [...new Set([...current, ...reviewableDrafts.map((draft) => draft.id)])].slice(0, 100))} disabled={!reviewableDrafts.length || busy !== ""}>
          {reviewableDrafts.length && reviewableDrafts.every((draft) => selectedDrafts.includes(draft.id)) ? "Bỏ chọn mục đang hiển thị" : `Chọn ${reviewableDrafts.length} mục chờ duyệt`}
        </button>
        <button type="button" className="is-reject" onClick={() => void bulkDecide("REJECTED")} disabled={!selectedDrafts.length || Boolean(busy)}>Từ chối {selectedDrafts.length || ""}</button>
        <button type="button" className="is-approve" onClick={() => void bulkDecide("APPROVED")} disabled={!selectedDrafts.length || Boolean(busy)}>Duyệt {selectedDrafts.length || ""}</button>
      </div>
      {batches.length ? batches.map((batch) => {
        const done = batch.drafts.filter((draft) => draft.status !== "QUEUED" && draft.status !== "RUNNING").length;
        const progress = batch.drafts.length ? Math.round(done / batch.drafts.length * 100) : 0;
        return <div className="ai-product-batch" key={batch.id}>
          <div className="ai-product-batch-head"><div><strong>Lô {batch.id.slice(0, 8)}</strong><small>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(batch.createdAt))} · {batch.drafts.length} ảnh</small></div><span>{batch.status === "PROCESSING" ? "Đang xử lý" : batch.status === "REVIEW" ? "Chờ rà soát" : batch.status === "COMPLETE" ? "Đã xử lý xong" : batch.status === "PARTIAL" ? "Hoàn tất một phần" : batch.status}</span></div>
          <div className="ai-product-progress"><span style={{ width: `${progress}%` }} /></div>
          <div className="ai-product-draft-list">{batch.drafts.map((draft) => {
            const fields: DraftFields = edits[draft.id] || {
              productName: draft.productName,
              shortDescription: draft.shortDescription,
              detailedDescription: draft.detailedDescription,
              categorySuggestion: draft.categorySuggestion,
              materialSuggestion: draft.materialSuggestion,
              gemstoneSuggestion: draft.gemstoneSuggestion,
              seoTitle: draft.seoTitle,
              seoMetaDescription: draft.seoMetaDescription,
              altText: draft.altText,
            };
            const canReview = ["NEEDS_REVIEW", "READY_FOR_REVIEW"].includes(draft.status);
            const taskError = draft.task.errorCode === "OPENAI_PRODUCT_GENERATION_FAILED"
              ? "OpenAI đã từ chối yêu cầu tạo nội dung. Kiểm tra Billing/quota, Usage limits và quyền sử dụng model của project rồi thử lại."
              : draft.task.errorMessage;
            return <div className="ai-product-review-item" key={draft.id}>
              <div className="ai-product-review-row">
                {canReview && <input type="checkbox" aria-label={`Chọn ${draft.sourceImageItem.originalFilename}`} checked={selectedDrafts.includes(draft.id)} disabled={!selectedDrafts.includes(draft.id) && selectedDrafts.length >= 100} onChange={() => toggleDraftSelection(draft.id)} />}
                <img src={imagePreviewUrl(draft.sourceImageItemId)} alt="" loading="lazy" />
                <div className="ai-product-review-row-copy"><strong>{draft.productName || (draft.status === "FAILED" ? "Chưa tạo được bản nháp" : "Đang chuẩn bị nội dung…")}</strong><small>{draft.sourceImageItem.originalFilename}</small>{draft.reviewReasons.length > 0 && <em>{draft.reviewReasons.length} điểm cần kiểm tra</em>}</div>
                <span className={`ai-product-status ${statusClass(draft.status)}`}>{statusLabels[draft.status]}</span>
                {canReview && <span className="ai-product-review-confidence">Danh mục {draft.categoryConfidence ?? draft.confidenceScore}%</span>}
                <button type="button" className="ai-product-expand-button" onClick={() => setExpandedDrafts((current) => current.includes(draft.id) ? current.filter((id) => id !== draft.id) : [...current, draft.id])}>{expandedDrafts.includes(draft.id) ? "Thu gọn" : "Rà soát"}</button>
              </div>
              {expandedDrafts.includes(draft.id) && <article className="ai-product-draft-card">
              <div className="ai-product-draft-image"><img src={imagePreviewUrl(draft.sourceImageItemId)} alt="Ảnh sản phẩm đã được duyệt" loading="lazy" /></div>
              <div className="ai-product-draft-content">
                <div className="ai-product-draft-top"><div><span className="ai-section-kicker">PRODUCT DRAFT · {draft.sourceImageItem.originalFilename}</span><h5>{draft.productName || (draft.status === "FAILED" ? "Chưa tạo được bản nháp" : "Đang chuẩn bị nội dung…")}</h5></div><span className={`ai-product-status ${statusClass(draft.status)}`}>{statusLabels[draft.status]}</span></div>
                {draft.status === "QUEUED" || draft.status === "RUNNING" ? <div className="ai-product-working"><span className="ai-product-spinner"/>AI đang phân tích ảnh và soạn nội dung…{draft.status === "RUNNING" ? "" : " Đang chờ worker."}<button type="button" disabled={busy === draft.id} onClick={() => void runDraftAction(draft, "cancel")}>Hủy</button></div> : null}
                {draft.status === "FAILED" ? <div className="ai-product-failure"><p>{taskError || "Không xử lý được ảnh này."}</p><button type="button" disabled={busy === draft.id} onClick={() => void runDraftAction(draft, "retry")}>{busy === draft.id ? "Đang thử lại…" : "Thử lại"}</button></div> : null}
                {!(["QUEUED", "RUNNING", "FAILED", "CANCELLED"].includes(draft.status)) && <>
                  <div className="ai-product-confidence"><span>Độ tin cậy gợi ý danh mục</span><strong>{draft.categoryConfidence ?? draft.confidenceScore}%</strong><div><i style={{ width: `${draft.categoryConfidence ?? draft.confidenceScore}%` }} /></div><em>{draft.needsReview ? "Cần admin xác minh" : "Gợi ý dựa trên chi tiết nhìn thấy"}</em></div>
                  {draft.reviewReasons.length > 0 && <div className="ai-product-review-flags"><strong>Điểm cần rà soát</strong><ul>{draft.reviewReasons.map((reason, index) => <li key={`${reason}-${index}`}>{labelReason(reason)}</li>)}</ul></div>}
                  <div className="ai-product-evidence"><strong>Chi tiết quan sát được</strong><p>{Array.isArray(draft.evidence) && draft.evidence.length ? (draft.evidence as string[]).join(" · ") : "Không có chi tiết đủ chắc chắn để ghi nhận."}</p></div>
                  <div className="ai-product-fields">
                    <label><span>Tên sản phẩm</span><input value={fields.productName} maxLength={180} onChange={(event) => editValue(draft, "productName", event.target.value)} /></label>
                    <label><span>Danh mục gợi ý</span><input value={fields.categorySuggestion || ""} maxLength={160} placeholder="Chưa xác định — chọn sau khi rà soát" onChange={(event) => editValue(draft, "categorySuggestion", event.target.value)} /></label>
                    <label><span>Chất liệu <small>đối chiếu hồ sơ thật</small></span><input value={fields.materialSuggestion || ""} maxLength={160} placeholder="Chưa xác minh" onChange={(event) => editValue(draft, "materialSuggestion", event.target.value)} /></label>
                    <label><span>Loại đá <small>đối chiếu hồ sơ thật</small></span><input value={fields.gemstoneSuggestion || ""} maxLength={160} placeholder="Chưa xác minh" onChange={(event) => editValue(draft, "gemstoneSuggestion", event.target.value)} /></label>
                    <label className="wide"><span>Mô tả ngắn</span><textarea value={fields.shortDescription} maxLength={500} rows={2} onChange={(event) => editValue(draft, "shortDescription", event.target.value)} /></label>
                    <label className="wide"><span>Mô tả chi tiết</span><textarea value={fields.detailedDescription} maxLength={6000} rows={4} onChange={(event) => editValue(draft, "detailedDescription", event.target.value)} /></label>
                    <label><span>SEO title</span><input value={fields.seoTitle} maxLength={180} onChange={(event) => editValue(draft, "seoTitle", event.target.value)} /></label>
                    <label><span>Alt text</span><input value={fields.altText} maxLength={500} onChange={(event) => editValue(draft, "altText", event.target.value)} /></label>
                    <label className="wide"><span>SEO meta description</span><textarea value={fields.seoMetaDescription} maxLength={320} rows={2} onChange={(event) => editValue(draft, "seoMetaDescription", event.target.value)} /></label>
                  </div>
                  <div className="ai-product-review-actions">
                    {Object.hasOwn(edits, draft.id) && <button type="button" className="is-secondary" disabled={busy === draft.id} onClick={() => void runDraftAction(draft, "save")}>{busy === draft.id ? "Đang lưu…" : "Lưu chỉnh sửa"}</button>}
                    {canReview ? <><button type="button" className="is-reject" disabled={busy === draft.id} onClick={() => void runDraftAction(draft, "reject")}>Từ chối</button><button type="button" disabled={busy === draft.id} onClick={() => void runDraftAction(draft, "approve")}>Duyệt bản nháp</button></> : draft.status === "APPROVED" ? <span>Đã duyệt bởi {draft.reviewedBy?.displayName || "admin"} · {draft.reviewedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.reviewedAt)) : ""}</span> : null}
                  </div>
                </>}
                {draft.status === "REJECTED" && <p className="ai-product-rejected">Bản nháp đã bị từ chối. Có thể chỉnh sửa hoặc tạo lại từ ảnh sau khi xử lý bản hiện tại.</p>}
                {draft.status === "CANCELLED" && <p className="ai-product-rejected">Tác vụ đã hủy.</p>}
              </div>
              </article>}
            </div>;
          })}</div>
        </div>;
      }) : <div className="ai-product-empty"><span>✧</span><strong>{loading ? "Đang tải bản nháp…" : draftSearch ? "Không tìm thấy bản nháp phù hợp" : "Chưa có bản nháp nào"}</strong><p>{draftSearch ? "Thử một từ khóa khác hoặc đổi bộ lọc trạng thái." : "Chọn ảnh đã duyệt ở phía trên để bắt đầu."}</p></div>}
      {draftsHaveMore && <button type="button" className="ai-product-load-more" onClick={() => void loadMoreDrafts()} disabled={busy === "drafts-page"}>{busy === "drafts-page" ? "Đang tải bản nháp…" : "Tải thêm 50 bản nháp"}</button>}
    </section>
  </section>;
}
