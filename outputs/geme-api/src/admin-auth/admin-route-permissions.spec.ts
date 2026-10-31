import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AppModule } from "../app.module.js";
import { ADMIN_PERMISSION_KEY } from "./admin-permissions.js";
import { AiStudioModule } from "../ai-studio/ai-studio.module.js";
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

test("AI Studio API is not registered in the active Nest application", () => {
  const appImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
  assert.equal(appImports.includes(AiStudioModule), false);
});
