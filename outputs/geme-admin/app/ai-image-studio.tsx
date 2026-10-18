"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { apiBaseUrl } from "../lib/api";

type ImagePreset = "STONE_GREY" | "WARM_IVORY" | "SOFT_SAGE";
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
  classification?: { suggestion?: string; labels?: string[]; method?: string } | null;
  qcReport?: { dimensions?: { width?: number; height?: number }; opaqueForegroundPixelsPreserved?: boolean } | null;
  attachedProduct?: { id: string; sku: string; name: string; status: string } | null;
  attachedProductId?: string | null;
};
type ImageBatch = { id: string; name: string; preset: ImagePreset; status: ImageBatchStatus; createdAt: string; items: ImageItem[] };
type ImageStudioStatus = { provider: string; configured: boolean; sandbox: boolean; maxFilesPerBatch: number; maxImageBytes: number; maxBatchBytes: number; presets: ImagePreset[]; privateStorage: string };
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
  return `${apiBaseUrl}/ai-studio/image-studio/items/${encodeURIComponent(item.id)}/preview?variant=${variant}`;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl}/${path.replace(/^\//, "")}`, { ...init, headers, credentials: "include", cache: "no-store" });
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
  const [classificationHint, setClassificationHint] = useState("");
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
    setBusy(true);
    const key = idempotencyKey.current || crypto.randomUUID();
    idempotencyKey.current = key;
    try {
      const created = await request<ImageBatch>("ai-studio/image-studio/batches", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          name: batchName.trim(), preset,
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
      setNotice("Lô ảnh đã được ghi nhận. Ảnh sẽ chờ xử lý và kiểm duyệt riêng từng tấm.");
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
      <div><span className="ai-section-kicker">GEME VISUAL AGENT · IMAGE STUDIO</span><h3>Hậu kỳ hình ảnh sản phẩm</h3><p>Giữ ảnh gốc nguyên vẹn, tách nền thành mask rồi ghép nền GEME có kiểm soát.</p></div>
      <div className="ai-image-provider"><span className={status?.configured ? "is-ready" : "is-offline"} />{status?.configured ? status.sandbox ? "Photoroom Sandbox" : "Photoroom đã kết nối" : "Chưa cấu hình Photoroom"}</div>
    </header>

    {error && <div className="ai-studio-alert ai-studio-alert-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="ai-studio-alert ai-studio-alert-success" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice("")}>Đóng</button></div>}

    <div className="ai-image-layout">
      <section className="ai-image-upload-panel">
        <div className="ai-section-heading"><div><span className="ai-section-kicker">NEW BATCH</span><h3>Tạo lô ảnh</h3><p>Chọn nhiều ảnh hoặc cả thư mục. Mỗi ảnh được kiểm duyệt riêng.</p></div><span className="ai-image-panel-mark">✦</span></div>
        <div className={`ai-image-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <span className="ai-image-upload-icon">↑</span><strong>Kéo ảnh vào đây</strong><small>JPEG, PNG, WebP · tối đa 8 MB/ảnh · 50 ảnh/lô</small>
          <div><button type="button" onClick={() => fileInput.current?.click()}>Chọn ảnh</button><button type="button" className="is-secondary" onClick={() => folderInput.current?.click()}>Chọn thư mục</button></div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onFileChange} />
          <input ref={folderInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={onFileChange} />
        </div>
        {files.length > 0 && <div className="ai-image-local-list"><div className="ai-image-list-head"><strong>{files.length} ảnh được chọn</strong><button type="button" onClick={() => setFiles([])}>Bỏ tất cả</button></div>{files.map((entry) => <div className="ai-image-local-row" key={entry.key}><span className={`ai-upload-dot state-${entry.state.toLowerCase()}`} /><div><strong>{entry.name}</strong><small>{entry.relativePath ? `${entry.relativePath} · ` : ""}{bytesLabel(entry.file.size)}{entry.error ? ` · ${entry.error}` : ""}</small></div>{entry.state === "FAILED" && batch && <button type="button" onClick={() => void retryUpload(entry)}>Tải lại</button>}<button type="button" aria-label={`Bỏ ${entry.name}`} onClick={() => setFiles((rows) => rows.filter((row) => row.key !== entry.key))}>×</button></div>)}</div>}
        <div className="ai-image-form-grid">
          <label><span>Tên lô</span><input maxLength={120} value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="Ví dụ: Nhẫn Emerald · đợt 1" /></label>
          <label><span>Preset nền</span><select value={preset} onChange={(event) => setPreset(event.target.value as ImagePreset)}>{Object.entries(presetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="wide"><span>Gợi ý nhóm ảnh <small>Tùy chọn; giúp gắn cờ review, không thay phân loại bằng model thị giác</small></span><select value={classificationHint} onChange={(event) => setClassificationHint(event.target.value)}>{classificationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="ai-image-safeguard"><span>◇</span><p>Photoroom chỉ cung cấp alpha mask. GEME bỏ pixel màu của ảnh trả về, giữ RGB gốc ở vùng vật thể và không dùng generative fill. Mask khó, đá trong, Opal, kim loại bóng và chi tiết nhỏ sẽ được gắn cờ duyệt.</p></div>
        {!status?.configured && <div className="ai-image-config-note">Cần cấu hình <code>PHOTOROOM_API_KEY</code> ở AI Core trước khi tạo lô. Khi chưa có key, ảnh chưa được tải lên hoặc lưu.</div>}
        <button className="ai-submit-button" type="button" onClick={() => void createBatch()} disabled={busy || !files.length || !status?.configured}><span>{busy ? "Đang tải ảnh vào hàng đợi…" : status?.configured ? "Tạo lô và xử lý ảnh" : "Cần kết nối Photoroom"}</span><b>→</b></button>
      </section>

      <aside className="ai-image-history-panel">
        <div className="ai-section-heading"><div><span className="ai-section-kicker">BATCH HISTORY</span><h3>Lô xử lý gần đây</h3><p>Ảnh gốc và kết quả luôn được lưu tách biệt.</p></div><button className="ai-image-refresh" type="button" onClick={() => void refresh()} aria-label="Tải lại danh sách">↻</button></div>
        {batches.length ? <div className="ai-image-batch-list">{batches.map((row) => <button className={`ai-image-batch-row ${batch?.id === row.id ? "is-active" : ""}`} type="button" key={row.id} onClick={() => { setSelected([]); void refresh(row.id); }}><span className="ai-image-batch-gem">◇</span><span><strong>{row.name}</strong><small>{row.items.length} ảnh · {presetLabels[row.preset]}</small></span><em className={`batch-${row.status.toLowerCase()}`}>{batchLabels[row.status]}</em></button>)}</div> : <div className="ai-image-empty">Chưa có lô xử lý. Hãy tải ảnh để bắt đầu.</div>}
        <div className="ai-image-storage-note"><span>▣</span><p>Kho ảnh riêng: {status?.privateStorage === "r2-private" ? "Cloudflare R2 private" : "PostgreSQL media store"}. Ảnh chưa duyệt không được công khai.</p></div>
      </aside>
    </div>

    {batch && <section className="ai-image-review-panel">
      <div className="ai-image-review-head"><div><span className="ai-section-kicker">IMAGE REVIEW</span><h3>{batch.name}</h3><p>{batch.items.length} ảnh · {presetLabels[batch.preset]} · {batchLabels[batch.status]}</p></div><div className="ai-image-batch-actions">{batch.items.length > 0 && <><span className="ai-image-progress-label">{progressCount}/{batch.items.length} · {progressPercent}%</span><button type="button" className="ai-image-batch-select" onClick={() => setSelected(selected.length === batch.items.length ? [] : batch.items.map((item) => item.id))}>{selected.length === batch.items.length ? "Bỏ chọn" : `Chọn tất cả · ${selected.length} đã chọn`}</button></>}{active && <button type="button" className="is-danger" onClick={() => void cancelBatch()} disabled={busy}>Dừng lô</button>}{approvedCount > 0 && <a className="ai-image-export" href={`${apiBaseUrl}/ai-studio/image-studio/batches/${encodeURIComponent(batch.id)}/export.zip`}>Tải ZIP đã duyệt ({approvedCount})</a>}</div></div>
      {batch.items.length > 0 && <div className="ai-image-progress"><span style={{ width: `${progressPercent}%` }} /></div>}
      <div className="ai-image-grid">
        {batch.items.map((item) => <article className={`ai-image-card item-${item.status.toLowerCase()}`} key={item.id}>
          <div className="ai-image-card-head"><label><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} /><span className="ai-image-select-box">✓</span></label><span className={`ai-status ai-status-${item.status.toLowerCase()}`}><i />{statusLabels[item.status]}</span></div>
          <BeforeAfter item={item} />
          <div className="ai-image-card-body"><strong title={item.originalFilename}>{item.originalFilename}</strong>{item.relativePath && <small className="ai-image-folder-path">{item.relativePath}</small>}
            <div className={`ai-image-qc qc-${item.qcStatus.toLowerCase()}`}><i />QC: {item.qcStatus === "PASS" ? "Đạt kiểm tra tự động" : item.qcStatus === "REVIEW" ? "Cần người kiểm tra" : item.qcStatus === "FAIL" ? "Không đạt" : "Đang chờ"}</div>
            {item.qcFlags.length > 0 && <small className="ai-image-flags">{item.qcFlags.map((flag) => flag.replaceAll("_", " ")).join(" · ")}</small>}
            {item.errorCode && <small className="ai-image-flags">Lỗi xử lý: {item.errorCode.replaceAll("_", " ")}</small>}
            {item.classification?.suggestion && <small className="ai-image-classification">Gợi ý: {item.classification.suggestion} · {item.classification.method === "filename_and_admin_hint" ? "metadata/tên tệp" : "AI"}</small>}
            {item.qcReport?.dimensions && <small className="ai-image-dimensions">{item.qcReport.dimensions.width} × {item.qcReport.dimensions.height}px · {item.qcReport.opaqueForegroundPixelsPreserved ? "pixel vùng đặc giữ nguyên" : "cần xem lại pixel"}</small>}
            {item.status === "AWAITING_APPROVAL" && <div className="ai-image-action-row"><button type="button" className="is-approve" disabled={busy} onClick={() => void itemAction(item, "approve")}>Duyệt</button><button type="button" className="is-reject" disabled={busy} onClick={() => void itemAction(item, "reject")}>Từ chối</button></div>}
            {item.status === "FAILED" && <button className="ai-image-retry" type="button" disabled={busy} onClick={() => void itemAction(item, "retry")}>↻ Thử lại</button>}
            {item.status === "APPROVED" && <div className="ai-image-approved-actions"><div className="ai-image-download-links"><a href={`${apiBaseUrl}/ai-studio/image-studio/items/${encodeURIComponent(item.id)}/download?format=png`}>PNG</a><a href={`${apiBaseUrl}/ai-studio/image-studio/items/${encodeURIComponent(item.id)}/download?format=jpeg`}>JPEG</a><a href={`${apiBaseUrl}/ai-studio/image-studio/items/${encodeURIComponent(item.id)}/download?format=webp`}>WebP</a></div>{item.attachedProduct ? <small>Đã gắn vào bản nháp {item.attachedProduct.sku}</small> : <div className="ai-image-attach"><input value={skuInputs[item.id] || ""} onChange={(event) => setSkuInputs((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="SKU bản nháp" maxLength={64} /><button type="button" disabled={busy} onClick={() => void attach(item)}>Gắn ảnh</button></div>}</div>}
          </div>
        </article>)}
      </div>
    </section>}
  </section>;
}
