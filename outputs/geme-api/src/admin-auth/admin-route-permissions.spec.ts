import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_PERMISSION_KEY } from "./admin-permissions.js";
import { SocialController } from "../social/social.controller.js";
import { AdminCalendarController } from "../admin-calendar/admin-calendar.controller.js";
import { CommerceController } from "../commerce/commerce.controller.js";

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

test("Calendar API separates event reads from event management", () => {
  assert.deepEqual(permissions(AdminCalendarController, "today"), ["calendar.read"]);
  assert.deepEqual(permissions(AdminCalendarController, "list"), ["calendar.read"]);
  for (const method of ["create", "update", "remove"]) assert.deepEqual(permissions(AdminCalendarController, method), ["calendar.manage"]);
});

test("gross profit report requires finance read access", () => {
  assert.deepEqual(permissions(CommerceController, "grossProfitReport"), ["finance.read"]);
});
