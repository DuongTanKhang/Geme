import assert from "node:assert/strict";
import { test } from "node:test";
import { fromApiProduct, toApiProduct } from "../app/product-api-mapper.ts";

test("product API mapper preserves bangle variant identity, options, price, stock and media", () => {
  const apiProduct = {
    id: "product-1",
    sku: "NSBAMQ01",
    name: "Kiềng Aquamarine",
    kind: "JEWELRY",
    categoryId: "bangle-category",
    status: "ACTIVE",
    fullDescription: "Chi tiết đầy đủ",
    technicalImageUrl: null,
    price: 2_000_000,
    stock: 6,
    category: { id: "bangle-category", name: "Vòng Kiềng", slug: "vong-kieng", pricingMode: "QUALITY_AND_BEAD_SIZE" },
    images: [{ url: "https://cdn.example.test/product.webp" }],
    variants: [
      { id: "round-id", sku: "NSBAMQ01R02S54", shape: "ROUND", quality: "2A", beadSize: "54", carat: null, gemstoneQuality: null, price: 2_000_000, originalPrice: 2_200_000, stock: 2, imageUrls: [], videoUrl: null },
      { id: "oval-id", sku: "NSBAMQ01O03S56", shape: "OVAL", quality: "3A", beadSize: "56", carat: null, gemstoneQuality: "A", price: 2_500_000, originalPrice: null, stock: 3, imageUrls: ["https://cdn.example.test/oval.webp"], videoUrl: "https://cdn.example.test/oval.mp4" },
      { id: "square-id", sku: "NSBAMQ01SQ04S58", shape: "SQUARE", quality: "4A", beadSize: "58", carat: "1.25", gemstoneQuality: "AA", price: 3_000_000, originalPrice: null, stock: 1, imageUrls: [], videoUrl: null },
    ],
  };

  const frontend = fromApiProduct(apiProduct);
  assert.equal(frontend.detailsLoaded, true);
  assert.deepEqual(frontend.priceVariants.map(({ id, sku, shape, quality, beadSize, carat, gemstoneQuality, price, originalPrice, stock, imageUrls, videoUrl }) => ({ id, sku, shape, quality, beadSize, carat, gemstoneQuality, price, originalPrice, stock, imageUrls, videoUrl })), apiProduct.variants.map((variant) => ({ ...variant, carat: variant.carat == null ? null : Number(variant.carat), originalPrice: variant.originalPrice ?? undefined, gemstoneQuality: variant.gemstoneQuality ?? null, videoUrl: variant.videoUrl ?? null })));

  const payload = toApiProduct(frontend);
  assert.deepEqual(payload.priceVariants.map(({ id, sku, shape, quality, beadSize, carat, gemstoneQuality, price, originalPrice, imageUrls, videoUrl }) => ({ id, sku, shape, quality, beadSize, carat, gemstoneQuality, price, originalPrice, imageUrls, videoUrl })), apiProduct.variants.map(({ stock: _stock, ...variant }) => ({ ...variant, carat: variant.carat == null ? null : Number(variant.carat), originalPrice: variant.originalPrice ?? undefined, gemstoneQuality: variant.gemstoneQuality ?? null, videoUrl: variant.videoUrl ?? null })));
});

test("summary products are marked incomplete and never treated as full edit documents", () => {
  const summary = fromApiProduct({ id: "product-2", sku: "SKU2", status: "HIDDEN", adminSummary: true, variants: [{ id: "variant-2", sku: "SKU2", shape: "OVAL", quality: "A", beadSize: "52", price: 10, stock: 1 }] });
  assert.equal(summary.detailsLoaded, false);
  assert.equal(summary.priceVariants[0].shape, "OVAL");

  const storefrontList = fromApiProduct({
    id: "product-3", sku: "SKU3", status: "ACTIVE", name: "Kiềng tóm tắt",
    variants: [{ quality: "A", shape: "ROUND", beadSize: "52", carat: null, gemstoneQuality: null, price: 10 }],
  });
  assert.equal(storefrontList.detailsLoaded, false);
});
