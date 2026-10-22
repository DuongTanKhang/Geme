import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { calculateCheckoutPrice, getCheckoutPromotionValue, type CheckoutPromotion } from "../commerce/checkout-pricing.js";

export type SocialPlatformName = "FACEBOOK_PAGE" | "INSTAGRAM";
export type SocialLinkSourceName = "NONE" | "PRODUCT" | "MANUAL";
export type SocialTargetInput = { accountId: string | null; platform: SocialPlatformName; caption: string; linkUrl: string | null; linkSource: SocialLinkSourceName; mediaAssetId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const htmlTag = /<\/?[a-z][^>]*>/i;

export function socialCommerceSnapshot(product: any, variant: any | null, promotions: CheckoutPromotion[]) {
  const promotionValue = getCheckoutPromotionValue(product, promotions);
  const price = calculateCheckoutPrice(product, variant, promotionValue);
  return {
    productId: product.id, productSku: product.sku, variantId: variant?.id || null, variantSku: variant?.sku || null,
    currency: "VND", listedUnitPrice: price.listedUnitPrice, saleUnitPrice: price.saleUnitPrice,
    compareAtUnitPrice: price.compareAtUnitPrice, promotionValue: price.promotionValue, checkedAt: new Date().toISOString(),
  };
}

export function socialCommerceSnapshotHash(value: Record<string, unknown>) {
  const { checkedAt: _checkedAt, ...stable } = value;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function unknownRetryEligible(input: { targetStatus: string; postRevision: number; targetApprovedRevision: number | null; postApprovedRevision: number | null; latestDecision: string | null; acknowledgeDuplicateRisk: boolean }) {
  return input.targetStatus === "UNKNOWN"
    && input.targetApprovedRevision === input.postRevision
    && input.postApprovedRevision === input.postRevision
    && (input.latestDecision === "CONFIRMED_NOT_PUBLISHED" || input.latestDecision === "UNRESOLVED")
    && input.acknowledgeDuplicateRisk;
}

export function boundedText(value: unknown, field: string, max: number, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new BadRequestException(`${field} không hợp lệ.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || htmlTag.test(result)) throw new BadRequestException(`${field} cần có nội dung hợp lệ, tối đa ${max} ký tự.`);
  return result;
}

export function safeGEMEUrl(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new BadRequestException("Liên kết sản phẩm không hợp lệ.");
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException("Liên kết sản phẩm phải là URL HTTPS của GEME."); }
  const configured = process.env.GEME_SITE_URL?.trim() || "";
  if (!configured) throw new BadRequestException("GEME_SITE_URL chưa được cấu hình trên máy chủ.");
  let origin: string;
  try { origin = new URL(configured).origin; } catch { throw new BadRequestException("GEME_SITE_URL chưa hợp lệ."); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new BadRequestException("Chỉ dùng liên kết HTTPS trên website GEME.");
  return url.toString();
}

export function normalizeSocialTargets(value: unknown): SocialTargetInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new BadRequestException("Chọn một hoặc hai tài khoản đích đã kết nối.");
  const targets = value.map((item): SocialTargetInput => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException("Thông tin kênh đăng không hợp lệ.");
    const row = item as Record<string, unknown>;
    const accountId = typeof row.accountId === "string" && row.accountId.trim() ? row.accountId.trim() : null;
    if (accountId && !UUID.test(accountId)) throw new BadRequestException("Tài khoản mạng xã hội không hợp lệ.");
    if (row.platform !== "FACEBOOK_PAGE" && row.platform !== "INSTAGRAM") throw new BadRequestException("Chỉ hỗ trợ Facebook Page và Instagram Professional.");
    const caption = boundedText(row.caption, "Nội dung", 2200, row.platform === "INSTAGRAM");
    const declaredSource = row.linkSource === "PRODUCT" || row.linkSource === "MANUAL" || row.linkSource === "NONE" ? row.linkSource : null;
    const linkSource = declaredSource || (row.linkUrl ? "MANUAL" : "NONE");
    const linkUrl = linkSource === "PRODUCT" ? null : safeGEMEUrl(row.linkUrl);
    if (linkSource === "PRODUCT" && row.platform !== "FACEBOOK_PAGE") throw new BadRequestException("Liên kết sản phẩm tự sinh chỉ dùng cho Facebook Page.");
    if (linkSource === "NONE" && linkUrl) throw new BadRequestException("Liên kết có nội dung cần đánh dấu là liên kết nhập tay hoặc liên kết sản phẩm.");
    if (linkSource !== "NONE" && linkSource !== "PRODUCT" && !linkUrl) throw new BadRequestException("Nguồn liên kết không khớp với URL đang lưu.");
    const mediaAssetId = row.mediaAssetId == null || row.mediaAssetId === "" ? null : String(row.mediaAssetId);
    if (mediaAssetId && !UUID.test(mediaAssetId)) throw new BadRequestException("Ảnh đã chọn không hợp lệ.");
    if (row.platform === "INSTAGRAM" && !mediaAssetId) throw new BadRequestException("Instagram yêu cầu chọn một ảnh sản phẩm đã duyệt.");
    return { accountId, platform: row.platform, caption, linkUrl, linkSource, mediaAssetId };
  });
  const accountIds = targets.flatMap((target) => target.accountId ? [target.accountId] : []);
  if (new Set(accountIds).size !== accountIds.length) throw new BadRequestException("Không chọn lặp cùng một tài khoản.");
  return targets;
}

export function socialPayloadHash(target: Pick<SocialTargetInput, "accountId" | "platform" | "caption" | "linkUrl" | "mediaAssetId"> & { linkSource?: string }) {
  return createHash("sha256").update(JSON.stringify({ accountId: target.accountId || "", platform: target.platform, caption: target.caption.trim(), linkUrl: target.linkUrl || null, mediaAssetId: target.mediaAssetId || null })).digest("hex");
}

export function approvedSnapshotHash(targets: Array<{ accountId: string; platform: string; caption: string; linkUrl: string | null; linkSource?: string; mediaAssetId: string | null }>) {
  const normalized = targets.map((target) => ({ accountId: target.accountId, platform: target.platform, caption: target.caption.trim(), linkUrl: target.linkUrl || null, mediaAssetId: target.mediaAssetId || null })).sort((a, b) => a.accountId.localeCompare(b.accountId));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function aggregateSocialStatus(statuses: string[]) {
  if (!statuses.length) return "DRAFT";
  if (statuses.every((status) => status === "PUBLISHED")) return "PUBLISHED";
  if (statuses.some((status) => status === "UNKNOWN")) return "UNKNOWN";
  if (statuses.some((status) => status === "PUBLISHING")) return "PUBLISHING";
  if (statuses.some((status) => status === "SCHEDULED")) return "SCHEDULED";
  if (statuses.some((status) => status === "PUBLISHED")) return "PARTIAL";
  if (statuses.every((status) => status === "CANCELLED")) return "CANCELLED";
  if (statuses.some((status) => status === "FAILED")) return "FAILED";
  if (statuses.every((status) => status === "APPROVED")) return "APPROVED";
  return "DRAFT";
}

export function parseHoChiMinhSchedule(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const isLocalDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (!isLocalDateTime && !hasZone) throw new BadRequestException("Thời gian phải có múi giờ hoặc được nhập theo giờ Việt Nam.");
  const date = new Date(isLocalDateTime ? `${raw}+07:00` : raw);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException("Thời gian lên lịch không hợp lệ.");
  if (date.getTime() < Date.now() + 60_000) throw new BadRequestException("Thời gian lên lịch phải cách hiện tại ít nhất một phút.");
  if (date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new BadRequestException("Chỉ được lên lịch tối đa một năm.");
  return date;
}
