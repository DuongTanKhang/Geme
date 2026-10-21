"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Platform = "FACEBOOK_PAGE" | "INSTAGRAM";
type Account = { id: string; platform: Platform; remoteAccountId: string; displayName: string; username?: string | null; selected: boolean; connectionId: string; connectionName: string; connectionStatus: string; scopes?: string[]; missingScopes?: string[] };
type Product = { id: string; sku: string; name: string; slug: string; category: string | null; gemstone: string | null; material: string | null; images: Array<{ id: string; filename: string; alt?: string | null; mimeType: string; size: number; url: string }> };
type MarketingDraft = { id: string; status: string; channel: string; objective: string; title: string; caption: string; body: string; callToAction: string; hashtags: string[]; sourceProductIds: string[]; factWarnings: string[] };
type DraftTarget = { accountId: string; platform: Platform; caption: string; linkUrl: string; mediaAssetId: string };
type PostTarget = DraftTarget & { id?: string; status?: string; scheduledAt?: string | null; publishedAt?: string | null; previewUrl?: string | null; permalink?: string | null; lastErrorCode?: string | null; account?: { displayName?: string; active?: boolean } | null; attempts?: Array<{ status: string; errorCode?: string | null; startedAt: string }> };
type SocialPost = { id: string; title: string; status: string; revision: number; approvedRevision?: number | null; approvedAt?: string | null; lastErrorCode?: string | null; createdAt: string; sourceProductId?: string | null; sourceMarketingDraftId?: string | null; sourceProduct?: { id: string; sku: string; name: string; slug: string } | null; targets: PostTarget[] };
type Status = { configured: boolean; metaConfigured: boolean; encryptionConfigured: boolean; permissionsRequired: string[]; accounts: Account[]; metrics: Record<string, number> };
type Composer = { id?: string; title: string; sourceProductId: string; sourceMarketingDraftId: string; targets: DraftTarget[]; scheduleLocal: string };

const API = "/api/admin/social";
const platformName = (platform: Platform) => platform === "FACEBOOK_PAGE" ? "Facebook Page" : "Instagram Professional";
const statusName: Record<string, string> = { DRAFT: "Bản nháp", APPROVED: "Đã duyệt", SCHEDULED: "Đã lên lịch", PUBLISHING: "Đang đăng", PUBLISHED: "Đã đăng", PARTIAL: "Đăng một phần", FAILED: "Thất bại", UNKNOWN: "Cần đối soát", CANCELLED: "Đã hủy" };
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const imageAllowed = (platform: Platform, image: Product["images"][number]) => platform === "INSTAGRAM" ? image.mimeType === "image/jpeg" && image.size <= 8 * 1024 * 1024 : ["image/jpeg", "image/png"].includes(image.mimeType);

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, { method, credentials: "include", cache: "no-store", headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(data.message || `Yêu cầu thất bại (${response.status}).`);
  return data as T;
}

function blankComposer(accounts: Account[]): Composer {
  const selected = accounts.filter((account) => account.selected);
  const targets = selected.slice(0, 2).map((account) => ({ accountId: account.id, platform: account.platform, caption: "", linkUrl: "", mediaAssetId: "" }));
  if (!targets.length) targets.push({ accountId: "", platform: "FACEBOOK_PAGE", caption: "", linkUrl: "", mediaAssetId: "" });
  return { title: "", sourceProductId: "", sourceMarketingDraftId: "", targets, scheduleLocal: "" };
}

export default function SocialWorkspace() {
  const [tab, setTab] = useState<"overview" | "content" | "calendar" | "accounts">("overview");
  const [status, setStatus] = useState<Status | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [marketingDrafts, setMarketingDrafts] = useState<MarketingDraft[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [search, setSearch] = useState("");
  const [postFilter, setPostFilter] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selecting, setSelecting] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextStatus, nextPosts, drafts] = await Promise.all([
        request<Status>("/status"),
        request<SocialPost[]>(`/posts${postFilter ? `?status=${encodeURIComponent(postFilter)}` : ""}`),
        request<MarketingDraft[]>("/marketing-drafts"),
      ]);
      setStatus(nextStatus);
      setPosts(nextPosts);
      setMarketingDrafts(drafts);
      setSelecting(nextStatus.accounts.filter((account) => account.selected).map((account) => account.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được dữ liệu mạng xã hội."); }
    finally { setLoading(false); }
  }, [postFilter]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("socialMeta");
    if (outcome !== "success" && outcome !== "error") return;
    setNotice(outcome === "success" ? "Đã kết nối tài khoản Meta. Chọn Page/Instagram muốn sử dụng trong mục Tài khoản." : "Meta chưa kết nối được. Kiểm tra quyền App, Redirect URI và log API rồi thử lại.");
    const url = new URL(window.location.href);
    url.searchParams.delete("socialMeta");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    if (tab !== "content" && tab !== "calendar") return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [tab, refresh]);
  useEffect(() => {
    if (!productSearch.trim()) return;
    const timer = window.setTimeout(() => void request<Product[]>(`/products?search=${encodeURIComponent(productSearch)}`).then(setProducts).catch((caught) => setError(caught instanceof Error ? caught.message : "Không tải được sản phẩm.")), 250);
    return () => window.clearTimeout(timer);
  }, [productSearch]);

  const selectedAccounts = useMemo(() => status?.accounts.filter((account) => account.selected) || [], [status]);
  const visiblePosts = useMemo(() => posts.filter((post) => !search || `${post.title} ${post.targets.map((target) => `${target.caption} ${target.account?.displayName || ""}`).join(" ")}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))), [posts, search]);

  function toast(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 4200); }
  async function startConnect() {
    setBusy(true); setError("");
    try { const result = await request<{ authorizationUrl: string }>("/meta/authorize", "POST", {}); window.location.assign(result.authorizationUrl); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không bắt đầu được Meta OAuth."); setBusy(false); }
  }

  function openNew() {
    setComposer(blankComposer(status?.accounts || []));
    setProductSearch("");
    void request<Product[]>("/products").then(setProducts).catch((caught) => setError(caught instanceof Error ? caught.message : "Không tải được danh sách sản phẩm."));
    setTab("content");
  }

  function editPost(post: SocialPost) {
    if (!["DRAFT", "FAILED"].includes(post.status)) return;
    setComposer({ id: post.id, title: post.title, sourceProductId: post.sourceProductId || "", sourceMarketingDraftId: post.sourceMarketingDraftId || "", scheduleLocal: "", targets: post.targets.map((target) => ({ accountId: target.accountId || "", platform: target.platform, caption: target.caption, linkUrl: target.linkUrl || "", mediaAssetId: target.mediaAssetId || "" })) });
    void request<Product[]>(post.sourceProduct?.sku ? `/products?search=${encodeURIComponent(post.sourceProduct.sku)}` : "/products").then(setProducts).catch(() => undefined);
    setTab("content");
  }

  function patchTarget(index: number, patch: Partial<DraftTarget>) {
    setComposer((current) => current ? { ...current, targets: current.targets.map((target, targetIndex) => targetIndex === index ? { ...target, ...patch } : target) } : current);
  }

  function addChannel(platform: Platform) {
    setComposer((current) => current && current.targets.length < 2 ? { ...current, targets: [...current.targets, { accountId: "", platform, caption: "", linkUrl: "", mediaAssetId: "" }] } : current);
  }

  function chooseProduct(productId: string) {
    const product = products.find((row) => row.id === productId);
    setComposer((current) => current ? { ...current, sourceProductId: productId, targets: current.targets.map((target) => { const compatible = product?.images.filter((image) => imageAllowed(target.platform, image)) || []; const currentImage = compatible.find((image) => image.id === target.mediaAssetId); return { ...target, linkUrl: product && target.platform === "FACEBOOK_PAGE" && !target.linkUrl ? `https://geme.vn/san-pham/${encodeURIComponent(product.slug)}` : target.linkUrl, mediaAssetId: currentImage?.id || compatible[0]?.id || "" }; }) } : current);
  }

  function useMarketingDraft(id: string) {
    const draft = marketingDrafts.find((row) => row.id === id);
    if (!draft) return;
    const text = [draft.caption || draft.body, draft.callToAction, draft.hashtags.map((tag) => `#${tag}`).join(" ")].filter(Boolean).join("\n\n");
    setComposer((current) => current ? { ...current, sourceMarketingDraftId: id, title: draft.title || current.title, sourceProductId: current.sourceProductId || draft.sourceProductIds[0] || "", targets: current.targets.map((target) => ({ ...target, caption: text.slice(0, 2200) })) } : current);
  }

  async function saveDraft(): Promise<SocialPost | null> {
    if (!composer) return null;
    if (!composer.targets.length) { setError("Thêm ít nhất một kênh nội dung."); return null; }
    setBusy(true); setError("");
    try {
      const payload = { title: composer.title, sourceProductId: composer.sourceProductId || null, sourceMarketingDraftId: composer.sourceMarketingDraftId || null, targets: composer.targets.map((target) => ({ ...target, accountId: target.accountId || null, linkUrl: target.linkUrl || null, mediaAssetId: target.mediaAssetId || null })) };
      const post = await request<SocialPost>(composer.id ? `/posts/${composer.id}` : "/posts", composer.id ? "PATCH" : "POST", payload);
      setComposer((current) => current ? { ...current, id: post.id } : current);
      await refresh();
      toast("Đã lưu bản nháp mạng xã hội.");
      return post;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không lưu được bản nháp."); return null; }
    finally { setBusy(false); }
  }

  async function approve(schedule = false) {
    if (!composer) return;
    let post = composer.id ? null : await saveDraft();
    if (composer.id) post = await saveDraft();
    if (!post) return;
    let scheduledAt: string | null = null;
    if (schedule) {
      if (!composer.scheduleLocal) { setError("Chọn thời gian lên lịch theo giờ Việt Nam."); return; }
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(composer.scheduleLocal)) { setError("Thời gian lên lịch không hợp lệ."); return; }
      const localDate = new Date(`${composer.scheduleLocal}:00+07:00`);
      if (!Number.isFinite(localDate.getTime())) { setError("Thời gian lên lịch không hợp lệ."); return; }
      scheduledAt = localDate.toISOString();
    }
    setBusy(true); setError("");
    try {
      await request(`/posts/${post.id}/approve`, "POST", { scheduledAt });
      setComposer(null);
      await refresh();
      setTab("content");
      toast(schedule ? "Đã duyệt và lên lịch đăng." : "Đã duyệt nội dung. Bấm Đăng ngay khi sẵn sàng.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không duyệt được nội dung."); }
    finally { setBusy(false); }
  }

  async function action(path: string, message: string) {
    setBusy(true); setError("");
    try { await request(path, "POST", {}); await refresh(); toast(message); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Thao tác chưa hoàn tất."); }
    finally { setBusy(false); }
  }

  async function saveSelection() {
    setBusy(true); setError("");
    try { await request("/accounts/selection", "PATCH", { accountIds: selecting }); await refresh(); toast("Đã lưu các tài khoản đích được chọn."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không lưu được tài khoản."); }
    finally { setBusy(false); }
  }

  async function disconnect(connectionId: string) {
    if (!window.confirm("Ngắt kết nối Meta này? Bản nháp và lịch sử sẽ được giữ lại.")) return;
    setBusy(true); setError("");
    try { await request(`/connections/${connectionId}/disconnect`, "POST", {}); await refresh(); toast("Đã ngắt kết nối Meta."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không ngắt được Meta."); }
    finally { setBusy(false); }
  }

  function productForComposer() { return products.find((product) => product.id === composer?.sourceProductId); }

  return <section className="social-workspace" aria-label="Mạng xã hội GEME">
    <div className="social-heading">
      <div><span className="social-eyebrow">GEME · CONTENT & PUBLISHING</span><h1>Mạng xã hội</h1><p>Chuẩn bị, duyệt và theo dõi nội dung Facebook Page cùng Instagram Professional.</p></div>
      <div className="social-heading-actions"><button className="social-button social-button-light" onClick={() => void refresh()} disabled={loading || busy}>Làm mới</button><button className="social-button social-button-primary" onClick={openNew} disabled={busy}>+ Soạn nội dung</button></div>
    </div>

    <nav className="social-tabs" aria-label="Khu vực mạng xã hội">
      {([["overview", "Tổng quan"], ["content", "Nội dung"], ["calendar", "Lịch đăng"], ["accounts", "Tài khoản"]] as const).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setComposer(null); setTab(key); }}>{label}</button>)}
    </nav>
    {error && <div className="social-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="social-success" role="status">{notice}<button onClick={() => setNotice("")}>Đóng</button></div>}
    {loading && !status ? <div className="social-empty">Đang tải dữ liệu mạng xã hội…</div> : null}

    {tab === "overview" && status && <>
      <div className="social-kpis">
        {[["Bản nháp", status.metrics.drafts || 0], ["Lịch đăng", status.metrics.scheduled || 0], ["Đã đăng", status.metrics.published || 0], ["Cần kiểm tra", (status.metrics.failed || 0) + (status.metrics.unknown || 0)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>Trạng thái từ hệ thống đăng bài</small></article>)}
      </div>
      <div className="social-overview-grid">
        <article className="social-panel social-connect-card"><span className="social-eyebrow">META BUSINESS</span><h2>{status.configured ? "Kết nối Meta" : "Hoàn tất cấu hình kết nối"}</h2><p>{status.configured ? "Kết nối Facebook Page và Instagram Professional để chọn chính xác nơi đăng." : "Bạn vẫn có thể lưu bản nháp. Để đăng thật, cấu hình Meta App và khóa mã hóa trên server."}</p><button className="social-button social-button-primary" onClick={() => void startConnect()} disabled={!status.configured || busy}>{status.configured ? "Kết nối tài khoản Meta" : "Meta OAuth chưa sẵn sàng"}</button><ul><li>Không cần gửi mật khẩu Facebook cho GEME.</li><li>Chỉ yêu cầu quyền quản lý Page và đăng ảnh/nội dung.</li><li>Không có thao tác quảng cáo, inbox hay bình luận.</li></ul></article>
        <article className="social-panel"><div className="social-panel-title"><div><span className="social-eyebrow">PUBLISHING STATUS</span><h2>Kênh đã chọn</h2></div><button className="social-text-button" onClick={() => setTab("accounts")}>Quản lý tài khoản →</button></div>
          {selectedAccounts.length ? <div className="social-account-list">{selectedAccounts.map((account) => <div key={account.id}><span className={`social-platform-mark ${account.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{account.platform === "INSTAGRAM" ? "IG" : "f"}</span><span><strong>{account.displayName}</strong><small>{platformName(account.platform)} · {account.connectionName}</small></span><b className="social-dot" title="Đã chọn"/></div>)}</div> : <div className="social-empty compact">Chưa chọn tài khoản đích. Bản nháp vẫn có thể được soạn và lưu.</div>}
        </article>
      </div>
      <article className="social-panel social-recent"><div className="social-panel-title"><div><span className="social-eyebrow">LATEST ACTIVITY</span><h2>Nội dung gần đây</h2></div><button className="social-text-button" onClick={() => setTab("content")}>Xem tất cả →</button></div><PostList posts={posts.slice(0, 5)} onEdit={editPost} onAction={action} busy={busy}/></article>
    </>}

    {tab === "accounts" && status && <div className="social-panel social-accounts-panel"><div className="social-panel-title"><div><span className="social-eyebrow">CONNECTED DESTINATIONS</span><h2>Tài khoản mạng xã hội</h2><p>Tick tài khoản được phép xuất hiện trong composer. Không tự chọn Page đầu tiên.</p></div><button className="social-button social-button-primary" onClick={() => void startConnect()} disabled={!status.configured || busy}>+ Kết nối Meta</button></div>
      {!status.accounts.length ? <div className="social-empty">Chưa có tài khoản. Cấu hình Meta OAuth rồi kết nối Page/Instagram Professional.</div> : <div className="social-account-grid">{status.accounts.map((account) => <label className="social-account-card" key={account.id}><input type="checkbox" checked={selecting.includes(account.id)} onChange={(event) => setSelecting((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))}/><span className={`social-platform-mark ${account.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{account.platform === "INSTAGRAM" ? "IG" : "f"}</span><span className="social-account-copy"><strong>{account.displayName}</strong><small>{platformName(account.platform)}{account.username ? ` · @${account.username}` : ""}</small><small>{account.connectionName} · {account.connectionStatus === "ACTIVE" ? "Đang kết nối" : "Cần kết nối lại"}</small></span><span className="social-account-check">{selecting.includes(account.id) ? "Đã chọn" : "Chưa chọn"}</span><button type="button" className="social-text-button" onClick={(event) => { event.preventDefault(); void disconnect(account.connectionId); }}>Ngắt</button></label>)}</div>}
      {status.accounts.length > 0 && <div className="social-footer-actions"><small>{selecting.length} tài khoản sẽ xuất hiện ở composer.</small><button className="social-button social-button-primary" onClick={() => void saveSelection()} disabled={busy}>Lưu lựa chọn</button></div>}
      <div className="social-permission-note"><strong>Quyền Meta cần dùng</strong><span>{status.permissionsRequired.join(" · ")}</span><small>Chỉ Page và Instagram chuyên nghiệp được Meta cấp quyền mới đăng được. Thu hồi quyền từ cài đặt Business Integrations của Meta hoặc ngắt tại đây.</small></div>
    </div>}

    {tab === "content" && !composer && <section className="social-panel social-content-panel"><div className="social-toolbar"><div><span className="social-eyebrow">CONTENT LIBRARY</span><h2>Quản lý nội dung</h2></div><div className="social-toolbar-controls"><input aria-label="Tìm nội dung" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tiêu đề hoặc nội dung…"/><select aria-label="Lọc trạng thái" value={postFilter} onChange={(event) => setPostFilter(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statusName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div><PostList posts={visiblePosts} onEdit={editPost} onAction={action} busy={busy}/></section>}

    {tab === "calendar" && <section className="social-panel social-calendar"><div className="social-toolbar"><div><span className="social-eyebrow">SCHEDULE · ASIA/HO_CHI_MINH</span><h2>Lịch đăng và kết quả</h2></div><button className="social-button social-button-light" onClick={() => setTab("content")}>Mở thư viện nội dung</button></div><PostList posts={posts.filter((post) => ["SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "UNKNOWN"].includes(post.status)).sort((a, b) => new Date(a.targets[0]?.scheduledAt || a.createdAt).getTime() - new Date(b.targets[0]?.scheduledAt || b.createdAt).getTime())} onEdit={editPost} onAction={action} busy={busy}/></section>}

    {tab === "content" && composer && <section className="social-composer-layout">
      <div className="social-panel social-composer"><div className="social-panel-title"><div><span className="social-eyebrow">CONTENT BRIEF</span><h2>{composer.id ? "Chỉnh sửa bản nháp" : "Soạn nội dung"}</h2><p>Chọn sản phẩm, ảnh đã duyệt và viết nội dung riêng cho từng kênh.</p></div><button className="social-text-button" onClick={() => setComposer(null)}>← Quay lại</button></div>
        <div className="social-form-grid">
          <label className="social-field social-wide"><span>Tiêu đề nội bộ</span><input value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} placeholder="Ví dụ: Bộ sưu tập sắc xanh" maxLength={180}/></label>
          <label className="social-field"><span>Sản phẩm GEME</span><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Tìm theo tên hoặc SKU"/><select value={composer.sourceProductId} onChange={(event) => chooseProduct(event.target.value)}><option value="">Không gắn sản phẩm</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          <label className="social-field"><span>Bản nháp Marketing Agent (tùy chọn)</span><select value={composer.sourceMarketingDraftId} onChange={(event) => useMarketingDraft(event.target.value)}><option value="">Không dùng bản nháp AI</option>{marketingDrafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || draft.objective} · {draft.channel}</option>)}</select><small>AI chỉ hỗ trợ nội dung; bài vẫn cần kiểm tra và duyệt riêng tại đây.</small></label>
          <div className="social-wide social-channel-heading"><span>Nội dung theo kênh</span><div><button onClick={() => addChannel("FACEBOOK_PAGE")} disabled={composer.targets.length >= 2 || composer.targets.some((target) => target.platform === "FACEBOOK_PAGE")}>+ Facebook</button><button onClick={() => addChannel("INSTAGRAM")} disabled={composer.targets.length >= 2 || composer.targets.some((target) => target.platform === "INSTAGRAM")}>+ Instagram</button></div></div>
          {composer.targets.map((target, index) => <article className="social-channel-editor social-wide" key={`${target.platform}-${index}`}>
            <div className="social-channel-editor-heading"><span className={`social-platform-mark ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><strong>{platformName(target.platform)}</strong>{composer.targets.length > 1 && <button className="social-text-button" onClick={() => setComposer({ ...composer, targets: composer.targets.filter((_, itemIndex) => itemIndex !== index) })}>Gỡ kênh</button>}</div>
            <label className="social-field"><span>Tài khoản đích</span><select value={target.accountId} onChange={(event) => patchTarget(index, { accountId: event.target.value })}><option value="">Lưu bản nháp, chọn tài khoản sau</option>{status?.accounts.filter((account) => account.platform === target.platform).map((account) => <option key={account.id} value={account.id}>{account.displayName}{account.selected ? " · đã chọn" : " · chưa chọn trong quản lý tài khoản"}</option>)}</select></label>
            <label className="social-field"><span>Nội dung</span><textarea value={target.caption} onChange={(event) => patchTarget(index, { caption: event.target.value })} rows={5} maxLength={2200} placeholder={target.platform === "INSTAGRAM" ? "Viết caption cho Instagram…" : "Viết nội dung cho Facebook…"}/><small>{target.caption.length}/2200 · Không tự động bổ sung thông tin chưa được GEME xác nhận.</small></label>
            {target.platform === "FACEBOOK_PAGE" && <label className="social-field"><span>Liên kết sản phẩm GEME (không bắt buộc)</span><input value={target.linkUrl} onChange={(event) => patchTarget(index, { linkUrl: event.target.value })} placeholder="https://geme.vn/san-pham/…"/></label>}
            <label className="social-field"><span>Ảnh sản phẩm đã duyệt {target.platform === "INSTAGRAM" ? "· bắt buộc" : "· không bắt buộc"}</span><select value={target.mediaAssetId} onChange={(event) => patchTarget(index, { mediaAssetId: event.target.value })}><option value="">Không đính kèm ảnh</option>{productForComposer()?.images.filter((image) => imageAllowed(target.platform, image)).map((image) => <option key={image.id} value={image.id}>{image.alt || image.filename}</option>)}</select><small>{target.platform === "INSTAGRAM" ? "Instagram cần JPEG công khai, tối đa 8 MB; chỉ ảnh đã duyệt/QC đạt." : "Ảnh đã duyệt, QC đạt và có CDN R2 công khai mới được gửi cho Meta."}</small></label>
            {target.mediaAssetId && productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url && <img className="social-image-preview" src={productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url} alt="Ảnh sản phẩm đã chọn"/>}
          </article>)}
          {composer.sourceMarketingDraftId && marketingDrafts.find((draft) => draft.id === composer.sourceMarketingDraftId)?.factWarnings?.length ? <div className="social-warning social-wide"><strong>Thông tin cần rà soát từ Marketing Agent</strong><p>{marketingDrafts.find((draft) => draft.id === composer.sourceMarketingDraftId)?.factWarnings?.join(" · ")}</p></div> : null}
        </div>
        <div className="social-composer-actions"><button className="social-button social-button-light" onClick={() => void saveDraft()} disabled={busy}>Lưu bản nháp</button><button className="social-button social-button-light" onClick={() => void approve(false)} disabled={busy || !composer.targets.some((target) => target.accountId)}>Duyệt nội dung</button><label className="social-schedule-field"><span>Lên lịch giờ Việt Nam</span><input type="datetime-local" value={composer.scheduleLocal} onChange={(event) => setComposer({ ...composer, scheduleLocal: event.target.value })}/></label><button className="social-button social-button-primary" onClick={() => void approve(true)} disabled={busy || !composer.targets.some((target) => target.accountId)}>Duyệt & lên lịch</button></div>
        <p className="social-footnote">Đăng ngay chỉ bật sau khi nội dung đã được duyệt. Mọi chỉnh sửa sau duyệt sẽ tạo revision mới và cần duyệt lại.</p>
      </div>
      <aside className="social-panel social-preview"><span className="social-eyebrow">LIVE PREVIEW · BẢN XEM TRƯỚC</span><h2>Xem trước bài đăng</h2>{composer.targets.map((target, index) => <article className="social-preview-card" key={`${target.platform}-${index}`}><header><span className={`social-platform-mark ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><span><strong>{target.accountId ? status?.accounts.find((account) => account.id === target.accountId)?.displayName || platformName(target.platform) : platformName(target.platform)}</strong><small>Bản xem trước trong Admin · chưa đăng</small></span></header>{target.mediaAssetId && productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url && <img src={productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url} alt="Ảnh xem trước"/>}<p>{target.caption || "Nội dung của bạn sẽ hiển thị ở đây."}</p>{target.linkUrl && <small>{target.linkUrl}</small>}</article>)}{!composer.targets.length && <p>Thêm một kênh để xem trước.</p>}</aside>
    </section>}

    {tab === "content" && !composer && <div className="social-after-list"><button className="social-button social-button-primary" onClick={openNew}>+ Soạn nội dung mới</button></div>}
    {busy && <div className="social-busy" role="status">Đang lưu thay đổi…</div>}
  </section>;
}

function PostList({ posts, onEdit, onAction, busy }: { posts: SocialPost[]; onEdit: (post: SocialPost) => void; onAction: (path: string, message: string) => void; busy: boolean }) {
  if (!posts.length) return <div className="social-empty">Chưa có nội dung trong mục này. Bắt đầu bằng cách soạn bản nháp thủ công hoặc dùng Marketing Agent.</div>;
  return <div className="social-post-list">{posts.map((post) => <article className="social-post-row" key={post.id}>
    <div className="social-post-main"><div className="social-post-title"><h3>{post.title}</h3><span className={`social-status status-${post.status.toLowerCase()}`}>{statusName[post.status] || post.status}</span></div><div className="social-post-meta"><span>Revision {post.revision}</span><span>{post.targets.map((target) => platformName(target.platform)).join(" + ")}</span><span>Cập nhật {formatDate(post.createdAt)}</span>{post.approvedAt && <span>Duyệt {formatDate(post.approvedAt)}</span>}</div>{post.targets.map((target) => <div className="social-result-row" key={target.id || target.accountId + target.platform}><span className={`social-platform-mark small ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><span className="social-result-caption">{target.caption || "Chưa có nội dung"}</span><span className={`social-status status-${(target.status || post.status).toLowerCase()}`}>{statusName[target.status || post.status] || target.status || post.status}</span>{target.permalink && <a href={target.permalink} target="_blank" rel="noreferrer">Mở bài ↗</a>}{target.lastErrorCode && <small className="social-error-code">{target.lastErrorCode}</small>}</div>)}</div>
    <div className="social-post-actions">{["DRAFT", "FAILED"].includes(post.status) && <button className="social-text-button" onClick={() => onEdit(post)}>Chỉnh sửa</button>}{post.status === "APPROVED" && <button className="social-button social-button-primary" disabled={busy} onClick={() => onAction(`/posts/${post.id}/publish-now`, "Đã đưa vào hàng đợi đăng bài.")}>Đăng ngay</button>}{post.status === "PARTIAL" && <button className="social-text-button" disabled={busy} onClick={() => onAction(`/posts/${post.id}/retry-failed`, "Đang thử lại những kênh chưa đăng được.")}>Thử lại kênh lỗi</button>}{post.status === "SCHEDULED" && <button className="social-text-button" disabled={busy} onClick={() => onAction(`/posts/${post.id}/reschedule`, "Đã hủy duyệt cũ. Sửa bản nháp và duyệt lại lịch mới.")}>Đổi lịch</button>}{["SCHEDULED", "APPROVED"].includes(post.status) && <button className="social-text-button danger" disabled={busy} onClick={() => onAction(`/posts/${post.id}/cancel`, "Đã hủy lịch/nội dung chưa đăng.")}>Hủy</button>}</div>
  </article>)}</div>;
}
