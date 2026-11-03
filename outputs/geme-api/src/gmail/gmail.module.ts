import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin-auth/admin-auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GmailAdminController, GmailOAuthCallbackController } from "./gmail.controller.js";
import { GmailService } from "./gmail.service.js";

@Module({ imports: [PrismaModule, AdminAuthModule], controllers: [GmailAdminController, GmailOAuthCallbackController], providers: [GmailService] })
export class GmailModule {}
