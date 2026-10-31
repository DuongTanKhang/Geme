import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { AiImageStudioService } from "./ai-image-studio.service.js";
import { AiProductAgentService } from "./ai-product-agent.service.js";
import { AiStudioService } from "./ai-studio.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type ImageUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type ProductAgentUpload = ImageUpload;
type ImageResponse = { setHeader(name: string, value: string): unknown; status(code: number): ImageResponse; end(body?: Buffer): unknown };

@Controller("admin/ai-studio")
@UseGuards(AdminAuthGuard)
@RequireAdminPermissions("ai-studio.read")
export class AiStudioController {
  constructor(private readonly aiStudio: AiStudioService, private readonly imageStudio: AiImageStudioService, private readonly productAgent: AiProductAgentService) {}

  @Get("overview") overview() { return this.aiStudio.overview(); }
  @Get("tasks") tasks(@Query("status") status?: string, @Query("limit") limit?: string) { return this.aiStudio.listTasks(status, limit); }
  @Get("tasks/:id") task(@Param("id", new ParseUUIDPipe()) id: string) { return this.aiStudio.task(id); }
  @Post("tasks") @RequireAdminPermissions("ai-studio.draft") createTask(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.aiStudio.createTask(request.adminIdentity, body, key);
  }
  @Post("tasks/:id/cancel") @RequireAdminPermissions("ai-studio.draft") cancelTask(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.aiStudio.cancelTask(request.adminIdentity, id);
  }
  @Get("approvals") approvals(@Query("limit") limit?: string) { return this.aiStudio.approvals(limit); }
  @Post("tasks/:id/approve") @RequireAdminPermissions("ai-studio.approve") approve(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.aiStudio.decideApproval(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("tasks/:id/reject") @RequireAdminPermissions("ai-studio.approve") reject(@Req() request: AdminRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.aiStudio.decideApproval(request.adminIdentity, id, "REJECTED", body?.note);
  }

  @Get("image-studio/status") imageStatus() { return this.imageStudio.status(); }
  @Get("image-studio/batches") imageBatches(@Query("limit") limit?: string) { return this.imageStudio.listBatches(limit); }
  @Post("image-studio/batches") @RequireAdminPermissions("ai-studio.draft") createImageBatch(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.imageStudio.createBatch(request.adminIdentity, body, key);
  }
  @Post("image-studio/batches/:batchId/items/:itemId/upload")
  @RequireAdminPermissions("ai-studio.draft")
  @UseInterceptors(FileInterceptor("image_file", { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, parts: 4 } }))
  uploadImage(@Param("batchId", new ParseUUIDPipe()) batchId: string, @Param("itemId", new ParseUUIDPipe()) itemId: string, @UploadedFile() file?: ImageUpload) {
    return this.imageStudio.uploadItem(batchId, itemId, file);
  }
  @Get("image-studio/batches/:batchId") imageBatch(@Param("batchId", new ParseUUIDPipe()) id: string) { return this.imageStudio.getBatch(id); }
  @Post("image-studio/batches/:batchId/cancel") @RequireAdminPermissions("ai-studio.draft") cancelImageBatch(@Req() request: AdminRequest, @Param("batchId", new ParseUUIDPipe()) id: string) {
    return this.imageStudio.cancelBatch(request.adminIdentity, id);
  }
  @Get("image-studio/batches/:batchId/export.zip") exportImageBatch(@Param("batchId", new ParseUUIDPipe()) id: string, @Res() response: ImageResponse) {
    return this.imageStudio.writeZip(id, response);
  }
  @Post("image-studio/items/:itemId/approve") @RequireAdminPermissions("ai-studio.approve") approveImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.decideItem(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("image-studio/items/:itemId/reject") @RequireAdminPermissions("ai-studio.approve") rejectImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.decideItem(request.adminIdentity, id, "REJECTED", body?.note);
  }
  @Post("image-studio/items/:itemId/retry") @RequireAdminPermissions("ai-studio.draft") retryImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string) {
    return this.imageStudio.retryItem(request.adminIdentity, id);
  }
  @Post("image-studio/items/:itemId/attach") @RequireAdminPermissions("ai-studio.approve", "catalog.content.write") attachImage(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.imageStudio.attachToDraft(request.adminIdentity, id, body?.sku);
  }
  @Post("image-studio/items/:itemId/attach-technical-drawing") @RequireAdminPermissions("ai-studio.approve", "catalog.content.write") attachTechnicalDrawing(@Req() request: AdminRequest, @Param("itemId", new ParseUUIDPipe()) id: string) {
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
  @Post("product-agent/direct-upload")
  @RequireAdminPermissions("ai-studio.draft")
  @UseInterceptors(FilesInterceptor("image_files", 5, { limits: { fileSize: 8 * 1024 * 1024, files: 5, fields: 0, parts: 5 } }))
  uploadProductAgentImages(@Req() request: AdminRequest, @UploadedFiles() files: ProductAgentUpload[] | undefined, @Headers("idempotency-key") key?: string) {
    return this.productAgent.uploadDirectImages(request.adminIdentity, files, key);
  }
  @Get("product-agent/batches") productDraftBatches(@Query("limit") limit?: string) {
    return this.productAgent.listBatches(limit);
  }
  @Post("product-agent/batches") @RequireAdminPermissions("ai-studio.draft") createProductDraftBatch(@Req() request: AdminRequest, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.productAgent.createBatch(request.adminIdentity, body, key);
  }
  @Get("product-agent/batches/:batchId") productDraftBatch(@Param("batchId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.batch(id);
  }
  @Get("product-agent/drafts") productDrafts(@Query("status") status?: string, @Query("limit") limit?: string, @Query("cursor") cursor?: string, @Query("q") search?: string) {
    return this.productAgent.listDrafts(status, limit, cursor, search);
  }
  @Post("product-agent/drafts/bulk-decision") @RequireAdminPermissions("ai-studio.approve") bulkDecideProductDrafts(@Req() request: AdminRequest, @Body() body: unknown) {
    return this.productAgent.bulkDecideDrafts(request.adminIdentity, body);
  }
  @Get("product-agent/drafts/:draftId") productDraft(@Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.getDraft(id);
  }
  @Patch("product-agent/drafts/:draftId") @RequireAdminPermissions("ai-studio.draft") updateProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.productAgent.updateDraft(request.adminIdentity, id, body);
  }
  @Post("product-agent/drafts/:draftId/approve") @RequireAdminPermissions("ai-studio.approve") approveProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.productAgent.decideDraft(request.adminIdentity, id, "APPROVED", body?.note);
  }
  @Post("product-agent/drafts/:draftId/attach") @RequireAdminPermissions("ai-studio.approve", "catalog.content.write") attachProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.productAgent.attachApprovedDraftToProduct(request.adminIdentity, id, body);
  }
  @Post("product-agent/drafts/:draftId/reject") @RequireAdminPermissions("ai-studio.approve") rejectProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string, @Body() body: Record<string, unknown>) {
    return this.productAgent.decideDraft(request.adminIdentity, id, "REJECTED", body?.note);
  }
  @Post("product-agent/drafts/:draftId/cancel") @RequireAdminPermissions("ai-studio.draft") cancelProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.cancelDraft(request.adminIdentity, id);
  }
  @Post("product-agent/drafts/:draftId/retry") @RequireAdminPermissions("ai-studio.draft") retryProductDraft(@Req() request: AdminRequest, @Param("draftId", new ParseUUIDPipe()) id: string) {
    return this.productAgent.retryDraft(request.adminIdentity, id);
  }

}
