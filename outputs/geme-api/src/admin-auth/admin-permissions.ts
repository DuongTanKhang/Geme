import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, SetMetadata } from "@nestjs/common";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "./admin-auth.service.js";

export const ADMIN_PERMISSION_KEY = "geme.admin.permissions";
export const ADMIN_PERMISSION_CATALOG = [
  "dashboard.read",
  "catalog.read", "catalog.write", "catalog.content.write", "catalog.price.write", "catalog.publish", "catalog.delete",
  "content.read", "content.write",
  "promotions.read", "promotions.write",
  "orders.read", "orders.write",
  "customers.read", "customers.write",
  "inventory.read", "inventory.write",
  "returns.read", "returns.manage",
  "finance.read", "finance.manage",
  "audit.read", "access.manage",
  "settings.manage", "integrations.manage",
  "integrations.read", "shipping.read", "shipping.manage",
  "social.read", "social.draft", "social.approve", "social.publish", "social.connect", "social.manage",
  "ai-studio.read", "ai-studio.draft", "ai-studio.approve", "ai-studio.manage",
  "contacts.read", "contacts.manage",
] as const;
export type AdminPermission = typeof ADMIN_PERMISSION_CATALOG[number];
export const RequireAdminPermissions = (...permissions: AdminPermission[]) => SetMetadata(ADMIN_PERMISSION_KEY, permissions);

const allForAdmin = ADMIN_PERMISSION_CATALOG;
export const ADMIN_PERMISSION_DEFAULTS: Record<string, readonly string[]> = {
  SUPER_ADMIN: ADMIN_PERMISSION_CATALOG,
  ADMIN: allForAdmin,
  CONTENT_EDITOR: ["dashboard.read", "catalog.read", "catalog.content.write", "content.read", "content.write", "social.read", "social.draft", "ai-studio.read", "ai-studio.draft"],
  STAFF: [],
};

export const ADMIN_PAGE_ACCESS_CATALOG = [
  { id: "overview", label: "Tổng quan", permissions: ["dashboard.read"] },
  { id: "operations", label: "Vận hành & đối soát", permissions: ["returns.read", "finance.read", "audit.read"] },
  { id: "orders", label: "Đơn hàng", permissions: ["orders.read", "orders.write"] },
  { id: "shipping", label: "Quản lý giao hàng", permissions: ["shipping.read", "shipping.manage"] },
  { id: "products", label: "Sản phẩm", permissions: ["catalog.read", "catalog.write", "catalog.content.write", "catalog.price.write", "catalog.publish", "catalog.delete"] },
  { id: "customers", label: "Khách hàng", permissions: ["customers.read", "customers.write"] },
  { id: "contacts", label: "Tin nhắn liên hệ", permissions: ["contacts.read", "contacts.manage"] },
  { id: "promotions", label: "Khuyến mãi", permissions: ["promotions.read", "promotions.write"] },
  { id: "posts", label: "Bài viết / Blog", permissions: ["content.read", "content.write"] },
  { id: "social", label: "Mạng xã hội", permissions: ["social.read", "social.draft", "social.approve", "social.publish", "social.connect"] },
  { id: "shopee", label: "Shopee", permissions: ["integrations.read", "integrations.manage"] },
  { id: "inventory", label: "Quản lý tồn kho", permissions: ["inventory.read", "inventory.write"] },
  { id: "banners", label: "Banner & Footer", permissions: ["settings.manage"] },
  { id: "reports", label: "Báo cáo", permissions: ["dashboard.read"] },
  { id: "settings", label: "Cài đặt", permissions: ["settings.manage"] },
  { id: "access", label: "Vai trò & quyền truy cập", permissions: ["access.manage"] },
] as const;
export const ADMIN_STAFF_ROLE_SUGGESTIONS = [
  { id: "sales", label: "Nhân viên bán hàng", pages: ["overview", "orders", "customers"] },
  { id: "operations", label: "Nhân viên vận hành", pages: ["overview", "operations", "orders", "shipping", "inventory"] },
  { id: "products", label: "Nhân viên quản lý sản phẩm", pages: ["overview", "products", "inventory"] },
  { id: "content", label: "Nhân viên nội dung", pages: ["overview", "posts", "social"] },
  { id: "custom", label: "Tùy chỉnh", pages: [] },
] as const;

@Injectable()
export class AdminPermissionService {
  async getEffectivePermissions(identity: AdminIdentity) {
    if (identity.role === "SUPER_ADMIN") return [...ADMIN_PERMISSION_CATALOG];
    const grants = await this.prisma.adminPermissionGrant.findMany({ where: { adminId: identity.id }, select: { permission: true, effect: true } });
    return [...this.effectiveSet(identity.role, grants)];
  }

  private effectiveSet(role: string, grants: Array<{ permission: string; effect: string }>) {
    const effective = new Set(ADMIN_PERMISSION_DEFAULTS[role] || []);
    const denied = new Set<string>();
    for (const grant of grants) {
      if (!ADMIN_PERMISSION_CATALOG.includes(grant.permission as AdminPermission)) continue;
      if (grant.effect === "ALLOW") effective.add(grant.permission);
      else if (grant.effect === "DENY") {
        effective.delete(grant.permission);
        denied.add(grant.permission);
      }
    }
    if (effective.has("social.manage")) for (const permission of ["social.draft", "social.approve", "social.publish", "social.connect"]) if (!denied.has(permission)) effective.add(permission);
    if (effective.has("ai-studio.manage")) for (const permission of ["ai-studio.draft", "ai-studio.approve"]) if (!denied.has(permission)) effective.add(permission);
    return effective;
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
        correlationId: identity.correlationId,
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
      select: { id: true, email: true, username: true, displayName: true, jobTitle: true, role: true, isActive: true, permissionGrants: { select: { permission: true, effect: true } } },
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
    });
  }

  async describeUser(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, username: true, displayName: true, jobTitle: true, role: true, isActive: true, permissionGrants: { select: { permission: true, effect: true } } },
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
    const saved = await this.prisma.$transaction(async (tx) => {
      // Serialize edits to both the target and actor so concurrent role changes cannot
      // make an out-of-scope override effective between validation and save.
      await tx.$queryRaw`SELECT "id" FROM "admin_users" WHERE "id" IN (${actor.id}::uuid, ${adminId}::uuid) ORDER BY "id" FOR UPDATE`;
      const [user, actorUser] = await Promise.all([
        tx.adminUser.findUnique({ where: { id: adminId }, select: { id: true, email: true, displayName: true, role: true, isActive: true } }),
        tx.adminUser.findUnique({ where: { id: actor.id }, select: { id: true, email: true, displayName: true, role: true, isActive: true } }),
      ]);
      if (!user) return null;
      if (!actorUser?.isActive) throw new ForbiddenException("Tài khoản thực hiện thao tác không còn hoạt động.");
      if (user.role === "SUPER_ADMIN") throw new ForbiddenException("Không thể thay đổi quyền mặc định của Super Admin.");
      const actorGrants = await tx.adminPermissionGrant.findMany({ where: { adminId: actor.id }, select: { permission: true, effect: true } });
      const actorPermissions = actorUser.role === "SUPER_ADMIN" ? new Set<string>(ADMIN_PERMISSION_CATALOG) : this.effectiveSet(actorUser.role, actorGrants);
      const before = await tx.adminPermissionGrant.findMany({ where: { adminId }, select: { permission: true, effect: true } });
      const after = grants;
      const beforeEffective = this.effectiveSet(user.role, before);
      const afterEffective = this.effectiveSet(user.role, after);
      if (actorUser.role !== "SUPER_ADMIN") {
        const changed = ADMIN_PERMISSION_CATALOG.filter((permission) => beforeEffective.has(permission) !== afterEffective.has(permission));
        const outOfScope = changed.find((permission) => !actorPermissions.has(permission));
        if (outOfScope) throw new ForbiddenException(`Bạn không thể cấp hoặc thu hồi quyền ${outOfScope}.`);
      }
      await tx.adminPermissionGrant.deleteMany({ where: { adminId } });
      if (grants.length) await tx.adminPermissionGrant.createMany({ data: grants.map((grant) => ({ ...grant, adminId, grantedByAdminId: actor.id })) });
      await tx.adminUser.update({ where: { id: adminId }, data: { authVersion: { increment: 1 } } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: "ADMIN_PERMISSIONS_REPLACED",
        entityType: "ADMIN_USER",
        entityId: adminId,
        before: before as any,
        after: grants as any,
      } });
      return user;
    });
    if (!saved) return null;
    return this.describeUser(adminId);
  }

  async createStaffAccount(actor: AdminIdentity, input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const username = typeof body.account === "string" ? body.account.trim().toLowerCase() : "";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new BadRequestException("Tài khoản cần 3–40 ký tự, bắt đầu bằng chữ/số và chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.");
    if (!jobTitle || jobTitle.length > 80) throw new BadRequestException("Vui lòng chọn vai trò hợp lệ (tối đa 80 ký tự).");
    if (password.length < 12 || password.length > 256) throw new BadRequestException("Mật khẩu cần từ 12 đến 256 ký tự.");
    if (!Array.isArray(body.pages) || body.pages.length > ADMIN_PAGE_ACCESS_CATALOG.length) throw new BadRequestException("Danh sách trang được cấp quyền không hợp lệ.");
    const pageIds = body.pages;
    if (pageIds.some((page) => typeof page !== "string" || !ADMIN_PAGE_ACCESS_CATALOG.some((entry) => entry.id === page)) || new Set(pageIds).size !== pageIds.length) {
      throw new BadRequestException("Danh sách trang được cấp quyền có mục không hợp lệ hoặc bị lặp.");
    }
    const requestedPermissions = new Set<string>(ADMIN_PAGE_ACCESS_CATALOG.filter((page) => pageIds.includes(page.id)).flatMap((page) => page.permissions));
    const actorPermissions = new Set(await this.getEffectivePermissions(actor));
    const outOfScope = [...requestedPermissions].find((permission) => !actorPermissions.has(permission));
    if (outOfScope) throw new ForbiddenException(`Bạn không thể cấp quyền ${outOfScope}.`);

    const passwordHash = await hash(password, 12);
    let saved;
    try { saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "admin_users" WHERE "id" = ${actor.id}::uuid FOR UPDATE`;
      const actorUser = await tx.adminUser.findUnique({ where: { id: actor.id }, select: { id: true, isActive: true, role: true } });
      if (!actorUser?.isActive) throw new ForbiddenException("Tài khoản thực hiện thao tác không còn hoạt động.");
      const currentActorGrants = await tx.adminPermissionGrant.findMany({ where: { adminId: actor.id }, select: { permission: true, effect: true } });
      const currentActorPermissions = actorUser.role === "SUPER_ADMIN" ? new Set<string>(ADMIN_PERMISSION_CATALOG) : this.effectiveSet(actorUser.role, currentActorGrants);
      const changedScope = [...requestedPermissions].find((permission) => !currentActorPermissions.has(permission));
      if (changedScope) throw new ForbiddenException(`Bạn không thể cấp quyền ${changedScope}.`);

      const user = await tx.adminUser.create({
        data: {
          username,
          // Admin identities are login accounts, not customer profiles. This reserved
          // address satisfies the existing audit/user schema without requiring email.
          email: `${randomUUID()}@staff.geme.invalid`,
          displayName: username,
          jobTitle,
          role: "STAFF",
          passwordHash,
        },
        select: { id: true, email: true, username: true, displayName: true, jobTitle: true, role: true, isActive: true },
      });
      const grants = ADMIN_PERMISSION_CATALOG.map((permission) => ({
        adminId: user.id,
        permission,
        effect: requestedPermissions.has(permission) ? "ALLOW" : "DENY",
        grantedByAdminId: actor.id,
      }));
      await tx.adminPermissionGrant.createMany({ data: grants });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: "ADMIN_STAFF_ACCOUNT_CREATED",
        entityType: "ADMIN_USER",
        entityId: user.id,
        after: { username, jobTitle, pages: pageIds, role: "STAFF" } as any,
      } });
      return user;
    }); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new ConflictException("Tài khoản này đã tồn tại.");
      throw error;
    }
    return this.describeUser(saved.id);
  }

  async resetUserPassword(adminId: string, actor: AdminIdentity, passwordInput: unknown) {
    const password = typeof passwordInput === "string" ? passwordInput : "";
    if (password.length < 12 || password.length > 256) throw new BadRequestException("Mật khẩu cần từ 12 đến 256 ký tự.");
    const passwordHash = await hash(password, 12);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "admin_users" WHERE "id" IN (${actor.id}::uuid, ${adminId}::uuid) ORDER BY "id" FOR UPDATE`;
      const [target, actorUser] = await Promise.all([
        tx.adminUser.findUnique({ where: { id: adminId }, select: { id: true, username: true, email: true, role: true, isActive: true } }),
        tx.adminUser.findUnique({ where: { id: actor.id }, select: { id: true, isActive: true } }),
      ]);
      if (!target) throw new NotFoundException("Không tìm thấy tài khoản quản trị.");
      if (!actorUser?.isActive) throw new ForbiddenException("Tài khoản thực hiện thao tác không còn hoạt động.");
      if (target.role === "SUPER_ADMIN") throw new ForbiddenException("Không thể đặt lại mật khẩu Super Admin tại màn hình này.");
      await tx.adminUser.update({ where: { id: adminId }, data: { passwordHash, authVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: "ADMIN_STAFF_PASSWORD_RESET",
        entityType: "ADMIN_USER",
        entityId: adminId,
        after: { username: target.username, email: target.email, sessionsRevoked: true } as any,
      } });
      return true;
    });
    return { updated: result, sessionsRevoked: true };
  }

  async setUserActive(adminId: string, actor: AdminIdentity, isActive: unknown) {
    if (typeof isActive !== "boolean") throw new BadRequestException("Trạng thái tài khoản không hợp lệ.");
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "admin_users" WHERE "id" IN (${actor.id}::uuid, ${adminId}::uuid) ORDER BY "id" FOR UPDATE`;
      const [target, actorUser] = await Promise.all([
        tx.adminUser.findUnique({ where: { id: adminId }, select: { id: true, username: true, email: true, role: true, isActive: true } }),
        tx.adminUser.findUnique({ where: { id: actor.id }, select: { id: true, isActive: true } }),
      ]);
      if (!target) return null;
      if (!actorUser?.isActive) throw new ForbiddenException("Tài khoản thực hiện thao tác không còn hoạt động.");
      if (target.role === "SUPER_ADMIN") throw new ForbiddenException("Không thể khóa hoặc mở khóa Super Admin tại màn hình này.");
      if (target.id === actor.id && isActive === false) throw new ForbiddenException("Không thể tự khóa tài khoản đang đăng nhập.");
      const saved = await tx.adminUser.update({ where: { id: adminId }, data: { isActive, ...(isActive ? {} : { authVersion: { increment: 1 } }) }, select: { id: true } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: isActive ? "ADMIN_STAFF_ACCOUNT_ENABLED" : "ADMIN_STAFF_ACCOUNT_DISABLED",
        entityType: "ADMIN_USER",
        entityId: saved.id,
        before: { isActive: target.isActive } as any,
        after: { isActive, username: target.username } as any,
      } });
      return saved;
    });
    return result ? this.describeUser(adminId) : null;
  }

  constructor(private readonly prisma: PrismaService) {}
}
