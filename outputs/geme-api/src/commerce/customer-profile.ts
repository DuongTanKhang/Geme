type OrderCustomerSnapshot = {
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  shippingAddress?: string | null;
};

/** Create or reuse a GEME customer only after an order has been paid. */
export async function ensureCustomerForPaidOrder(tx: any, order: OrderCustomerSnapshot) {
  if (order.customerId) {
    const linked = await tx.customer.findUnique({ where: { id: order.customerId } });
    if (!linked) return null;
    const linkedDigits = String(order.customerPhone || "").replace(/\D/g, "");
    const linkedPhone = linkedDigits.startsWith("84") && linkedDigits.length >= 10 ? `0${linkedDigits.slice(2)}` : linkedDigits || null;
    const linkedEmail = String(order.customerEmail || "").trim().toLowerCase() || null;
    const linkedAddress = String(order.shippingAddress || "").trim() || null;
    if (!linkedPhone && !linkedEmail && !linkedAddress) return linked;
    return tx.customer.update({
      where: { id: linked.id },
      data: {
        phone: linked.phone || linkedPhone,
        email: linked.email || linkedEmail,
        defaultAddress: linkedAddress || linked.defaultAddress,
      },
    });
  }

  const name = String(order.customerName || "").trim();
  const digits = String(order.customerPhone || "").replace(/\D/g, "");
  const phone = digits.startsWith("84") && digits.length >= 10 ? `0${digits.slice(2)}` : digits || null;
  const email = String(order.customerEmail || "").trim().toLowerCase() || null;
  const address = String(order.shippingAddress || "").trim() || null;
  if (!name || (!phone && !email)) return null;

  const byPhone = phone ? await tx.customer.findUnique({ where: { phone } }) : null;
  const byEmail = email ? await tx.customer.findUnique({ where: { email } }) : null;
  const existing = byPhone || byEmail;
  if (existing) {
    const emailBelongsToAnotherCustomer = Boolean(byEmail && byEmail.id !== existing.id);
    return tx.customer.update({
      where: { id: existing.id },
      data: {
        name,
        phone: existing.phone || phone,
        email: emailBelongsToAnotherCustomer ? existing.email : existing.email || email,
        defaultAddress: address || existing.defaultAddress,
      },
    });
  }

  return tx.customer.create({
    data: { name, phone, email, defaultAddress: address, status: "ACTIVE", segment: "Khách mới" },
  });
}
