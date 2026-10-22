type ProductLike = {
  id: string;
  categoryId?: string | null;
  gemstoneTypeId?: string | null;
  kind?: string;
  price?: unknown;
  originalPrice?: unknown;
  category?: { pricingMode?: string | null } | null;
};

type VariantLike = {
  price?: unknown;
  originalPrice?: unknown;
  carat?: unknown;
} | null | undefined;

export type CheckoutPromotion = {
  id: string;
  value: unknown;
  productIds: string[];
  categoryIds: string[];
  excludedProductIds: string[];
  excludedCategoryIds: string[];
};

export async function loadActiveStorePromotions(client: any, now = new Date()): Promise<CheckoutPromotion[]> {
  const [promotions, categories] = await Promise.all([
    client.promotion.findMany({
      where: { visible: true, status: "ACTIVE", type: "PERCENTAGE", startsAt: { lte: now }, endsAt: { gte: now } },
      select: { id: true, value: true, targets: { select: { categoryId: true, productId: true, excluded: true } } },
      take: 500,
    }),
    client.category.findMany({ select: { id: true, parentId: true } }),
  ]) as [Array<{ id: string; value: unknown; targets: Array<{ categoryId: string | null; productId: string | null; excluded: boolean }> }>, Array<{ id: string; parentId: string | null }>];
  const descendantsOf = (roots: string[]) => {
    const ids = new Set(roots);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); changed = true; }
    }
    return [...ids];
  };
  return promotions.map((promotion) => {
    const included = promotion.targets.filter((target) => !target.excluded);
    const excluded = promotion.targets.filter((target) => target.excluded);
    return {
      id: promotion.id, value: Number(promotion.value) || 0,
      productIds: included.flatMap((target) => target.productId ? [target.productId] : []),
      categoryIds: descendantsOf(included.flatMap((target) => target.categoryId ? [target.categoryId] : [])),
      excludedProductIds: excluded.flatMap((target) => target.productId ? [target.productId] : []),
      excludedCategoryIds: descendantsOf(excluded.flatMap((target) => target.categoryId ? [target.categoryId] : [])),
    };
  }).filter((promotion) => Number(promotion.value) > 0);
}

const asPositiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function getCheckoutPromotionValue(product: ProductLike, promotions: CheckoutPromotion[]) {
  const categoryIds = [product.categoryId, product.gemstoneTypeId].filter((id): id is string => Boolean(id));
  let value = 0;
  for (const promotion of promotions) {
    const excluded = promotion.excludedProductIds.includes(product.id)
      || categoryIds.some((id) => promotion.excludedCategoryIds.includes(id));
    const included = promotion.productIds.includes(product.id)
      || categoryIds.some((id) => promotion.categoryIds.includes(id));
    if (included && !excluded) value = Math.max(value, Math.min(100, asPositiveNumber(promotion.value)));
  }
  return value;
}

/**
 * `price` is GEME's current selling price. Promotions apply to this amount;
 * `originalPrice` remains the compare-at value and must never raise the sale price.
 */
export function calculateCheckoutPrice(product: ProductLike, variant: VariantLike, promotionValue = 0) {
  const caratPricing = product.kind === "GEMSTONE"
    && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(product.category?.pricingMode || "");
  const multiplier = caratPricing && variant ? asPositiveNumber(variant.carat) : 1;
  const listedUnitPrice = Math.round(asPositiveNumber(variant?.price ?? product.price) * multiplier);
  const percent = Math.min(100, asPositiveNumber(promotionValue));
  const saleUnitPrice = percent > 0 ? Math.max(0, Math.round(listedUnitPrice * (1 - percent / 100))) : listedUnitPrice;
  const configuredOriginalPrice = asPositiveNumber(variant?.originalPrice ?? product.originalPrice);
  const compareAtUnitPrice = Math.max(listedUnitPrice, Math.round(configuredOriginalPrice * multiplier));
  return {
    listedUnitPrice,
    saleUnitPrice,
    compareAtUnitPrice: compareAtUnitPrice > saleUnitPrice ? compareAtUnitPrice : 0,
    promotionDiscountPerUnit: Math.max(0, listedUnitPrice - saleUnitPrice),
    promotionValue: percent,
  };
}
