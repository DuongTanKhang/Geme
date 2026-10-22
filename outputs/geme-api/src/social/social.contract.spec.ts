import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { aggregateSocialStatus, approvedSnapshotHash, normalizeSocialTargets, parseHoChiMinhSchedule, safeGEMEUrl, socialCommerceSnapshot, socialCommerceSnapshotHash, socialPayloadHash, unknownRetryEligible } from "./social.contract.js";

const accountId = "123e4567-e89b-42d3-a456-426614174000";
const assetId = "123e4567-e89b-42d3-a456-426614174001";

test("manual drafts may exist before Meta is configured, but cannot be approved without an account", () => {
  const targets = normalizeSocialTargets([{ platform: "FACEBOOK_PAGE", caption: "Bộ sưu tập mới", accountId: null }]);
  assert.equal(targets[0].accountId, null);
  assert.throws(() => normalizeSocialTargets([{ platform: "INSTAGRAM", caption: "", accountId: null }]), BadRequestException);
  assert.throws(() => normalizeSocialTargets([{ platform: "TIKTOK", caption: "nội dung" }]), BadRequestException);
});

test("Instagram target requires one image and account duplication is rejected", () => {
  const instagram = normalizeSocialTargets([{ accountId, platform: "INSTAGRAM", caption: "Vẻ đẹp tự nhiên", mediaAssetId: assetId }]);
  assert.equal(instagram[0].mediaAssetId, assetId);
  assert.throws(() => normalizeSocialTargets([{ accountId, platform: "INSTAGRAM", caption: "Thiếu ảnh" }]), BadRequestException);
  assert.throws(() => normalizeSocialTargets([{ accountId, platform: "FACEBOOK_PAGE", caption: "Một" }, { accountId, platform: "FACEBOOK_PAGE", caption: "Hai" }]), BadRequestException);
});

test("product links are restricted to the configured HTTPS GEME origin", () => {
  const originalSiteUrl = process.env.GEME_SITE_URL;
  process.env.GEME_SITE_URL = "https://geme.vn";
  try {
    assert.equal(safeGEMEUrl("https://geme.vn/san-pham/nhan-emerald"), "https://geme.vn/san-pham/nhan-emerald");
    assert.throws(() => safeGEMEUrl("https://attacker.example/image.jpg"), BadRequestException);
    assert.throws(() => safeGEMEUrl("javascript:alert(1)"), BadRequestException);
  } finally {
    if (originalSiteUrl === undefined) delete process.env.GEME_SITE_URL;
    else process.env.GEME_SITE_URL = originalSiteUrl;
  }
});

test("product-generated links defer URL authority to the server product lookup", () => {
  const targets = normalizeSocialTargets([{ accountId: null, platform: "FACEBOOK_PAGE", caption: "GEME", linkUrl: "", linkSource: "PRODUCT" }]);
  assert.equal(targets[0].linkSource, "PRODUCT");
  assert.equal(targets[0].linkUrl, null);
  assert.throws(() => normalizeSocialTargets([{ platform: "INSTAGRAM", caption: "GEME", mediaAssetId: assetId, linkSource: "PRODUCT" }]), BadRequestException);
});

test("commerce snapshots use checkout sale-price math and change when listed price changes", () => {
  const product = { id: "product-1", sku: "GEME-1", name: "Nhẫn", price: 1_000_000, originalPrice: 1_200_000, kind: "JEWELRY", categoryId: "category-1", gemstoneTypeId: null, category: { pricingMode: "FIXED" } };
  const promotion = { id: "promo-1", value: 10, productIds: ["product-1"], categoryIds: [], excludedProductIds: [], excludedCategoryIds: [] };
  const approved = socialCommerceSnapshot(product, null, [promotion]);
  assert.equal(approved.saleUnitPrice, 900_000);
  assert.equal(approved.compareAtUnitPrice, 1_200_000);
  const current = socialCommerceSnapshot({ ...product, price: 1_100_000 }, null, [promotion]);
  assert.notEqual(socialCommerceSnapshotHash(approved), socialCommerceSnapshotHash(current));
  assert.equal(socialCommerceSnapshotHash(approved), socialCommerceSnapshotHash({ ...approved, checkedAt: "different-time" }));
});

test("UNKNOWN retry requires same approved revision, explicit reconciliation, and duplicate-risk acknowledgment", () => {
  const eligible = { targetStatus: "UNKNOWN", postRevision: 4, targetApprovedRevision: 4, postApprovedRevision: 4, latestDecision: "UNRESOLVED", acknowledgeDuplicateRisk: true };
  assert.equal(unknownRetryEligible(eligible), true);
  assert.equal(unknownRetryEligible({ ...eligible, acknowledgeDuplicateRisk: false }), false);
  assert.equal(unknownRetryEligible({ ...eligible, latestDecision: "RETRY_AUTHORIZED" }), false);
  assert.equal(unknownRetryEligible({ ...eligible, postRevision: 5 }), false);
  assert.equal(unknownRetryEligible({ ...eligible, targetStatus: "PUBLISHED" }), false);
});

test("approved payload hashes change when the channel copy or selected asset changes", () => {
  const one = { accountId, platform: "INSTAGRAM" as const, caption: "Emerald", linkUrl: null, mediaAssetId: assetId };
  assert.notEqual(socialPayloadHash(one), socialPayloadHash({ ...one, caption: "Đá quý Emerald" }));
  assert.notEqual(socialPayloadHash(one), socialPayloadHash({ ...one, mediaAssetId: null }));
  assert.notEqual(approvedSnapshotHash([one]), approvedSnapshotHash([{ ...one, accountId: "123e4567-e89b-42d3-a456-426614174002" }]));
});

test("aggregate status preserves partial success and unknown outcomes", () => {
  assert.equal(aggregateSocialStatus(["PUBLISHED", "FAILED"]), "PARTIAL");
  assert.equal(aggregateSocialStatus(["PUBLISHED", "UNKNOWN"]), "UNKNOWN");
  assert.equal(aggregateSocialStatus(["PUBLISHED", "PUBLISHED"]), "PUBLISHED");
});

test("naive schedule date-time is interpreted in Asia/Ho_Chi_Minh", () => {
  const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const future = `${futureDate.getUTCFullYear()}-${String(futureDate.getUTCMonth() + 1).padStart(2, "0")}-${String(futureDate.getUTCDate()).padStart(2, "0")}T09:00`;
  const result = parseHoChiMinhSchedule(future);
  assert.ok(result);
  assert.equal(result!.getUTCHours(), 2);
  assert.throws(() => parseHoChiMinhSchedule("2027-01-01 09:00:00"), BadRequestException);
});
