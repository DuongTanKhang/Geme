import assert from "node:assert/strict";
import test from "node:test";
import { canRegisterWithPrivacyPolicy } from "../app/lib/registration-policy.ts";

test("registration accepts only a published privacy policy with readable content", () => {
  assert.equal(canRegisterWithPrivacyPolicy({ slug: "bao-mat", title: "Bảo mật", status: "PUBLISHED", content: "Nội dung đã công bố" }), true);
  assert.equal(canRegisterWithPrivacyPolicy({ slug: "bao-mat", title: "Bảo mật", status: "DRAFT", content: "Bản nháp" }), false);
  assert.equal(canRegisterWithPrivacyPolicy({ slug: "bao-mat", title: "Bảo mật", status: "PUBLISHED", content: "  " }), false);
  assert.equal(canRegisterWithPrivacyPolicy({ slug: "mua-hang", title: "Mua hàng", status: "PUBLISHED", content: "Nội dung" }), false);
  assert.equal(canRegisterWithPrivacyPolicy(null), false);
});
