import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { normalizeMarketingEdits, normalizeMarketingSubmission, normalizeSalesSubmission, validateKnowledgeDocument } from "./ai-phase-four.contract.js";

test("Sales Agent replaces order and contact details before any AI payload is created", () => {
  const result = normalizeSalesSubmission({ question: "Tra cứu đơn hàng của tôi, số điện thoại 0912345678" });
  assert.equal(result.privateRequest, true);
  assert.equal(result.question.includes("0912345678"), false);
  assert.equal(result.question.includes("đơn hàng của tôi"), false);
  const orderReference = normalizeSalesSubmission({ question: "Kiểm tra giúp tôi GME-MV0N0T7R-24B7C đang giao tới đâu" });
  assert.equal(orderReference.privateRequest, true);
  assert.equal(orderReference.question.includes("GME-MV0N0T7R-24B7C"), false);
});

test("Sales budget must be a positive safe integer within the configured ceiling", () => {
  assert.equal(normalizeSalesSubmission({ question: "Tư vấn nhẫn Emerald", maxBudget: "5000000" }).maxBudget, 5_000_000);
  assert.throws(() => normalizeSalesSubmission({ question: "Tư vấn nhẫn", maxBudget: -1 }), BadRequestException);
});

test("Marketing submission constrains channel, products, and idempotency", () => {
  const result = normalizeMarketingSubmission({ channel: "instagram", objective: "Giới thiệu bộ sưu tập", productIds: ["123e4567-e89b-42d3-a456-426614174000"], keywords: ["opal"], callToAction: "Khám phá" }, "phase4-key-123");
  assert.equal(result.channel, "INSTAGRAM");
  assert.equal(result.productIds.length, 1);
  assert.throws(() => normalizeMarketingSubmission({ channel: "TIKTOK", objective: "Test", productIds: ["123e4567-e89b-42d3-a456-426614174000"] }, "phase4-key-123"), BadRequestException);
  assert.throws(() => normalizeMarketingSubmission({ channel: "BLOG", objective: "Test", productIds: [] }, "phase4-key-123"), BadRequestException);
});

test("Knowledge documents have stable keys, explicit sources, and ordered effective dates", () => {
  assert.throws(() => validateKnowledgeDocument({ documentKey: "Đổi trả", title: "Chính sách", topic: "Đổi trả", sourceLabel: "Nội bộ", content: "Điều khoản hợp lệ tối thiểu", effectiveFrom: "2026-10-20T00:00:00Z", expiresAt: "2026-10-19T00:00:00Z" }), BadRequestException);
  const value = validateKnowledgeDocument({ documentKey: "doi-tra", title: "Chính sách đổi trả", topic: "Đổi trả", sourceLabel: "Quy định cửa hàng", content: "Nội dung đã được GEME xác nhận." });
  assert.equal(value.documentKey, "doi-tra");
  assert.equal(value.effectiveFrom, null);
});

test("Marketing edits reject executable markup and bound metadata", () => {
  assert.throws(() => normalizeMarketingEdits({ body: "<script>alert(1)</script>" }), BadRequestException);
  assert.throws(() => normalizeMarketingEdits({ seoDescription: "x".repeat(321) }), BadRequestException);
  assert.deepEqual(normalizeMarketingEdits({ hashtags: ["#GEME", "#GEME", "Opal"] }).hashtags, ["GEME", "Opal"]);
});
