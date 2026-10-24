import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { AdminAuthGuard } from "./admin-auth.guard.js";

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "controller",
  } as any;
}

test("guard denies every authenticated role when a guarded route has no permission declaration and audits it", async () => {
  for (const role of ["ADMIN", "SUPER_ADMIN", "CONTENT_EDITOR"]) {
    const denied: unknown[][] = [];
    const guard = new AdminAuthGuard(
      { authenticateAuthorization: async () => ({ id: "admin-1", email: "admin@geme.test", displayName: "Admin", role }) } as any,
      { assertPermissions: async () => undefined, recordAuthorizationDenied: async (...args: unknown[]) => { denied.push(args); } } as any,
      { getAllAndOverride: () => undefined } as any,
    );
    await assert.rejects(guard.canActivate(context({
      headers: { authorization: "Bearer valid-token" }, route: { path: "/admin/unannotated" },
    })), ForbiddenException);
    assert.equal(denied.length, 1);
    assert.deepEqual(denied[0]?.[1], "/admin/unannotated");
    assert.deepEqual(denied[0]?.[2], []);
  }
});

test("guard authenticates explicitly declared empty permission routes and enforces declared permissions", async () => {
  let checked: string[] | undefined;
  const identity = { id: "editor-1", email: "editor@geme.test", displayName: "Editor", role: "CONTENT_EDITOR" };
  const guard = new AdminAuthGuard(
    { authenticateAuthorization: async () => identity } as any,
    { assertPermissions: async (_identity: unknown, permissions: string[]) => { checked = permissions; }, recordAuthorizationDenied: async () => undefined } as any,
    { getAllAndOverride: () => [] } as any,
  );
    const request: any = { headers: { authorization: "Bearer valid-token" } };
  assert.equal(await guard.canActivate(context(request)), true);
  assert.deepEqual(checked, []);
  assert.equal(request.adminIdentity, identity);

  const denied = new AdminAuthGuard(
    { authenticateAuthorization: async () => identity } as any,
    {
      assertPermissions: async () => { throw new ForbiddenException("Permission denied"); },
      recordAuthorizationDenied: async () => undefined,
    } as any,
    { getAllAndOverride: () => ["catalog.publish"] } as any,
  );
  await assert.rejects(denied.canActivate(context({ headers: { authorization: "Bearer valid-token" } })), ForbiddenException);
});

test("guard rejects anonymous requests before inspecting route permissions", async () => {
  const guard = new AdminAuthGuard(
    { authenticateAuthorization: async () => null } as any,
    { assertPermissions: async () => undefined, recordAuthorizationDenied: async () => undefined } as any,
    { getAllAndOverride: () => undefined } as any,
  );
  await assert.rejects(guard.canActivate(context({ headers: {} })), UnauthorizedException);
});
