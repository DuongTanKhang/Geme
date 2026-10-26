import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseGuards, applyDecorators } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { AdminPermissionService, RequireAdminPermissions, type AdminPermission } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { CommerceService } from "./commerce.service.js";
import { NewArrivalsService } from "./new-arrivals.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
const admin = (...permissions: AdminPermission[]) => applyDecorators(UseGuards(AdminAuthGuard), RequireAdminPermissions(...permissions));

@Controller()
export class NewArrivalsController {
  constructor(private readonly newArrivals: NewArrivalsService, private readonly commerce: CommerceService, private readonly permissions: AdminPermissionService) {}

  @Get("catalog/new-arrivals")
  @Header("Cache-Control", "public, max-age=0, s-maxage=5, stale-while-revalidate=5")
  list(@Query() query: Record<string, string | string[] | undefined>) { return this.newArrivals.list(query); }

  @Get("catalog/jewelry-stone-groups")
  @Header("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=30")
  publicGroups() { return this.newArrivals.listPublicGroups(); }

  @Get("catalog/new-arrivals/groups/:slug/products")
  @Header("Cache-Control", "public, max-age=0, s-maxage=5, stale-while-revalidate=5")
  groupProducts(@Param("slug") slug: string, @Query() query: Record<string, string | string[] | undefined>) { return this.newArrivals.groupProducts(slug, query); }

  @Get("admin/catalog/jewelry-stone-groups") @admin("catalog.read")
  adminGroups() { return this.newArrivals.listGroupsAdmin(); }

  @Post("admin/catalog/jewelry-stone-groups") @admin("catalog.write")
  async createGroup(@Req() request: AdminRequest, @Body() body: Record<string, any>) {
    await this.permissions.assertPermissions(request.adminIdentity, ["catalog.write"]);
    const result = await this.newArrivals.createGroup(body, request.adminIdentity);
    this.commerce.notifyNewArrivalsConfigurationUpdated();
    return result;
  }

  @Patch("admin/catalog/jewelry-stone-groups/:id") @admin("catalog.write")
  async updateGroup(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any>) {
    await this.permissions.assertPermissions(request.adminIdentity, ["catalog.write"]);
    const result = await this.newArrivals.updateGroup(id, body, request.adminIdentity);
    this.commerce.notifyNewArrivalsConfigurationUpdated();
    return result;
  }

  @Patch("admin/catalog/jewelry-stone-group-mappings/:sourceType/:sourceId") @admin("catalog.write")
  async mapSource(@Req() request: AdminRequest, @Param("sourceType") sourceType: string, @Param("sourceId") sourceId: string, @Body() body: Record<string, any>) {
    if (!body || Object.keys(body).some((key) => key !== "jewelryStoneGroupId") || !Object.hasOwn(body, "jewelryStoneGroupId")) throw new BadRequestException("Chỉ gửi jewelryStoneGroupId (UUID hoặc null) vào mapping.");
    await this.permissions.assertPermissions(request.adminIdentity, ["catalog.write"]);
    const result = await this.newArrivals.mapStoneSource(sourceType, sourceId, body.jewelryStoneGroupId, request.adminIdentity);
    this.commerce.notifyNewArrivalsConfigurationUpdated();
    return result;
  }

  @Patch("admin/products/:id/jewelry-stone-group") @admin("catalog.write")
  async assignProductGroup(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any>) {
    if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "jewelryStoneGroupId")) throw new BadRequestException("Chỉ gửi jewelryStoneGroupId (UUID hoặc null).");
    await this.permissions.assertPermissions(request.adminIdentity, ["catalog.write"]);
    const result = await this.newArrivals.assignProductGroup(id, body.jewelryStoneGroupId, request.adminIdentity);
    this.commerce.notifyNewArrivalsConfigurationUpdated();
    return result;
  }

  @Get("admin/catalog/new-arrivals-settings") @admin("settings.manage")
  async getSettings(@Req() request: AdminRequest) {
    await this.permissions.assertPermissions(request.adminIdentity, ["settings.manage"]);
    return this.newArrivals.getRecentDaysAdmin();
  }

  @Patch("admin/catalog/new-arrivals-settings") @admin("settings.manage")
  async updateSettings(@Req() request: AdminRequest, @Body() body: Record<string, any>) {
    if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "newArrivalsRecentDays")) throw new BadRequestException("Chỉ gửi newArrivalsRecentDays.");
    await this.permissions.assertPermissions(request.adminIdentity, ["settings.manage"]);
    const result = await this.newArrivals.setRecentDaysAdmin(body, request.adminIdentity);
    this.commerce.notifyNewArrivalsConfigurationUpdated();
    return result;
  }
}
