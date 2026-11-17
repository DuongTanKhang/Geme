import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { AdminCalendarService } from "./admin-calendar.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller("admin/calendar")
@UseGuards(AdminAuthGuard)
export class AdminCalendarController {
  constructor(private readonly calendar: AdminCalendarService) {}

  @Get("today")
  @RequireAdminPermissions("calendar.read")
  today() { return this.calendar.today(); }

  @Get("due")
  @RequireAdminPermissions("calendar.read")
  due() { return this.calendar.due(); }

  @Get("events")
  @RequireAdminPermissions("calendar.read")
  list(@Query("from") from?: string, @Query("to") to?: string) { return this.calendar.list(from, to); }

  @Post("events")
  @RequireAdminPermissions("calendar.manage")
  create(@Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    return this.calendar.create(request.adminIdentity, body);
  }

  @Patch("events/:id")
  @RequireAdminPermissions("calendar.manage")
  update(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: AdminRequest, @Body() body: Record<string, unknown>) {
    return this.calendar.update(id, request.adminIdentity, body);
  }

  @Delete("events/:id")
  @RequireAdminPermissions("calendar.manage")
  remove(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: AdminRequest) {
    return this.calendar.remove(id, request.adminIdentity);
  }
}
