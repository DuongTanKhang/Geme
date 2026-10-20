import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { MediaAssetsService } from "../media/media-assets.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiStudioQueue } from "./ai-studio.queue.js";
import { AiStudioService } from "./ai-studio.service.js";

const MAX_ITEMS = 50;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PRESETS = new Set(["STONE_GREY", "WARM_IVORY", "SOFT_SAGE"]);
const IMAGE_BATCH_ACTIVE = ["UPLOADING", "PROCESSING", "REVIEW"] as const;
const ALLOWED_ITEM_TRANSITIONS = ["PENDING_UPLOAD", "QUEUED", "RUNNING"] as const;

type ImageManifestItem = { name: string; relativePath: string; size: number; mimeType: string; classificationHint: string };
type ImageBatchInput = { name: string; preset: "STONE_GREY" | "WARM_IVORY" | "SOFT_SAGE"; purpose: "PRODUCT_PHOTO" | "TECHNICAL_DRAWING"; targetProductSku: string; visualPrompt: string; items: ImageManifestItem[]; totalBytes: number; manifestHash: string; idempotencyKey: string };
type BinaryResponse = { setHeader(name: string, value: string): unknown; status(code: number): BinaryResponse; end(body?: Buffer): unknown };

function cleanRelativePath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || /[\0-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw new BadRequestException("Đường dẫn thư mục chứa thành phần không hợp lệ.");
  const safe = parts.join("/");
  if (Buffer.byteLength(safe, "utf8") > 500) throw new BadRequestException("Đường dẫn ảnh trong thư mục quá dài.");
  return safe;
}

function validateManifest(body: unknown, keyInput: unknown): ImageBatchInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Thông tin lô ảnh không hợp lệ.");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["name", "preset", "purpose", "productSku", "visualPrompt", "items"].includes(key))) throw new BadRequestException("Lô ảnh có trường không được hỗ trợ.");
  if (typeof value.preset !== "string" || !PRESETS.has(value.preset)) throw new BadRequestException("Preset xử lý ảnh không hợp lệ.");
  const purpose = value.purpose === "TECHNICAL_DRAWING" ? "TECHNICAL_DRAWING" : value.purpose === undefined || value.purpose === "PRODUCT_PHOTO" ? "PRODUCT_PHOTO" : null;
  if (!purpose) throw new BadRequestException("Loại tác vụ ảnh không hợp lệ.");
  if (value.visualPrompt !== undefined && typeof value.visualPrompt !== "string") throw new BadRequestException("Chỉ dẫn hình ảnh không hợp lệ.");
  const visualPrompt = typeof value.visualPrompt === "string" ? value.visualPrompt.trim() : "";
  if (visualPrompt.length > 1200) throw new BadRequestException("Chỉ dẫn tạo nền tối đa 1.200 ký tự.");
  if (purpose === "TECHNICAL_DRAWING" && visualPrompt) throw new BadRequestException("Chỉ dẫn tạo nền chỉ dùng cho hậu kỳ ảnh sản phẩm.");
  const targetProductSku = typeof value.productSku === "string" ? value.productSku.trim().slice(0, 64) : "";
  if (purpose === "TECHNICAL_DRAWING" && !targetProductSku) throw new BadRequestException("Hãy nhập SKU sản phẩm cần tạo ảnh kỹ thuật.");
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_ITEMS) throw new BadRequestException(`Mỗi lô cần từ 1 đến ${MAX_ITEMS} ảnh.`);
  if (purpose === "TECHNICAL_DRAWING" && value.items.length !== 1) throw new BadRequestException("Ảnh kỹ thuật cần đúng một ảnh tham chiếu cho mỗi lần tạo.");
  const idempotencyKey = typeof keyInput === "string" ? keyInput.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu khóa Idempotency-Key hợp lệ.");

  let totalBytes = 0;
  const items = value.items.map((raw): ImageManifestItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("Thông tin một ảnh không hợp lệ.");
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["name", "relativePath", "size", "mimeType", "classificationHint"].includes(key))) throw new BadRequestException("Ảnh có trường không được hỗ trợ.");
    const sourceName = typeof item.name === "string" ? item.name.replace(/\\/g, "/") : "";
    const name = basename(sourceName).trim().slice(0, 240);
    if (!name || name === "." || name === "..") throw new BadRequestException("Tên tệp ảnh không hợp lệ.");
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.toLowerCase() : "";
    if (!SUPPORTED_TYPES.has(mimeType)) throw new BadRequestException("Chỉ nhận ảnh JPEG, PNG hoặc WebP.");
    const size = Number(item.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) throw new BadRequestException("Mỗi ảnh phải nhỏ hơn hoặc bằng 8 MB.");
    totalBytes += size;
    const classificationHint = typeof item.classificationHint === "string" ? item.classificationHint.trim().slice(0, 120) : "";
    return { name, relativePath: cleanRelativePath(item.relativePath), size, mimeType, classificationHint };
  });
  if (totalBytes > MAX_BATCH_BYTES) throw new BadRequestException("Tổng dung lượng một lô ảnh không được vượt quá 100 MB.");
  const manifestHash = createHash("sha256").update(JSON.stringify({ name: value.name, preset: value.preset, purpose, targetProductSku, visualPrompt, items })).digest("hex");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : "";
  return { name: name || `Lô ảnh ${new Date().toLocaleDateString("vi-VN")}`, preset: value.preset as ImageBatchInput["preset"], purpose, targetProductSku, visualPrompt, items, totalBytes, manifestHash, idempotencyKey };
}

function isSupportedImage(file: { buffer: Buffer; mimetype: string }) {
  const { buffer, mimetype } = file;
  if (!SUPPORTED_TYPES.has(mimetype.toLowerCase())) return false;
  if (mimetype === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimetype === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: { name: string; data: Buffer }[]) {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    if (name.length > 65535 || entry.data.length > 0xffffffff || offset > 0xffffffff) throw new BadRequestException("Lô ảnh vượt giới hạn định dạng ZIP thông thường.");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    directoryParts.push(central);
    offset += local.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(directoryParts);
  if (entries.length > 0xffff || centralDirectory.length > 0xffffffff || offset > 0xffffffff) throw new BadRequestException("Lô ảnh vượt giới hạn định dạng ZIP thông thường.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

@Injectable()
export class AiImageStudioService {
  private readonly logger = new Logger(AiImageStudioService.name);
  private readonly coreUrl = (process.env.AI_CORE_URL || "http://ai-core:8000").replace(/\/+$/, "");
  private readonly coreSecret = process.env.AI_CORE_SHARED_SECRET || "";

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AiStudioQueue,
    private readonly tasks: AiStudioService,
    private readonly media: MediaAssetsService,
    private readonly commerce: CommerceService,
  ) {}

  status() {
    return {
      provider: "PHOTOROOM",
      configured: process.env.PHOTOROOM_CONFIGURED?.trim() === "true" || Boolean(process.env.PHOTOROOM_API_KEY?.trim()),
      technicalDrawingConfigured: process.env.OPENAI_CONFIGURED?.trim() === "true",
      customPromptConfigured: process.env.OPENAI_CONFIGURED?.trim() === "true",
      sandbox: process.env.PHOTOROOM_SANDBOX?.trim().toLowerCase() === "true",
      maxFilesPerBatch: MAX_ITEMS,
      maxImageBytes: MAX_IMAGE_BYTES,
      maxBatchBytes: MAX_BATCH_BYTES,
      presets: ["STONE_GREY", "WARM_IVORY", "SOFT_SAGE"],
      privateStorage: process.env.MEDIA_STORAGE_PROVIDER === "r2" && Boolean(process.env.R2_PRIVATE_BUCKET_NAME?.trim()) ? "r2-private" : "database-private",
    };
  }

  async createBatch(actor: AdminIdentity, body: unknown, idempotencyHeader: unknown) {
    const submission = validateManifest(body, idempotencyHeader);
    if (submission.purpose === "PRODUCT_PHOTO" && !this.status().configured) throw new ServiceUnavailableException("Image Studio chưa được bật. Hãy cấu hình Photoroom ở AI Core trước khi tạo lô ảnh.");
    if (submission.purpose === "TECHNICAL_DRAWING" && !this.status().technicalDrawingConfigured) throw new ServiceUnavailableException("Chưa cấu hình khóa OpenAI cho AI Core để tạo ảnh kỹ thuật.");
    if (submission.visualPrompt && !this.status().customPromptConfigured) throw new ServiceUnavailableException("Chưa cấu hình khóa OpenAI cho AI Core để tạo bối cảnh theo chỉ dẫn.");
    const targetProduct = submission.purpose === "TECHNICAL_DRAWING"
      ? await this.prisma.product.findUnique({ where: { sku: submission.targetProductSku }, select: { id: true } })
      : null;
    if (submission.purpose === "TECHNICAL_DRAWING" && !targetProduct) throw new NotFoundException("Không tìm thấy sản phẩm theo SKU đã nhập.");
    const existing = await this.prisma.aiImageBatch.findUnique({ where: { idempotencyKey: submission.idempotencyKey } });
    if (existing) {
      if (existing.createdByAdminId !== actor.id || existing.manifestHash !== submission.manifestHash) throw new ConflictException("Khóa idempotency của lô ảnh đã được sử dụng cho yêu cầu khác.");
      return this.getBatch(existing.id);
    }
    await this.queue.consumeCreateQuota(actor.id);
    const batch = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
      const active = await transaction.aiImageBatch.count({ where: { createdByAdminId: actor.id, status: { in: [...IMAGE_BATCH_ACTIVE] } } });
      if (active >= 3) throw new ConflictException("Mỗi admin chỉ có thể mở tối đa 3 lô ảnh đang xử lý hoặc chờ duyệt.");
      const created = await transaction.aiImageBatch.create({
        data: {
          idempotencyKey: submission.idempotencyKey,
          manifestHash: submission.manifestHash,
          createdByAdminId: actor.id,
          name: submission.name,
          preset: submission.preset,
          purpose: submission.purpose,
          visualPrompt: submission.visualPrompt,
          targetProductId: targetProduct?.id,
          totalBytes: BigInt(submission.totalBytes),
          items: { create: submission.items.map((item) => ({ originalFilename: item.name, relativePath: item.relativePath, mimeType: item.mimeType, expectedSize: item.size, classificationHint: item.classificationHint || null, status: "PENDING_UPLOAD", qcStatus: "PENDING" })) },
        },
        select: { id: true },
      });
      return created;
    });
    this.log("ai.image_batch.created", actor.id, batch.id, { files: submission.items.length, bytes: submission.totalBytes, preset: submission.preset, purpose: submission.purpose, targetProductId: targetProduct?.id });
    return this.getBatch(batch.id);
  }

  async uploadItem(batchId: string, itemId: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException("Chưa nhận được tệp ảnh.");
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException("Mỗi ảnh phải nhỏ hơn hoặc bằng 8 MB.");
    if (!isSupportedImage(file)) throw new BadRequestException("Nội dung ảnh không khớp định dạng JPEG, PNG hoặc WebP đã khai báo.");
    const item = await this.prisma.aiImageItem.findFirst({ where: { id: itemId, batchId }, include: { batch: true } });
    if (!item) throw new NotFoundException("Không tìm thấy ảnh trong lô.");
    if (item.originalAssetId) return this.getBatch(batchId);
    if (item.status !== "PENDING_UPLOAD") throw new ConflictException("Ảnh không còn ở trạng thái chờ tải lên.");
    if (file.size !== item.expectedSize || file.mimetype.toLowerCase() !== item.mimeType) throw new BadRequestException("Kích thước hoặc định dạng ảnh khác thông tin lô đã khai báo.");

    const digest = createHash("sha256").update(file.buffer).digest("hex");
    const asset = await this.media.save({
      filename: item.originalFilename,
      mimeType: item.mimeType,
      bytes: file.buffer,
      sourceKey: `ai-studio/items/${item.id}/original`,
      isPrivate: true,
      updateExisting: true,
      alt: "Ảnh gốc riêng tư của Image Studio",
    });
    let task;
    try {
      task = await this.prisma.$transaction(async (transaction) => {
        const createdTask = await transaction.aiTask.upsert({
          where: { idempotencyKey: `image:${item.id}` },
          create: {
            idempotencyKey: `image:${item.id}`,
            requestedByAdminId: item.batch.createdByAdminId,
            type: "IMAGE_STUDIO_PROCESSING",
            title: `Image Studio · ${item.originalFilename}`.slice(0, 120),
            input: { imageItemId: item.id } satisfies Prisma.InputJsonObject,
          },
          update: {},
        });
        await transaction.aiImageItem.update({
          where: { id: item.id },
          data: { originalAssetId: asset.id, sourceSha256: digest, taskId: createdTask.id, status: "QUEUED", classification: { state: "PENDING_AI_ASSISTED_CLASSIFICATION" } },
        });
        await transaction.aiImageBatch.update({ where: { id: batchId }, data: { status: "PROCESSING" } });
        return createdTask;
      });
      await this.queue.enqueue(task.id);
    } catch (error) {
      if (task) {
        await this.prisma.aiTask.updateMany({ where: { id: task.id, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi ảnh chưa sẵn sàng.", completedAt: new Date() } });
        await this.prisma.aiImageItem.updateMany({ where: { id: item.id, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE" } });
        await this.refreshBatchState(batchId);
      }
      throw error;
    }
    this.log("ai.image_item.queued", item.batch.createdByAdminId, item.id, { taskId: task.id, sha256: digest });
    return this.getBatch(batchId);
  }

  async listBatches(limitInput?: string) {
    const parsed = Number(limitInput || 12);
    const take = Number.isInteger(parsed) ? Math.min(30, Math.max(1, parsed)) : 12;
    const batches = await this.prisma.aiImageBatch.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: { targetProduct: { select: { sku: true, name: true } }, items: { select: { id: true, status: true, qcStatus: true, qcFlags: true, originalFilename: true, relativePath: true, taskId: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    });
    return batches.map((batch) => ({ ...batch, totalBytes: batch.totalBytes.toString() }));
  }

  async getBatch(id: string) {
    const batch = await this.prisma.aiImageBatch.findUnique({
      where: { id },
      include: {
        targetProduct: { select: { id: true, sku: true, name: true, status: true, technicalImageUrl: true } },
        items: {
          include: {
            task: { select: { id: true, status: true, approval: { select: { id: true, status: true, decisionNote: true } } } },
            attachedProduct: { select: { id: true, sku: true, name: true, status: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!batch) throw new NotFoundException("Không tìm thấy lô ảnh.");
    return { ...batch, totalBytes: batch.totalBytes.toString() };
  }

  async getPreview(itemId: string, variant: string) {
    if (variant !== "original" && variant !== "output") throw new BadRequestException("Loại ảnh xem trước không hợp lệ.");
    const item = await this.prisma.aiImageItem.findUnique({ where: { id: itemId }, select: { originalAssetId: true, outputAssetId: true } });
    if (!item) throw new NotFoundException("Không tìm thấy ảnh.");
    const assetId = variant === "original" ? item.originalAssetId : item.outputAssetId;
    if (!assetId) throw new NotFoundException(variant === "original" ? "Ảnh gốc chưa được tải lên." : "Ảnh xử lý chưa sẵn sàng.");
    const asset = await this.media.findById(assetId);
    if (!asset.isPrivate) throw new NotFoundException("Không tìm thấy ảnh riêng tư.");
    return { bytes: await this.media.read(asset), mimeType: asset.mimeType, size: asset.size, filename: asset.filename };
  }

  async decideItem(actor: AdminIdentity, itemId: string, decision: "APPROVED" | "REJECTED", note: unknown) {
    const item = await this.prisma.aiImageItem.findUnique({ where: { id: itemId }, select: { taskId: true, batchId: true, status: true } });
    if (!item?.taskId) throw new NotFoundException("Ảnh chưa có tác vụ phê duyệt.");
    if (item.status !== "AWAITING_APPROVAL") throw new ConflictException("Ảnh chưa sẵn sàng để duyệt.");
    const result = await this.tasks.decideApproval(actor, item.taskId, decision, note);
    await this.refreshBatchState(item.batchId);
    this.log(`ai.image_item.${decision.toLowerCase()}`, actor.id, itemId, { batchId: item.batchId });
    return result;
  }

  async retryItem(actor: AdminIdentity, itemId: string) {
    const item = await this.prisma.aiImageItem.findUnique({ where: { id: itemId }, include: { task: true } });
    if (!item?.task) throw new NotFoundException("Không tìm thấy tác vụ ảnh để thử lại.");
    if (item.status !== "FAILED" || item.task.status !== "FAILED") throw new ConflictException("Chỉ có thể thử lại ảnh đã thất bại.");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.aiTask.update({ where: { id: item.taskId! }, data: { status: "QUEUED", attemptCount: 0, errorCode: null, errorMessage: null, completedAt: null, startedAt: null, result: Prisma.JsonNull } });
      await transaction.aiImageItem.update({ where: { id: item.id }, data: { status: "QUEUED", errorCode: null, attemptCount: 0, qcStatus: "PENDING", qcFlags: [], qcReport: Prisma.JsonNull, outputAssetId: null } });
      await transaction.aiImageBatch.update({ where: { id: item.batchId }, data: { status: "PROCESSING" } });
    });
    await this.queue.enqueue(item.taskId!, true);
    this.log("ai.image_item.retry_queued", actor.id, itemId, { taskId: item.taskId });
    return this.getBatch(item.batchId);
  }

  async cancelBatch(actor: AdminIdentity, batchId: string) {
    const batch = await this.getBatch(batchId);
    for (const item of batch.items) {
      if (!ALLOWED_ITEM_TRANSITIONS.includes(item.status as typeof ALLOWED_ITEM_TRANSITIONS[number])) continue;
      if (item.taskId) await this.tasks.cancelTask(actor, item.taskId);
      await this.prisma.aiImageItem.updateMany({ where: { id: item.id, status: { in: [...ALLOWED_ITEM_TRANSITIONS] } }, data: { status: "CANCELLED", errorCode: null } });
    }
    await this.refreshBatchState(batchId);
    this.log("ai.image_batch.cancelled", actor.id, batchId);
    return this.getBatch(batchId);
  }

  async attachToDraft(actor: AdminIdentity, itemId: string, skuInput: unknown) {
    const sku = typeof skuInput === "string" ? skuInput.trim() : "";
    if (!sku || sku.length > 64) throw new BadRequestException("Hãy nhập SKU sản phẩm bản nháp.");
    const [item, product] = await Promise.all([
      this.prisma.aiImageItem.findUnique({ where: { id: itemId }, include: { batch: true } }),
      this.prisma.product.findUnique({ where: { sku }, select: { id: true, sku: true, name: true, status: true } }),
    ]);
    if (item?.batch.purpose === "TECHNICAL_DRAWING") throw new BadRequestException("Tác vụ này là ảnh kỹ thuật. Hãy dùng nút gắn ảnh kỹ thuật vào SKU đã chọn khi tạo lô.");
    if (!item?.outputAssetId) throw new NotFoundException("Ảnh xử lý chưa có kết quả.");
    if (item.status !== "APPROVED") throw new ConflictException("Cần duyệt ảnh trước khi gắn vào sản phẩm.");
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm theo SKU.");
    if (product.status !== "DRAFT") throw new ConflictException("Image Studio chỉ gắn ảnh vào sản phẩm ở trạng thái bản nháp; thao tác này không xuất bản sản phẩm.");
    if (item.attachedProductId) {
      if (item.attachedProductId === product.id) return this.getBatch(item.batchId);
      throw new ConflictException("Ảnh này đã được gắn vào một SKU khác.");
    }
    const outputAsset = await this.media.findById(item.outputAssetId);
    if (!outputAsset.isPrivate) throw new ConflictException("Ảnh kết quả không ở kho riêng tư như mong đợi.");
    const outputBytes = await this.media.read(outputAsset);
    const published = await this.media.save({
      filename: outputAsset.filename,
      mimeType: outputAsset.mimeType,
      bytes: outputBytes,
      sourceKey: `ai-studio/published/${item.id}/${randomUUID()}`,
      isPrivate: false,
      alt: product.name,
    });
    try {
      const attached = await this.prisma.$transaction(async (transaction) => {
        const stillDraft = await transaction.product.findUnique({ where: { id: product.id }, select: { status: true, name: true } });
        if (!stillDraft || stillDraft.status !== "DRAFT") throw new ConflictException("Sản phẩm không còn ở trạng thái bản nháp.");
        const claim = await transaction.aiImageItem.updateMany({ where: { id: item.id, status: "APPROVED", attachedProductId: null }, data: { attachedProductId: product.id, publishedAssetId: published.id } });
        if (claim.count !== 1) throw new ConflictException("Ảnh vừa được gắn vào sản phẩm khác.");
        const current = await transaction.productImage.findFirst({ where: { productId: product.id }, select: { sortOrder: true }, orderBy: { sortOrder: "desc" } });
        await transaction.productImage.create({ data: { productId: product.id, url: published.url, alt: stillDraft.name, sortOrder: (current?.sortOrder ?? -1) + 1, isPrimary: !current } });
        return transaction.aiImageItem.findUniqueOrThrow({ where: { id: item.id }, select: { id: true, attachedProductId: true, publishedAssetId: true } });
      });
      this.commerce.notifyProductImagesUpdated(product.id);
      this.log("ai.image_item.attached_to_draft", actor.id, item.id, { productId: product.id, sku: product.sku, publishedAssetId: attached.publishedAssetId });
      return this.getBatch(item.batchId);
    } catch (error) {
      await this.media.removeUnreferencedAsset(published.id).catch(() => undefined);
      throw error;
    }
  }

  async attachTechnicalDrawing(actor: AdminIdentity, itemId: string) {
    const item = await this.prisma.aiImageItem.findUnique({
      where: { id: itemId },
      include: { batch: { include: { targetProduct: { select: { id: true, sku: true, name: true, technicalImageUrl: true } } } } },
    });
    if (!item?.outputAssetId) throw new NotFoundException("Ảnh kỹ thuật chưa có kết quả.");
    if (item.batch.purpose !== "TECHNICAL_DRAWING" || !item.batch.targetProduct) throw new BadRequestException("Lô ảnh này chưa được tạo cho ảnh kỹ thuật của sản phẩm.");
    if (item.status !== "APPROVED") throw new ConflictException("Cần duyệt ảnh kỹ thuật trước khi gắn vào sản phẩm.");
    const product = item.batch.targetProduct;
    if (item.attachedProductId) {
      if (item.attachedProductId === product.id && item.publishedAssetId) return this.getBatch(item.batchId);
      throw new ConflictException("Ảnh này đã được gắn vào một sản phẩm khác.");
    }

    const outputAsset = await this.media.findById(item.outputAssetId);
    if (!outputAsset.isPrivate) throw new ConflictException("Ảnh kết quả không còn ở kho riêng tư như mong đợi.");
    const outputBytes = await this.media.read(outputAsset);
    const published = await this.media.save({
      filename: `geme-technical-${product.sku}-${item.id}.png`,
      mimeType: outputAsset.mimeType,
      bytes: outputBytes,
      sourceKey: `ai-studio/technical-drawings/${item.id}/published`,
      isPrivate: false,
      updateExisting: true,
      alt: `Bản vẽ kỹ thuật AI tham khảo · ${product.name}`,
    });
    try {
      await this.prisma.$transaction(async (transaction) => {
        const currentProduct = await transaction.product.findUnique({ where: { id: product.id }, select: { name: true } });
        if (!currentProduct) throw new NotFoundException("Sản phẩm đích không còn tồn tại.");
        const claim = await transaction.aiImageItem.updateMany({ where: { id: item.id, status: "APPROVED", attachedProductId: null }, data: { attachedProductId: product.id, publishedAssetId: published.id } });
        if (claim.count !== 1) throw new ConflictException("Ảnh vừa được gắn vào một sản phẩm khác.");
        await transaction.product.update({ where: { id: product.id }, data: { technicalImageUrl: published.url } });
        await transaction.productMediaAsset.create({
          data: {
            productId: product.id,
            mediaAssetId: published.id,
            tag: "TECHNICAL_DRAWING",
            sourceAiImageItemId: item.id,
            approvedByAdminId: actor.id,
            approvedAt: new Date(),
            metadata: { source: "AI_STUDIO", label: "Ảnh kỹ thuật", isAiGenerated: true, isManufacturingSpecification: false },
          },
        });
      });
      this.commerce.notifyProductImagesUpdated(product.id);
      this.log("ai.technical_drawing.attached", actor.id, item.id, { productId: product.id, sku: product.sku, tag: "TECHNICAL_DRAWING", publishedAssetId: published.id });
      return this.getBatch(item.batchId);
    } catch (error) {
      await this.media.removeUnreferencedAsset(published.id).catch(() => undefined);
      throw error;
    }
  }

  async listTechnicalDrawings(skuInput: string) {
    const sku = skuInput.trim();
    if (!sku || sku.length > 64) throw new BadRequestException("SKU sản phẩm không hợp lệ.");
    const product = await this.prisma.product.findUnique({ where: { sku }, select: { id: true, sku: true, name: true, technicalImageUrl: true } });
    if (!product) throw new NotFoundException("Không tìm thấy sản phẩm theo SKU.");
    const assets = await this.prisma.productMediaAsset.findMany({
      where: { productId: product.id, tag: "TECHNICAL_DRAWING" },
      orderBy: { createdAt: "desc" },
      include: { mediaAsset: { select: { id: true, filename: true, mimeType: true, isPrivate: true, storageProvider: true, objectKey: true, sourceKey: true, size: true } } },
    });
    return { product, assets: assets.map(({ mediaAsset, ...link }) => ({ ...link, url: this.media.urlFor(mediaAsset), filename: mediaAsset.filename, mimeType: mediaAsset.mimeType })) };
  }

  async download(itemId: string, formatInput: string) {
    const format = formatInput.toLowerCase();
    if (!["png", "jpeg", "webp"].includes(format)) throw new BadRequestException("Định dạng tải ảnh không được hỗ trợ.");
    const item = await this.prisma.aiImageItem.findUnique({ where: { id: itemId }, select: { status: true, outputAssetId: true, originalFilename: true } });
    if (!item?.outputAssetId) throw new NotFoundException("Chưa có ảnh đã xử lý.");
    if (item.status !== "APPROVED") throw new ConflictException("Chỉ tải được ảnh đã được admin phê duyệt.");
    const asset = await this.media.findById(item.outputAssetId);
    const source = await this.media.read(asset);
    const result = format === "png" ? { bytes: source, mimeType: "image/png" } : await this.convert(source, format);
    const extension = format === "jpeg" ? "jpg" : format;
    return { ...result, filename: `${basename(item.originalFilename, `.${item.originalFilename.split(".").pop()}`)}-geme.${extension}` };
  }

  async exportBatch(batchId: string) {
    const batch = await this.prisma.aiImageBatch.findUnique({ where: { id: batchId }, include: { items: { where: { status: "APPROVED", outputAssetId: { not: null } }, orderBy: { createdAt: "asc" } } } });
    if (!batch) throw new NotFoundException("Không tìm thấy lô ảnh.");
    if (!batch.items.length) throw new ConflictException("Lô chưa có ảnh được duyệt để xuất.");
    if (batch.items.length > MAX_ITEMS) throw new BadRequestException("Lô vượt giới hạn xuất ZIP.");
    const entries: { name: string; data: Buffer }[] = [];
    let totalBytes = 0;
    for (const item of batch.items) {
      const asset = await this.media.findById(item.outputAssetId!);
      const bytes = await this.media.read(asset);
      totalBytes += bytes.byteLength;
      if (totalBytes > 120 * 1024 * 1024) throw new BadRequestException("Tổng ảnh đã duyệt vượt giới hạn ZIP 120 MB. Hãy chia thành nhiều lô nhỏ.");
      const directory = item.relativePath ? `${item.relativePath}/` : "";
      const safeName = basename(item.originalFilename).replace(/[<>:"|?*]/g, "_");
      entries.push({ name: `${directory}${item.id.slice(0, 8)}-${safeName.replace(/\.[^.]+$/, "")}-geme.png`, data: bytes });
    }
    return { bytes: storedZip(entries), filename: `${batch.name.replace(/[<>:"/\\|?*]/g, "_")}-geme-images.zip` };
  }

  async writePreview(itemId: string, variant: string, response: BinaryResponse) {
    const asset = await this.getPreview(itemId, variant);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return response.end(asset.bytes);
  }

  async writeDownload(itemId: string, format: string, response: BinaryResponse) {
    const asset = await this.download(itemId, format);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.bytes.length));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    return response.end(asset.bytes);
  }

  async writeZip(batchId: string, response: BinaryResponse) {
    const archive = await this.exportBatch(batchId);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Length", String(archive.bytes.length));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`);
    return response.end(archive.bytes);
  }

  private async convert(image: Buffer, format: string) {
    if (Buffer.byteLength(this.coreSecret.trim(), "utf8") < 32) throw new ServiceUnavailableException("AI Core chưa được cấu hình khóa nội bộ.");
    const form = new FormData();
    form.append("image_file", new Blob([Uint8Array.from(image)], { type: "image/png" }), "geme-image.png");
    form.append("output_format", format);
    let response: Response;
    try {
      response = await fetch(`${this.coreUrl}/internal/images/convert`, { method: "POST", headers: { "X-AI-Core-Key": this.coreSecret }, body: form, signal: AbortSignal.timeout(45_000) });
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "ai.image_convert.failed", code: error instanceof Error ? error.name : "AI_CORE_UNAVAILABLE" }));
      throw new ServiceUnavailableException("Không kết nối được bộ chuyển định dạng ảnh.");
    }
    if (!response.ok) throw new ServiceUnavailableException("Bộ chuyển định dạng ảnh tạm thời không xử lý được yêu cầu.");
    return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || "application/octet-stream" };
  }

  private async refreshBatchState(batchId: string) {
    const statuses = (await this.prisma.aiImageItem.findMany({ where: { batchId }, select: { status: true } })).map((item) => item.status);
    let status: "UPLOADING" | "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "PROCESSING";
    if (statuses.some((value) => value === "PENDING_UPLOAD")) status = "UPLOADING";
    else if (statuses.some((value) => value === "QUEUED" || value === "RUNNING")) status = "PROCESSING";
    else if (statuses.some((value) => value === "AWAITING_APPROVAL")) status = "REVIEW";
    else if (statuses.every((value) => value === "APPROVED")) status = "COMPLETE";
    else if (statuses.every((value) => value === "CANCELLED")) status = "CANCELLED";
    else if (statuses.every((value) => value === "FAILED")) status = "FAILED";
    else status = "PARTIAL";
    await this.prisma.aiImageBatch.update({ where: { id: batchId }, data: { status } });
  }

  private log(event: string, adminId: string, entityId: string, fields: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ event, adminId, entityId, ...fields, at: new Date().toISOString() }));
  }
}
