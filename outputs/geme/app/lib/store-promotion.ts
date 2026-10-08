import type { StoreProduct, StorePromotion } from "./store-api";

export function getStoreProductPromotion(product: StoreProduct, promotions: StorePromotion[]) {
  const productId = String(product.id);
  const categoryIds = [product.categoryId, product.gemstoneTypeId, product.category?.id]
    .filter((id): id is string => Boolean(id))
    .map(String);
  const intersects = (values: string[] | undefined, targets: string[]) =>
    (values ?? []).some((value) => targets.includes(String(value)));

  return promotions
    .filter((promotion) => {
      const excluded = intersects(promotion.excludedProductIds, [productId])
        || intersects(promotion.excludedCategoryIds, categoryIds);
      const applicable = intersects(promotion.productIds, [productId])
        || intersects(promotion.categoryIds, categoryIds);
      return !excluded && applicable && Number(promotion.value) > 0;
    })
    .sort((a, b) => Number(b.value) - Number(a.value))[0];
}

export function formatStorePromotionPeriod(promotion: StorePromotion) {
  const zone = "Asia/Ho_Chi_Minh";
  const dateFormat = new Intl.DateTimeFormat("vi-VN", {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeFormat = new Intl.DateTimeFormat("vi-VN", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const partsFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const label = (value: string | null | undefined, boundary: "start" | "end") => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const timeParts = Object.fromEntries(partsFormat.formatToParts(date).map((part) => [part.type, part.value]));
    const isAllDayBoundary = boundary === "start"
      ? timeParts.hour === "00" && timeParts.minute === "00"
      : timeParts.hour === "23" && timeParts.minute === "59";
    return `${dateFormat.format(date)}${isAllDayBoundary ? "" : ` ${timeFormat.format(date)}`}`;
  };

  const start = label(promotion.startsAt, "start");
  const end = label(promotion.endsAt, "end");
  if (start && end) return `Thời gian: ${start} – ${end}`;
  if (start) return `Bắt đầu: ${start}`;
  if (end) return `Đến: ${end}`;
  return "";
}
