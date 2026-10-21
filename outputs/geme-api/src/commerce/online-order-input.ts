const ONLINE_PAYMENT_METHODS = new Set(["COD", "BANK_TRANSFER", "MOMO", "CREDIT_CARD"]);

/** Accept only checkout fields; all price, payment and sales-channel facts are server-owned. */
export function onlineOrderInput(body: Record<string, any>) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 30).map((line: Record<string, unknown>) => ({
    productId: typeof line?.productId === "string" ? line.productId.slice(0, 64) : "",
    variantId: typeof line?.variantId === "string" ? line.variantId.slice(0, 64) : undefined,
    sku: typeof line?.sku === "string" ? line.sku.slice(0, 64) : "",
    quantity: line?.quantity,
  })) : [];
  const paymentMethod = typeof body.paymentMethod === "string" && ONLINE_PAYMENT_METHODS.has(body.paymentMethod)
    ? body.paymentMethod
    : "COD";

  return {
    customerName: typeof body.customerName === "string" ? body.customerName.slice(0, 160) : "",
    phone: typeof body.phone === "string" ? body.phone.slice(0, 32) : "",
    email: typeof body.email === "string" ? body.email.slice(0, 320) : "",
    shippingAddress: typeof body.shippingAddress === "string" ? body.shippingAddress.slice(0, 1000) : "",
    note: typeof body.note === "string" ? body.note.slice(0, 2000) : "",
    paymentMethod,
    items,
    salesChannel: "ONLINE",
    channel: "ONLINE",
    paid: false,
    discountAmount: 0,
    shippingFee: 0,
    expectedTotalAmount: Number.isFinite(Number(body.expectedTotalAmount)) && Number(body.expectedTotalAmount) >= 0 ? Math.round(Number(body.expectedTotalAmount)) : undefined,
    shippingMethod: "Giao hàng",
  };
}
