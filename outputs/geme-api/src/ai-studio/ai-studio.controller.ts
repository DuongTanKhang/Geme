import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { AiImageStudioService } from "./ai-image-studio.service.js";
import { AiStudioService } from "./ai-studio.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };
type ImageUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type ImageResponse = { setHeader(name: string, value: string): unknown; status(code: number): ImageResponse; end(body?: Buffer): unknown };

@Controller("admin/ai-studio")
@UseGuards(AdminAuthGuard)
export class AiStudioController {
  constructor(private readonly aiStudio: AiStudioService, private readonly imageStudio: AiImageStudioService) {}

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
  @Get("image-studio/items/:itemId/preview") previewImage(@Param("itemId", new ParseUUIDPipe()) id: string, @Query("variant") variant: string, @Res() response: ImageResponse) {
    return this.imageStudio.writePreview(id, variant, response);
  }
  @Get("image-studio/items/:itemId/download") downloadImage(@Param("itemId", new ParseUUIDPipe()) id: string, @Query("format") format: string, @Res() response: ImageResponse) {
    return this.imageStudio.writeDownload(id, format, response);
  }
}
