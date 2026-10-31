export type CommerceOrderStatus = "PENDING_PAYMENT" | "PENDING_CONFIRMATION" | "PROCESSING" | "SHIPPING" | "DELIVERED" | "CANCELLED";

const allowedTransitions: Record<CommerceOrderStatus, readonly CommerceOrderStatus[]> = {
  PENDING_PAYMENT: ["PENDING_CONFIRMATION", "CANCELLED"],
  PENDING_CONFIRMATION: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPING", "CANCELLED"],
  // Once handed to delivery, cancellation would incorrectly restore stock.
  // Resolve carrier returns through a return workflow instead.
  SHIPPING: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** The same state is an idempotent no-op; transitions never move backwards. */
export function canTransitionOrder(current: string, next: string, source: "ADMIN" | "CARRIER" = "ADMIN") {
  if (current === next) return true;
  if (source === "CARRIER" && current === "PROCESSING" && next === "DELIVERED") return true;
  return Object.hasOwn(allowedTransitions, current)
    && allowedTransitions[current as CommerceOrderStatus].includes(next as CommerceOrderStatus);
}

export function isOrderStateTerminal(status: string) {
  return status === "DELIVERED" || status === "CANCELLED";
}
