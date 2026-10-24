import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { ADMIN_PERMISSION_DEFAULTS, ADMIN_PERMISSION_CATALOG, AdminPermissionService } from "./admin-permissions.js";

const identity = (id: string, role: string) => ({ id, email: `${id}@geme.test`, displayName: id, role });

function mockPrisma(users: Array<Record<string, any>>, initial: Record<string, Array<{ permission: string; effect: string }>> = {}) {
  const byId = new Map(users.map((user) => [user.id, { isActive: true, ...user }]));
  const grants = new Map(Object.entries(initial));
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    adminUser: { findUnique: async ({ where }: any) => byId.get(where.id) || null },
    adminPermissionGrant: {
      findMany: async ({ where }: any) => (grants.get(where.adminId) || []).map((row) => ({ ...row })),
      deleteMany: async ({ where }: any) => { grants.set(where.adminId, []); writes++; return { count: 0 }; },
      createMany: async ({ data }: any) => { grants.set(data.map((row: any) => ({ permission: row.permission, effect: row.effect }))); writes++; return { count: data.length }; },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    ...tx,
    $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
  };
  return { prisma, writes: () => writes, grants };
}

test("admin defaults keep access and audit restricted; content editors cannot change price or publish", () => {
  assert.ok(ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("catalog.write"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("access.manage"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.ADMIN.includes("audit.read"));
  assert.ok(ADMIN_PERMISSION_DEFAULTS.CONTENT_EDITOR.includes("catalog.content.write"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.CONTENT_EDITOR.includes("catalog.write"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.CONTENT_EDITOR.includes("catalog.price.write"));
  assert.ok(!ADMIN_PERMISSION_DEFAULTS.CONTENT_EDITOR.includes("catalog.publish"));
  assert.deepEqual(ADMIN_PERMISSION_DEFAULTS.SUPER_ADMIN, ADMIN_PERMISSION_CATALOG);
});

test("effective permission changes are visible immediately after a grant update", async () => {
  const store = mockPrisma([{ id: "admin-1", email: "a@geme.test", displayName: "A", role: "ADMIN" }]);
  const service = new AdminPermissionService(store.prisma as any);
  assert.ok((await service.getEffectivePermissions(identity("admin-1", "ADMIN"))).includes("catalog.write"));
  store.grants.set("admin-1", [{ permission: "catalog.write", effect: "DENY" }]);
  assert.ok(!(await service.getEffectivePermissions(identity("admin-1", "ADMIN"))).includes("catalog.write"));
});

test("removing a DENY cannot restore a default permission outside the actor scope", async () => {
  const store = mockPrisma([
    { id: "actor", email: "actor@geme.test", displayName: "Actor", role: "CONTENT_EDITOR" },
    { id: "target", email: "target@geme.test", displayName: "Target", role: "ADMIN" },
  ], { target: [{ permission: "catalog.publish", effect: "DENY" }] });
  const service = new AdminPermissionService(store.prisma as any);
  await assert.rejects(service.replaceUserOverrides("target", identity("actor", "CONTENT_EDITOR"), []), ForbiddenException);
  assert.equal(store.writes(), 0);
  assert.ok(store.grants.get("target")?.some((grant) => grant.permission === "catalog.publish" && grant.effect === "DENY"));
});

test("non-super-admin cannot add an out-of-scope permission", async () => {
  const store = mockPrisma([
    { id: "actor", email: "actor@geme.test", displayName: "Actor", role: "CONTENT_EDITOR" },
    { id: "target", email: "target@geme.test", displayName: "Target", role: "CONTENT_EDITOR" },
  ]);
  const service = new AdminPermissionService(store.prisma as any);
  await assert.rejects(service.replaceUserOverrides("target", identity("actor", "CONTENT_EDITOR"), [{ permission: "finance.manage", effect: "ALLOW" }]), ForbiddenException);
  assert.equal(store.writes(), 0);
});

test("super-admin permission overrides remain immutable", async () => {
  const store = mockPrisma([
    { id: "actor", email: "actor@geme.test", displayName: "Actor", role: "ADMIN" },
    { id: "root", email: "root@geme.test", displayName: "Root", role: "SUPER_ADMIN" },
  ]);
  const service = new AdminPermissionService(store.prisma as any);
  await assert.rejects(service.replaceUserOverrides("root", identity("actor", "ADMIN"), []), ForbiddenException);
});
