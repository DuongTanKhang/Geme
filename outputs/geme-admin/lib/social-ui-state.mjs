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
