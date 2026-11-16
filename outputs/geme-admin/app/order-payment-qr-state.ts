import type { BankQrSettings } from "./bank-qr";
import type { OrderReceiptData } from "./order-receipt-modal";

export type OrderQrSnapshot = {
  id: string;
  code: string;
  totalAmount: number;
  orderStatus: string;
  paymentStatus: string;
  paymentCaptured: number;
  paymentRefunded: number;
  paymentEntries: OrderReceiptData["paymentEntries"];
  paymentBalance: number;
  qrState: "READY" | "PAID" | "CANCELLED" | "EXPIRED" | "UNAVAILABLE" | "PARTIAL" | "REFUNDED";
  paymentExpiresAt: string | null;
  serverNow: string;
  bankQr: BankQrSettings | null;
};

// Anchor to the server clock, then advance with elapsed time (not the PC clock).
export function qrRemainingMs(snapshot: Pick<OrderQrSnapshot, "serverNow" | "paymentExpiresAt">, elapsedMs = 0): number | null {
  const deadline = snapshot.paymentExpiresAt ? Date.parse(snapshot.paymentExpiresAt) : NaN;
  const serverNow = Date.parse(snapshot.serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return null;
  return Math.max(0, deadline - serverNow - Math.max(0, elapsedMs));
}

export function canReopenOrderQr(order: { payment: string; paymentStatus: string; status: string; qrPaymentExpiresAt?: string | null }, now = Date.now()) {
  return order.payment === "BANK_TRANSFER" && order.paymentStatus === "PENDING"
    && ["Chờ thanh toán", "Chờ xác nhận"].includes(order.status)
    && Boolean(order.qrPaymentExpiresAt && Date.parse(order.qrPaymentExpiresAt) > now);
}
