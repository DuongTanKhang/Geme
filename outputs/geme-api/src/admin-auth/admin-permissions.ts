import { BadRequestException, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "./admin-auth.service.js";

export const ADMIN_PERMISSION_KEY = "geme.admin.permissions";
export const ADMIN_PERMISSION_CATALOG = [
  "dashboard.read",
  "catalog.read", "catalog.write",
  "content.read", "content.write",
  "orders.read", "orders.write",
  "customers.read", "customers.write",
  "inventory.read", "inventory.write",
  "returns.read", "returns.manage",
  "finance.read", "finance.manage",
  "audit.read", "access.manage",
  "settings.manage", "integrations.manage",
  "integrations.read", "shipping.read", "shipping.manage",
  "social.read", "social.manage", "ai-studio.read", "ai-studio.manage",
] as const;
export type AdminPermission = typeof ADMIN_PERMISSION_CATALOG[number];
export const RequireAdminPermissions = (...permissions: AdminPermission[]) => SetMetadata(ADMIN_PERMISSION_KEY, permissions);

const allForAdmin = ADMIN_PERMISSION_CATALOG.filter((permission) => permission !== "access.manage" && permission !== "audit.read");
export const ADMIN_PERMISSION_DEFAULTS: Record<string, readonly string[]> = {
  SUPER_ADMIN: ADMIN_PERMISSION_CATALOG,
  ADMIN: allForAdmin,
  CONTENT_EDITOR: ["dashboard.read", "catalog.read", "catalog.write", "content.read", "content.write", "social.read", "ai-studio.read"],
};

@Injectable()
export class AdminPermissionService {
  private readonly cache = new Map<string, { expiresAt: number; effective: Set<string>; grants: Array<{ permission: string; effect: string }> }>();

  async getEffectivePermissions(identity: AdminIdentity) {
    if (identity.role === "SUPER_ADMIN") return [...ADMIN_PERMISSION_CATALOG];
    const cached = this.cache.get(identity.id);
    if (cached && cached.expiresAt > Date.now()) return [...cached.effective];
    const grants = await this.prisma.adminPermissionGrant.findMany({ where: { adminId: identity.id }, select: { permission: true, effect: true } });
    const effective = new Set(ADMIN_PERMISSION_DEFAULTS[identity.role] || []);
    for (const grant of grants) {
      if (!ADMIN_PERMISSION_CATALOG.includes(grant.permission as AdminPermission)) continue;
      if (grant.effect === "ALLOW") effective.add(grant.permission);
      else if (grant.effect === "DENY") effective.delete(grant.permission);
    }
    this.cache.set(identity.id, { expiresAt: Date.now() + 5_000, effective, grants });
    return [...effective];
  }

  async assertPermissions(identity: AdminIdentity, required: readonly string[]) {
    const effective = new Set(await this.getEffectivePermissions(identity));
    const missing = required.filter((permission) => !effective.has(permission));
    if (missing.length) throw new ForbiddenException("Tài khoản chưa được cấp đủ quyền để thực hiện thao tác này.");
  }

  async recordAuthorizationDenied(identity: AdminIdentity, route: string, required: readonly string[]) {
    try {
      await this.prisma.auditLog.create({ data: {
        adminId: identity.id,
        action: "ADMIN_PERMISSION_DENIED",
        entityType: "ADMIN_API_ACCESS",
        entityId: route.replace(/[^A-Za-z0-9_/:.{}-]/g, "").slice(0, 80) || null,
        after: { requiredPermissions: [...required] },
      } });
    } catch {
      // Authorization must still fail closed if the audit store is temporarily unavailable.
    }
  }

  async listUsers() {
    return this.prisma.adminUser.findMany({
      select: { id: true, email: true, displayName: true, role: true, isActive: true, permissionGrants: { select: { permission: true, effect: true } } },
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
    });
  }

  async describeUser(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, displayName: true, role: true, isActive: true, permissionGrants: { select: { permission: true, effect: true } } },
    });
    if (!admin) return null;
    const permissions = await this.getEffectivePermissions({ id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role });
    return { ...admin, permissions };
  }

  async replaceUserOverrides(adminId: string, actor: AdminIdentity, input: unknown) {
    if (!Array.isArray(input) || input.length > ADMIN_PERMISSION_CATALOG.length) throw new BadRequestException("Danh sách quyền không hợp lệ.");
    const seen = new Set<string>();
    const grants = input.map((value) => {
      const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const permission = typeof row.permission === "string" ? row.permission : "";
      const effect = typeof row.effect === "string" ? row.effect.toUpperCase() : "";
      if (!ADMIN_PERMISSION_CATALOG.includes(permission as AdminPermission) || !["ALLOW", "DENY"].includes(effect) || seen.has(permission)) {
        throw new BadRequestException("Quyền được gửi lên không hợp lệ hoặc bị lặp.");
      }
      seen.add(permission);
      return { permission, effect };
    });
    const user = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true, email: true, displayName: true, role: true } });
    if (!user) return null;
    if (user.role === "SUPER_ADMIN") throw new ForbiddenException("Không thể thay đổi quyền mặc định của Super Admin.");
    if (actor.role !== "SUPER_ADMIN") {
      const actorPermissions = new Set(await this.getEffectivePermissions(actor));
      const outOfScope = grants.find((grant) => !actorPermissions.has(grant.permission));
      if (outOfScope) throw new ForbiddenException(`Bạn không thể cấp hoặc thu hồi quyền ${outOfScope.permission}.`);
    }
    const before = await this.prisma.adminPermissionGrant.findMany({ where: { adminId }, select: { permission: true, effect: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.adminPermissionGrant.deleteMany({ where: { adminId } });
      if (grants.length) await tx.adminPermissionGrant.createMany({ data: grants.map((grant) => ({ ...grant, adminId, grantedByAdminId: actor.id })) });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        action: "ADMIN_PERMISSIONS_REPLACED",
        entityType: "ADMIN_USER",
        entityId: adminId,
        before: before as any,
        after: grants as any,
      } });
    });
    this.cache.delete(adminId);
    return this.describeUser(adminId);
  }

  constructor(private readonly prisma: PrismaService) {}
}
