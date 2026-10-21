import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { aggregateSocialStatus, approvedSnapshotHash, normalizeSocialTargets, parseHoChiMinhSchedule, safeGEMEUrl, socialPayloadHash } from "./social.contract.js";

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
  assert.equal(safeGEMEUrl("https://geme.vn/san-pham/nhan-emerald"), "https://geme.vn/san-pham/nhan-emerald");
  assert.throws(() => safeGEMEUrl("https://attacker.example/image.jpg"), BadRequestException);
  assert.throws(() => safeGEMEUrl("javascript:alert(1)"), BadRequestException);
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
