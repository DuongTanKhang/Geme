"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { apiBaseUrl } from "../lib/api";

type ImagePreset = "STONE_GREY" | "WARM_IVORY" | "SOFT_SAGE";
type ImagePurpose = "PRODUCT_PHOTO" | "TECHNICAL_DRAWING";
type ImageItemStatus = "PENDING_UPLOAD" | "QUEUED" | "RUNNING" | "AWAITING_APPROVAL" | "APPROVED" | "REJECTED" | "FAILED" | "CANCELLED";
type ImageBatchStatus = "UPLOADING" | "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED";
type ImageItem = {
  id: string;
  originalFilename: string;
  relativePath: string;
  status: ImageItemStatus;
  qcStatus: "PENDING" | "PASS" | "REVIEW" | "FAIL";
  qcFlags: string[];
  errorCode?: string | null;
  expectedSize: number;
  taskId?: string | null;
  task?: { id: string; status: string; approval?: { status: string } | null } | null;
  classification?: { suggestion?: string; labels?: string[]; method?: string; category?: string; visible_components?: string[]; visible_views?: string[]; uncertain_details?: string[] } | null;
  qcReport?: { dimensions?: { width?: number; height?: number }; opaqueForegroundPixelsPreserved?: boolean } | null;
  attachedProduct?: { id: string; sku: string; name: string; status: string } | null;
  attachedProductId?: string | null;
};
type ImageBatch = { id: string; name: string; preset: ImagePreset; purpose: ImagePurpose; visualPrompt?: string; status: ImageBatchStatus; targetProduct?: { id?: string; sku: string; name: string; status?: string; technicalImageUrl?: string | null } | null; createdAt: string; items: ImageItem[] };
type ImageStudioStatus = { provider: string; configured: boolean; technicalDrawingConfigured: boolean; customPromptConfigured: boolean; sandbox: boolean; maxFilesPerBatch: number; maxImageBytes: number; maxBatchBytes: number; presets: ImagePreset[]; privateStorage: string };
type LocalUpload = { key: string; file: File; name: string; relativePath: string; serverItemId?: string; state: "WAITING" | "UPLOADING" | "QUEUED" | "FAILED"; error?: string };

const statusLabels: Record<ImageItemStatus, string> = {
  PENDING_UPLOAD: "Chờ tải ảnh",
  QUEUED: "Đang chờ xử lý",
  RUNNING: "Đang xử lý",
  AWAITING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
};
const batchLabels: Record<ImageBatchStatus, string> = {
  UPLOADING: "Đang tải ảnh",
  PROCESSING: "Đang xử lý",
  REVIEW: "Chờ duyệt ảnh",
  COMPLETE: "Hoàn tất",
  PARTIAL: "Hoàn tất một phần",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
};
const presetLabels: Record<ImagePreset, string> = { STONE_GREY: "Stone Grey", WARM_IVORY: "Warm Ivory", SOFT_SAGE: "Soft Sage" };
const imageErrorLabels: Record<string, string> = {
  PHOTOROOM_BILLING_REQUIRED: "Photoroom trả HTTP 402 Payment Required. Kiểm tra tín dụng, gói API và thanh toán tài khoản Photoroom rồi thử lại.",
  PHOTOROOM_AUTH_FAILED: "Photoroom từ chối API key. Kiểm tra key và quyền API trong cấu hình server.",
  PHOTOROOM_RATE_LIMITED: "Photoroom đang giới hạn tốc độ. Chờ rồi thử lại thủ công.",
  PHOTOROOM_IMAGE_REJECTED: "Photoroom từ chối định dạng hoặc nội dung ảnh. Kiểm tra ảnh nguồn rồi thử lại.",
  PHOTOROOM_REQUEST_REJECTED: "Photoroom từ chối yêu cầu xử lý ảnh. Kiểm tra cấu hình và ảnh nguồn.",
  PHOTOROOM_TIMEOUT: "Photoroom xử lý quá thời gian chờ. Có thể thử lại sau.",
  PHOTOROOM_UNAVAILABLE: "Photoroom đang tạm thời không khả dụng. Có thể thử lại sau.",
  PHOTOROOM_NOT_CONFIGURED: "Chưa cấu hình API key Photoroom trên server.",
  PHOTOROOM_SANDBOX_KEY_REQUIRED: "Đang bật chế độ sandbox nhưng API key Photoroom không phải sandbox key.",
  CUSTOM_BACKGROUND_RATE_LIMITED: "OpenAI đang giới hạn tốc độ tạo ảnh. Hãy chờ rồi thử lại.",
  CUSTOM_BACKGROUND_QUOTA_EXCEEDED: "OpenAI báo hết hạn mức hoặc billing chưa hoạt động. Kiểm tra Usage, Billing và Limits của project rồi thử lại.",
  CUSTOM_BACKGROUND_AUTH_FAILED: "OpenAI từ chối API key. Kiểm tra key và quyền project trong cấu hình server.",
  CUSTOM_BACKGROUND_REQUEST_REJECTED: "OpenAI từ chối yêu cầu tạo bối cảnh. Hãy chỉnh prompt rồi thử lại.",
  CUSTOM_BACKGROUND_PROVIDER_UNAVAILABLE: "Dịch vụ tạo ảnh OpenAI đang tạm thời không khả dụng. Có thể thử lại sau.",
  CUSTOM_BACKGROUND_HTTP_429: "OpenAI trả HTTP 429: có thể do giới hạn tốc độ hoặc hết quota/billing. Log cũ không ghi subtype; hãy kiểm tra Usage, Billing và Limits của project trước khi thử lại.",
};
function imageErrorLabel(code: string) { return imageErrorLabels[code] || code.replaceAll("_", " "); }
const aiImageStudioApiUrl = `${apiBaseUrl}/admin/ai-studio/image-studio`;
const classificationOptions = [
  ["", "Tự gợi ý từ tên ảnh"],
  ["ring", "Nhẫn / trang sức"],
  ["emerald", "Emerald / đá màu"],
  ["opal", "Opal"],
  ["jade bracelet", "Vòng ngọc / jade"],
  ["transparent gemstone", "Đá trong suốt"],
  ["reflective silver jewelry", "Trang sức bạc phản chiếu"],
] as const;

function imageUrl(item: ImageItem, variant: "original" | "output") {
  return `${aiImageStudioApiUrl}/items/${encodeURIComponent(item.id)}/preview?variant=${variant}`;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl}/admin/${path.replace(/^\//, "")}`, { ...init, headers, credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { message?: string | string[]; detail?: string };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || body.detail || `Máy chủ trả về lỗi ${response.status}.`);
  return body as T;
}

function bytesLabel(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function BeforeAfter({ item }: { item: ImageItem }) {
  const [position, setPosition] = useState(50);
  const ready = Boolean(item.task && ["AWAITING_APPROVAL", "APPROVED", "REJECTED"].includes(item.task.status));
  return <div className="ai-image-compare">
    <div className="ai-image-compare-stage">
      <img className="ai-image-source" src={imageUrl(item, "original")} alt={`Ảnh gốc ${item.originalFilename}`} loading="lazy" />
      {ready && <img className="ai-image-result" src={imageUrl(item, "output")} alt={`Ảnh GEME ${item.originalFilename}`} style={{ clipPath: `inset(0 0 0 ${position}%)` }} loading="lazy" />}
      <span className="ai-image-compare-label source">Gốc</span>{ready && <span className="ai-image-compare-label result">GEME</span>}
    </div>
    {ready && <input aria-label="So sánh ảnh gốc và ảnh GEME" className="ai-image-compare-slider" type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} />}
  </div>;
}

export default function AiImageStudioWorkspace() {
  const [status, setStatus] = useState<ImageStudioStatus | null>(null);
  const [batches, setBatches] = useState<ImageBatch[]>([]);
  const [batch, setBatch] = useState<ImageBatch | null>(null);
  const [files, setFiles] = useState<LocalUpload[]>([]);
  const [batchName, setBatchName] = useState("");
  const [preset, setPreset] = useState<ImagePreset>("STONE_GREY");
  const [purpose, setPurpose] = useState<ImagePurpose>("PRODUCT_PHOTO");
  const [productSku, setProductSku] = useState("");
  const [classificationHint, setClassificationHint] = useState("");
  const [visualPrompt, setVisualPrompt] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({});
  const idempotencyKey = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (batchId?: string) => {
    try {
      const [nextStatus, nextBatches] = await Promise.all([
        request<ImageStudioStatus>("ai-studio/image-studio/status"),
        request<ImageBatch[]>("ai-studio/image-studio/batches?limit=12"),
      ]);
      setStatus(nextStatus);
      setBatches(nextBatches);
      const nextId = batchId || batch?.id || nextBatches[0]?.id;
      if (nextId) setBatch(await request<ImageBatch>(`ai-studio/image-studio/batches/${encodeURIComponent(nextId)}`));
      else setBatch(null);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được Image Studio.");
    }
  }, [batch?.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  const active = batch?.items.some((item) => ["QUEUED", "RUNNING", "PENDING_UPLOAD"].includes(item.status));
  useEffect(() => {
    if (!active || !batch?.id) return;
    const timer = window.setInterval(() => void refresh(batch.id), 3500);
    return () => window.clearInterval(timer);
  }, [active, batch?.id, refresh]);

  const approvedCount = batch?.items.filter((item) => item.status === "APPROVED").length || 0;
  const progressCount = batch?.items.filter((item) => ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "FAILED", "CANCELLED"].includes(item.status)).length || 0;
  const progressPercent = batch?.items.length ? Math.round((progressCount / batch.items.length) * 100) : 0;

  function addFiles(inputFiles: FileList | File[]) {
    if (purpose === "TECHNICAL_DRAWING" && files.length + inputFiles.length > 1) {
      setError("Mỗi ảnh kỹ thuật dùng đúng một ảnh tham chiếu. Hãy bỏ ảnh đang chọn trước khi chọn ảnh khác.");
      return;
    }
    const additions = Array.from(inputFiles).map((file) => {
      const maybePathFile = file as File & { webkitRelativePath?: string };
      const folderPath = maybePathFile.webkitRelativePath || "";
      return { key: crypto.randomUUID(), file, name: file.name, relativePath: folderPath.split("/").slice(0, -1).join("/"), state: "WAITING" as const };
    });
    if (files.length + additions.length > 50) setError("Mỗi lô tối đa 50 ảnh.");
    idempotencyKey.current = null;
    setFiles((current) => [...current, ...additions].slice(0, 50));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function validateSelectedFiles() {
    if (!files.length) throw new Error("Hãy chọn ít nhất một ảnh hoặc thư mục ảnh.");
    if (purpose === "TECHNICAL_DRAWING" && files.length !== 1) throw new Error("Mỗi bản vẽ kỹ thuật dùng đúng một ảnh sản phẩm làm tham chiếu.");
    if (purpose === "TECHNICAL_DRAWING" && !productSku.trim()) throw new Error("Hãy nhập SKU sản phẩm cần gắn bản vẽ kỹ thuật.");
    if (files.length > 50) throw new Error("Mỗi lô tối đa 50 ảnh.");
    let total = 0;
    for (const item of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(item.file.type)) throw new Error(`${item.name}: chỉ nhận JPEG, PNG hoặc WebP.`);
      if (!item.file.size || item.file.size > 8 * 1024 * 1024) throw new Error(`${item.name}: kích thước tối đa 8 MB.`);
      total += item.file.size;
    }
    if (total > 100 * 1024 * 1024) throw new Error("Tổng dung lượng một lô tối đa 100 MB.");
  }

  async function uploadOne(batchId: string, itemId: string, file: File) {
    const data = new FormData();
    data.append("image_file", file, file.name);
    return request<ImageBatch>(`ai-studio/image-studio/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/upload`, { method: "POST", body: data });
  }

  async function createBatch() {
    if (busy) return;
    setError(""); setNotice("");
    try { validateSelectedFiles(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Danh sách ảnh chưa hợp lệ."); return; }
    if (purpose === "PRODUCT_PHOTO" && !status?.configured) { setError("Chưa cấu hình Photoroom cho tác vụ hậu kỳ ảnh."); return; }
    if (purpose === "PRODUCT_PHOTO" && visualPrompt.trim() && !status?.customPromptConfigured) { setError("Chưa cấu hình khóa OpenAI để tạo bối cảnh theo chỉ dẫn."); return; }
    if (purpose === "TECHNICAL_DRAWING" && !status?.technicalDrawingConfigured) { setError("Chưa cấu hình khóa OpenAI cho tác vụ bản vẽ kỹ thuật."); return; }
    setBusy(true);
    const key = idempotencyKey.current || crypto.randomUUID();
    idempotencyKey.current = key;
    try {
      const created = await request<ImageBatch>("ai-studio/image-studio/batches", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          name: batchName.trim(), preset, purpose, ...(purpose === "TECHNICAL_DRAWING" ? { productSku: productSku.trim() } : visualPrompt.trim() ? { visualPrompt: visualPrompt.trim() } : {}),
          items: files.map((item) => ({ name: item.name, relativePath: item.relativePath, size: item.file.size, mimeType: item.file.type, classificationHint })),
        }),
      });
      idempotencyKey.current = null;
      setBatch(created);
      setSelected([]);
      setFiles((current) => current.map((item, index) => ({ ...item, serverItemId: created.items[index]?.id, state: "WAITING" })));
      let index = 0;
      let completed = 0;
      const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
        while (index < files.length) {
          const current = index++;
          const local = files[current];
          const serverItem = created.items[current];
          setFiles((rows) => rows.map((entry) => entry.key === local.key ? { ...entry, state: "UPLOADING" } : entry));
          try {
            await uploadOne(created.id, serverItem.id, local.file);
            setFiles((rows) => rows.map((entry) => entry.key === local.key ? { ...entry, state: "QUEUED" } : entry));
          } catch (reason) {
            setFiles((rows) => rows.map((entry) => entry.key === local.key ? { ...entry, state: "FAILED", error: reason instanceof Error ? reason.message : "Tải ảnh lỗi." } : entry));
          }
          completed++;
          setNotice(`Đã gửi ${completed}/${files.length} ảnh vào hàng đợi.`);
        }
      });
      await Promise.all(workers);
      setFiles((current) => current.filter((item) => item.state === "FAILED"));
      setBatchName("");
      await refresh(created.id);
      setNotice(purpose === "TECHNICAL_DRAWING" ? "Ảnh tham chiếu đã vào hàng đợi. Bản vẽ sẽ được phân tích, tạo riêng và chờ bạn duyệt trước khi gắn vào hồ sơ SKU." : "Lô ảnh đã được ghi nhận. Ảnh sẽ chờ xử lý và kiểm duyệt riêng từng tấm.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được lô ảnh.");
    } finally { setBusy(false); }
  }

  async function retryUpload(local: LocalUpload) {
    if (!batch || local.state !== "FAILED") return;
    if (!local.serverItemId) return;
    setFiles((rows) => rows.map((entry) => entry.key === local.key ? { ...entry, state: "UPLOADING", error: undefined } : entry));
    try { await uploadOne(batch.id, local.serverItemId, local.file); setFiles((rows) => rows.filter((entry) => entry.key !== local.key)); await refresh(batch.id); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "Tải ảnh lỗi.";
      setFiles((rows) => rows.map((entry) => entry.key === local.key ? { ...entry, state: "FAILED", error: message } : entry));
      setError(message);
    }
  }

  async function itemAction(item: ImageItem, action: "approve" | "reject" | "retry") {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = action === "retry" ? undefined : JSON.stringify({ note: action === "reject" ? "Cần kiểm tra lại ảnh gốc và mask trước khi dùng." : "Ảnh đã được admin kiểm tra và phê duyệt." });
      await request(`ai-studio/image-studio/items/${encodeURIComponent(item.id)}/${action}`, { method: "POST", ...(body ? { body } : {}) });
      await refresh(batch?.id);
      setNotice(action === "approve" ? "Đã duyệt ảnh." : action === "reject" ? "Đã từ chối ảnh." : "Đã đưa ảnh vào hàng đợi thử lại.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không cập nhật được ảnh."); }
    finally { setBusy(false); }
  }

  async function attach(item: ImageItem) {
    const sku = skuInputs[item.id]?.trim();
    if (!sku) { setError("Hãy nhập SKU sản phẩm bản nháp."); return; }
    setBusy(true); setError("");
    try {
      await request(`ai-studio/image-studio/items/${encodeURIComponent(item.id)}/attach`, { method: "POST", body: JSON.stringify({ sku }) });
      await refresh(batch?.id);
      setNotice(`Đã gắn ảnh vào bản nháp ${sku}. Sản phẩm chưa được xuất bản.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không gắn được ảnh vào sản phẩm."); }
    finally { setBusy(false); }
  }

  async function attachTechnicalDrawing(item: ImageItem) {
    if (!batch?.targetProduct) return;
    if (batch.targetProduct.technicalImageUrl && !window.confirm(`SKU ${batch.targetProduct.sku} đã có ảnh kỹ thuật. Gắn ảnh mới sẽ thay ảnh đang dùng trong hồ sơ sản phẩm. Tiếp tục?`)) return;
    setBusy(true); setError("");
    try {
      await request(`ai-studio/image-studio/items/${encodeURIComponent(item.id)}/attach-technical-drawing`, { method: "POST" });
      await refresh(batch.id);
      setNotice(`Đã gắn tag TECHNICAL_DRAWING và cập nhật ảnh kỹ thuật cho SKU ${batch.targetProduct.sku}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không gắn được ảnh kỹ thuật vào sản phẩm."); }
    finally { setBusy(false); }
  }

  async function cancelBatch() {
    if (!batch || busy) return;
    setBusy(true); setError("");
    try { await request(`ai-studio/image-studio/batches/${encodeURIComponent(batch.id)}/cancel`, { method: "POST", body: "{}" }); await refresh(batch.id); setNotice("Đã dừng các ảnh còn trong hàng đợi."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Không hủy được lô."); }
    finally { setBusy(false); }
  }

  function toggleSelected(itemId: string) {
    setSelected((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  return <section className="ai-image-studio">
    <header className="ai-image-hero">
      <div><span className="ai-section-kicker">GEME VISUAL AGENT · IMAGE STUDIO</span><h3>Hậu kỳ & bản vẽ kỹ thuật</h3><p>Giữ ảnh gốc riêng biệt, tạo bản nháp có nhãn để admin kiểm duyệt trước khi gắn vào sản phẩm.</p></div>
      <div className="ai-image-provider"><span className={(purpose === "TECHNICAL_DRAWING" ? status?.technicalDrawingConfigured : status?.configured) ? "is-ready" : "is-offline"} />{purpose === "TECHNICAL_DRAWING" ? status?.technicalDrawingConfigured ? "OpenAI Image đã cấu hình" : "Chưa cấu hình OpenAI Image" : status?.configured ? status.sandbox ? "Photoroom Sandbox" : "Photoroom đã kết nối" : "Chưa cấu hình Photoroom"}</div>
    </header>

    {error && <div className="ai-studio-alert ai-studio-alert-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="ai-studio-alert ai-studio-alert-success" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice("")}>Đóng</button></div>}

    <div className="ai-image-layout">
      <section className="ai-image-upload-panel">
        <div className="ai-section-heading"><div><span className="ai-section-kicker">NEW BATCH</span><h3>{purpose === "TECHNICAL_DRAWING" ? "Tạo ảnh kỹ thuật" : "Tạo lô ảnh sản phẩm"}</h3><p>{purpose === "TECHNICAL_DRAWING" ? "Một ảnh sản phẩm tham chiếu, gắn cho đúng SKU và luôn chờ người duyệt." : "Chọn nhiều ảnh hoặc cả thư mục. Mỗi ảnh được kiểm duyệt riêng."}</p></div><span className="ai-image-panel-mark">✦</span></div>
        <div className={`ai-image-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <span className="ai-image-upload-icon">↑</span><strong>Kéo ảnh vào đây</strong><small>JPEG, PNG, WebP · tối đa 8 MB/ảnh · {purpose === "TECHNICAL_DRAWING" ? "1 ảnh tham chiếu/lần" : "50 ảnh/lô"}</small>
          <div><button type="button" onClick={() => fileInput.current?.click()}>Chọn ảnh</button><button type="button" className="is-secondary" disabled={purpose === "TECHNICAL_DRAWING"} onClick={() => folderInput.current?.click()}>Chọn thư mục</button></div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple={purpose === "PRODUCT_PHOTO"} hidden onChange={onFileChange} />
          <input ref={folderInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={onFileChange} />
        </div>
        {files.length > 0 && <div className="ai-image-local-list"><div className="ai-image-list-head"><strong>{files.length} ảnh được chọn</strong><button type="button" onClick={() => setFiles([])}>Bỏ tất cả</button></div>{files.map((entry) => <div className="ai-image-local-row" key={entry.key}><span className={`ai-upload-dot state-${entry.state.toLowerCase()}`} /><div><strong>{entry.name}</strong><small>{entry.relativePath ? `${entry.relativePath} · ` : ""}{bytesLabel(entry.file.size)}{entry.error ? ` · ${entry.error}` : ""}</small></div>{entry.state === "FAILED" && batch && <button type="button" onClick={() => void retryUpload(entry)}>Tải lại</button>}<button type="button" aria-label={`Bỏ ${entry.name}`} onClick={() => setFiles((rows) => rows.filter((row) => row.key !== entry.key))}>×</button></div>)}</div>}
        <div className="ai-image-form-grid">
          <label><span>Loại tác vụ</span><select value={purpose} onChange={(event) => { const next = event.target.value as ImagePurpose; setPurpose(next); if (next === "TECHNICAL_DRAWING") setFiles((rows) => rows.slice(0, 1)); idempotencyKey.current = null; }}><option value="PRODUCT_PHOTO">Hậu kỳ ảnh sản phẩm</option><option value="TECHNICAL_DRAWING">Tạo bản vẽ kỹ thuật AI</option></select></label>
          <label><span>Tên lô</span><input maxLength={120} value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="Ví dụ: Nhẫn Emerald · đợt 1" /></label>
          {purpose === "PRODUCT_PHOTO" && <label><span>Preset nền</span><select value={preset} onChange={(event) => setPreset(event.target.value as ImagePreset)}>{Object.entries(presetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {purpose === "TECHNICAL_DRAWING" && <label><span>SKU sản phẩm</span><input maxLength={64} value={productSku} onChange={(event) => { setProductSku(event.target.value); idempotencyKey.current = null; }} placeholder="Nhập SKU cần gắn ảnh kỹ thuật" /></label>}
          {purpose === "PRODUCT_PHOTO" && <label className="wide"><span>Gợi ý nhóm ảnh <small>Tùy chọn; giúp gắn cờ review, không thay phân loại bằng model thị giác</small></span><select value={classificationHint} onChange={(event) => setClassificationHint(event.target.value)}>{classificationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {purpose === "PRODUCT_PHOTO" && <label className="wide"><span>Chỉ dẫn sáng tạo cho AI <small>Tùy chọn · tối đa 1.200 ký tự</small></span><textarea maxLength={1200} rows={3} value={visualPrompt} onChange={(event) => { setVisualPrompt(event.target.value); idempotencyKey.current = null; }} placeholder="Ví dụ: Bối cảnh đá xám khói, khối travertine thấp lệch sang phải, ánh sáng studio ấm từ bên trái, bóng đổ mềm và tối giản theo phong cách GEME…" /><small className="ai-image-prompt-help">Mô tả bối cảnh, bề mặt, ánh sáng, không khí và vật trang trí phụ. AI dựng bối cảnh riêng theo chỉ dẫn; GEME ghép sản phẩm gốc lên trên. Mỗi ảnh có chỉ dẫn sẽ gọi OpenAI Image và có thể phát sinh phí.</small></label>}
        </div>
        <div className="ai-image-safeguard"><span>◇</span><p>{purpose === "TECHNICAL_DRAWING" ? "Agent sẽ phân tích những chi tiết nhìn thấy rồi tạo bản minh họa tham khảo. Không suy đoán kích thước hoặc cấu tạo bị khuất. Ảnh AI có thể làm sai chi tiết đá/chấu; kết quả không phải bản CAD hay thông số chế tác và luôn cần đối chiếu thủ công." : visualPrompt.trim() ? "OpenAI tạo bối cảnh, ánh sáng và vật trang trí nền theo chỉ dẫn; ảnh sản phẩm gốc không gửi sang OpenAI. Photoroom cung cấp mask, GEME ghép lại sản phẩm gốc và kiểm tra pixel vùng đặc. Ảnh có nền AI luôn cần admin kiểm duyệt." : "Photoroom chỉ cung cấp alpha mask. GEME giữ RGB gốc ở vùng vật thể và không dùng generative fill. Mask khó, đá trong, Opal, kim loại bóng và chi tiết nhỏ sẽ được gắn cờ duyệt."}</p></div>
        {purpose === "PRODUCT_PHOTO" && !status?.configured && <div className="ai-image-config-note">Cần cấu hình <code>PHOTOROOM_API_KEY</code> ở AI Core trước khi tạo lô hậu kỳ ảnh.</div>}
        {purpose === "PRODUCT_PHOTO" && visualPrompt.trim() && !status?.customPromptConfigured && <div className="ai-image-config-note">Cần cấu hình <code>GEME_OPENAI_API_KEY</code> trong <code>.env.docker</code> để tạo nền theo prompt.</div>}
        {purpose === "TECHNICAL_DRAWING" && <div className="ai-image-config-note">Ảnh tham chiếu sẽ được gửi đến OpenAI để phân tích và tạo một ảnh nháp; thao tác có thể phát sinh phí API. Khóa chỉ nằm ở backend.</div>}
        {purpose === "TECHNICAL_DRAWING" && !status?.technicalDrawingConfigured && <div className="ai-image-config-note">Cần cấu hình <code>GEME_OPENAI_API_KEY</code> trong <code>.env.docker</code> để bật phân tích và tạo ảnh kỹ thuật.</div>}
        <button className="ai-submit-button" type="button" onClick={() => void createBatch()} disabled={busy || !files.length || (purpose === "PRODUCT_PHOTO" ? !status?.configured || Boolean(visualPrompt.trim() && !status?.customPromptConfigured) : !status?.technicalDrawingConfigured)}><span>{busy ? "Đang tải ảnh vào hàng đợi…" : purpose === "TECHNICAL_DRAWING" ? "Phân tích & tạo bản nháp kỹ thuật" : visualPrompt.trim() ? "Tạo bối cảnh AI & xử lý ảnh" : status?.configured ? "Tạo lô và xử lý ảnh" : "Cần kết nối Photoroom"}</span><b>→</b></button>
      </section>

      <aside className="ai-image-history-panel">
        <div className="ai-section-heading"><div><span className="ai-section-kicker">BATCH HISTORY</span><h3>Lô xử lý gần đây</h3><p>Ảnh gốc và kết quả luôn được lưu tách biệt.</p></div><button className="ai-image-refresh" type="button" onClick={() => void refresh()} aria-label="Tải lại danh sách">↻</button></div>
        {batches.length ? <div className="ai-image-batch-list">{batches.map((row) => <button className={`ai-image-batch-row ${batch?.id === row.id ? "is-active" : ""}`} type="button" key={row.id} onClick={() => { setSelected([]); void refresh(row.id); }}><span className="ai-image-batch-gem">◇</span><span><strong>{row.name}</strong><small>{row.purpose === "TECHNICAL_DRAWING" ? `Ảnh kỹ thuật · ${row.targetProduct?.sku || "SKU"}` : `${row.items.length} ảnh · ${presetLabels[row.preset]}`}</small></span><em className={`batch-${row.status.toLowerCase()}`}>{batchLabels[row.status]}</em></button>)}</div> : <div className="ai-image-empty">Chưa có lô xử lý. Hãy tải ảnh để bắt đầu.</div>}
        <div className="ai-image-storage-note"><span>▣</span><p>Kho ảnh riêng: {status?.privateStorage === "r2-private" ? "Cloudflare R2 private" : "PostgreSQL media store"}. Ảnh chưa duyệt không được công khai.</p></div>
      </aside>
    </div>

    {batch && <section className="ai-image-review-panel">
      <div className="ai-image-review-head"><div><span className="ai-section-kicker">IMAGE REVIEW</span><h3>{batch.name}</h3><p>{batch.purpose === "TECHNICAL_DRAWING" ? `Ảnh kỹ thuật AI · SKU ${batch.targetProduct?.sku || "chưa gắn"} · cần duyệt thủ công` : `${batch.items.length} ảnh · ${presetLabels[batch.preset]}`} · {batchLabels[batch.status]}</p></div><div className="ai-image-batch-actions">{batch.items.length > 0 && <><span className="ai-image-progress-label">{progressCount}/{batch.items.length} · {progressPercent}%</span>{batch.purpose === "PRODUCT_PHOTO" && <button type="button" className="ai-image-batch-select" onClick={() => setSelected(selected.length === batch.items.length ? [] : batch.items.map((item) => item.id))}>{selected.length === batch.items.length ? "Bỏ chọn" : `Chọn tất cả · ${selected.length} đã chọn`}</button>}</>}{active && <button type="button" className="is-danger" onClick={() => void cancelBatch()} disabled={busy}>Dừng lô</button>}{approvedCount > 0 && <a className="ai-image-export" href={`${aiImageStudioApiUrl}/batches/${encodeURIComponent(batch.id)}/export.zip`}>Tải ZIP đã duyệt ({approvedCount})</a>}</div></div>
       {batch.visualPrompt && <div className="ai-image-prompt-summary"><strong>Chỉ dẫn AI đã dùng</strong><p>{batch.visualPrompt}</p></div>}
       {batch.items.length > 0 && <div className="ai-image-progress"><span style={{ width: `${progressPercent}%` }} /></div>}
      <div className="ai-image-grid">
        {batch.items.map((item) => <article className={`ai-image-card item-${item.status.toLowerCase()}`} key={item.id}>
          <div className="ai-image-card-head">{batch.purpose === "PRODUCT_PHOTO" && <label><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} /><span className="ai-image-select-box">✓</span></label>}<span className={`ai-status ai-status-${item.status.toLowerCase()}`}><i />{statusLabels[item.status]}</span>{batch.purpose === "TECHNICAL_DRAWING" && <span className="ai-image-classification">TECHNICAL_DRAWING</span>}</div>
          <BeforeAfter item={item} />
          <div className="ai-image-card-body"><strong title={item.originalFilename}>{item.originalFilename}</strong>{item.relativePath && <small className="ai-image-folder-path">{item.relativePath}</small>}
            <div className={`ai-image-qc qc-${item.qcStatus.toLowerCase()}`}><i />QC: {item.qcStatus === "PASS" ? "Đạt kiểm tra tự động" : item.qcStatus === "REVIEW" ? "Cần người kiểm tra" : item.qcStatus === "FAIL" ? "Không đạt" : "Đang chờ"}</div>
            {item.qcFlags.length > 0 && <small className="ai-image-flags">{item.qcFlags.map((flag) => flag.replaceAll("_", " ")).join(" · ")}</small>}
            {item.errorCode && <small className="ai-image-flags">Lỗi xử lý: {imageErrorLabel(item.errorCode)}</small>}
            {item.classification?.suggestion && <small className="ai-image-classification">Gợi ý: {item.classification.suggestion} · {item.classification.method === "filename_and_admin_hint" ? "metadata/tên tệp" : "AI"}</small>}
            {item.classification?.category && <small className="ai-image-classification">AI nhận diện tham khảo: {item.classification.category}{item.classification.visible_components?.length ? ` · ${item.classification.visible_components.join(", ")}` : ""}{item.classification.visible_views?.length ? ` · Góc nhìn: ${item.classification.visible_views.join(", ")}` : ""}</small>}
            {item.classification?.uncertain_details?.length ? <small className="ai-image-flags">Chưa thể xác minh: {item.classification.uncertain_details.join(" · ")}</small> : null}
            {item.qcReport?.dimensions && <small className="ai-image-dimensions">{item.qcReport.dimensions.width} × {item.qcReport.dimensions.height}px · {item.qcReport.opaqueForegroundPixelsPreserved ? "pixel vùng đặc giữ nguyên" : "cần xem lại pixel"}</small>}
            {item.status === "AWAITING_APPROVAL" && <div className="ai-image-action-row"><button type="button" className="is-approve" disabled={busy} onClick={() => void itemAction(item, "approve")}>Duyệt</button><button type="button" className="is-reject" disabled={busy} onClick={() => void itemAction(item, "reject")}>Từ chối</button></div>}
            {item.status === "FAILED" && <button className="ai-image-retry" type="button" disabled={busy} onClick={() => void itemAction(item, "retry")}>↻ Thử lại</button>}
            {item.status === "APPROVED" && <div className="ai-image-approved-actions"><div className="ai-image-download-links"><a href={`${aiImageStudioApiUrl}/items/${encodeURIComponent(item.id)}/download?format=png`}>PNG</a><a href={`${aiImageStudioApiUrl}/items/${encodeURIComponent(item.id)}/download?format=jpeg`}>JPEG</a><a href={`${aiImageStudioApiUrl}/items/${encodeURIComponent(item.id)}/download?format=webp`}>WebP</a></div>{batch.purpose === "TECHNICAL_DRAWING" ? item.attachedProduct ? <small>Đã gắn tag Ảnh kỹ thuật cho {item.attachedProduct.sku}</small> : <button type="button" disabled={busy} onClick={() => void attachTechnicalDrawing(item)}>Gắn tag Ảnh kỹ thuật vào {batch.targetProduct?.sku || "sản phẩm"}</button> : item.attachedProduct ? <small>Đã gắn vào bản nháp {item.attachedProduct.sku}</small> : <div className="ai-image-attach"><input value={skuInputs[item.id] || ""} onChange={(event) => setSkuInputs((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="SKU bản nháp" maxLength={64} /><button type="button" disabled={busy} onClick={() => void attach(item)}>Gắn ảnh</button></div>}</div>}
          </div>
        </article>)}
      </div>
    </section>}
  </section>;
}
