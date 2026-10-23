import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";
import { ADMIN_PERMISSION_CATALOG, ADMIN_PERMISSION_DEFAULTS, AdminPermissionService, RequireAdminPermissions } from "./admin-permissions.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService, private readonly permissions: AdminPermissionService) {}

  @Post("login")
  login(@Body() body: Record<string, unknown>) {
    return this.auth.login(body.email, body.password);
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

  @Get("permissions")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("access.manage")
  permissionCatalog() {
    return { permissions: ADMIN_PERMISSION_CATALOG, defaults: ADMIN_PERMISSION_DEFAULTS };
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
}
