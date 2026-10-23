export function getInventoryReservationExpiry(
  paymentMethod: string,
  paid: boolean,
  now = new Date(),
  configuredTtl = process.env.ORDER_INVENTORY_RESERVATION_TTL_MINUTES,
) {
  // COD is settled on delivery, so it must remain reserved through fulfillment.
  if (paid || paymentMethod === "COD") return null;
  const configured = Number(configuredTtl);
  const minutes = Number.isInteger(configured) && configured >= 5 && configured <= 1440 ? configured : 30;
  return new Date(now.getTime() + minutes * 60_000);
}
