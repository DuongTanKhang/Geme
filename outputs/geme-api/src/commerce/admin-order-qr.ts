type QrOrder = {
  id: string;
  code: string;
  status: string;
  totalAmount: unknown;
  qrPaymentExpiresAt: Date | null;
  payments: Array<{ id?: string; method: string; status: string; amount: unknown; providerRef?: string | null; paidAt?: Date | null; recordedByAdminId?: string | null; recordingNote?: string | null; refunds?: Array<{ amount: unknown }> }>;
};

/** Read-only projection: viewing an existing QR never starts or extends its TTL. */
export function adminOrderQrSnapshot(order: QrOrder, now = new Date()) {
  const totalAmount = Number(order.totalAmount);
  const captured = order.payments
    .filter((payment) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const refundedAmount = order.payments.reduce((sum, payment) => sum + (payment.refunds ?? []).reduce((refundSum, refund) => refundSum + Number(refund.amount), 0), 0);
  const refunded = refundedAmount > 0 || order.payments.some((payment) => ["PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status));
  const paymentStatus = captured > 0 && refundedAmount >= captured ? "REFUNDED"
    : captured > 0 && captured >= totalAmount ? (refunded ? "PARTIALLY_REFUNDED" : "PAID")
    : captured > 0 ? "PARTIALLY_PAID"
    : order.payments.some((payment) => payment.status === "FAILED") && !order.payments.some((payment) => payment.status === "PENDING") ? "FAILED" : "PENDING";
  const deadline = order.qrPaymentExpiresAt?.getTime();
  const qrState = refunded ? "REFUNDED"
    : paymentStatus === "PAID" ? "PAID"
    : order.status === "CANCELLED" ? "CANCELLED"
    : captured > 0 ? "PARTIAL"
    : !order.payments.some((payment) => payment.method === "BANK_TRANSFER")
      || !["PENDING_PAYMENT", "PENDING_CONFIRMATION"].includes(order.status)
      || !Number.isSafeInteger(totalAmount) || totalAmount <= 0 || !Number.isFinite(deadline) ? "UNAVAILABLE"
    : deadline! <= now.getTime() ? "EXPIRED" : "READY";
  return {
    id: order.id, code: order.code, totalAmount, orderStatus: order.status,
    paymentStatus, paymentCaptured: captured, paymentRefunded: refundedAmount,
    paymentBalance: Math.max(0, totalAmount - captured), qrState,
    paymentEntries: order.payments.map((payment) => ({
      id: payment.id ?? "", method: payment.method, status: payment.status, amount: Number(payment.amount),
      providerRef: payment.providerRef ?? null, paidAt: payment.paidAt?.toISOString() ?? null,
      recordedByAdminId: payment.recordedByAdminId ?? null, recordingNote: payment.recordingNote ?? null,
      refundedAmount: (payment.refunds ?? []).reduce((sum, refund) => sum + Number(refund.amount), 0),
    })),
    paymentExpiresAt: Number.isFinite(deadline) ? order.qrPaymentExpiresAt!.toISOString() : null,
    serverNow: now.toISOString(),
  };
}
