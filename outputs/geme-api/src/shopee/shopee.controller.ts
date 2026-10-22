import { Body, Controller, Delete, Get, Logger, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { ShopeeService } from "./shopee.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type RedirectResponse = { redirect(statusCode: number, url: string): unknown; status(statusCode: number): { send(body: string): unknown } };

@Controller("admin/shopee")
@UseGuards(AdminAuthGuard)
export class ShopeeAdminController {
  constructor(private readonly shopee: ShopeeService) {}

  @Get("status") status() { return this.shopee.status(); }
  @Post("authorize") authorize(@Req() request: AdminRequest) { return this.shopee.startAuthorization(request.adminIdentity); }
  @Delete("connections/:id") disconnect(@Param("id", new ParseUUIDPipe()) id: string) { return this.shopee.disconnect(id); }
  @Post("connections/:id/sync") sync(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.shopee.enqueueSync(id, request.adminIdentity); }
  @Get("orders") orders(@Query("page") page?: string, @Query("limit") limit?: string, @Query("status") status?: string, @Query("q") q?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("connectionId") connectionId?: string, @Query("environment") environment?: string, @Query("shopId") shopId?: string) { return this.shopee.listOrders({ page, limit, status, q, from, to, connectionId, environment, shopId }); }
  @Get("orders/:id") order(@Param("id", new ParseUUIDPipe()) id: string) { return this.shopee.getOrder(id); }
  @Get("mappings/unmatched") unmatched(@Query("limit") limit?: string) { return this.shopee.unmatchedItems(limit); }
  @Get("mappings/catalog") catalog(@Query("q") q?: string) { return this.shopee.searchCatalog(q); }
  @Post("mappings/:id") mapItem(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.shopee.mapItem(id, body); }
  @Get("sync-runs") syncRuns(@Query("limit") limit?: string, @Query("connectionId") connectionId?: string, @Query("environment") environment?: string) { return this.shopee.syncHistory({ limit, connectionId, environment }); }
  @Post("sync-runs/:id/retry") retrySync(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.shopee.retrySyncRun(id, request.adminIdentity); }
}

// Shopee redirects to this callback with a short-lived, one-time state. The
// callback does not accept tokens or secrets from the browser or expose them.
@Controller("shopee")
export class ShopeeOAuthCallbackController {
  private readonly logger = new Logger(ShopeeOAuthCallbackController.name);
  constructor(private readonly shopee: ShopeeService) {}

  @Get("callback")
  async callback(
    @Query("state") state: string,
    @Query("code") code: string,
    @Query("shop_id") shopId: string,
    @Query("error") oauthError: string,
    @Res() response: RedirectResponse,
  ) {
    let result: "connected" | "error" | "denied" = oauthError ? "denied" : "error";
    if (!oauthError && state && code && shopId) {
      try { await this.shopee.completeAuthorization(state, code, shopId); result = "connected"; }
      catch (error) {
        const candidate = error instanceof Error ? error.message : "SHOPEE_CALLBACK_FAILED";
        this.logger.warn(JSON.stringify({ event: "shopee.oauth.callback_failed", code: /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : "SHOPEE_CALLBACK_FAILED" }));
      }
    } else if (oauthError && state) {
      try {
        result = await this.shopee.consumeAuthorizationDenial(state) ? "denied" : "error";
      } catch {
        result = "error";
      }
      this.logger.warn(JSON.stringify({ event: "shopee.oauth.denied", stateAccepted: result === "denied" }));
    }
    const returnUrl = await this.shopee.callbackReturnUrl(result);
    if (!returnUrl) return response.status(503).send("Shopee callback đã nhận nhưng SHOPEE_ADMIN_RETURN_URL chưa được cấu hình hợp lệ. Vui lòng quay lại GEME Admin.");
    return response.redirect(302, returnUrl);
  }
}
