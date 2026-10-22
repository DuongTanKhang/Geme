const STATUS_LABELS = {
  DRAFT: "Bản nháp",
  APPROVED: "Đã duyệt",
  SCHEDULED: "Đã lên lịch",
  PUBLISHING: "Đang đăng",
  PUBLISHED: "Đã đăng",
  PARTIAL: "Đăng một phần",
  FAILED: "Thất bại",
  UNKNOWN: "Cần đối soát",
  CANCELLED: "Đã hủy",
};

/** @param {{ loading: boolean; error: boolean; itemCount: number }} input */
export function getCollectionState({ loading, error, itemCount }) {
  if (itemCount > 0) return "data";
  if (loading) return "loading";
  if (error) return "error";
  return "empty";
}

/** @param {string} status */
export function socialStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

/** @param {{ status: string; targets?: Array<{ status?: string | null }> }} post */
export function socialPostStatusSummary(post) {
  return {
    overall: socialStatusLabel(post.status),
    targetStatuses: (post.targets || []).map((target) => socialStatusLabel(target.status || post.status)),
    needsReconciliation: post.status === "UNKNOWN" || post.targets?.some((target) => target.status === "UNKNOWN") || false,
  };
}

/** Product auto-links follow the selected product; manually edited links are preserved. */
export function updateSocialProductLink(target, productId, productUrl) {
  if (target.linkSource === "MANUAL") return { ...target };
  if (!productId || !productUrl || target.platform !== "FACEBOOK_PAGE") return { ...target, linkUrl: "", linkSource: "NONE" };
  return { ...target, linkUrl: productUrl, linkSource: "PRODUCT" };
}

export function socialProductLinkWarning(target, productUrl) {
  return target.linkSource === "MANUAL" && Boolean(target.linkUrl) && Boolean(productUrl) && target.linkUrl !== productUrl;
}

export function mergeSocialPage(current, incoming, append) {
  const rows = append ? [...current, ...incoming] : incoming;
  const unique = new Map();
  for (const row of rows) unique.set(row.id, row);
  return [...unique.values()];
}

export function socialUpdatedAtLabel(post) {
  return post.updatedAt || post.createdAt || null;
}
