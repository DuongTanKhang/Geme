import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { MarketingService } from "./marketing.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller("marketing")
export class PublicMarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Post("page-view") pageView(@Body() body: Record<string, unknown>) { return this.marketing.recordPageView(body); }
  @Post("cart-add") cartAdd(@Body() body: Record<string, unknown>) { return this.marketing.recordCartAdd(body.sessionId); }
  @Post("signup") signup(@Body() body: Record<string, unknown>) { return this.marketing.recordSignup(body.sessionId); }
}

@Controller("admin/marketing")
@UseGuards(AdminAuthGuard)
export class AdminMarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get("overview")
  @RequireAdminPermissions("marketing.read")
  overview(@Query("from") from?: string, @Query("to") to?: string, @Query("cohorts") cohorts?: string) { return this.marketing.overview(from, to, cohorts !== "false"); }

  @Post("spend")
  @RequireAdminPermissions("marketing.manage")
  createSpend(@Req() request: AdminRequest, @Body() body: Record<string, unknown>) { return this.marketing.createSpend(request.adminIdentity, body); }
}
