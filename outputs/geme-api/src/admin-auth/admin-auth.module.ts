import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminPermissionService } from "./admin-permissions.js";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, AdminPermissionService, { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor }],
  exports: [AdminAuthService, AdminAuthGuard, AdminPermissionService],
})
export class AdminAuthModule {}
