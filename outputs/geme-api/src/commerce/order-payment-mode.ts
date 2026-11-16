export type OrderPaymentModeInput = {
  storeSale: boolean;
  method: string;
  requestedQrPayment: boolean;
  requestedPaid: boolean;
};

/**
 * Keep payment intent separate from the sales channel.  A counter order can
 * legitimately wait for a customer to scan a transfer QR; it must not be
 * marked paid merely because it was created from Admin.
 */
export function getOrderPaymentFlags(input: OrderPaymentModeInput) {
  const qrPayment = input.method === "BANK_TRANSFER" && input.requestedQrPayment;
  const paid = input.storeSale && !qrPayment && (input.requestedPaid || input.method === "COD");
  return { qrPayment, paid };
}
