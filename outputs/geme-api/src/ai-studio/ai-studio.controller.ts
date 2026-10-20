import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { AiImageStudioService } from "./ai-image-studio.service.js";
import { AiProductAgentService } from "./ai-product-agent.service.js";
import { AiPhaseFourService } from "./ai-phase-four.service.js";
import { AiStudioService } from "./ai-studio.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type ImageUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type ImageResponse = { setHeader(name: string, value: string): unknown; status(code: number): ImageResponse; end(body?: Buffer): unknown };

@Controller("admin/ai-studio")
@UseGuards(AdminAuthGuard)
export class AiStudioController {
  constructor(private readonly aiStudio: AiStudioService, private readonly imageStudio: AiImageStudioService, private readonly productAgent: AiProductAgentService, private readonly phaseFour: AiPhaseFourService) {}

  @Get("overview") overview() { return this.aiStudio.overview(); }
  @Get("tasks") tasks(@Query("status") status?: string, @Query("limit") limit?: string) { return this.aiStudio.listTasks(status, limit); }
  @Get("tasks/:id") task(@Param("id", new ParseUUIDPipe()) id: string) { return this.aiStudio.task(id); }
  @Post("tasks") createTask(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.aiStudio.createTask(request.adminIdentity, body, key);
  }
  @Post("tasks/:id/cancel") cancelTask(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.aiStudio.cancelTask(request.adminIdentity, id);
  }
  @Get("approvals") approvals(@Query("limit") limit?: string) { return this.aiStudio.approvals(limit); }
  @Post("tasks/:id/approve") approve(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.aiStudio.decideApproval(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("tasks/:id/reject") reject(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.aiStudio.decideApproval(request.adminIdentity, id, "REJECTED", body?.note);
  }

  @Get("image-studio/status") imageStatus() { return this.imageStudio.status(); }
  @Get("image-studio/batches") imageBatches(@Query("limit") limit?: string) { return this.imageStudio.listBatches(limit); }
  @Post("image-studio/batches") createImageBatch(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.imageStudio.createBatch(request.adminIdentity, body, key);
  }
  @Post("image-studio/batches/:batchId/items/:itemId/upload")
  @UseInterceptors(FileInterceptor("image_file", { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, parts: 4 } }))
  uploadImage(@Param("batchId", new ParseUUIDPipe()) batchId: string, @Param("itemId", new ParseUUIDPipe()) itemId: string, @UploadedFile() file?: ImageUpload) {
    return this.imageStudio.uploadItem(batchId, itemId, file);
  }
  @Get("image-studio/batches/:batchId") imageBatch(@Param("batchId", new ParseUUIDPipe()) id: string) { return this.imageStudio.getBatch(id); }
  @Post("image-studio/batches/:batchId/cancel") cancelImageBatch(@Req() request: AdminRequest, @Param("batchId", new ParseUUIDPipe()) id: string) {
    return this.imageStudio.cancelBatch(request.adminIdentity, id);
  }
  @Get("image-studio/batches/:batchId/export.zip") exportImageBatch(@Param("batchId", new ParseUUIDPipe()) id: string, @Res() response: ImageResponse) {
    return this.imageStudio.writeZip(id, response);
  }
  @Post("image-studio/items/:itemId/approve") approveImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.decideItem(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("image-studio/items/:itemId/reject") rejectImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.decideItem(request.adminIdentity, id, "REJECTED", body?.note);
  }
  @Post("image-studio/items/:itemId/retry") retryImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string) {
    return this.imageStudio.retryItem(request.adminIdentity, id);
  }
  @Post("image-studio/items/:itemId/attach") attachImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.attachToDraft(request.adminIdentity, id, body?.sku);
  }
  @Post("image-studio/items/:itemId/attach-technical-drawing") attachTechnicalDrawing(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string) {
    return this.imageStudio.attachTechnicalDrawing(request.adminIdentity, id);
  }
  @Get("image-studio/products/:sku/technical-drawings") technicalDrawings(@Param("sku") sku: string) {
    return this.imageStudio.listTechnicalDrawings(sku);
  }
  @Get("image-studio/items/:itemId/preview") previewImage(@Param("itemId", new ParseUUIDPipe()) id: string, @Query("variant") variant: string, @Res() response: ImageResponse) {
    return this.imageStudio.writePreview(id, variant, response);
  }
  @Get("image-studio/items/:itemId/download") downloadImage(@Param("itemId", new ParseUUIDPipe()) id: string, @Query("format") format: string, @Res() response: ImageResponse) {
    return this.imageStudio.writeDownload(id, format, response);
  }

  @Get("product-agent/approved-images") approvedProductImages(@Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    return this.productAgent.listApprovedImages(limit, cursor);
  }
  @Get("product-agent/status") productAgentStatus() {
    return this.productAgent.status();
  }
  @Get("product-agent/batches") productDraftBatches(@Query("limit") limit?: string) {
    return this.productAgent.listBatches(limit);
  }
  @Post("product-agent/batches") createProductDraftBatch(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.productAgent.createBatch(request.adminIdentity, body, key);
  }
  @Get("product-agent/batches/:batchId") productDraftBatch(@Param("batchId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.batch(id);
  }
  @Get("product-agent/drafts") productDrafts(@Query("status") status?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string, @Query("q") search?: string) {
    return this.productAgent.listDrafts(status, limit, cursor, search);
  }
  @Post("product-agent/drafts/bulk-decision") bulkDecideProductDrafts(@Req() request: AdminRequest, @Body() body: unknown) {
    return this.productAgent.bulkDecideDrafts(request.adminIdentity, body);
  }
  @Get("product-agent/drafts/:draftId") productDraft(@Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.getDraft(id);
  }
  @Patch("product-agent/drafts/:draftId") updateProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.productAgent.updateDraft(request.adminIdentity, id, body);
  }
  @Post("product-agent/drafts/:draftId/approve") approveProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.productAgent.decideDraft(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("product-agent/drafts/:draftId/reject") rejectProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.productAgent.decideDraft(request.adminIdentity, id, "REJECTED", body?.note);
  }
  @Post("product-agent/drafts/:draftId/cancel") cancelProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.cancelDraft(request.adminIdentity, id);
  }
  @Post("product-agent/drafts/:draftId/retry") retryProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.retryDraft(request.adminIdentity, id);
  }

  @Get("phase4/sales/status") salesStatus() { return this.phaseFour.salesStatus(); }
  @Get("phase4/sales/analytics") salesAnalytics() { return this.phaseFour.salesAnalytics(); }
  @Post("phase4/sales/answer") salesAnswer(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.phaseFour.askSales(request.adminIdentity, body, key);
  }
  @Post("phase4/sales/answers/:taskId/product-click") salesProductClick(@Param("taskId", new ParseUUIDPipe()) taskId: string, @Body() body: Record<string, unknown>) {
    return this.phaseFour.recordProductClick(taskId, body?.productId);
  }
  @Get("phase4/sales/knowledge") salesKnowledge(@Query("archived") archived?: string) { return this.phaseFour.listKnowledge(archived === "true"); }
  @Post("phase4/sales/knowledge") createSalesKnowledge(@Req() request: AdminRequest, @Body() body: unknown) { return this.phaseFour.createKnowledge(request.adminIdentity, body); }
  @Post("phase4/sales/knowledge/:id/revisions") createSalesKnowledgeRevision(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.phaseFour.createKnowledgeRevision(request.adminIdentity, id, body); }
  @Post("phase4/sales/knowledge/:id/activate") activateSalesKnowledge(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.phaseFour.activateKnowledge(request.adminIdentity, id); }
  @Post("phase4/sales/knowledge/:id/archive") archiveSalesKnowledge(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.phaseFour.archiveKnowledge(request.adminIdentity, id); }

  @Get("phase4/marketing/products") marketingProducts(@Query("search") search?: string) { return this.phaseFour.marketingProducts(search); }
  @Get("phase4/marketing/drafts") marketingDrafts(@Query("status") status?: string, @Query("limit") limit?: string) { return this.phaseFour.listMarketingDrafts(status, limit); }
  @Get("phase4/marketing/drafts/:id") marketingDraft(@Param("id", new ParseUUIDPipe()) id: string) { return this.phaseFour.marketingDraft(id); }
  @Post("phase4/marketing/drafts") createMarketingDraft(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.phaseFour.createMarketingDraft(request.adminIdentity, body, key);
  }
  @Patch("phase4/marketing/drafts/:id") updateMarketingDraft(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.phaseFour.updateMarketingDraft(request.adminIdentity, id, body);
  }
  @Post("phase4/marketing/drafts/:id/retry") retryMarketingDraft(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.phaseFour.retryMarketingDraft(request.adminIdentity, id);
  }
  @Post("phase4/marketing/drafts/:id/approve") approveMarketingDraft(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.phaseFour.decideMarketingDraft(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("phase4/marketing/drafts/:id/reject") rejectMarketingDraft(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.phaseFour.decideMarketingDraft(request.adminIdentity, id, "REJECTED", body?.note);
  }
}
