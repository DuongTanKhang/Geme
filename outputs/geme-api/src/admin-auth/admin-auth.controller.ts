import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AdminAuthService, type AdminIdentity } from "./admin-auth.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("login")
  login(@Body() body: Record<string, unknown>) {
    return this.auth.login(body.email, body.password);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  me(@Req() request: AdminRequest) {
    return request.adminIdentity;
  }
}
