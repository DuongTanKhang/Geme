import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";

type AdminRequest = { headers: { authorization?: string }; adminIdentity?: AdminIdentity };

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const identity = await this.auth.authenticateAuthorization(request.headers.authorization);
    if (!identity) throw new UnauthorizedException("Cần đăng nhập tài khoản quản trị để tiếp tục.");
    // CONTENT_EDITOR has no field-level permission model yet. Do not let this
    // legacy role inherit inventory, customer, finance, or integration access.
    if (identity.role === "CONTENT_EDITOR") throw new ForbiddenException("Vai trò biên tập chưa được cấp quyền quản trị trong phiên bản này.");
    request.adminIdentity = identity;
    return true;
  }
}
