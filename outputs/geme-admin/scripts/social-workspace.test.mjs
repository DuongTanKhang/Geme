import assert from "node:assert/strict";
import test from "node:test";
import { mergeSocialPage, socialProductLinkWarning, socialUpdatedAtLabel, updateSocialProductLink } from "../lib/social-ui-state.mjs";

const facebook = { accountId: "page", platform: "FACEBOOK_PAGE", caption: "", linkUrl: "", linkSource: "NONE", mediaAssetId: "" };
const productA = "https://geme.vn/san-pham/a";
const productB = "https://geme.vn/san-pham/b";

test("switching product A to B refreshes a generated link to B", () => {
  const linkedA = updateSocialProductLink(facebook, "a", productA);
  assert.equal(linkedA.linkUrl, productA);
  assert.equal(linkedA.linkSource, "PRODUCT");
  const linkedB = updateSocialProductLink(linkedA, "b", productB);
  assert.equal(linkedB.linkUrl, productB);
  assert.equal(linkedB.linkSource, "PRODUCT");
  assert.equal(socialProductLinkWarning(linkedB, productB), false);
});

test("manual link survives product changes and warns when it points elsewhere", () => {
  const manual = { ...facebook, linkUrl: "https://geme.vn/san-pham/custom", linkSource: "MANUAL" };
  const retained = updateSocialProductLink(manual, "b", productB);
  assert.equal(retained.linkUrl, manual.linkUrl);
  assert.equal(retained.linkSource, "MANUAL");
  assert.equal(socialProductLinkWarning(retained, productB), true);
});

test("removing product clears an auto-link but preserves a manually entered link", () => {
  assert.deepEqual(updateSocialProductLink({ ...facebook, linkUrl: productA, linkSource: "PRODUCT" }, "", ""), { ...facebook, linkUrl: "", linkSource: "NONE" });
  const manual = { ...facebook, linkUrl: "https://geme.vn/san-pham/custom", linkSource: "MANUAL" };
  assert.deepEqual(updateSocialProductLink(manual, "", ""), manual);
});

test("server page merge avoids duplicates and updated label uses updatedAt", () => {
  const old = [{ id: "1", revision: 1 }, { id: "2", revision: 1 }];
  const merged = mergeSocialPage(old, [{ id: "2", revision: 2 }, { id: "3", revision: 1 }], true);
  assert.deepEqual(merged.map((row) => row.id), ["1", "2", "3"]);
  assert.equal(merged[1].revision, 2);
  assert.equal(socialUpdatedAtLabel({ createdAt: "created", updatedAt: "updated" }), "updated");
  assert.equal(socialUpdatedAtLabel({ createdAt: "created" }), "created");
});
