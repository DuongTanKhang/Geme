"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCollectionState, mergeSocialPage, socialPostStatusSummary, socialProductLinkWarning, socialUpdatedAtLabel, updateSocialProductLink } from "../lib/social-ui-state.mjs";

type Platform = "FACEBOOK_PAGE" | "INSTAGRAM";
type Account = { id: string; platform: Platform; remoteAccountId: string; displayName: string; username?: string | null; selected: boolean; connectionId: string; connectionName: string; connectionStatus: string; scopes?: string[]; missingScopes?: string[] };
type Product = { id: string; sku: string; name: string; slug: string; productUrl: string; price: number; currentSalePrice: number; hasVariants: boolean; variants: Array<{ id: string; sku: string | null; label: string; price: number; currentSalePrice: number; stock: number }>; category: string | null; gemstone: string | null; material: string | null; images: Array<{ id: string; filename: string; alt?: string | null; mimeType: string; size: number; url: string }> };
type MarketingDraft = { id: string; status: string; channel: string; objective: string; title: string; caption: string; body: string; callToAction: string; hashtags: string[]; sourceProductIds: string[]; factWarnings: string[] };
type DraftTarget = { accountId: string; platform: Platform; caption: string; linkUrl: string; linkSource: "NONE" | "PRODUCT" | "MANUAL"; mediaAssetId: string };
type PostTarget = DraftTarget & { id?: string; status?: string; scheduledAt?: string | null; publishedAt?: string | null; previewUrl?: string | null; permalink?: string | null; remoteContainerId?: string | null; remoteMediaId?: string | null; lastErrorCode?: string | null; account?: { displayName?: string; active?: boolean } | null; attempts?: Array<{ id?: string; status: string; errorCode?: string | null; startedAt: string; finishedAt?: string | null; remoteContainerId?: string | null; remoteMediaId?: string | null }>; reconciliations?: Array<{ decision: string; source: string; resultCode?: string | null; notes?: string | null; evidenceReference?: string | null; publishedAtReported?: string | null; createdAt: string; admin?: { displayName: string; email: string } }> };
type SocialPost = { id: string; title: string; status: string; revision: number; approvedRevision?: number | null; approvedAt?: string | null; updatedAt: string; lastErrorCode?: string | null; createdAt: string; sourceProductId?: string | null; sourceProductVariantId?: string | null; sourceMarketingDraftId?: string | null; sourceProduct?: { id: string; sku: string; name: string; slug: string } | null; approvedCommerceSnapshot?: { productSku: string; variantSku: string | null; currency: string; listedUnitPrice: number; saleUnitPrice: number; promotionValue: number } | null; commerceCurrent?: { productSku: string; variantSku: string | null; currency: string; listedUnitPrice: number; saleUnitPrice: number; promotionValue: number } | null; commerceChanged?: boolean; targets: PostTarget[] };
type PostPage = { items: SocialPost[]; nextCursor: string | null; hasMore: boolean };
type Status = { configured: boolean; metaConfigured: boolean; encryptionConfigured: boolean; permissionsRequired: string[]; accounts: Account[]; metrics: Partial<Record<"drafts" | "scheduled" | "published" | "partial" | "failed" | "unknown", number>> };
type Composer = { id?: string; title: string; sourceProductId: string; sourceProductVariantId: string; sourceMarketingDraftId: string; targets: DraftTarget[]; scheduleLocal: string; commerceReviewed: boolean };
type ResourceState = "loading" | "ready" | "error";

const API = "/api/admin/social";
const platformName = (platform: Platform) => platform === "FACEBOOK_PAGE" ? "Facebook Page" : "Instagram Professional";
const statusName: Record<string, string> = { DRAFT: "Bản nháp", APPROVED: "Đã duyệt", SCHEDULED: "Đã lên lịch", PUBLISHING: "Đang đăng", PUBLISHED: "Đã đăng", PARTIAL: "Đăng một phần", FAILED: "Thất bại", UNKNOWN: "Cần đối soát", CANCELLED: "Đã hủy" };
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }) : "—";
const imageAllowed = (platform: Platform, image: Product["images"][number]) => platform === "INSTAGRAM" ? image.mimeType === "image/jpeg" && image.size <= 8 * 1024 * 1024 : ["image/jpeg", "image/png"].includes(image.mimeType);

class SocialApiError extends Error {
  constructor(message: string, readonly detail: string) { super(message); }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { method, credentials: "include", cache: "no-store", headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new SocialApiError("Không kết nối được API GEME. Kiểm tra dịch vụ rồi thử lại.", `${method} ${path}: không kết nối được proxy.`);
  }
  const raw = await response.text().catch(() => "");
  let data: { message?: unknown } = {};
  try { data = raw ? JSON.parse(raw) as typeof data : {}; } catch { /* Keep raw server text out of the main UI. */ }
  if (!response.ok) {
    const message = typeof data.message === "string" && !/Cannot (GET|POST|PATCH|PUT|DELETE)|Internal Server Error/i.test(data.message) ? data.message : null;
    const friendly = response.status === 401 ? "Phiên đăng nhập quản trị đã hết hạn. Đăng nhập lại rồi thử lại."
      : response.status === 403 ? "Yêu cầu bị từ chối. Tải lại trang và kiểm tra quyền quản trị."
        : response.status === 404 ? "API Mạng xã hội chưa sẵn sàng. Hãy khởi động lại API GEME sau khi cập nhật."
          : response.status >= 500 ? "Máy chủ GEME đang gặp lỗi. Vui lòng thử lại sau."
            : message || "Yêu cầu chưa hoàn tất. Kiểm tra thông tin rồi thử lại.";
    throw new SocialApiError(friendly, `${method} ${path} · HTTP ${response.status}`);
  }
  if (!raw) return {} as T;
  try { return JSON.parse(raw) as T; }
  catch { throw new SocialApiError("API trả về dữ liệu không hợp lệ. Thử làm mới trang.", `${method} ${path} · phản hồi không phải JSON`); }
}

function blankComposer(accounts: Account[]): Composer {
  const selected = accounts.filter((account) => account.selected);
  const targets = selected.slice(0, 2).map((account) => ({ accountId: account.id, platform: account.platform, caption: "", linkUrl: "", linkSource: "NONE" as const, mediaAssetId: "" }));
  if (!targets.length) targets.push({ accountId: "", platform: "FACEBOOK_PAGE", caption: "", linkUrl: "", linkSource: "NONE", mediaAssetId: "" });
  return { title: "", sourceProductId: "", sourceProductVariantId: "", sourceMarketingDraftId: "", targets, scheduleLocal: "", commerceReviewed: false };
}

export default function SocialWorkspace() {
  const [tab, setTab] = useState<"overview" | "content" | "calendar" | "accounts">("overview");
  const [status, setStatus] = useState<Status | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [recentPosts, setRecentPosts] = useState<SocialPost[]>([]);
  const [calendarPosts, setCalendarPosts] = useState<SocialPost[]>([]);
  const [marketingDrafts, setMarketingDrafts] = useState<MarketingDraft[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [search, setSearch] = useState("");
  const [postFilter, setPostFilter] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7));
  const [calendarFilter, setCalendarFilter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [detailPost, setDetailPost] = useState<SocialPost | null>(null);
  const [manualDecision, setManualDecision] = useState("UNRESOLVED");
  const [manualNotes, setManualNotes] = useState("");
  const [manualEvidence, setManualEvidence] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [loadState, setLoadState] = useState<{ status: ResourceState; posts: ResourceState; drafts: ResourceState }>({ status: "loading", posts: "loading", drafts: "loading" });
  const [loadErrors, setLoadErrors] = useState<{ status: string; posts: string; drafts: string }>({ status: "", posts: "", drafts: "" });
  const [refreshing, setRefreshing] = useState(false);
  const refreshSequence = useRef(0);
  const contentSequence = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const calendarSequence = useRef(0);
  const productSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selecting, setSelecting] = useState<string[]>([]);

  const loadContent = useCallback(async (append = false) => {
    const sequence = append ? contentSequence.current : ++contentSequence.current;
    if (!append) { cursorRef.current = null; setPosts([]); setHasMore(false); setContentLoading(true); setContentError(""); }
    else setContentLoading(true);
    const params = new URLSearchParams({ limit: "25" });
    if (postFilter) params.set("status", postFilter);
    if (search.trim()) params.set("q", search.trim());
    if (append && cursorRef.current) params.set("cursor", cursorRef.current);
    try {
      const page = await request<PostPage>(`/posts?${params.toString()}`);
      if (sequence !== contentSequence.current) return;
      setPosts((current) => mergeSocialPage(current, page.items, append));
      cursorRef.current = page.nextCursor;
      setHasMore(page.hasMore);
      setContentError("");
    } catch (caught) {
      if (sequence === contentSequence.current) setContentError(caught instanceof Error ? caught.message : "Không tải được danh sách nội dung.");
    } finally { if (sequence === contentSequence.current) setContentLoading(false); }
  }, [postFilter, search]);

  const loadCalendar = useCallback(async () => {
    const sequence = ++calendarSequence.current;
    setCalendarLoading(true); setCalendarError("");
    const [year, month] = calendarMonth.split("-").map(Number);
    if (!year || !month || month > 12) { setCalendarError("Chọn tháng hợp lệ để tải lịch."); setCalendarLoading(false); return; }
    const from = new Date(Date.UTC(year, month - 1, 1, -7)).toISOString();
    const to = new Date(Date.UTC(year, month, 1, -7)).toISOString();
    try {
      const params = new URLSearchParams({ from, to });
      if (calendarFilter) params.set("status", calendarFilter);
      const rows = await request<SocialPost[]>(`/posts/calendar?${params.toString()}`);
      if (sequence === calendarSequence.current) setCalendarPosts(rows);
    } catch (caught) {
      if (sequence === calendarSequence.current) setCalendarError(caught instanceof Error ? caught.message : "Không tải được lịch đăng.");
    } finally { if (sequence === calendarSequence.current) setCalendarLoading(false); }
  }, [calendarMonth, calendarFilter]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    const [statusResult, postsResult, draftsResult] = await Promise.allSettled([
      request<Status>("/status"),
      request<PostPage>("/posts?limit=5"),
      request<MarketingDraft[]>("/marketing-drafts"),
    ]);
    if (sequence !== refreshSequence.current) return;
    const messageOf = (result: PromiseRejectedResult) => result.reason instanceof Error ? result.reason.message : "Không tải được dữ liệu. Vui lòng thử lại.";
    if (statusResult.status === "fulfilled") {
      setStatus(statusResult.value);
      setSelecting(statusResult.value.accounts.filter((account) => account.selected).map((account) => account.id));
      setLoadState((current) => ({ ...current, status: "ready" }));
      setLoadErrors((current) => ({ ...current, status: "" }));
    } else {
      setLoadState((current) => ({ ...current, status: "error" }));
      setLoadErrors((current) => ({ ...current, status: messageOf(statusResult) }));
    }
    if (postsResult.status === "fulfilled") {
      setRecentPosts(postsResult.value.items);
      setLoadState((current) => ({ ...current, posts: "ready" }));
      setLoadErrors((current) => ({ ...current, posts: "" }));
    } else {
      setLoadState((current) => ({ ...current, posts: "error" }));
      setLoadErrors((current) => ({ ...current, posts: messageOf(postsResult) }));
    }
    if (draftsResult.status === "fulfilled") {
      setMarketingDrafts(draftsResult.value);
      setLoadState((current) => ({ ...current, drafts: "ready" }));
      setLoadErrors((current) => ({ ...current, drafts: "" }));
    } else {
      setLoadState((current) => ({ ...current, drafts: "error" }));
      setLoadErrors((current) => ({ ...current, drafts: messageOf(draftsResult) }));
    }
    setRefreshing(false);
  }, []);

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
    const timer = window.setInterval(() => { void refresh(); if (tab === "content" && !composer) void loadContent(false); else if (tab === "calendar") void loadCalendar(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [tab, composer, loadContent, loadCalendar, refresh]);
  useEffect(() => {
    if (tab !== "content" || composer) return;
    const timer = window.setTimeout(() => void loadContent(false), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [tab, composer, search, postFilter, loadContent]);
  useEffect(() => { if (tab === "calendar") void loadCalendar(); }, [tab, calendarMonth, loadCalendar]);
  const loadProducts = useCallback(async (query = "") => {
    const sequence = ++productSequence.current;
    try {
      const rows = await request<Product[]>(`/products${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ""}`);
      if (sequence === productSequence.current) setProducts(rows);
    } catch (caught) {
      if (sequence === productSequence.current) setError(caught instanceof Error ? caught.message : "Không tải được sản phẩm.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(productSearch), 250);
    return () => window.clearTimeout(timer);
  }, [productSearch, loadProducts]);

  const selectedAccounts = useMemo(() => status?.accounts.filter((account) => account.selected) || [], [status]);
  const visiblePosts = posts;

  function toast(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 4200); }
  async function startConnect() {
    setBusy(true); setError("");
    try { const result = await request<{ authorizationUrl: string }>("/meta/authorize", "POST", {}); window.location.assign(result.authorizationUrl); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không bắt đầu được Meta OAuth."); setBusy(false); }
  }

  function openNew() {
    setComposer(blankComposer(status?.accounts || []));
    setProductSearch("");
    void loadProducts("");
    setTab("content");
  }

  function editPost(post: SocialPost) {
    if (!["DRAFT", "FAILED"].includes(post.status)) return;
    setComposer({ id: post.id, title: post.title, sourceProductId: post.sourceProductId || "", sourceProductVariantId: post.sourceProductVariantId || "", sourceMarketingDraftId: post.sourceMarketingDraftId || "", scheduleLocal: "", commerceReviewed: false, targets: post.targets.map((target) => ({ accountId: target.accountId || "", platform: target.platform, caption: target.caption, linkUrl: target.linkUrl || "", linkSource: target.linkSource || (target.linkUrl ? "MANUAL" : "NONE"), mediaAssetId: target.mediaAssetId || "" })) });
    setProductSearch(post.sourceProduct?.sku || "");
    void loadProducts(post.sourceProduct?.sku || "");
    setTab("content");
  }

  function patchTarget(index: number, patch: Partial<DraftTarget>) {
    setComposer((current) => current ? { ...current, targets: current.targets.map((target, targetIndex) => targetIndex === index ? { ...target, ...patch } : target) } : current);
  }

  function addChannel(platform: Platform) {
    setComposer((current) => current && current.targets.length < 2 ? { ...current, targets: [...current.targets, { accountId: "", platform, caption: "", linkUrl: "", linkSource: "NONE", mediaAssetId: "" }] } : current);
  }

  function chooseProduct(productId: string) {
    const product = products.find((row) => row.id === productId);
    setComposer((current) => current ? { ...current, sourceProductId: productId, sourceProductVariantId: "", commerceReviewed: false, targets: current.targets.map((target) => { const compatible = product?.images.filter((image) => imageAllowed(target.platform, image)) || []; const currentImage = compatible.find((image) => image.id === target.mediaAssetId); return { ...updateSocialProductLink(target, productId, product?.productUrl), mediaAssetId: currentImage?.id || compatible[0]?.id || "" }; }) } : current);
  }

  function useMarketingDraft(id: string) {
    const draft = marketingDrafts.find((row) => row.id === id);
    if (!draft) return;
    const text = [draft.caption || draft.body, draft.callToAction, draft.hashtags.map((tag) => `#${tag}`).join(" ")].filter(Boolean).join("\n\n");
    setComposer((current) => {
      if (!current) return current;
      const productId = current.sourceProductId || draft.sourceProductIds[0] || "";
      const product = products.find((row) => row.id === productId);
      return { ...current, sourceMarketingDraftId: id, title: draft.title || current.title, sourceProductId: productId, sourceProductVariantId: current.sourceProductId === productId ? current.sourceProductVariantId : "", commerceReviewed: false, targets: current.targets.map((target) => ({ ...updateSocialProductLink(target, productId, product?.productUrl), caption: text.slice(0, 2200) })) };
    });
  }

  async function saveDraft(): Promise<SocialPost | null> {
    if (!composer) return null;
    if (!composer.targets.length) { setError("Thêm ít nhất một kênh nội dung."); return null; }
    setBusy(true); setError("");
    try {
      const payload = { title: composer.title, sourceProductId: composer.sourceProductId || null, sourceProductVariantId: composer.sourceProductVariantId || null, sourceMarketingDraftId: composer.sourceMarketingDraftId || null, targets: composer.targets.map((target) => ({ ...target, accountId: target.accountId || null, linkUrl: target.linkUrl || null, mediaAssetId: target.mediaAssetId || null })) };
      const post = await request<SocialPost>(composer.id ? `/posts/${composer.id}` : "/posts", composer.id ? "PATCH" : "POST", payload);
      setComposer((current) => current ? { ...current, id: post.id } : current);
      await refresh();
      if (tab === "content") void loadContent(false);
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
      await request(`/posts/${post.id}/approve`, "POST", { scheduledAt, commerceReviewed: composer.commerceReviewed });
      setComposer(null);
      await refresh();
      void loadContent(false);
      setTab("content");
      toast(schedule ? "Đã duyệt và lên lịch đăng." : "Đã duyệt nội dung. Bấm Đăng ngay khi sẵn sàng.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không duyệt được nội dung."); }
    finally { setBusy(false); }
  }

  async function action(path: string, message: string) {
    setBusy(true); setError("");
    try { await request(path, "POST", {}); await refresh(); if (tab === "content") void loadContent(false); if (tab === "calendar") void loadCalendar(); toast(message); }
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
  function productSalePrice() { const product = productForComposer(); return product?.hasVariants ? product.variants.find((variant) => variant.id === composer?.sourceProductVariantId)?.currentSalePrice : product?.currentSalePrice; }
  function linkWarning(target: DraftTarget) { const product = productForComposer(); return socialProductLinkWarning(target, product?.productUrl || ""); }
  async function openDetails(post: SocialPost) {
    setDetailPost(post);
    setBusy(true); setError("");
    try { setDetailPost(await request<SocialPost>(`/posts/${post.id}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được chi tiết bài đăng."); }
    finally { setBusy(false); }
  }
  async function verifyUnknown(target: PostTarget) {
    if (!detailPost || !target.id) return;
    setBusy(true); setError("");
    try { const updated = await request<SocialPost>(`/posts/${detailPost.id}/targets/${target.id}/verify`, "POST", {}); setDetailPost(updated); await refresh(); if (tab === "content") void loadContent(false); toast("Đã ghi nhận kết quả truy vấn Meta và lưu lịch sử đối soát."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không đối soát được kênh."); }
    finally { setBusy(false); }
  }
  async function saveManualReconciliation(target: PostTarget) {
    if (!detailPost || !target.id) return;
    setBusy(true); setError("");
    try { const updated = await request<SocialPost>(`/posts/${detailPost.id}/targets/${target.id}/reconcile`, "POST", { decision: manualDecision, notes: manualNotes, evidenceReference: manualEvidence }); setDetailPost(updated); setManualNotes(""); setManualEvidence(""); await refresh(); if (tab === "content") void loadContent(false); toast("Đã lưu đối soát thủ công cùng người thực hiện và dấu vết kiểm tra."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không lưu được đối soát thủ công."); }
    finally { setBusy(false); }
  }
  async function retryUnknown(target: PostTarget) {
    if (!detailPost || !target.id || !window.confirm("Meta vẫn có thể đã nhận bài. Tạo lần gửi mới có nguy cơ đăng trùng. Bạn xác nhận nguy cơ này và muốn tiếp tục?")) return;
    setBusy(true); setError("");
    try { const updated = await request<SocialPost>(`/posts/${detailPost.id}/targets/${target.id}/retry-after-reconciliation`, "POST", { acknowledgeDuplicateRisk: true }); setDetailPost(updated); await refresh(); if (tab === "content") void loadContent(false); toast("Đã lưu quyết định cho phép thử lại sau đối soát."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không cho phép thử lại kênh."); }
    finally { setBusy(false); }
  }
  const loadErrorMessages = [loadErrors.status, loadErrors.posts, loadErrors.drafts].filter(Boolean);
  const hasStaleData = Boolean((status && loadErrors.status) || (posts.length && loadErrors.posts) || (marketingDrafts.length && loadErrors.drafts));
  const statusMetaText = !status?.metaConfigured ? "Meta App chưa được cấu hình" : !status.encryptionConfigured ? "Thiếu khóa mã hóa token trên máy chủ" : "Sẵn sàng kết nối";
  const reviewCount = status && status.metrics.failed !== undefined && status.metrics.unknown !== undefined && status.metrics.partial !== undefined ? status.metrics.failed + status.metrics.unknown + status.metrics.partial : undefined;
  const metricValue = (value?: number) => value === undefined ? "—" : value.toLocaleString("vi-VN");

  return <section className="social-workspace" aria-label="Mạng xã hội GEME">
    <div className="social-heading">
      <div><span className="social-eyebrow">GEME · CONTENT & PUBLISHING</span><h1>Mạng xã hội</h1><p>Chuẩn bị, duyệt và theo dõi nội dung Facebook Page cùng Instagram Professional.</p></div>
      <div className="social-heading-actions"><button type="button" className="social-button social-button-light" onClick={() => void refresh()} disabled={refreshing || busy} aria-label="Làm mới dữ liệu mạng xã hội">{refreshing ? "Đang làm mới…" : "Làm mới"}</button><button type="button" className="social-button social-button-primary" onClick={openNew} disabled={busy}>+ Soạn nội dung</button></div>
    </div>

    <nav className="social-tabs" aria-label="Khu vực mạng xã hội" role="tablist">
      {([["overview", "Tổng quan"], ["content", "Nội dung"], ["calendar", "Lịch đăng"], ["accounts", "Tài khoản"]] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? "active" : ""} onClick={() => { setComposer(null); setTab(key); }}>{label}</button>)}
    </nav>
    {error && <div className="social-alert" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError("")}>Đóng</button></div>}
    {notice && <div className="social-success" role="status">{notice}<button onClick={() => setNotice("")}>Đóng</button></div>}
    {loadErrorMessages.length > 0 && <div className="social-load-alert" role="alert"><span aria-hidden="true">!</span><div><strong>{hasStaleData ? "Một phần dữ liệu chưa được cập nhật" : "Không tải được một phần dữ liệu"}</strong><p>{loadErrorMessages.join(" ")}{hasStaleData ? " Dữ liệu đã tải trước đó vẫn được giữ lại." : ""}</p></div><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Đang thử…" : "Thử lại"}</button></div>}
    {refreshing && <div className="social-refresh-status" role="status" aria-live="polite">Đang cập nhật dữ liệu…</div>}

    {tab === "overview" && (status ? <>
      <div className="social-kpis">
        <MetricCard label="Bản nháp" value={metricValue(status.metrics.drafts)} kind="draft"/>
        <MetricCard label="Lịch đăng" value={metricValue(status.metrics.scheduled)} kind="schedule"/>
        <MetricCard label="Đã đăng" value={metricValue(status.metrics.published)} kind="published"/>
        <MetricCard label="Cần kiểm tra" value={metricValue(reviewCount)} kind="review"/>
      </div>
      <div className="social-overview-grid">
        <article className="social-panel social-connect-card">
          <span className="social-eyebrow">META BUSINESS</span>
          <h2>{status.configured ? "Kết nối Meta" : "Hoàn tất cấu hình kết nối"}</h2>
          <p>Kết nối Facebook Page và Instagram Professional để quản lý nội dung và kênh đăng từ GEME.</p>
          <div className={`social-meta-readiness ${status.configured ? "ready" : "needs-setup"}`}><span aria-hidden="true">{status.configured ? "●" : "!"}</span>{statusMetaText}</div>
          <button type="button" className="social-button social-button-primary" onClick={() => void startConnect()} disabled={!status.configured || busy}>{status.configured ? "Kết nối tài khoản Meta" : "Meta OAuth chưa sẵn sàng"}</button>
          <p className="social-connect-note">Quản lý kết nối và quyền đăng nội dung. GEME không yêu cầu mật khẩu Facebook.</p>
        </article>
        <article className="social-panel">
          <div className="social-panel-title"><div><span className="social-eyebrow">PUBLISHING STATUS</span><h2>Kênh đã chọn</h2></div><button type="button" className="social-text-button" onClick={() => setTab("accounts")}>Quản lý tài khoản →</button></div>
          {selectedAccounts.length ? <div className="social-account-list">{selectedAccounts.map((account) => <div key={account.id}><span className={`social-platform-mark ${account.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{account.platform === "INSTAGRAM" ? "IG" : "f"}</span><span><strong>{account.displayName}</strong><small>{platformName(account.platform)} · {account.connectionName}</small></span><span className={`social-account-state ${account.connectionStatus === "ACTIVE" && !account.missingScopes?.length ? "connected" : "needs-attention"}`}>{account.connectionStatus !== "ACTIVE" ? "Cần kết nối lại" : account.missingScopes?.length ? `Thiếu quyền (${account.missingScopes.length})` : "Đã chọn · đang kết nối"}</span></div>)}</div> : <div className="social-empty compact">Chưa chọn tài khoản đích. Bản nháp vẫn có thể được soạn và lưu.</div>}
        </article>
      </div>
      <article className="social-panel social-recent"><div className="social-panel-title"><div><span className="social-eyebrow">LATEST ACTIVITY</span><h2>Nội dung gần đây</h2></div><button type="button" className="social-text-button" onClick={() => setTab("content")}>Xem tất cả →</button></div><PostList posts={recentPosts.slice(0, 5)} loading={loadState.posts === "loading"} error={loadErrors.posts} onRetry={refresh} onEdit={editPost} onAction={action} onDetails={openDetails} busy={busy} emptyText="Chưa có hoạt động mạng xã hội. Soạn bản nháp đầu tiên để bắt đầu."/></article>
    </> : <ResourcePanel state={loadState.status} error={loadErrors.status} onRetry={refresh} title="Trạng thái kết nối"/>)}

    {tab === "accounts" && (status ? <div className="social-panel social-accounts-panel">
      <div className="social-panel-title"><div><span className="social-eyebrow">CONNECTED DESTINATIONS</span><h2>Tài khoản mạng xã hội</h2><p>Chọn tài khoản xuất hiện trong composer. Trạng thái lựa chọn và kết nối được hiển thị riêng.</p></div><button type="button" className="social-button social-button-primary" onClick={() => void startConnect()} disabled={!status.configured || busy}>+ Kết nối Meta</button></div>
      {!status.accounts.length ? <div className="social-empty">{status.configured ? "Chưa có tài khoản Meta kết nối." : `Chưa có tài khoản kết nối. ${statusMetaText}.`}</div> : <div className="social-account-grid">{status.accounts.map((account) => <article className="social-account-card" key={account.id}>
        <label className="social-account-label" htmlFor={`social-account-${account.id}`}><input id={`social-account-${account.id}`} type="checkbox" checked={selecting.includes(account.id)} onChange={(event) => setSelecting((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))}/><span className={`social-platform-mark ${account.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{account.platform === "INSTAGRAM" ? "IG" : "f"}</span><span className="social-account-copy"><strong>{account.displayName}</strong><small>{platformName(account.platform)}{account.username ? ` · @${account.username}` : ""}</small><small>{account.connectionName}</small></span></label>
        <div className="social-account-card-status"><span className={`social-account-state ${account.connectionStatus === "ACTIVE" && !account.missingScopes?.length ? "connected" : "needs-attention"}`}>{account.connectionStatus !== "ACTIVE" ? "Cần kết nối lại" : account.missingScopes?.length ? `Thiếu quyền · ${account.missingScopes.join(", ")}` : "Đang kết nối"}</span><span className="social-account-check">{selecting.includes(account.id) ? "Đã chọn" : "Chưa chọn"}</span><button type="button" className="social-text-button danger" onClick={() => void disconnect(account.connectionId)} disabled={busy}>Ngắt kết nối</button></div>
      </article>)}</div>}
      {status.accounts.length > 0 && <div className="social-footer-actions"><small>{selecting.length} tài khoản sẽ xuất hiện ở composer.</small><button type="button" className="social-button social-button-primary" onClick={() => void saveSelection()} disabled={busy}>Lưu lựa chọn</button></div>}
      <div className="social-permission-note"><strong>Quyền Meta cần dùng</strong><span>{status.permissionsRequired.join(" · ")}</span><small>Chỉ Page và Instagram chuyên nghiệp được Meta cấp quyền mới đăng được. Bạn có thể thu hồi quyền từ cài đặt Business Integrations hoặc ngắt kết nối tại đây.</small></div>
    </div> : <ResourcePanel state={loadState.status} error={loadErrors.status} onRetry={refresh} title="Tài khoản Meta"/>)}

    {tab === "content" && !composer && <section className="social-panel social-content-panel"><div className="social-toolbar"><div><span className="social-eyebrow">CONTENT LIBRARY</span><h2>Quản lý nội dung</h2></div><div className="social-toolbar-controls"><label className="social-search-field"><span className="sr-only">Tìm nội dung</span><input type="search" aria-label="Tìm nội dung" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tiêu đề hoặc nội dung…"/></label><label className="social-filter-field"><span className="sr-only">Lọc trạng thái</span><select aria-label="Lọc trạng thái" value={postFilter} onChange={(event) => setPostFilter(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statusName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div><PostList posts={visiblePosts} loading={contentLoading} error={contentError} onRetry={() => loadContent(false)} onEdit={editPost} onAction={action} onDetails={openDetails} busy={busy} emptyText={search || postFilter ? "Không có nội dung khớp điều kiện lọc." : "Chưa có nội dung. Tạo bản nháp để chuẩn bị bài đăng đầu tiên."}/>{hasMore && <div className="social-load-more"><button type="button" className="social-button social-button-light" onClick={() => void loadContent(true)} disabled={contentLoading}>{contentLoading ? "Đang tải…" : "Tải thêm nội dung"}</button></div>}</section>}

    {tab === "calendar" && <section className="social-panel social-calendar"><div className="social-toolbar"><div><span className="social-eyebrow">SCHEDULE · ASIA/HO_CHI_MINH</span><h2>Lịch đăng và kết quả</h2><p>Thời gian hiển thị theo giờ Việt Nam (GMT+7). Bài lên lịch dùng giờ đích; bài đã đăng dùng thời điểm Meta xác nhận.</p></div><div className="social-calendar-controls"><label className="social-filter-field"><span>Tháng</span><input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)}/></label><label className="social-filter-field"><span>Trạng thái</span><select value={calendarFilter} onChange={(event) => setCalendarFilter(event.target.value)}><option value="">Tất cả</option>{Object.entries(statusName).filter(([value]) => ["SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "UNKNOWN"].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="social-button social-button-light" onClick={() => setTab("content")}>Mở thư viện nội dung</button></div></div><PostList posts={calendarPosts} loading={calendarLoading} error={calendarError} onRetry={loadCalendar} onEdit={editPost} onAction={action} onDetails={openDetails} busy={busy} emptyText="Không có lịch đăng hoặc kết quả trong tháng này."/></section>}
    {tab === "content" && composer && <section className="social-composer-layout">
      <div className="social-panel social-composer"><div className="social-panel-title"><div><span className="social-eyebrow">CONTENT BRIEF</span><h2>{composer.id ? "Chỉnh sửa bản nháp" : "Soạn nội dung"}</h2><p>Chọn sản phẩm, ảnh đã duyệt và viết nội dung riêng cho từng kênh.</p></div><button className="social-text-button" onClick={() => setComposer(null)}>← Quay lại</button></div>
        <div className="social-form-grid">
          <label className="social-field social-wide"><span>Tiêu đề nội bộ</span><input value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} placeholder="Ví dụ: Bộ sưu tập sắc xanh" maxLength={180}/></label>
          <label className="social-field"><span>Sản phẩm GEME</span><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Tìm theo tên hoặc SKU"/><select value={composer.sourceProductId} onChange={(event) => chooseProduct(event.target.value)}><option value="">Không gắn sản phẩm</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          {productForComposer()?.hasVariants && <label className="social-field"><span>Biến thể được quảng bá</span><select value={composer.sourceProductVariantId} onChange={(event) => setComposer({ ...composer, sourceProductVariantId: event.target.value, commerceReviewed: false })}><option value="">Chọn biến thể cụ thể</option>{productForComposer()?.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={variant.stock <= 0}>{variant.label || variant.sku || variant.id} · {variant.currentSalePrice.toLocaleString("vi-VN")} ₫ · tồn {variant.stock}</option>)}</select><small>Không tự lấy biến thể đầu tiên hoặc giá thấp nhất. Chỉ biến thể còn hàng mới có thể duyệt.</small></label>}
          {productForComposer() && <div className="social-commerce-review social-wide"><strong>Giá hiện tại để đối chiếu nội dung</strong><span>{productSalePrice() == null ? "Chọn biến thể trước khi duyệt" : `${productSalePrice()!.toLocaleString("vi-VN")} ₫ · VND`}</span><small>Giá được lưu cùng revision khi duyệt. Nếu giá hoặc khuyến mãi đổi trước lúc đăng, hệ thống sẽ chặn target và yêu cầu duyệt lại. Hãy kiểm tra caption có nêu giá hay không.</small><label><input type="checkbox" checked={composer.commerceReviewed} onChange={(event) => setComposer({ ...composer, commerceReviewed: event.target.checked })}/> Tôi đã rà soát giá bán/khuyến mãi và caption với đúng sản phẩm, biến thể.</label></div>}
          <label className="social-field"><span>Bản nháp Marketing Agent (tùy chọn)</span><select value={composer.sourceMarketingDraftId} onChange={(event) => useMarketingDraft(event.target.value)} disabled={loadState.drafts !== "ready"}><option value="">{loadState.drafts === "loading" ? "Đang tải bản nháp…" : loadState.drafts === "error" ? "Bản nháp AI chưa tải được" : "Không dùng bản nháp AI"}</option>{marketingDrafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || draft.objective} · {draft.channel}</option>)}</select><small>{loadErrors.drafts ? "Lỗi tải bản nháp AI không ảnh hưởng đến bản soạn hiện tại." : "AI chỉ hỗ trợ nội dung; bài vẫn cần kiểm tra và duyệt riêng tại đây."}</small>{loadErrors.drafts && <button type="button" className="social-inline-retry" onClick={() => void refresh()} disabled={refreshing}>Thử tải bản nháp lại</button>}</label>
          <div className="social-wide social-channel-heading"><span>Nội dung theo kênh</span><div><button type="button" onClick={() => addChannel("FACEBOOK_PAGE")} disabled={busy || composer.targets.length >= 2 || composer.targets.some((target) => target.platform === "FACEBOOK_PAGE")}>+ Facebook</button><button type="button" onClick={() => addChannel("INSTAGRAM")} disabled={busy || composer.targets.length >= 2 || composer.targets.some((target) => target.platform === "INSTAGRAM")}>+ Instagram</button></div></div>
          {composer.targets.map((target, index) => <article className="social-channel-editor social-wide" key={`${target.platform}-${index}`}>
            <div className="social-channel-editor-heading"><span className={`social-platform-mark ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><strong>{platformName(target.platform)}</strong>{composer.targets.length > 1 && <button type="button" className="social-text-button" onClick={() => setComposer({ ...composer, targets: composer.targets.filter((_, itemIndex) => itemIndex !== index) })}>Gỡ kênh</button>}</div>
            <label className="social-field"><span>Tài khoản đích</span><select value={target.accountId} onChange={(event) => patchTarget(index, { accountId: event.target.value })}><option value="">Lưu bản nháp, chọn tài khoản sau</option>{status?.accounts.filter((account) => account.platform === target.platform).map((account) => <option key={account.id} value={account.id}>{account.displayName}{account.selected ? " · đã chọn" : " · chưa chọn trong quản lý tài khoản"}</option>)}</select></label>
            <label className="social-field"><span>Nội dung</span><textarea value={target.caption} onChange={(event) => patchTarget(index, { caption: event.target.value })} rows={5} maxLength={2200} placeholder={target.platform === "INSTAGRAM" ? "Viết caption cho Instagram…" : "Viết nội dung cho Facebook…"}/><small>{target.caption.length}/2200 · Không tự động bổ sung thông tin chưa được GEME xác nhận.</small></label>
            {target.platform === "FACEBOOK_PAGE" && <label className="social-field"><span>Liên kết sản phẩm GEME (không bắt buộc)</span><input value={target.linkUrl} onChange={(event) => patchTarget(index, { linkUrl: event.target.value, linkSource: event.target.value ? "MANUAL" : "NONE" })} placeholder={productForComposer()?.productUrl || "Liên kết công khai từ cấu hình GEME"}/>{linkWarning(target) && <small className="social-inline-warning">Liên kết nhập tay hiện khác sản phẩm đang chọn. Hệ thống giữ nguyên; hãy xác nhận đúng liên kết trước khi duyệt.</small>}{target.linkSource === "PRODUCT" && <small>Liên kết này tự sinh và sẽ đổi theo sản phẩm đang chọn.</small>}</label>}
            <label className="social-field"><span>Ảnh sản phẩm đã duyệt {target.platform === "INSTAGRAM" ? "· bắt buộc" : "· không bắt buộc"}</span><select value={target.mediaAssetId} onChange={(event) => patchTarget(index, { mediaAssetId: event.target.value })}><option value="">Không đính kèm ảnh</option>{productForComposer()?.images.filter((image) => imageAllowed(target.platform, image)).map((image) => <option key={image.id} value={image.id}>{image.alt || image.filename}</option>)}</select><small>{target.platform === "INSTAGRAM" ? "Instagram cần JPEG công khai, tối đa 8 MB; chỉ ảnh đã duyệt/QC đạt." : "Ảnh đã duyệt, QC đạt và có CDN R2 công khai mới được gửi cho Meta."}</small></label>
            {target.mediaAssetId && productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url && <img className="social-image-preview" src={productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url} alt="Ảnh sản phẩm đã chọn"/>}
          </article>)}
          {composer.sourceMarketingDraftId && marketingDrafts.find((draft) => draft.id === composer.sourceMarketingDraftId)?.factWarnings?.length ? <div className="social-warning social-wide"><strong>Thông tin cần rà soát từ Marketing Agent</strong><p>{marketingDrafts.find((draft) => draft.id === composer.sourceMarketingDraftId)?.factWarnings?.join(" · ")}</p></div> : null}
        </div>
        <div className="social-composer-actions"><button type="button" className="social-button social-button-light" onClick={() => void saveDraft()} disabled={busy}>{busy ? "Đang lưu…" : "Lưu bản nháp"}</button><button type="button" className="social-button social-button-light" onClick={() => void approve(false)} disabled={busy || !composer.targets.some((target) => target.accountId) || Boolean(composer.sourceProductId && !composer.commerceReviewed) || Boolean(productForComposer()?.hasVariants && !composer.sourceProductVariantId)}>Duyệt nội dung</button><label className="social-schedule-field"><span>Lên lịch giờ Việt Nam</span><input type="datetime-local" value={composer.scheduleLocal} onChange={(event) => setComposer({ ...composer, scheduleLocal: event.target.value })}/></label><button type="button" className="social-button social-button-primary" onClick={() => void approve(true)} disabled={busy || !composer.targets.some((target) => target.accountId) || Boolean(composer.sourceProductId && !composer.commerceReviewed) || Boolean(productForComposer()?.hasVariants && !composer.sourceProductVariantId)}>Duyệt & lên lịch</button></div>
        <p className="social-footnote">Đăng ngay chỉ bật sau khi nội dung đã được duyệt. Mọi chỉnh sửa sau duyệt sẽ tạo revision mới và cần duyệt lại.</p>
      </div>
      <aside className="social-panel social-preview"><span className="social-eyebrow">BẢN XEM TRƯỚC · CHƯA ĐĂNG</span><h2>Xem trước bài đăng</h2>{composer.targets.map((target, index) => <article className="social-preview-card" key={`${target.platform}-${index}`}><header><span className={`social-platform-mark ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><span><strong>{target.accountId ? status?.accounts.find((account) => account.id === target.accountId)?.displayName || platformName(target.platform) : platformName(target.platform)}</strong><small>Bản xem trước · Chưa đăng</small></span></header>{target.mediaAssetId && productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url && <img src={productForComposer()?.images.find((image) => image.id === target.mediaAssetId)?.url} alt="Ảnh xem trước"/>}<p>{target.caption || "Nội dung của bạn sẽ hiển thị ở đây."}</p>{target.linkUrl && <small>{target.linkUrl}</small>}</article>)}{!composer.targets.length && <p>Thêm một kênh để xem trước.</p>}</aside>
    </section>}

    {tab === "content" && !composer && <div className="social-after-list"><button type="button" className="social-button social-button-primary" onClick={openNew}>+ Soạn nội dung mới</button></div>}
    {detailPost && <div className="social-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailPost(null); }}><aside className="social-detail-panel" role="dialog" aria-modal="true" aria-labelledby="social-detail-title"><header><div><span className="social-eyebrow">POST & TARGET AUDIT</span><h2 id="social-detail-title">{detailPost.title}</h2><p>Revision {detailPost.revision} · {statusName[detailPost.status] || detailPost.status}</p></div><button type="button" className="social-text-button" onClick={() => setDetailPost(null)}>Đóng</button></header>
      {detailPost.sourceProductId && <section className="social-detail-commerce"><strong>Đối chiếu giá lúc duyệt và hiện tại</strong>{detailPost.approvedCommerceSnapshot ? <p>Lúc duyệt: {detailPost.approvedCommerceSnapshot.saleUnitPrice.toLocaleString("vi-VN")} ₫ · {detailPost.approvedCommerceSnapshot.variantSku || detailPost.approvedCommerceSnapshot.productSku}{detailPost.approvedCommerceSnapshot.promotionValue ? ` · giảm ${detailPost.approvedCommerceSnapshot.promotionValue}%` : ""}</p> : <p>Chưa có snapshot giá ở lần duyệt này. Cần kiểm tra thủ công.</p>}{detailPost.commerceCurrent && <p>Hiện tại: {detailPost.commerceCurrent.saleUnitPrice.toLocaleString("vi-VN")} ₫ · {detailPost.commerceCurrent.variantSku || detailPost.commerceCurrent.productSku}{detailPost.commerceCurrent.promotionValue ? ` · giảm ${detailPost.commerceCurrent.promotionValue}%` : ""}</p>}{detailPost.commerceChanged && <div className="social-inline-warning">Giá/khuyến mãi đã đổi sau khi duyệt. Worker sẽ không gửi các target chưa đăng; sửa và duyệt lại bản nội dung.</div>}</section>}
      {detailPost.targets.map((target, index) => <article className="social-detail-target" key={target.id || `${target.platform}-${index}`}><div className="social-detail-target-title"><span className={`social-platform-mark small ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`}>{target.platform === "INSTAGRAM" ? "IG" : "f"}</span><div><strong>{target.account?.displayName || platformName(target.platform)}</strong><small>{statusName[target.status || detailPost.status] || target.status} · {formatDate(target.scheduledAt || target.publishedAt)}</small></div></div>
        <dl><dt>Mã lỗi an toàn</dt><dd>{target.lastErrorCode || "—"}</dd><dt>Container ID</dt><dd>{target.remoteContainerId || "Chưa có"}</dd><dt>Remote media/post ID</dt><dd>{target.remoteMediaId || "Chưa có"}</dd><dt>Liên kết</dt><dd>{target.permalink ? <a href={target.permalink} target="_blank" rel="noreferrer">Mở bài Meta ↗</a> : "Chưa có permalink đã xác minh"}</dd></dl>
        <h3>Lịch sử gửi</h3>{target.attempts?.length ? target.attempts.map((attempt) => <div className="social-detail-history" key={attempt.id || attempt.startedAt}><span>{formatDate(attempt.startedAt)} → {attempt.finishedAt ? formatDate(attempt.finishedAt) : "đang xử lý"}</span><span>{attempt.status} · {attempt.errorCode || "không lỗi"}</span><small>{attempt.remoteContainerId ? `Container ${attempt.remoteContainerId}` : ""} {attempt.remoteMediaId ? `· Media ${attempt.remoteMediaId}` : ""}</small></div>) : <p>Chưa có lần gửi.</p>}
        <h3>Lịch sử đối soát</h3>{target.reconciliations?.length ? target.reconciliations.map((entry, entryIndex) => <div className="social-detail-history" key={`${entry.createdAt}-${entryIndex}`}><span>{formatDate(entry.createdAt)} · {entry.decision} ({entry.source}) · {entry.admin?.displayName || entry.admin?.email || "Admin"}</span><span>{entry.resultCode || ""} {entry.notes || ""}</span>{entry.evidenceReference && <small>Tham chiếu: {entry.evidenceReference}</small>}</div>) : <p>Chưa có đối soát.</p>}
        {target.status === "UNKNOWN" && <div className="social-reconcile-actions"><p>Không gửi lại tự động. Đối soát theo đúng tài khoản đích hoặc ghi nhận kiểm tra thủ công; permalink nhập tay chỉ là tham chiếu.</p><button type="button" className="social-button social-button-light" disabled={busy} onClick={() => void verifyUnknown(target)}>Kiểm tra bằng Meta API</button><label className="social-field"><span>Kết quả kiểm tra thủ công</span><select value={manualDecision} onChange={(event) => setManualDecision(event.target.value)}><option value="UNRESOLVED">Chưa xác định</option><option value="CONFIRMED_NOT_PUBLISHED">Đã xác nhận chưa đăng</option><option value="CONFIRMED_PUBLISHED">Đã xác nhận đã đăng</option></select></label><label className="social-field"><span>Ghi chú (5–1.200 ký tự)</span><textarea value={manualNotes} onChange={(event) => setManualNotes(event.target.value)} maxLength={1200} rows={3}/></label><label className="social-field"><span>Tham chiếu bằng chứng (không tự truy cập URL)</span><input value={manualEvidence} onChange={(event) => setManualEvidence(event.target.value)} maxLength={2000} placeholder="Ví dụ: kiểm tra trực tiếp trong Meta Business Suite"/></label><button type="button" className="social-button social-button-primary" disabled={busy || manualNotes.trim().length < 5 || (manualDecision === "CONFIRMED_PUBLISHED" && !manualEvidence.trim())} onClick={() => void saveManualReconciliation(target)}>Lưu kết quả thủ công</button>{["CONFIRMED_NOT_PUBLISHED", "UNRESOLVED"].includes(target.reconciliations?.[0]?.decision || "") && <button type="button" className="social-button social-button-danger" disabled={busy} onClick={() => void retryUnknown(target)}>Cho phép thử lại sau khi xác nhận rủi ro đăng trùng</button>}</div>}
      </article>)}
    </aside></div>}
    {busy && <div className="social-busy" role="status">Đang lưu thay đổi…</div>}
  </section>;
}

function MetricCard({ label, value, kind }: { label: string; value: string; kind: "draft" | "schedule" | "published" | "review" }) {
  return <article className={`social-kpi social-kpi-${kind}`}><span className="social-kpi-icon" aria-hidden="true"><MetricIcon kind={kind}/></span><div className="social-kpi-copy"><span>{label}</span><strong>{value}</strong><small>Trạng thái từ hệ thống đăng bài</small></div></article>;
}

function MetricIcon({ kind }: { kind: "draft" | "schedule" | "published" | "review" }) {
  if (kind === "schedule") return <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>;
  if (kind === "published") return <svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7"/></svg>;
  if (kind === "review") return <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v6h5"/></svg>;
}

function ResourcePanel({ state, error, onRetry, title }: { state: ResourceState; error: string; onRetry: () => Promise<void>; title: string }) {
  const view = getCollectionState({ loading: state === "loading", error: state === "error", itemCount: 0 });
  return <div className={`social-resource-panel state-${view}`} role={view === "error" ? "alert" : "status"}>
    <span className="social-resource-symbol" aria-hidden="true">{view === "loading" ? "…" : view === "error" ? "!" : "✓"}</span>
    <div><strong>{view === "loading" ? `Đang tải ${title.toLocaleLowerCase("vi")}…` : view === "error" ? `Không tải được ${title.toLocaleLowerCase("vi")}` : title}</strong><p>{view === "loading" ? "Dữ liệu đang được lấy từ hệ thống GEME." : error || "Chưa có dữ liệu cho mục này."}</p></div>
    {view === "error" && <button type="button" className="social-button social-button-light" onClick={() => void onRetry()}>Thử lại</button>}
  </div>;
}

function PostList({ posts, loading, error, onRetry, onEdit, onAction, onDetails, busy, emptyText = "Chưa có nội dung trong mục này." }: { posts: SocialPost[]; loading: boolean; error: string; onRetry: () => Promise<void>; onEdit: (post: SocialPost) => void; onAction: (path: string, message: string) => void; onDetails: (post: SocialPost) => void; busy: boolean; emptyText?: string }) {
  const view = getCollectionState({ loading, error: Boolean(error), itemCount: posts.length });
  if (view === "loading") return <div className="social-resource-panel state-loading" role="status"><span className="social-resource-symbol" aria-hidden="true">…</span><div><strong>Đang tải bài viết…</strong><p>Đang lấy trạng thái từng kênh từ API GEME.</p></div></div>;
  if (view === "error") return <div className="social-resource-panel state-error" role="alert"><span className="social-resource-symbol" aria-hidden="true">!</span><div><strong>Không tải được bài viết</strong><p>{error}</p></div><button type="button" className="social-button social-button-light" onClick={() => void onRetry()}>Thử lại</button></div>;
  if (view === "empty") return <div className="social-empty">{emptyText}</div>;

  return <div className="social-post-list">
    {error && <div className="social-stale-note" role="status"><span>Dữ liệu đã tải trước đó</span><span>Lần làm mới này thất bại.</span><button type="button" onClick={() => void onRetry()} disabled={busy}>Thử lại</button></div>}
    {posts.map((post) => {
      const summary = socialPostStatusSummary(post);
      const hasUnknownTarget = summary.needsReconciliation;
      return <article className="social-post-row" key={post.id}>
        <div className="social-post-main">
          <div className="social-post-title"><h3>{post.title}</h3><span className={`social-status status-${post.status.toLowerCase()}`}>{summary.overall}</span></div>
          <div className="social-post-meta"><span>Revision {post.revision}</span><span>{post.targets.map((target) => platformName(target.platform)).join(" + ")}</span><span>Cập nhật {formatDate(socialUpdatedAtLabel(post))}</span><span>Ngày tạo {formatDate(post.createdAt)}</span>{post.approvedAt && <span>Duyệt {formatDate(post.approvedAt)}</span>}</div>
          {post.targets.map((target, index) => { const time = ["SCHEDULED", "PUBLISHING"].includes(target.status || post.status) ? target.scheduledAt : target.status === "PUBLISHED" ? target.publishedAt : target.attempts?.[0]?.startedAt; return <div className="social-result-row" key={target.id || target.accountId + target.platform}>
            <span className={`social-platform-mark small ${target.platform === "INSTAGRAM" ? "instagram" : "facebook"}`} aria-hidden="true">{target.platform === "INSTAGRAM" ? "IG" : "f"}</span>
            <span className="social-result-channel">{target.account?.displayName || platformName(target.platform)}</span>
            <span className="social-result-caption" title={target.caption}>{target.caption || "Chưa có nội dung"}</span>
            <span className={`social-status status-${(target.status || post.status).toLowerCase()}`}>{summary.targetStatuses[index]}</span>
            {time && <time className="social-scheduled-time">{target.status === "PUBLISHED" ? "Meta xác nhận" : ["SCHEDULED", "PUBLISHING"].includes(target.status || post.status) ? "Giờ đích" : "Lần gửi gần nhất"}: {formatDate(time)}</time>}
            {target.permalink && <a href={target.permalink} target="_blank" rel="noreferrer">Mở bài ↗</a>}
            {target.lastErrorCode && <details className="social-error-code"><summary>{target.lastErrorCode === "SOCIAL_PRICE_CHANGED_AFTER_APPROVAL" ? "Giá/khuyến mãi đổi sau khi duyệt" : target.lastErrorCode === "SOCIAL_PRICE_REVIEW_REQUIRED" ? "Cần rà soát giá trước khi đăng" : target.lastErrorCode === "META_CONNECTION_INACTIVE" ? "Tài khoản Meta cần kết nối lại" : target.lastErrorCode === "WORKER_INTERRUPTED_UNKNOWN_OUTCOME" ? "Kết quả gửi chưa xác định" : "Cần kiểm tra trạng thái kênh"}</summary><code>{target.lastErrorCode}</code></details>}
          </div>; })}
          {hasUnknownTarget && <div className="social-reconcile-note">Meta chưa xác nhận kết quả của ít nhất một kênh. Hãy đối soát trong Meta trước khi thao tác lại để tránh đăng trùng.</div>}
        </div>
        <div className="social-post-actions">
          <button type="button" className="social-text-button" disabled={busy} onClick={() => onDetails(post)}>Chi tiết</button>
          {["DRAFT", "FAILED"].includes(post.status) && <button type="button" className="social-text-button" disabled={busy} onClick={() => onEdit(post)}>Chỉnh sửa</button>}
          {post.status === "APPROVED" && <button type="button" className="social-button social-button-primary" disabled={busy} onClick={() => onAction(`/posts/${post.id}/publish-now`, "Đã đưa vào hàng đợi đăng bài.")}>Đăng ngay</button>}
          {post.status === "PARTIAL" && !hasUnknownTarget && <button type="button" className="social-text-button" disabled={busy} onClick={() => onAction(`/posts/${post.id}/retry-failed`, "Đang thử lại những kênh chưa đăng được.")}>Thử lại kênh lỗi</button>}
          {post.status === "SCHEDULED" && <button type="button" className="social-text-button" disabled={busy} onClick={() => onAction(`/posts/${post.id}/reschedule`, "Đã hủy duyệt cũ. Sửa bản nháp và duyệt lại lịch mới.")}>Đổi lịch</button>}
          {["SCHEDULED", "APPROVED"].includes(post.status) && <button type="button" className="social-text-button danger" disabled={busy} onClick={() => onAction(`/posts/${post.id}/cancel`, "Đã hủy lịch/nội dung chưa đăng.")}>Hủy</button>}
        </div>
      </article>;
    })}
  </div>;
}
