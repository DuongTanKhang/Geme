import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { ADMIN_PERMISSION_DEFAULTS, ADMIN_PERMISSION_CATALOG, AdminPermissionService } from "./admin-permissions.js";

const identity = (id: string, role: string) => ({ id, email: `${id}@geme.test`, displayName: id, role });

test("admin role defaults keep access management and audit restricted", async () => {
  assert.ok(ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("catalog.write"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("access.manage"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("audit.read"));
  assert.deepEqual(ADMIN_PERMISSION_DEFAULTS.SUPER_ADMIN, ADMIN_PERMISSION_CATALOG);
});

test("permission overrides can narrow or add only catalogued permissions", async () => {
  const service = new AdminPermissionService({
    adminPermissionGrant: { findMany: async () => [
      { permission: "catalog.write", effect: "DENY" },
      { permission: "audit.read", effect: "ALLOW" },
      { permission: "made.up.permission", effect: "ALLOW" },
    ] },
  } as any);
  const effective = new Set(await service.getEffectivePermissions(identity("admin-1", "ADMIN")));
  assert.ok(!effective.has("catalog.write"));
  assert.ok(effective.has("catalog.read"));
  assert.ok(effective.has("audit.read"));
  assert.ok(!effective.has("made.up.permission"));
});

test("non-super-admin cannot grant an override outside their own effective permissions", async () => {
  let transactionStarted = false;
  const service = new AdminPermissionService({
    adminPermissionGrant: { findMany: async () => [] },
    adminUser: { findUnique: async () => ({ id: "admin-2", email: "admin-2@geme.test", displayName: "Admin 2", role: "ADMIN" }) },
    $transaction: async () => { transactionStarted = true; },
  } as any);
  await assert.rejects(
    service.replaceUserOverrides("admin-2", identity("admin-1", "ADMIN"), [{ permission: "audit.read", effect: "ALLOW" }]),
    ForbiddenException,
  );
  assert.equal(transactionStarted, false);
});

test("super-admin permission overrides remain immutable", async () => {
  const service = new AdminPermissionService({
    adminUser: { findUnique: async () => ({ id: "root", email: "root@geme.test", displayName: "Root", role: "SUPER_ADMIN" }) },
  } as any);
  await assert.rejects(
    service.replaceUserOverrides("root", identity("admin-1", "ADMIN"), []),
    ForbiddenException,
  );
});
