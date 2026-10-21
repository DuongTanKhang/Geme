import assert from "node:assert/strict";
import test from "node:test";
import { calculateCheckoutPrice, getCheckoutPromotionValue, type CheckoutPromotion } from "./checkout-pricing.js";

test("chooses highest eligible storefront percentage and honors product/category exclusions", () => {
  const product = { id: "p-1", categoryId: "category-child", gemstoneTypeId: null };
  const promotions: CheckoutPromotion[] = [
    { id: "category-sale", value: 12, productIds: [], categoryIds: ["category-child"], excludedProductIds: [], excludedCategoryIds: [] },
    { id: "product-sale", value: 25, productIds: ["p-1"], categoryIds: [], excludedProductIds: ["p-1"], excludedCategoryIds: [] },
    { id: "weaker-sale", value: 8, productIds: ["p-1"], categoryIds: [], excludedProductIds: [], excludedCategoryIds: [] },
  ];

  assert.equal(getCheckoutPromotionValue(product, promotions), 12);
});

test("applies promotion to selling price without using compare-at price as the discount base", () => {
  const result = calculateCheckoutPrice({ id: "p-1", kind: "JEWELRY", price: 1_000_000, originalPrice: 1_200_000 }, null, 15);

  assert.deepEqual(result, {
    listedUnitPrice: 1_000_000,
    saleUnitPrice: 850_000,
    compareAtUnitPrice: 1_200_000,
    promotionDiscountPerUnit: 150_000,
    promotionValue: 15,
  });
});

test("multiplies carat price before applying promotion", () => {
  const result = calculateCheckoutPrice(
    { id: "gem-1", kind: "GEMSTONE", category: { pricingMode: "GEMSTONE_CARAT" }, price: 0 },
    { price: 3_000_000, carat: 1.25 },
    20,
  );

  assert.equal(result.listedUnitPrice, 3_750_000);
  assert.equal(result.saleUnitPrice, 3_000_000);
  assert.equal(result.promotionDiscountPerUnit, 750_000);
});
