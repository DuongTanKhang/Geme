import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { retrySerializationConflict } from "./commerce.service.js";

test("serialization retry stops at its configured bound with a clear conflict and no partial commit", async () => {
  let attempts = 0;
  let committedEffects = 0;
  await assert.rejects(() => retrySerializationConflict(async () => {
    attempts++;
    throw Object.assign(new Error("serialization failure"), { code: "P2034" });
  }, 3), (error: unknown) => error instanceof ConflictException && /giao dịch đã được hủy an toàn/i.test(error.message));
  assert.equal(attempts, 3);
  assert.equal(committedEffects, 0);
});

test("serialization retry reruns a rolled back operation and commits its effect only once", async () => {
  let attempts = 0;
  let committedEffects = 0;
  const result = await retrySerializationConflict(async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error("serialization failure"), { meta: { code: "40001" } });
    committedEffects++;
    return "committed";
  }, 3);
  assert.equal(result, "committed");
  assert.equal(attempts, 3);
  assert.equal(committedEffects, 1);
});
