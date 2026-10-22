import { Body, Controller, Get, HttpException, Logger, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { SocialService } from "./social.service.js";
import { MetaRequestError } from "./social-meta.client.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type RedirectResponse = { redirect(statusCode: number, url: string): unknown };

@Controller("admin/social")
@UseGuards(AdminAuthGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get("status") status() { return this.social.status(); }
  @Get("accounts") accounts() { return this.social.accounts(); }
  @Post("meta/authorize") authorize(@Req() request: AdminRequest) { return this.social.startOAuth(request.adminIdentity); }
  @Patch("accounts/selection") selectAccounts(@Req() request: AdminRequest, @Body() body: Record<string, unknown>) { return this.social.selectAccounts(request.adminIdentity, body?.accountIds); }
  @Post("connections/:id/disconnect") disconnect(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.social.disconnect(request.adminIdentity, id); }
  @Get("products") products(@Query("search") search?: string) { return this.social.products(search); }
  @Get("marketing-drafts") marketingDrafts() { return this.social.marketingDrafts(); }
  @Get("posts") posts(@Query("status") status?: string, @Query("q") search?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string) { return this.social.listPosts(status, search, limit, cursor); }
  @Get("posts/calendar") calendar(@Query("from") from?: string, @Query("to") to?: string, @Query("status") status?: string) { return this.social.calendar(from, to, status); }
  @Get("posts/:id") getPost(@Param("id", new ParseUUIDPipe()) id: string) { return this.social.getPost(id); }
  @Post("posts") createPost(@Req() request: AdminRequest, @Body() body: unknown) { return this.social.createPost(request.adminIdentity, body); }
  @Patch("posts/:id") updatePost(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.social.updatePost(request.adminIdentity, id, body); }
  @Post("posts/:id/approve") approve(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.social.approvePost(request.adminIdentity, id, body); }
  @Post("posts/:id/publish-now") publishNow(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.social.publishNow(request.adminIdentity, id); }
  @Post("posts/:id/retry-failed") retryFailed(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.social.retryFailed(request.adminIdentity, id); }
  @Post("posts/:postId/targets/:targetId/verify") verifyTarget(@Req() request: AdminRequest, @Param("postId", new ParseUUIDPipe()) postId: string, @Param("targetId", new ParseUUIDPipe()) targetId: string) { return this.social.verifyUnknownTarget(request.adminIdentity, postId, targetId); }
  @Post("posts/:postId/targets/:targetId/reconcile") reconcileTarget(@Req() request: AdminRequest, @Param("postId", new ParseUUIDPipe()) postId: string, @Param("targetId", new ParseUUIDPipe()) targetId: string, @Body() body: unknown) { return this.social.recordManualReconciliation(request.adminIdentity, postId, targetId, body); }
  @Post("posts/:postId/targets/:targetId/retry-after-reconciliation") retryUnknown(@Req() request: AdminRequest, @Param("postId", new ParseUUIDPipe()) postId: string, @Param("targetId", new ParseUUIDPipe()) targetId: string, @Body() body: unknown) { return this.social.retryUnknownTarget(request.adminIdentity, postId, targetId, body); }
  @Post("posts/:id/cancel") cancel(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.social.cancel(request.adminIdentity, id); }
  @Post("posts/:id/reschedule") reschedule(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.social.reschedule(request.adminIdentity, id); }
}

// Meta redirects here without the Admin cookie: the callback is authenticated
// only by the short-lived, random, one-time state bound to the initiating admin.
@Controller("social/meta")
export class SocialOAuthCallbackController {
  private readonly logger = new Logger(SocialOAuthCallbackController.name);

  constructor(private readonly social: SocialService) {}

  @Get("callback")
  async callback(@Query("state") state: string, @Query("code") code: string, @Query("error") oauthError: string, @Res() response: RedirectResponse) {
    let result: "success" | "error" = "error";
    if (!oauthError && state && code) {
      try { await this.social.completeOAuth(state, code); result = "success"; }
      catch (error) {
        const code = error instanceof MetaRequestError ? error.code : error instanceof HttpException ? `HTTP_${error.getStatus()}` : error instanceof Error ? error.name : "UNKNOWN";
        this.logger.warn(JSON.stringify({ event: "social.oauth.callback_failed", code }));
        result = "error";
      }
    } else if (oauthError) {
      this.logger.warn(JSON.stringify({ event: "social.oauth.denied", code: "META_OAUTH_DENIED" }));
    }
    return response.redirect(302, await this.social.oauthReturnUrl(result));
  }
}
