import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";
import { ADMIN_PAGE_ACCESS_CATALOG, ADMIN_PERMISSION_CATALOG, ADMIN_PERMISSION_DEFAULTS, ADMIN_STAFF_ROLE_SUGGESTIONS, AdminPermissionService, RequireAdminPermissions } from "./admin-permissions.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService, private readonly permissions: AdminPermissionService) {}

  @Post("login")
  login(@Body() body: Record<string, unknown>) {
    return this.auth.login(body.account ?? body.email, body.password);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions()
  async me(@Req() request: AdminRequest) {
    return { ...request.adminIdentity, permissions: await this.permissions.getEffectivePermissions(request.adminIdentity) };
  }

  @Get("users")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  listUsers() {
    return this.permissions.listUsers();
  }

  @Post("users")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  createStaffAccount(@Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    return this.permissions.createStaffAccount(request.adminIdentity, body);
  }

  @Get("permissions")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  permissionCatalog() {
    return { permissions: ADMIN_PERMISSION_CATALOG, defaults: ADMIN_PERMISSION_DEFAULTS, pages: ADMIN_PAGE_ACCESS_CATALOG, roleSuggestions: ADMIN_STAFF_ROLE_SUGGESTIONS };
  }

  @Get("users/:id/permissions")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  async userPermissions(@Param("id") id: string) {
    const result = await this.permissions.describeUser(id);
    if (!result) throw new NotFoundException("Không tìm thấy tài khoản quản trị.");
    return result;
  }

  @Patch("users/:id/permissions")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  async updateUserPermissions(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    const result = await this.permissions.replaceUserOverrides(id, request.adminIdentity, body.grants);
    if (!result) throw new NotFoundException("Không tìm thấy tài khoản quản trị.");
    return result;
  }

  @Patch("users/:id/password")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  resetUserPassword(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    return this.permissions.resetUserPassword(id, request.adminIdentity, body.password);
  }

  @Patch("users/:id/status")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  async setUserActive(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    const result = await this.permissions.setUserActive(id, request.adminIdentity, body.isActive);
    if (!result) throw new NotFoundException("Không tìm thấy tài khoản quản trị.");
    return result;
  }
}
