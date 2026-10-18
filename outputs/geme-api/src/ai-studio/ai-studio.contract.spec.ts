import assert from "node:assert/strict";
import test from "node:test";
import { AiTaskInputError, normalizeAiTaskSubmission } from "./ai-studio.contract.js";

test("normalizes an allowed content task and requires an idempotency key", () => {
  assert.deepEqual(normalizeAiTaskSubmission({ type: "CONTENT_DRAFT", prompt: "  Viết mô tả bộ sưu tập  " }, "task-key-0001"), {
    type: "CONTENT_DRAFT",
    title: "Bản nháp nội dung",
    prompt: "Viết mô tả bộ sưu tập",
    idempotencyKey: "task-key-0001",
  });
});

test("rejects task payloads that could smuggle product, stock, price or order writes", () => {
  assert.throws(
    () => normalizeAiTaskSubmission({ type: "CONTENT_DRAFT", prompt: "Tạo mô tả", price: 1, stock: 100, orderId: "x" }, "task-key-0002"),
    AiTaskInputError,
  );
});

test("rejects unsupported task types and oversized prompts", () => {
  assert.throws(() => normalizeAiTaskSubmission({ type: "DELETE_ORDER", prompt: "Làm việc" }, "task-key-0003"), AiTaskInputError);
  assert.throws(() => normalizeAiTaskSubmission({ type: "CONTENT_DRAFT", prompt: "x".repeat(5001) }, "task-key-0004"), AiTaskInputError);
});

test("rejects missing or malformed idempotency keys", () => {
  assert.throws(() => normalizeAiTaskSubmission({ type: "IMAGE_GENERATION", prompt: "Tạo ảnh nền xám" }, undefined), AiTaskInputError);
  assert.throws(() => normalizeAiTaskSubmission({ type: "IMAGE_GENERATION", prompt: "Tạo ảnh nền xám" }, "short"), AiTaskInputError);
});
