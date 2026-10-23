import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { sanitizeBlogHtml } from "../commerce/blog-html.js";
import { MediaAssetsService } from "../media/media-assets.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiStudioQueue } from "./ai-studio.queue.js";

const draftStatuses = ["QUEUED", "RUNNING", "NEEDS_REVIEW", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "FAILED", "CANCELLED"] as const;
type DraftStatus = (typeof draftStatuses)[number];
const activelyBeingWorked = ["QUEUED", "RUNNING", "NEEDS_REVIEW", "READY_FOR_REVIEW"] as const;
const editableFields = {
  productName: 180,
  shortDescription: 500,
  detailedDescription: 6000,
  categorySuggestion: 160,
  materialSuggestion: 160,
  gemstoneSuggestion: 160,
  seoTitle: 180,
  seoMetaDescription: 320,
  altText: 500,
} as const;

export type ProductDraftSubmission = { imageItemIds: string[]; idempotencyKey: string; manifestHash: string };
type VerifiedLegacyProduct = { sku: string; productId: string };
type DirectProductImage = { buffer: Buffer; originalname: string; mimetype: string; size: number };

const directImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const directMaxImageBytes = 8 * 1024 * 1024;
const directMaxBatchBytes = 40 * 1024 * 1024;

function isSupportedDirectImage(file: DirectProductImage) {
  const mime = file.mimetype.toLowerCase();
  if (!directImageTypes.has(mime)) return false;
  if (mime === "image/png") return file.buffer.length >= 8 && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  return file.buffer.length >= 12 && file.buffer.toString("ascii", 0, 4) === "RIFF" && file.buffer.toString("ascii", 8, 12) === "WEBP";
}

function safeDirectFilename(value: string) {
  const name = value.replace(/\\/g, "/").split("/").at(-1)?.replace(/[\0-\x1f\x7f]/g, "").trim().slice(0, 240) || "product-image";
  if (name === "." || name === "..") throw new BadRequestException("Tên ảnh tải lên không hợp lệ.");
  return name;
}

export function verifiedLegacyProduct(report: Prisma.JsonValue | null): VerifiedLegacyProduct | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const data = report as Record<string, Prisma.JsonValue>;
  if (data.source !== "LEGACY_SQL" || typeof data.verifiedSku !== "string" || typeof data.verifiedProductId !== "string") return null;
  const sku = data.verifiedSku.trim();
  const productId = data.verifiedProductId.trim();
  if (!sku || sku.length > 64 || !/^[0-9a-f-]{36}$/i.test(productId)) return null;
  return { sku, productId };
}

type PageCursor = { createdAt: Date; id: string };

function parsePageCursor(value?: string): PageCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    const createdAt = typeof decoded.createdAt === "string" ? new Date(decoded.createdAt) : new Date(Number.NaN);
    if (!Number.isFinite(createdAt.getTime()) || typeof decoded.id !== "string" || !/^[0-9a-f-]{36}$/i.test(decoded.id)) throw new Error("invalid cursor");
    return { createdAt, id: decoded.id };
  } catch {
    throw new BadRequestException("Con trỏ phân trang không hợp lệ; hãy tải lại danh sách.");
  }
}

function encodePageCursor(item: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt.toISOString(), id: item.id })).toString("base64url");
}

export function normalizeProductDraftSubmission(value: unknown, idempotencyKey: unknown): ProductDraftSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Yêu cầu tạo bản nháp không hợp lệ.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "imageItemIds")) throw new BadRequestException("Yêu cầu chỉ nhận danh sách ảnh đã duyệt.");
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException("Thiếu hoặc sai khóa Idempotency-Key.");
  if (!Array.isArray(body.imageItemIds) || body.imageItemIds.length < 1 || body.imageItemIds.length > 5) {
    throw new BadRequestException("Chọn từ 1 đến 5 ảnh đã duyệt cho mỗi lô bản nháp.");
  }
  const ids = body.imageItemIds.map((id) => typeof id === "string" ? id.trim().toLowerCase() : "");
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
    throw new BadRequestException("Danh sách ảnh có mã không hợp lệ.");
  }
  if (new Set(ids).size !== ids.length) throw new BadRequestException("Danh sách ảnh không được chứa mục trùng.");
  const manifestHash = createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
  return { imageItemIds: ids, idempotencyKey: key, manifestHash };
}

export function normalizeProductDraftPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Nội dung chỉnh sửa không hợp lệ.");
  const body = value as Record<string, unknown>;
  const data: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(body)) {
    if (!Object.hasOwn(editableFields, key)) throw new BadRequestException(`Không thể sửa trường ${key}.`);
    const maxLength = editableFields[key as keyof typeof editableFields];
    if (entry === null && ["categorySuggestion", "materialSuggestion", "gemstoneSuggestion"].includes(key)) {
      data[key] = null;
      continue;
    }
    if (typeof entry !== "string" || entry.length > maxLength) throw new BadRequestException(`Trường ${key} phải là văn bản tối đa ${maxLength} ký tự.`);
    data[key] = entry.trim();
  }
  if (!Object.keys(data).length) throw new BadRequestException("Không có nội dung nào cần lưu.");
  if (data.productName !== undefined && !data.productName) throw new BadRequestException("Tên sản phẩm không được để trống.");
  return data;
}

@Injectable()
export class AiProductAgentService {
  private readonly logger = new Logger(AiProductAgentService.name);

  constructor(private readonly prisma: PrismaService, private readonly queue: AiStudioQueue, private readonly media: MediaAssetsService, private readonly commerce: CommerceService) {}

  status() {
    return {
      provider: "OpenAI Responses API",
      configured: process.env.OPENAI_CONFIGURED?.trim() === "true",
      maxFilesPerBatch: 5,
      maxImageBytes: 8 * 1024 * 1024,
      maxDirectUploadBytes: directMaxBatchBytes,
      directUpload: true,
      sideEffects: "no_product_update_until_admin_approval_and_valid_sku_attachment",
    };
  }

  async listApprovedImages(limitInput?: string, cursorInput?: string) {
    const parsed = Number(limitInput || 60);
    const take = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 60;
    const cursor = parsePageCursor(cursorInput);
    const approvedWhere = {
      status: "APPROVED" as const,
      outputAssetId: { not: null },
      outputAsset: { is: { isPrivate: true } },
      batch: { purpose: "PRODUCT_PHOTO" as const, isProductAgentDirectUpload: false },
    };
    const [items, total] = await Promise.all([this.prisma.aiImageItem.findMany({
      where: { ...approvedWhere, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      select: {
        id: true, originalFilename: true, relativePath: true, qcStatus: true, createdAt: true,
        batch: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }), this.prisma.aiImageItem.count({ where: approvedWhere })]);
    const hasMore = items.length > take;
    if (hasMore) items.pop();
    if (!items.length) return { items: [], nextCursor: null, hasMore: false, total };
    const drafts = await this.prisma.aiProductDraft.findMany({
      where: { sourceImageItemId: { in: items.map((item) => item.id) } },
      select: { id: true, sourceImageItemId: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const mostRecent = new Map<string, (typeof drafts)[number]>();
    for (const draft of drafts) if (!mostRecent.has(draft.sourceImageItemId)) mostRecent.set(draft.sourceImageItemId, draft);
    return {
      items: items.map((item) => ({
        ...item,
        previewUrl: `/api/admin/admin/ai-studio/image-studio/items/${item.id}/preview?variant=output`,
        latestDraft: mostRecent.get(item.id) || null,
      })),
      nextCursor: hasMore ? encodePageCursor(items.at(-1)!) : null,
      hasMore,
      total,
    };
  }

  async uploadDirectImages(actor: AdminIdentity, filesInput: DirectProductImage[] | undefined, idempotencyHeader: unknown) {
    const files = Array.isArray(filesInput) ? filesInput : [];
    if (files.length < 1 || files.length > 5) throw new BadRequestException("Tải từ 1 đến 5 ảnh cho mỗi lô Product Agent.");
    const key = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException("Thiếu khóa Idempotency-Key hợp lệ.");

    let totalBytes = 0;
    const manifest = files.map((file) => {
      if (!file?.buffer?.length || file.size !== file.buffer.length) throw new BadRequestException("Có ảnh tải lên không hợp lệ hoặc bị rỗng.");
      if (file.size > directMaxImageBytes) throw new BadRequestException("Mỗi ảnh phải nhỏ hơn hoặc bằng 8 MB.");
      if (!isSupportedDirectImage(file)) throw new BadRequestException("Chỉ nhận ảnh JPEG, PNG hoặc WebP đúng định dạng.");
      totalBytes += file.size;
      return { filename: safeDirectFilename(file.originalname), mimeType: file.mimetype.toLowerCase(), size: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex") };
    });
    if (totalBytes > directMaxBatchBytes) throw new BadRequestException("Tổng dung lượng một lô không được vượt quá 40 MB.");

    const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const keyHash = createHash("sha256").update(`${actor.id}:${key}`).digest("hex");
    const imageBatchKey = `pa-upload:${keyHash}`;
    const draftBatchKey = `pa-draft:${keyHash}`;
    const existing = await this.prisma.aiImageBatch.findUnique({ where: { idempotencyKey: imageBatchKey }, include: { items: { select: { id: true }, orderBy: { createdAt: "asc" } } } });
    if (existing) {
      if (existing.createdByAdminId !== actor.id || existing.manifestHash !== manifestHash || !existing.isProductAgentDirectUpload) {
        throw new ConflictException("Khóa tải ảnh đã được sử dụng cho một bộ ảnh khác.");
      }
      return this.createBatch(actor, { imageItemIds: existing.items.map(({ id }) => id) }, draftBatchKey);
    }

    const stored: { id: string }[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const name = manifest[index].filename;
        const sourceDigest = createHash("sha256").update(`${keyHash}:${index}:${manifest[index].sha256}`).digest("hex");
        const asset = await this.media.save({
          filename: name,
          mimeType: manifest[index].mimeType,
          bytes: file.buffer,
          sourceKey: `private-media/ai-product-agent/${actor.id}/${sourceDigest}`,
          isPrivate: true,
          alt: `Ảnh nguồn Product Agent · ${name}`.slice(0, 240),
          updateExisting: true,
        });
        stored.push({ id: asset.id });
      }

      let imageBatch;
      try {
        imageBatch = await this.prisma.aiImageBatch.create({
          data: {
            idempotencyKey: imageBatchKey,
            manifestHash,
            createdByAdminId: actor.id,
            name: `Product Agent trực tiếp · ${new Date().toLocaleDateString("vi-VN")}`,
            preset: "STONE_GREY",
            purpose: "PRODUCT_PHOTO",
            isProductAgentDirectUpload: true,
            status: "COMPLETE",
            totalBytes: BigInt(totalBytes),
            items: {
              create: files.map((_, index) => ({
                originalFilename: manifest[index].filename,
                mimeType: manifest[index].mimeType,
                expectedSize: manifest[index].size,
                sourceSha256: manifest[index].sha256,
                status: "APPROVED" as const,
                qcStatus: "REVIEW" as const,
                qcFlags: ["DIRECT_PRODUCT_AGENT_UPLOAD", "IMAGE_STUDIO_QC_SKIPPED"],
                classification: { source: "DIRECT_PRODUCT_AGENT_UPLOAD", visualEditing: "SKIPPED" },
                qcReport: { source: "DIRECT_PRODUCT_AGENT_UPLOAD", requiresVisualReview: true, imageStudioQc: "SKIPPED" },
                outputAsset: { connect: { id: stored[index].id } },
              })),
            },
          },
          include: { items: { select: { id: true }, orderBy: { createdAt: "asc" } } },
        });
      } catch (error) {
        const raced = await this.prisma.aiImageBatch.findUnique({ where: { idempotencyKey: imageBatchKey }, include: { items: { select: { id: true }, orderBy: { createdAt: "asc" } } } });
        if (!raced) throw error;
        if (raced.createdByAdminId !== actor.id || raced.manifestHash !== manifestHash || !raced.isProductAgentDirectUpload) {
          throw new ConflictException("Khóa tải ảnh đã được sử dụng cho một bộ ảnh khác.");
        }
        imageBatch = raced;
      }

      this.log("ai.product_agent.direct_upload_stored", actor.id, imageBatch.id, { count: imageBatch.items.length, totalBytes });
      return this.createBatch(actor, { imageItemIds: imageBatch.items.map(({ id }) => id) }, draftBatchKey);
    } catch (error) {
      for (const asset of stored) await this.media.removeUnreferencedAsset(asset.id).catch(() => false);
      throw error;
    }
  }

  async createBatch(actor: AdminIdentity, value: unknown, idempotencyHeader: unknown) {
    const submission = normalizeProductDraftSubmission(value, idempotencyHeader);
    const existing = await this.prisma.aiProductDraftBatch.findUnique({ where: { idempotencyKey: submission.idempotencyKey }, include: { drafts: { orderBy: { createdAt: "asc" } } } });
    if (existing) return this.returnExisting(existing, actor, submission);

    const selected = await this.prisma.aiImageItem.findMany({
      where: {
        id: { in: submission.imageItemIds },
        status: "APPROVED",
        outputAssetId: { not: null },
        outputAsset: { is: { isPrivate: true } },
        batch: { purpose: "PRODUCT_PHOTO" },
      },
      select: { id: true, originalFilename: true, qcReport: true },
    });
    if (selected.length !== submission.imageItemIds.length) {
      throw new ConflictException("Mỗi ảnh phải là ảnh sản phẩm đã được duyệt và còn lưu riêng trong Image Studio.");
    }
    const verifiedByImage = new Map<string, VerifiedLegacyProduct>();
    const legacyMatches = selected.flatMap((item) => {
      const match = verifiedLegacyProduct(item.qcReport);
      if (match) verifiedByImage.set(item.id, match);
      return match ? [match] : [];
    });
    if (legacyMatches.length) {
      const products = await this.prisma.product.findMany({
        where: { sku: { in: [...new Set(legacyMatches.map(({ sku }) => sku))] } },
        select: { id: true, sku: true, status: true },
      });
      const productBySku = new Map(products.map((product) => [product.sku.toLocaleUpperCase("en"), product]));
      for (const [imageId, match] of verifiedByImage) {
        const product = productBySku.get(match.sku.toLocaleUpperCase("en"));
        if (!product || product.id !== match.productId || product.status !== "DRAFT") {
          throw new ConflictException(`SKU ${match.sku} không còn khớp hồ sơ sản phẩm bản nháp. Tải lại danh sách trước khi tạo mô tả.`);
        }
      }
    }
    const inProgress = await this.prisma.aiProductDraft.findFirst({
      where: { sourceImageItemId: { in: submission.imageItemIds }, status: { in: [...activelyBeingWorked] } },
      select: { sourceImageItemId: true },
    });
    if (inProgress) throw new ConflictException("Một ảnh đang có bản nháp chờ xử lý hoặc rà soát. Hoàn tất bản nháp đó trước khi tạo lại.");

    await this.queue.consumeCreateQuota(actor.id);
    const activeLimit = this.activeTaskLimit();
    let batch;
    try {
      batch = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
        for (const itemId of [...submission.imageItemIds].sort()) {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"geme-product-source:" + itemId})::bigint)`;
        }
        const activeCount = await transaction.aiTask.count({ where: { requestedByAdminId: actor.id, status: { in: ["QUEUED", "RUNNING"] } } });
        if (activeCount + submission.imageItemIds.length > activeLimit) {
          throw new ConflictException(`Còn chỗ cho tối đa ${Math.max(0, activeLimit - activeCount)} tác vụ AI đang hoạt động.`);
        }
        const duplicate = await transaction.aiProductDraft.findFirst({ where: { sourceImageItemId: { in: submission.imageItemIds }, status: { in: [...activelyBeingWorked] } }, select: { id: true } });
        if (duplicate) throw new ConflictException("Một ảnh vừa được đưa sang Product Agent từ yêu cầu khác.");
        const createdBatch = await transaction.aiProductDraftBatch.create({
          data: { idempotencyKey: submission.idempotencyKey, manifestHash: submission.manifestHash, createdByAdminId: actor.id },
        });
        for (const itemId of submission.imageItemIds) {
          const draftId = randomUUID();
          const task = await transaction.aiTask.create({
            data: {
              idempotencyKey: `product-draft:${createHash("sha256").update(`${createdBatch.id}:${itemId}`).digest("hex")}`,
              requestedByAdminId: actor.id,
              type: "PRODUCT_DRAFT_GENERATION",
              title: `Product Agent · ${selected.find((item) => item.id === itemId)?.originalFilename || itemId}`.slice(0, 120),
              input: {
                imageItemId: itemId,
                productDraftId: draftId,
                ...(verifiedByImage.has(itemId) ? {
                  verifiedProductSku: verifiedByImage.get(itemId)!.sku,
                  verifiedProductId: verifiedByImage.get(itemId)!.productId,
                } : {}),
              },
            },
          });
          await transaction.aiProductDraft.create({ data: { id: draftId, batchId: createdBatch.id, taskId: task.id, sourceImageItemId: itemId } });
        }
        return createdBatch;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const raced = await this.prisma.aiProductDraftBatch.findUnique({ where: { idempotencyKey: submission.idempotencyKey }, include: { drafts: { orderBy: { createdAt: "asc" } } } });
        if (raced) return this.returnExisting(raced, actor, submission);
      }
      throw error;
    }

    const drafts = await this.prisma.aiProductDraft.findMany({ where: { batchId: batch.id }, select: { id: true, taskId: true } });
    for (const draft of drafts) {
      try {
        await this.queue.enqueue(draft.taskId);
      } catch (error) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.aiTask.updateMany({ where: { id: draft.taskId, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi chưa sẵn sàng. Thử lại bản nháp sau.", completedAt: new Date() } });
          await transaction.aiProductDraft.updateMany({ where: { id: draft.id, status: "QUEUED" }, data: { status: "FAILED" } });
        });
        this.log("ai.product_draft.queue_failed", actor.id, draft.id, { taskId: draft.taskId });
        if (!(error instanceof ServiceUnavailableException)) this.logger.warn("Unexpected Product Agent enqueue failure.");
      }
    }
    this.log("ai.product_draft.batch_queued", actor.id, batch.id, { count: drafts.length });
    await this.refreshBatchState(batch.id);
    return this.batch(batch.id);
  }

  async listBatches(limitInput?: string) {
    const parsed = Number(limitInput || 10);
    const take = Number.isInteger(parsed) ? Math.min(20, Math.max(1, parsed)) : 10;
    const batches = await this.prisma.aiProductDraftBatch.findMany({
      orderBy: { createdAt: "desc" }, take,
      include: { drafts: { include: { task: { select: { status: true, errorMessage: true, attemptCount: true } }, sourceImageItem: { select: { id: true, originalFilename: true } } }, orderBy: { createdAt: "asc" } } },
    });
    return batches;
  }

  async listDrafts(statusInput?: string, limitInput?: string, cursorInput?: string, searchInput?: string) {
    let status: DraftStatus | undefined;
    if (statusInput) {
      if (!draftStatuses.includes(statusInput as DraftStatus)) throw new BadRequestException("Trạng thái Product Draft không hợp lệ.");
      status = statusInput as DraftStatus;
    }
    const parsed = Number(limitInput || 50);
    const take = Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
    const cursor = parsePageCursor(cursorInput);
    const search = typeof searchInput === "string" ? searchInput.trim().slice(0, 120) : "";
    const baseWhere = {
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { productName: { contains: search, mode: "insensitive" as const } },
          { sourceImageItem: { is: { originalFilename: { contains: search, mode: "insensitive" as const } } } },
        ] } : {}),
      };
    const [items, total] = await Promise.all([this.prisma.aiProductDraft.findMany({
      where: {
        ...baseWhere,
        ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : {}),
      },
      include: {
        batch: { select: { id: true, status: true, createdAt: true } },
        task: { select: { id: true, status: true, errorCode: true, errorMessage: true, attemptCount: true } },
        sourceImageItem: { select: { id: true, originalFilename: true, attachedProduct: { select: { id: true, sku: true, name: true } }, batch: { select: { id: true, name: true } } } },
        reviewedBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1,
    }), this.prisma.aiProductDraft.count({ where: baseWhere })]);
    const hasMore = items.length > take;
    if (hasMore) items.pop();
    return { items, nextCursor: hasMore && items.length ? encodePageCursor(items.at(-1)!) : null, hasMore, total };
  }

  async bulkDecideDrafts(actor: AdminIdentity, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Yêu cầu duyệt hàng loạt không hợp lệ.");
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["draftIds", "decision", "note"].includes(key))) throw new BadRequestException("Yêu cầu chứa trường không được hỗ trợ.");
    if (!Array.isArray(body.draftIds) || body.draftIds.length < 1 || body.draftIds.length > 100 || body.draftIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException("Chọn từ 1 đến 100 bản nháp hợp lệ.");
    }
    const ids = [...new Set((body.draftIds as string[]).map((id) => id.toLowerCase()))];
    if (ids.length !== body.draftIds.length) throw new BadRequestException("Danh sách bản nháp không được chứa mục trùng.");
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED") throw new BadRequestException("Quyết định chỉ được là APPROVED hoặc REJECTED.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    const batchIds = await this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.aiProductDraft.findMany({ where: { id: { in: ids } }, select: { id: true, batchId: true, status: true } });
      if (candidates.length !== ids.length || candidates.some((draft) => !["NEEDS_REVIEW", "READY_FOR_REVIEW"].includes(draft.status))) {
        throw new ConflictException("Có bản nháp đã thay đổi trạng thái. Tải lại danh sách trước khi duyệt hàng loạt.");
      }
      const updated = await transaction.aiProductDraft.updateMany({
        where: { id: { in: ids }, status: { in: ["NEEDS_REVIEW", "READY_FOR_REVIEW"] } },
        data: {
          status: body.decision as "APPROVED" | "REJECTED",
          reviewedByAdminId: actor.id,
          reviewedAt: new Date(),
          ...(body.decision === "REJECTED" && note ? { reviewReasons: { push: `ADMIN: ${note.slice(0, 180)}` } } : {}),
        },
      });
      if (updated.count !== ids.length) throw new ConflictException("Một số bản nháp vừa được cập nhật bởi quản trị viên khác.");
      return [...new Set(candidates.map((draft) => draft.batchId))];
    });
    for (let offset = 0; offset < batchIds.length; offset += 10) {
      await Promise.all(batchIds.slice(offset, offset + 10).map((batchId) => this.refreshBatchState(batchId)));
    }
    this.log(`ai.product_draft.bulk_${String(body.decision).toLowerCase()}`, actor.id, ids[0], { count: ids.length, batchCount: batchIds.length, note: note || undefined });
    return { updatedCount: ids.length };
  }

  async batch(id: string) {
    const batch = await this.prisma.aiProductDraftBatch.findUnique({
      where: { id },
      include: {
        drafts: {
          include: {
            task: { select: { id: true, status: true, errorCode: true, errorMessage: true, attemptCount: true } },
            sourceImageItem: { select: { id: true, originalFilename: true } },
            reviewedBy: { select: { id: true, displayName: true } },
          }, orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!batch) throw new NotFoundException("Không tìm thấy lô bản nháp sản phẩm.");
    return batch;
  }

  async getDraft(id: string) {
    const draft = await this.prisma.aiProductDraft.findUnique({
      where: { id },
      include: {
        batch: { select: { id: true, status: true } },
        task: { select: { id: true, status: true, errorCode: true, errorMessage: true, attemptCount: true } },
        sourceImageItem: { select: { id: true, originalFilename: true, attachedProduct: { select: { id: true, sku: true, name: true } }, batch: { select: { id: true, name: true } } } },
        reviewedBy: { select: { id: true, displayName: true } },
      },
    });
    if (!draft) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    return { ...draft, previewUrl: `/api/admin/admin/ai-studio/image-studio/items/${draft.sourceImageItemId}/preview?variant=output` };
  }

  async updateDraft(actor: AdminIdentity, id: string, value: unknown) {
    const data = normalizeProductDraftPatch(value);
    const current = await this.prisma.aiProductDraft.findUnique({ where: { id }, select: { id: true, batchId: true, status: true, sourceImageItem: { select: { attachedProduct: { select: { sku: true } } } } } });
    if (!current) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    if (current.sourceImageItem.attachedProduct) throw new ConflictException(`Bản nháp đã được gắn vào SKU ${current.sourceImageItem.attachedProduct.sku}; hãy sửa nội dung trong hồ sơ sản phẩm.`);
    if (["QUEUED", "RUNNING", "FAILED", "CANCELLED", "REJECTED"].includes(current.status)) throw new ConflictException("Bản nháp này chưa sẵn sàng để chỉnh sửa.");
    const updated = await this.prisma.aiProductDraft.update({
      where: { id },
      data: { ...data, status: "NEEDS_REVIEW", reviewedByAdminId: null, reviewedAt: null },
      select: { id: true },
    });
    await this.refreshBatchState(current.batchId);
    this.log("ai.product_draft.edited", actor.id, id, { fields: Object.keys(data) });
    return this.getDraft(updated.id);
  }

  async decideDraft(actor: AdminIdentity, id: string, decision: "APPROVED" | "REJECTED", noteInput?: unknown) {
    const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 1000) : "";
    const current = await this.prisma.aiProductDraft.findUnique({ where: { id }, select: { id: true, batchId: true, status: true, productName: true, sourceImageItem: { select: { attachedProduct: { select: { sku: true } } } } } });
    if (!current) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    if (current.sourceImageItem.attachedProduct && decision === "REJECTED") throw new ConflictException(`Bản nháp đã được gắn vào SKU ${current.sourceImageItem.attachedProduct.sku}; không thể từ chối sau khi áp dụng vào sản phẩm.`);
    if (!["NEEDS_REVIEW", "READY_FOR_REVIEW", "APPROVED", "REJECTED"].includes(current.status)) throw new ConflictException("Bản nháp chưa sẵn sàng để quyết định.");
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.aiProductDraft.updateMany({
        where: { id, status: { in: ["NEEDS_REVIEW", "READY_FOR_REVIEW", "APPROVED", "REJECTED"] } },
        data: { status: decision, reviewedByAdminId: actor.id, reviewedAt: new Date(), ...(decision === "REJECTED" && note ? { reviewReasons: { push: `ADMIN: ${note.slice(0, 180)}` } } : {}) },
      });
      if (updated.count !== 1) throw new ConflictException("Bản nháp vừa được cập nhật bởi một quản trị viên khác.");
    });
    await this.refreshBatchState(current.batchId);
    this.log(`ai.product_draft.${decision.toLowerCase()}`, actor.id, id, { note: note || undefined });
    return this.getDraft(current.id);
  }

  async attachApprovedDraftToProduct(actor: AdminIdentity, id: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Yêu cầu gắn sản phẩm không hợp lệ.");
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "sku")) throw new BadRequestException("Yêu cầu chỉ nhận SKU sản phẩm.");
    const skuInput = typeof body.sku === "string" ? body.sku.trim() : "";
    if (!skuInput || skuInput.length > 64) throw new BadRequestException("Hãy nhập SKU sản phẩm hợp lệ (tối đa 64 ký tự).");

    const draft = await this.prisma.aiProductDraft.findUnique({
      where: { id },
      include: { sourceImageItem: { include: { batch: true, outputAsset: true, attachedProduct: { select: { id: true, sku: true, name: true } } } } },
    });
    if (!draft) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    if (draft.status !== "APPROVED") throw new ConflictException("Chỉ có thể gắn bản nháp sau khi admin đã duyệt nội dung.");
    if (!draft.productName.trim() || !draft.shortDescription.trim() || !draft.detailedDescription.trim()) {
      throw new ConflictException("Bản nháp cần có tên, mô tả ngắn và mô tả chi tiết trước khi gắn vào sản phẩm.");
    }
    const sku = skuInput.toLocaleUpperCase("en");
    const product = await this.prisma.product.findFirst({
      where: { sku: { equals: sku, mode: "insensitive" } },
      select: { id: true, sku: true, name: true },
    });
    if (!product) throw new NotFoundException(`Không tìm thấy sản phẩm có SKU “${skuInput}”. Chưa gắn ảnh hoặc cập nhật thông tin.`);

    const item = draft.sourceImageItem;
    if (item.batch.purpose !== "PRODUCT_PHOTO" || item.status !== "APPROVED" || !item.outputAsset || !item.outputAsset.isPrivate) {
      throw new ConflictException("Ảnh nguồn không còn hợp lệ hoặc chưa được duyệt để gắn vào sản phẩm.");
    }
    const output = item.outputAsset;
    if (item.attachedProductId && item.attachedProductId !== product.id) {
      throw new ConflictException(`Ảnh này đã được gắn vào SKU ${item.attachedProduct?.sku || "khác"}.`);
    }

    let publicAsset: { id: string; url: string };
    let createdPublicAssetId: string | null = null;
    if (item.attachedProductId === product.id) {
      if (!item.publishedAssetId) throw new ConflictException("Ảnh đã được gắn vào SKU này nhưng thiếu đường dẫn ảnh đã xuất bản. Kiểm tra thư viện ảnh sản phẩm.");
      const existing = await this.media.findById(item.publishedAssetId);
      if (existing.isPrivate) throw new ConflictException("Ảnh đã gắn chưa được chuyển sang thư viện ảnh công khai.");
      publicAsset = { id: existing.id, url: this.media.urlFor(existing) };
    } else {
      const extension = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType === "image/png" ? "png" : output.mimeType === "image/webp" ? "webp" : null;
      if (!extension) throw new ConflictException("Định dạng ảnh nguồn không được hỗ trợ để đưa vào thư viện sản phẩm.");
      const bytes = await this.media.read(output);
      const published = await this.media.save({
        filename: `geme-${product.sku}-${draft.id.slice(0, 8)}.${extension}`,
        mimeType: output.mimeType,
        bytes,
        sourceKey: `ai-product-agent/published/${item.id}`,
        isPrivate: false,
        updateExisting: true,
        alt: draft.altText.trim().slice(0, 240) || draft.productName,
      });
      publicAsset = { id: published.id, url: published.url };
      createdPublicAssetId = published.id;
    }

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const currentDraft = await transaction.aiProductDraft.findUnique({ where: { id }, select: { status: true } });
        if (currentDraft?.status !== "APPROVED") throw new ConflictException("Bản nháp không còn ở trạng thái đã duyệt. Tải lại danh sách rồi thử lại.");

        if (!item.attachedProductId) {
          const imageClaim = await transaction.aiImageItem.updateMany({
            where: { id: item.id, status: "APPROVED", attachedProductId: null, publishedAssetId: null },
            data: { attachedProductId: product.id, publishedAssetId: publicAsset.id },
          });
          if (imageClaim.count !== 1) return { attached: false };
        }

        const currentProduct = await transaction.product.findFirst({ where: { id: product.id, sku: product.sku }, select: { id: true, name: true } });
        if (!currentProduct) throw new NotFoundException(`SKU “${skuInput}” không còn khớp sản phẩm. Chưa áp dụng nội dung.`);
        const alreadyInGallery = await transaction.productImage.findFirst({ where: { productId: product.id, url: publicAsset.url }, select: { id: true } });
        await transaction.product.update({
          where: { id: product.id },
          data: {
            name: draft.productName.trim(),
            description: draft.shortDescription.trim(),
            fullDescription: sanitizeBlogHtml(draft.detailedDescription.trim()) || null,
            seoTitle: draft.seoTitle.trim() || null,
            seoDescription: draft.seoMetaDescription.trim() || null,
          },
        });
        if (!alreadyInGallery) {
          const galleryTail = await transaction.productImage.findFirst({ where: { productId: product.id }, select: { sortOrder: true }, orderBy: { sortOrder: "desc" } });
          await transaction.productImage.create({
            data: {
              productId: product.id,
              url: publicAsset.url,
              alt: draft.altText.trim().slice(0, 240) || draft.productName.trim(),
              sortOrder: (galleryTail?.sortOrder ?? -1) + 1,
              isPrimary: !galleryTail,
            },
          });
        }
        return { attached: true };
      });

      if (!result.attached) {
        const latest = await this.prisma.aiImageItem.findUnique({ where: { id: item.id }, select: { attachedProductId: true, publishedAssetId: true, attachedProduct: { select: { sku: true } } } });
        if (latest?.attachedProductId === product.id && latest.publishedAssetId) return this.getDraft(id);
        throw new ConflictException(`Ảnh vừa được gắn vào SKU ${latest?.attachedProduct?.sku || "khác"}.`);
      }
      this.commerce.notifyProductImagesUpdated(product.id);
      this.log("ai.product_draft.attached_to_product", actor.id, id, { productId: product.id, sku: product.sku, publishedAssetId: publicAsset.id, fields: ["name", "description", "fullDescription", "seoTitle", "seoDescription", "gallery"] });
      return this.getDraft(id);
    } catch (error) {
      if (createdPublicAssetId) await this.media.removeUnreferencedAsset(createdPublicAssetId).catch(() => false);
      throw error;
    }
  }

  async cancelDraft(actor: AdminIdentity, id: string) {
    const current = await this.prisma.aiProductDraft.findUnique({ where: { id }, select: { id: true, batchId: true, taskId: true, status: true } });
    if (!current) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    if (!["QUEUED", "RUNNING"].includes(current.status)) throw new ConflictException("Chỉ có thể hủy tác vụ đang chờ hoặc đang chạy.");
    await this.prisma.$transaction(async (transaction) => {
      const task = await transaction.aiTask.updateMany({ where: { id: current.taskId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date() } });
      if (task.count !== 1) throw new ConflictException("Tác vụ không còn ở trạng thái có thể hủy.");
      await transaction.aiProductDraft.update({ where: { id }, data: { status: "CANCELLED" } });
    });
    await this.queue.removeIfWaiting(current.taskId);
    await this.refreshBatchState(current.batchId);
    this.log("ai.product_draft.cancelled", actor.id, id, { taskId: current.taskId });
    return this.getDraft(id);
  }

  async retryDraft(actor: AdminIdentity, id: string) {
    const current = await this.prisma.aiProductDraft.findUnique({ where: { id }, include: {
      task: { select: { status: true } },
      sourceImageItem: { select: { id: true, originalFilename: true, status: true, batch: { select: { purpose: true } }, outputAsset: { select: { isPrivate: true } } } },
    } });
    if (!current) throw new NotFoundException("Không tìm thấy bản nháp sản phẩm.");
    if (current.status !== "FAILED" || current.task.status !== "FAILED") throw new ConflictException("Chỉ có thể thử lại bản nháp đã thất bại.");
    if (current.sourceImageItem.status !== "APPROVED" || current.sourceImageItem.batch.purpose !== "PRODUCT_PHOTO" || !current.sourceImageItem.outputAsset?.isPrivate) {
      throw new ConflictException("Ảnh nguồn không còn là ảnh sản phẩm đã duyệt.");
    }
    await this.queue.consumeCreateQuota(actor.id);
    const taskId = randomUUID();
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"geme-product-source:" + current.sourceImageItemId})::bigint)`;
        const activeCount = await transaction.aiTask.count({ where: { requestedByAdminId: actor.id, status: { in: ["QUEUED", "RUNNING"] } } });
        if (activeCount >= this.activeTaskLimit()) throw new ConflictException("Đã đạt giới hạn tác vụ AI đang hoạt động.");
        const duplicate = await transaction.aiProductDraft.findFirst({ where: { sourceImageItemId: current.sourceImageItemId, id: { not: id }, status: { in: [...activelyBeingWorked] } }, select: { id: true } });
        if (duplicate) throw new ConflictException("Ảnh này đã có bản nháp khác đang xử lý hoặc chờ rà soát.");
        const task = await transaction.aiTask.create({
          data: { id: taskId, idempotencyKey: `product-draft-retry:${randomUUID()}`, requestedByAdminId: actor.id, type: "PRODUCT_DRAFT_GENERATION", title: `Product Agent · ${current.sourceImageItem.originalFilename}`.slice(0, 120), input: { imageItemId: current.sourceImageItemId, productDraftId: id } },
        });
        await transaction.aiProductDraft.update({ where: { id }, data: {
          taskId: task.id, status: "QUEUED", reviewedByAdminId: null, reviewedAt: null,
          productName: "", shortDescription: "", detailedDescription: "", categorySuggestion: null, materialSuggestion: null, gemstoneSuggestion: null,
          seoTitle: "", seoMetaDescription: "", altText: "", confidenceScore: 0, categoryConfidence: null, materialConfidence: null, gemstoneConfidence: null,
          needsReview: true, reviewReasons: [], evidence: Prisma.JsonNull,
        } });
        await transaction.aiProductDraftBatch.update({ where: { id: current.batchId }, data: { status: "PROCESSING" } });
      });
      await this.queue.enqueue(taskId);
    } catch (error) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.aiTask.updateMany({ where: { id: taskId, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Không thể đưa tác vụ thử lại vào hàng đợi.", completedAt: new Date() } });
        await transaction.aiProductDraft.updateMany({ where: { id, taskId, status: "QUEUED" }, data: { status: "FAILED" } });
      }).catch(() => undefined);
      await this.refreshBatchState(current.batchId).catch(() => undefined);
      throw error;
    }
    await this.refreshBatchState(current.batchId);
    this.log("ai.product_draft.retry_queued", actor.id, id, { taskId });
    return this.getDraft(id);
  }

  async refreshBatchState(batchId: string) {
    const drafts = await this.prisma.aiProductDraft.findMany({ where: { batchId }, select: { status: true } });
    const statuses = drafts.map((draft) => draft.status);
    let status: "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "REVIEW";
    if (statuses.some((value) => value === "QUEUED" || value === "RUNNING")) status = "PROCESSING";
    else if (statuses.every((value) => value === "CANCELLED")) status = "CANCELLED";
    else if (statuses.every((value) => value === "FAILED")) status = "FAILED";
    else if (statuses.every((value) => ["APPROVED", "REJECTED", "CANCELLED"].includes(value))) status = "COMPLETE";
    else if (statuses.some((value) => value === "FAILED" || value === "CANCELLED")) status = "PARTIAL";
    await this.prisma.aiProductDraftBatch.updateMany({ where: { id: batchId }, data: { status } });
  }

  private async returnExisting(batch: { id: string; manifestHash: string; createdByAdminId: string }, actor: AdminIdentity, submission: ProductDraftSubmission) {
    if (batch.createdByAdminId !== actor.id || batch.manifestHash !== submission.manifestHash) throw new ConflictException("Khóa idempotency đã được sử dụng cho yêu cầu khác.");
    return this.batch(batch.id);
  }

  private activeTaskLimit() {
    const configured = Number(process.env.AI_STUDIO_ACTIVE_TASK_LIMIT);
    return Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 25) : 5;
  }

  private isUniqueConstraintError(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private log(event: string, adminId: string, id: string, fields: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ event, adminId, id, ...fields, at: new Date().toISOString() }));
  }
}
