import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { normalizeProductDraftPatch, normalizeProductDraftSubmission, verifiedLegacyProduct } from "./ai-product-agent.service.js";

const imageA = "0f8fad5b-d9cb-469f-a165-70867728950e";
const imageB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

test("normalizes unique approved-image IDs into an order-independent manifest", () => {
  const first = normalizeProductDraftSubmission({ imageItemIds: [imageA, imageB] }, "product-batch-key-1");
  const reversed = normalizeProductDraftSubmission({ imageItemIds: [imageB, imageA] }, "product-batch-key-2");
  assert.equal(first.manifestHash, reversed.manifestHash);
  assert.deepEqual(first.imageItemIds, [imageA, imageB]);
});

test("rejects duplicate, malformed, oversized, or unexpected batch input", () => {
  assert.throws(() => normalizeProductDraftSubmission({ imageItemIds: [imageA, imageA] }, "product-batch-key"), BadRequestException);
  assert.throws(() => normalizeProductDraftSubmission({ imageItemIds: ["../../orders"] }, "product-batch-key"), BadRequestException);
  assert.throws(() => normalizeProductDraftSubmission({ imageItemIds: [imageA], price: 1 }, "product-batch-key"), BadRequestException);
  assert.throws(() => normalizeProductDraftSubmission({ imageItemIds: Array(6).fill(imageA) }, "product-batch-key"), BadRequestException);
});

test("draft edit contract permits content only and rejects price, stock, and publishing fields", () => {
  assert.deepEqual(normalizeProductDraftPatch({ productName: "Nhẫn GEME", gemstoneSuggestion: null }), {
    productName: "Nhẫn GEME",
    gemstoneSuggestion: null,
  });
  assert.throws(() => normalizeProductDraftPatch({ price: 1000 }), BadRequestException);
  assert.throws(() => normalizeProductDraftPatch({ stock: 1 }), BadRequestException);
  assert.throws(() => normalizeProductDraftPatch({ status: "ACTIVE" }), BadRequestException);
  assert.throws(() => normalizeProductDraftPatch({ productName: "" }), BadRequestException);
});

test("legacy product facts are trusted only when an imported image carries an exact SKU and product ID", () => {
  assert.deepEqual(verifiedLegacyProduct({ source: "LEGACY_SQL", verifiedSku: "NSSREM043", verifiedProductId: imageA } as never), {
    sku: "NSSREM043",
    productId: imageA,
  });
  assert.equal(verifiedLegacyProduct({ source: "USER_INPUT", verifiedSku: "NSSREM043", verifiedProductId: imageA } as never), null);
  assert.equal(verifiedLegacyProduct({ source: "LEGACY_SQL", verifiedSku: "NSSREM043", verifiedProductId: "../product" } as never), null);
});
