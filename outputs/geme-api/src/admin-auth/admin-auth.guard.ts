import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";
import { ADMIN_PERMISSION_KEY, AdminPermissionService } from "./admin-permissions.js";

type AdminRequest = { headers: { authorization?: string }; route?: { path?: string }; baseUrl?: string; path?: string; adminIdentity?: AdminIdentity };

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService, private readonly permissions: AdminPermissionService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const identity = await this.auth.authenticateAuthorization(request.headers.authorization);
    if (!identity) throw new UnauthorizedException("Cần đăng nhập tài khoản quản trị để tiếp tục.");
    const required = this.reflector.getAllAndOverride<string[]>(ADMIN_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    const route = String(request.route?.path || `${request.baseUrl || ""}${request.path || ""}`);
    if (required !== undefined) {
      try {
        await this.permissions.assertPermissions(identity, required);
      } catch (error) {
        if (error instanceof ForbiddenException) await this.permissions.recordAuthorizationDenied(identity, route, required);
        throw error;
      }
    } else if (identity.role === "CONTENT_EDITOR") {
      await this.permissions.recordAuthorizationDenied(identity, route, []);
      throw new ForbiddenException("Tài khoản chưa được cấp quyền cho trang quản trị này.");
    }
    request.adminIdentity = identity;
    return true;
  }
}
