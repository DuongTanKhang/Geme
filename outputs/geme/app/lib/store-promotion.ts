import type { StoreProduct, StorePromotion, StoreVariant } from "./store-api";

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

/** Keep card, detail, cart and product schema prices aligned. A promotion is
 * applied to GEME's selling price; originalPrice is only a compare-at price. */
export function getStoreProductPrice(product: StoreProduct, promotions: StorePromotion[], variant?: StoreVariant | null) {
  const caratPricing = product.kind === "GEMSTONE"
    && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(product.category?.pricingMode || "");
  const multiplier = caratPricing && variant ? Math.max(0, Number(variant.carat) || 0) : 1;
  const listedPrice = Math.max(0, Math.round((Number(variant?.price ?? product.price) || 0) * multiplier));
  const configuredOriginalPrice = Math.max(0, Math.round((Number(variant?.originalPrice ?? product.originalPrice) || 0) * multiplier));
  const promotion = getStoreProductPromotion(product, promotions);
  const discountPercent = promotion ? Math.min(100, Math.max(0, Number(promotion.value) || 0)) : 0;
  const salePrice = discountPercent > 0 ? Math.max(0, Math.round(listedPrice * (1 - discountPercent / 100))) : listedPrice;
  const originalPrice = promotion
    ? Math.max(listedPrice, configuredOriginalPrice)
    : configuredOriginalPrice > salePrice ? configuredOriginalPrice : 0;
  const displayedDiscountPercent = discountPercent || (originalPrice > salePrice ? Math.round((1 - salePrice / originalPrice) * 100) : 0);
  return {
    listedPrice,
    salePrice,
    originalPrice,
    discountPercent: displayedDiscountPercent,
    promotion,
    promotionDiscount: Math.max(0, listedPrice - salePrice),
  };
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
