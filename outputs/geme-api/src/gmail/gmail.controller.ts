import { Body, Controller, Delete, Get, HttpException, Logger, Param, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { GmailService } from "./gmail.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type RedirectResponse = { redirect(statusCode: number, url: string): unknown; status(statusCode: number): { send(body: string): unknown } };

@Controller("admin/gmail")
@UseGuards(AdminAuthGuard)
@RequireAdminPermissions("settings.manage")
export class GmailAdminController {
  constructor(private readonly gmail: GmailService) {}

  @Get("status") status() { return this.gmail.status(); }
  @Post("authorize") authorize(@Req() request: AdminRequest) { return this.gmail.startAuthorization(request.adminIdentity); }
  @Delete("connection") disconnect(@Req() request: AdminRequest) { return this.gmail.disconnect(request.adminIdentity); }
  @Get("labels") labels() { return this.gmail.labels(); }
  @Get("messages") messages(@Query("folder") folder?: string, @Query("q") q?: string, @Query("pageToken") pageToken?: string, @Query("maxResults") maxResults?: string, @Query("labelId") labelId?: string) { return this.gmail.listMessages({ folder, q, pageToken, maxResults, labelId }); }
  @Get("messages/:id") message(@Param("id") id: string) { return this.gmail.getMessage(id); }
  @Post("messages/:id/modify") modifyMessage(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: unknown) { return this.gmail.modifyMessage(request.adminIdentity, id, body); }
  @Post("messages/:id/trash") trashMessage(@Req() request: AdminRequest, @Param("id") id: string) { return this.gmail.trashMessage(request.adminIdentity, id); }
  @Post("messages/:id/restore") restoreMessage(@Req() request: AdminRequest, @Param("id") id: string) { return this.gmail.trashMessage(request.adminIdentity, id, true); }
  @Post("messages/:id/archive") archiveMessage(@Req() request: AdminRequest, @Param("id") id: string) { return this.gmail.archiveMessage(request.adminIdentity, id); }
  @Post("messages/send") sendMessage(@Req() request: AdminRequest, @Body() body: unknown) { return this.gmail.sendMessage(request.adminIdentity, body); }
  @Get("drafts") drafts(@Query("q") q?: string, @Query("pageToken") pageToken?: string, @Query("maxResults") maxResults?: string) { return this.gmail.listDrafts({ q, pageToken, maxResults }); }
  @Get("drafts/:id") draft(@Param("id") id: string) { return this.gmail.getDraft(id); }
  @Post("drafts") createDraft(@Req() request: AdminRequest, @Body() body: unknown) { return this.gmail.createDraft(request.adminIdentity, body); }
  @Put("drafts/:id") updateDraft(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: unknown) { return this.gmail.updateDraft(request.adminIdentity, id, body); }
  @Post("drafts/:id/send") sendDraft(@Req() request: AdminRequest, @Param("id") id: string) { return this.gmail.sendDraft(request.adminIdentity, id); }
  @Delete("drafts/:id") deleteDraft(@Req() request: AdminRequest, @Param("id") id: string) { return this.gmail.deleteDraft(request.adminIdentity, id); }
}

@Controller("integrations/gmail")
export class GmailOAuthCallbackController {
  private readonly logger = new Logger(GmailOAuthCallbackController.name);
  constructor(private readonly gmail: GmailService) {}

  @Get("callback")
  async callback(@Query("state") state: string, @Query("code") code: string, @Query("error") oauthError: string, @Res() response: RedirectResponse) {
    let outcome: "connected" | "error" | "denied" = oauthError ? "denied" : "error";
    if (oauthError && state) {
      try { if (!await this.gmail.consumeAuthorizationDenial(state)) outcome = "error"; }
      catch { outcome = "error"; }
      this.logger.warn(JSON.stringify({ event: "gmail.oauth.denied", stateAccepted: outcome === "denied" }));
    } else if (state && code) {
      try { await this.gmail.completeAuthorization(state, code); outcome = "connected"; }
      catch (error) {
        const candidate = error instanceof HttpException ? `HTTP_${error.getStatus()}` : error instanceof Error ? error.name : "UNKNOWN";
        this.logger.warn(JSON.stringify({ event: "gmail.oauth.callback_failed", code: /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : "GMAIL_CALLBACK_FAILED" }));
      }
    }
    const target = await this.gmail.callbackReturnUrl(outcome);
    if (!target) return response.status(503).send("Gmail callback đã nhận nhưng GMAIL_OAUTH_ADMIN_RETURN_URL chưa được cấu hình hợp lệ. Vui lòng quay lại GEME Admin.");
    return response.redirect(302, target);
  }
}
