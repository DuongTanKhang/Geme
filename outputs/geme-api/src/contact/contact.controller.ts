import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { ContactService } from "./contact.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller()
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post("contact") submit(
    @Body() body: unknown,
    @Headers("origin") origin: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) { return this.contact.submit(body, origin, idempotencyKey); }

  @Get("admin/contact-inquiries")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("contacts.read")
  list(@Query("limit") limit?: string, @Query("cursor") cursor?: string) { return this.contact.list(limit, cursor); }

  @Patch("admin/contact-inquiries/:id/status")
  @UseGuards(AdminAuthGuard)
  @RequireAdminPermissions("contacts.manage")
  update(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: unknown) { return this.contact.updateStatus(id, request.adminIdentity, body); }
}
