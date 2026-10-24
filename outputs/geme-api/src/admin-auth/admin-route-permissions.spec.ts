import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_PERMISSION_KEY } from "./admin-permissions.js";
import { AiStudioController } from "../ai-studio/ai-studio.controller.js";
import { SocialController } from "../social/social.controller.js";

function permissions(controller: Function, method: string) {
  const handler = (controller as any).prototype[method];
  return Reflect.getMetadata(ADMIN_PERMISSION_KEY, handler);
}

test("Social API separates drafting, approval, publishing, and Meta connection permissions", () => {
  assert.deepEqual(Reflect.getMetadata(ADMIN_PERMISSION_KEY, SocialController), ["social.read"]);
  for (const method of ["authorize", "selectAccounts", "disconnect"]) assert.deepEqual(permissions(SocialController, method), ["social.connect"]);
  for (const method of ["createPost", "updatePost"]) assert.deepEqual(permissions(SocialController, method), ["social.draft"]);
  assert.deepEqual(permissions(SocialController, "approve"), ["social.approve"]);
  for (const method of ["publishNow", "retryFailed", "verifyTarget", "reconcileTarget", "retryUnknown", "cancel", "reschedule"]) {
    assert.deepEqual(permissions(SocialController, method), ["social.publish"]);
  }
});

test("AI Studio API separates draft work, approval, and product-writing side effects", () => {
  assert.deepEqual(Reflect.getMetadata(ADMIN_PERMISSION_KEY, AiStudioController), ["ai-studio.read"]);
  for (const method of ["createTask", "cancelTask", "createImageBatch", "uploadImage", "retryImage", "uploadProductAgentImages", "createProductDraftBatch", "updateProductDraft", "cancelProductDraft", "retryProductDraft", "salesAnswer", "createSalesKnowledge", "createSalesKnowledgeRevision", "createMarketingDraft", "updateMarketingDraft", "retryMarketingDraft"]) {
    assert.deepEqual(permissions(AiStudioController, method), ["ai-studio.draft"], method);
  }
  for (const method of ["approve", "reject", "approveImage", "rejectImage", "bulkDecideProductDrafts", "approveProductDraft", "rejectProductDraft", "activateSalesKnowledge", "archiveSalesKnowledge", "approveMarketingDraft", "rejectMarketingDraft"]) {
    assert.deepEqual(permissions(AiStudioController, method), ["ai-studio.approve"], method);
  }
  assert.deepEqual(permissions(AiStudioController, "attachImage"), ["ai-studio.approve", "catalog.content.write"]);
  assert.deepEqual(permissions(AiStudioController, "attachTechnicalDrawing"), ["ai-studio.approve", "catalog.content.write"]);
  assert.deepEqual(permissions(AiStudioController, "attachProductDraft"), ["ai-studio.approve", "catalog.content.write"]);
});
