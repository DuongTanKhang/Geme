import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { AI_QUEUE_DEFAULT_JOB_OPTIONS, AI_STUDIO_QUEUE, type AiQueuePayload, redisConnectionOptions } from "./ai-studio.queue.js";
import { createHash } from "node:crypto";
import { MediaStorageService } from "../media/media-storage.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the AI worker.");
const coreUrl = (process.env.AI_CORE_URL || "http://ai-core:8000").replace(/\/+$/, "");
const coreSecret = process.env.AI_CORE_SHARED_SECRET || "";
if (Buffer.byteLength(coreSecret.trim(), "utf8") < 32) throw new Error("AI_CORE_SHARED_SECRET must contain at least 32 bytes.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const mediaStorage = new MediaStorageService();
const recoveryQueue = new Queue<AiQueuePayload>(AI_STUDIO_QUEUE, { connection: redisConnectionOptions(true), defaultJobOptions: AI_QUEUE_DEFAULT_JOB_OPTIONS });

function workerConcurrency() {
  const configured = Number(process.env.AI_WORKER_CONCURRENCY);
  return Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 16) : 3;
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "AI_CORE_UNAVAILABLE";
  return /^[A-Z0-9_]{3,80}$/.test(message) ? message : "AI_CORE_UNAVAILABLE";
}

function isPermanentImageProviderError(code: string) {
  return [
    "CUSTOM_BACKGROUND_RATE_LIMITED",
    "CUSTOM_BACKGROUND_QUOTA_EXCEEDED",
    "CUSTOM_BACKGROUND_AUTH_FAILED",
    "CUSTOM_BACKGROUND_REQUEST_REJECTED",
    "CUSTOM_BACKGROUND_NOT_CONFIGURED",
    "PHOTOROOM_BILLING_REQUIRED",
    "PHOTOROOM_AUTH_FAILED",
    "PHOTOROOM_RATE_LIMITED",
    "PHOTOROOM_IMAGE_REJECTED",
    "PHOTOROOM_REQUEST_REJECTED",
    "PHOTOROOM_NOT_CONFIGURED",
    "PHOTOROOM_SANDBOX_KEY_REQUIRED",
  ].includes(code);
}

function imageFailureMessage(code: string, technicalDrawingTask: boolean) {
  const messages: Record<string, string> = {
    PHOTOROOM_BILLING_REQUIRED: "Photoroom trả HTTP 402 Payment Required. Kiểm tra tín dụng, gói API và thanh toán của tài khoản Photoroom rồi thử lại thủ công.",
    PHOTOROOM_AUTH_FAILED: "Photoroom từ chối API key. Kiểm tra key và quyền API trong cấu hình server.",
    PHOTOROOM_RATE_LIMITED: "Photoroom đang giới hạn tốc độ. Chờ giới hạn được gỡ rồi thử lại thủ công.",
    PHOTOROOM_IMAGE_REJECTED: "Photoroom từ chối định dạng hoặc nội dung ảnh. Hãy kiểm tra ảnh nguồn rồi thử lại.",
    PHOTOROOM_REQUEST_REJECTED: "Photoroom từ chối yêu cầu xử lý ảnh. Kiểm tra cấu hình và ảnh nguồn.",
    PHOTOROOM_TIMEOUT: "Photoroom xử lý quá thời gian chờ. Hãy thử lại sau.",
    PHOTOROOM_UNAVAILABLE: "Photoroom đang tạm thời không khả dụng. Hãy thử lại sau.",
    CUSTOM_BACKGROUND_QUOTA_EXCEEDED: "OpenAI đã hết tín dụng/quota hoặc chưa bật thanh toán cho project. Kiểm tra Billing và Limits rồi thử lại thủ công.",
    CUSTOM_BACKGROUND_RATE_LIMITED: "OpenAI đang giới hạn tốc độ tạo ảnh. Chờ giới hạn được gỡ rồi thử lại thủ công.",
    CUSTOM_BACKGROUND_AUTH_FAILED: "OpenAI từ chối API key. Kiểm tra key và quyền của project trong cấu hình server.",
    CUSTOM_BACKGROUND_REQUEST_REJECTED: "OpenAI từ chối yêu cầu tạo bối cảnh. Hãy điều chỉnh chỉ dẫn rồi thử lại.",
    OPENAI_PRODUCT_QUOTA_EXCEEDED: "OpenAI API đã hết quota/tín dụng hoặc chạm giới hạn ngân sách của project. Kiểm tra Billing và Usage limits rồi thử lại bản nháp.",
    OPENAI_PRODUCT_RATE_LIMITED: "OpenAI trả 429: project có thể hết quota/đạt giới hạn ngân sách hoặc đang bị giới hạn tốc độ. Kiểm tra Billing và Usage limits; nếu quota còn, chờ giới hạn tốc độ rồi bấm Thử lại.",
    OPENAI_PRODUCT_AUTH_FAILED: "OpenAI từ chối API key. Kiểm tra key và quyền của project trong cấu hình AI Core.",
    OPENAI_PRODUCT_ACCESS_DENIED: "Project OpenAI hiện không được phép dùng dịch vụ hoặc model này. Kiểm tra quyền của project.",
    OPENAI_PRODUCT_MODEL_UNAVAILABLE: "Model Product Agent đang cấu hình không khả dụng cho project OpenAI này.",
    OPENAI_PRODUCT_GENERATION_FAILED: "OpenAI từ chối yêu cầu tạo nội dung. Kiểm tra Billing, Usage limits và quyền model của project.",
  };
  if (messages[code]) return messages[code];
  if (code === "OPENAI_AGENT_QUOTA_EXCEEDED") return "OpenAI API đã hết quota/tín dụng hoặc chạm giới hạn ngân sách. Kiểm tra Billing và Usage limits rồi thử lại thủ công.";
  if (code === "OPENAI_AGENT_RATE_LIMITED") return "OpenAI đang giới hạn tốc độ. Chờ giới hạn được gỡ rồi thử lại thủ công.";
  if (code === "OPENAI_AGENT_AUTH_FAILED") return "OpenAI từ chối API key. Kiểm tra key trong cấu hình AI Core.";
  if (code === "OPENAI_AGENT_ACCESS_DENIED" || code === "OPENAI_AGENT_MODEL_UNAVAILABLE") return "Project OpenAI hiện chưa được phép dùng model đã cấu hình cho Agent này.";
  if (code === "OPENAI_AGENT_REQUEST_REJECTED") return "OpenAI từ chối yêu cầu (HTTP 400), không phải lỗi hết tín dụng. Cần kiểm tra log AI Core để xem mã lỗi hoặc tham số bị từ chối.";
  if (code === "OPENAI_AGENT_NOT_CONFIGURED") return "AI Core chưa nhận được OpenAI API key. Kiểm tra cấu hình GEME_OPENAI_API_KEY trên server.";
  if (code === "OPENAI_AGENT_INVALID_RESPONSE") return "OpenAI đã phản hồi nhưng nội dung không đúng định dạng JSON mà Agent yêu cầu. Có thể thử tạo lại bản nháp.";
  if (code.startsWith("OPENAI_AGENT_")) return "AI Agent chưa tạo được kết quả. Kiểm tra cấu hình AI Core rồi thử lại.";
  if (code.startsWith("OPENAI_PRODUCT_") || code.startsWith("PRODUCT_DRAFT_")) return "Product Agent chưa tạo được bản nháp. Kiểm tra cấu hình AI Core rồi thử lại.";
  if (technicalDrawingTask) return "Tạo ảnh kỹ thuật chưa thành công. Hãy kiểm tra khóa/dịch vụ rồi thử lại thủ công để tránh phát sinh lượt gọi lặp ngoài ý muốn.";
  if (code.startsWith("PHOTOROOM_")) return "Photoroom không xử lý được ảnh. Kiểm tra cấu hình và thử lại thủ công.";
  return "Tác vụ AI thất bại sau các lần thử lại.";
}

async function processTask(job: Job<AiQueuePayload>) {
  const { taskId } = job.data;
  const task = await prisma.aiTask.findUnique({ where: { id: taskId } });
  if (!task || task.status === "CANCELLED") return { skipped: true };

  const queueAttempt = job.attemptsMade + 1;
  const attempt = task.attemptCount + 1;
  const claimed = await prisma.aiTask.updateMany({
    where: { id: taskId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "RUNNING", startedAt: task.startedAt || new Date(), attemptCount: attempt, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) return { skipped: true };

  let pendingImageOutput: { itemId: string; bytes: Buffer; report: Record<string, unknown> } | null = null;
  let pendingProductDraft: { draftId: string; batchId: string; value: ProductDraftResult } | null = null;
  let pendingMarketingDraft: { draftId: string; value: MarketingDraftResult } | null = null;
  let technicalDrawingTask = false;
  let orphanPrivateObjectKey: string | null = null;
  try {
    let result: Prisma.InputJsonObject;
    if (task.type === "PRODUCT_DRAFT_GENERATION") {
      pendingProductDraft = await processProductDraft(task);
      result = {
        productDraft: {
          draftId: pendingProductDraft.draftId,
          confidenceScore: pendingProductDraft.value.confidenceScore,
          needsReview: pendingProductDraft.value.needsReview,
          reviewReasons: pendingProductDraft.value.reviewReasons,
        },
        sideEffects: "draft_only_no_commerce_mutation",
      };
    } else if (task.type === "IMAGE_STUDIO_PROCESSING") {
      const taskInput = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
      const imageItem = typeof taskInput.imageItemId === "string" ? await prisma.aiImageItem.findUnique({ where: { id: taskInput.imageItemId }, select: { batch: { select: { purpose: true } } } }) : null;
      technicalDrawingTask = imageItem?.batch.purpose === "TECHNICAL_DRAWING";
      pendingImageOutput = await processStudioImage(task);
      result = {
        imageStudio: {
          itemId: pendingImageOutput.itemId,
          qualityControl: pendingImageOutput.report as Prisma.InputJsonValue,
          previewPath: `/api/admin/ai-studio/image-studio/items/${pendingImageOutput.itemId}/preview?variant=output`,
        },
        sideEffects: "none_until_human_approval_and_product_attachment",
      };
    } else {
      if (task.type === "MARKETING_DRAFT_GENERATION") {
        const draft = await prisma.aiMarketingDraft.findUnique({ where: { taskId }, select: { id: true, status: true } });
        if (!draft || !["QUEUED", "GENERATING"].includes(draft.status)) throw new Error("MARKETING_DRAFT_STATE_CONFLICT");
        await prisma.aiMarketingDraft.updateMany({ where: { id: draft.id, status: "QUEUED" }, data: { status: "GENERATING", errorCode: null } });
      }
      const coreInput = task.type === "SALES_ANSWER" ? await refreshSalesInput(task.input) : task.input;
      const response = await fetch(`${coreUrl}/internal/tasks/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Core-Key": coreSecret },
        body: JSON.stringify({ task_id: task.id, idempotency_key: task.idempotencyKey, type: task.type, input: coreInput }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as { detail?: unknown } | null;
        const detail = typeof errorPayload?.detail === "string" ? errorPayload.detail : "";
        throw new Error(/^[A-Z0-9_]{3,80}$/.test(detail) ? detail : `AI_CORE_HTTP_${response.status}`);
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("AI_CORE_RESPONSE_TOO_LARGE");
      const envelope = JSON.parse(raw) as { result?: unknown };
      if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) throw new Error("AI_CORE_INVALID_RESPONSE");
      result = envelope.result as Prisma.InputJsonObject;
      if (task.type === "SALES_ANSWER") result = await validateSalesResult(result, coreInput);
      if (task.type === "MARKETING_DRAFT_GENERATION") {
        const generated = envelope.result as Record<string, unknown>;
        const draft = await prisma.aiMarketingDraft.findUnique({ where: { taskId }, select: { id: true, sourceProductIds: true, channel: true } });
        if (!draft) throw new Error("MARKETING_DRAFT_NOT_FOUND");
        const stringField = (key: string, limit: number) => typeof generated[key] === "string" ? (generated[key] as string).trim().slice(0, limit) : "";
        const hashtags = Array.isArray(generated.hashtags) ? generated.hashtags.filter((tag): tag is string => typeof tag === "string").slice(0, 12).map((tag) => tag.slice(0, 40)) : [];
        const warnings = Array.isArray(generated.fact_warnings) ? generated.fact_warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 24).map((warning) => warning.slice(0, 80)) : [];
        if (!stringField("caption", 1200) && !stringField("body", 12_000)) throw new Error("MARKETING_DRAFT_EMPTY");
        pendingMarketingDraft = {
          draftId: draft.id,
          value: {
            title: stringField("title", 180),
            caption: stringField("caption", 1200),
            body: stringField("body", 12_000),
            call_to_action: stringField("call_to_action", 240),
            seo_title: stringField("seo_title", 180),
            seo_description: stringField("seo_description", 320),
            alt_text: stringField("alt_text", 500),
            hashtags,
            source_product_ids: draft.sourceProductIds,
            channel: draft.channel,
            fact_warnings: warnings,
          },
        };
      }
    }
    const requiresApproval = task.type === "PRODUCT_PUBLICATION_PROPOSAL" || task.type === "IMAGE_STUDIO_PROCESSING";

    let outputObjectKey: string | null = null;
    let outputSourceKey: string | null = null;
    if (pendingImageOutput && mediaStorage.usesPrivateR2) {
      const digest = createHash("sha256").update(pendingImageOutput.bytes).digest("hex");
      outputObjectKey = `ai-studio/${pendingImageOutput.itemId}/${digest}.png`;
      orphanPrivateObjectKey = outputObjectKey;
      outputSourceKey = `ai-studio/items/${pendingImageOutput.itemId}/output`;
      await mediaStorage.putPrivateObject(outputObjectKey, pendingImageOutput.bytes, "image/png");
    }

    const committed = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.aiTask.updateMany({
        where: { id: taskId, status: "RUNNING" },
        data: {
          status: requiresApproval ? "AWAITING_APPROVAL" : "SUCCEEDED",
          result,
          ...(task.type === "SALES_ANSWER" ? { input: redactedSalesAuditInput(task.input) } : {}),
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      // Cancellation can race the AI Core call. Do not restore a canceled task
      // or create an approval if an administrator canceled while it ran.
      if (updated.count !== 1) return false;
      if (pendingImageOutput) {
        const { itemId, bytes, report } = pendingImageOutput;
        const asset = await transaction.mediaAsset.upsert({
          where: { sourceKey: outputSourceKey || `ai-studio/items/${itemId}/output` },
          create: {
            filename: `geme-image-${itemId}.png`,
            sourceKey: outputSourceKey || `ai-studio/items/${itemId}/output`,
            mimeType: "image/png",
            isPrivate: true,
            storageProvider: outputObjectKey ? "r2" : "database",
            objectKey: outputObjectKey,
            data: outputObjectKey ? null : new Uint8Array(bytes),
            size: bytes.byteLength,
            alt: null,
          },
          update: {
            mimeType: "image/png",
            isPrivate: true,
            storageProvider: outputObjectKey ? "r2" : "database",
            objectKey: outputObjectKey,
            data: outputObjectKey ? null : new Uint8Array(bytes),
            size: bytes.byteLength,
          },
          select: { id: true },
        });
        const quality = report.qc && typeof report.qc === "object" ? report.qc as Record<string, unknown> : {};
        const qcStatus = quality.status === "PASS" ? "PASS" : quality.status === "FAIL" ? "FAIL" : "REVIEW";
        const qcFlags = Array.isArray(quality.flags) ? quality.flags.filter((flag): flag is string => typeof flag === "string").slice(0, 32) : [];
        await transaction.aiImageItem.update({
          where: { id: itemId },
          data: {
            outputAssetId: asset.id,
            classification: report.classification as Prisma.InputJsonValue,
            qcStatus,
            qcFlags,
            qcReport: quality as Prisma.InputJsonObject,
            status: "AWAITING_APPROVAL",
            attemptCount: attempt,
            errorCode: null,
          },
        });
        await refreshImageBatchState(transaction, (await transaction.aiImageItem.findUniqueOrThrow({ where: { id: itemId }, select: { batchId: true } })).batchId);
      }
      if (pendingProductDraft) {
        const { draftId, batchId, value } = pendingProductDraft;
        const draftUpdated = await transaction.aiProductDraft.updateMany({
          where: { id: draftId, taskId, status: "RUNNING" },
          data: {
            status: value.needsReview ? "NEEDS_REVIEW" : "READY_FOR_REVIEW",
            productName: value.productName,
            shortDescription: value.shortDescription,
            detailedDescription: value.detailedDescription,
            categorySuggestion: value.categorySuggestion,
            materialSuggestion: null,
            gemstoneSuggestion: null,
            seoTitle: value.seoTitle,
            seoMetaDescription: value.seoMetaDescription,
            altText: value.altText,
            confidenceScore: value.confidenceScore,
            categoryConfidence: value.categoryConfidence,
            materialConfidence: value.materialConfidence,
            gemstoneConfidence: value.gemstoneConfidence,
            needsReview: value.needsReview,
            reviewReasons: value.reviewReasons,
            evidence: value.evidence as Prisma.InputJsonValue,
          },
        });
        if (draftUpdated.count !== 1) throw new Error("PRODUCT_DRAFT_STATE_CONFLICT");
        await refreshProductDraftBatchState(transaction, batchId);
      }
      if (pendingMarketingDraft) {
        const { draftId, value } = pendingMarketingDraft;
        const updatedDraft = await transaction.aiMarketingDraft.updateMany({
          where: { id: draftId, taskId, status: "GENERATING" },
          data: {
            status: "DRAFT",
            title: value.title,
            caption: value.caption,
            body: value.body,
            callToAction: value.call_to_action,
            seoTitle: value.seo_title,
            seoDescription: value.seo_description,
            altText: value.alt_text,
            hashtags: value.hashtags,
            factWarnings: value.fact_warnings,
            generatedAt: new Date(),
            errorCode: null,
          },
        });
        if (updatedDraft.count !== 1) throw new Error("MARKETING_DRAFT_STATE_CONFLICT");
      }
      if (task.type === "SALES_ANSWER") {
        const sales = result as Record<string, unknown>;
        const productCount = Array.isArray(sales.recommended_product_ids) ? Math.min(6, sales.recommended_product_ids.length) : 0;
        await transaction.aiSalesMetric.upsert({
          where: { taskId },
          create: { taskId, needsHandoff: sales.needs_handoff === true, unresolved: sales.unresolved === true, recommendedProductCount: productCount },
          update: { needsHandoff: sales.needs_handoff === true, unresolved: sales.unresolved === true, recommendedProductCount: productCount },
        });
      }
      if (requiresApproval) await transaction.aiApproval.create({ data: { taskId } });
      return true;
    });

    if (committed) orphanPrivateObjectKey = null;
    else if (orphanPrivateObjectKey) {
      await mediaStorage.deletePrivateObject(orphanPrivateObjectKey).catch(() => undefined);
      orphanPrivateObjectKey = null;
    }

    console.log(JSON.stringify({ event: committed ? "ai.worker.task_completed" : "ai.worker.task_skipped_after_cancel", taskId, type: task.type, attempt, approvalRequired: requiresApproval, at: new Date().toISOString() }));
    return { taskId, approvalRequired: requiresApproval };
  } catch (error) {
    if (orphanPrivateObjectKey) await mediaStorage.deletePrivateObject(orphanPrivateObjectKey).catch(() => undefined);
    const maxAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
    const failureCode = safeErrorCode(error);
    const permanentImageProviderError = task.type === "IMAGE_STUDIO_PROCESSING" && isPermanentImageProviderError(failureCode);
    const permanentProductProviderError = task.type === "PRODUCT_DRAFT_GENERATION" && [
      "OPENAI_PRODUCT_QUOTA_EXCEEDED",
      "OPENAI_PRODUCT_RATE_LIMITED",
      "OPENAI_PRODUCT_AUTH_FAILED",
      "OPENAI_PRODUCT_ACCESS_DENIED",
      "OPENAI_PRODUCT_MODEL_UNAVAILABLE",
    ].includes(failureCode);
    const permanentAgentProviderError = ["SALES_ANSWER", "MARKETING_DRAFT_GENERATION"].includes(task.type) && [
      "OPENAI_AGENT_QUOTA_EXCEEDED",
      "OPENAI_AGENT_RATE_LIMITED",
      "OPENAI_AGENT_AUTH_FAILED",
      "OPENAI_AGENT_ACCESS_DENIED",
      "OPENAI_AGENT_MODEL_UNAVAILABLE",
    ].includes(failureCode);
    const willRetry = !technicalDrawingTask && !permanentImageProviderError && !permanentProductProviderError && !permanentAgentProviderError && queueAttempt < maxAttempts;
    const failureMessage = imageFailureMessage(failureCode, technicalDrawingTask);
    await prisma.aiTask.updateMany({
      where: { id: taskId, status: "RUNNING" },
      data: {
        status: willRetry ? "QUEUED" : "FAILED",
        ...(!willRetry && task.type === "SALES_ANSWER" ? { input: redactedSalesAuditInput(task.input) } : {}),
        errorCode: failureCode,
        errorMessage: willRetry ? "AI Core tạm thời chưa xử lý được; tác vụ sẽ tự thử lại." : failureMessage,
        ...(willRetry ? {} : { completedAt: new Date() }),
      },
    });
    if (task.type === "MARKETING_DRAFT_GENERATION") {
      await prisma.aiMarketingDraft.updateMany({
        where: { taskId, status: { in: ["QUEUED", "GENERATING"] } },
        data: { status: willRetry ? "QUEUED" : "FAILED", errorCode: failureCode },
      });
    }
    if (task.type === "IMAGE_STUDIO_PROCESSING") {
      const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
      if (typeof input.imageItemId === "string") {
        await prisma.$transaction(async (transaction) => {
          await transaction.aiImageItem.updateMany({
            where: { id: input.imageItemId as string, status: { in: ["QUEUED", "RUNNING"] } },
            data: { status: willRetry ? "QUEUED" : "FAILED", errorCode: failureCode, attemptCount: attempt },
          });
          const item = await transaction.aiImageItem.findUnique({ where: { id: input.imageItemId as string }, select: { batchId: true } });
          if (item) await refreshImageBatchState(transaction, item.batchId);
        });
      }
    }
    if (task.type === "PRODUCT_DRAFT_GENERATION") {
      const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
      if (typeof input.productDraftId === "string") {
        await prisma.$transaction(async (transaction) => {
          const draft = await transaction.aiProductDraft.findUnique({ where: { id: input.productDraftId as string }, select: { batchId: true } });
          await transaction.aiProductDraft.updateMany({
            where: { id: input.productDraftId as string, taskId, status: { in: ["QUEUED", "RUNNING"] } },
            data: { status: willRetry ? "QUEUED" : "FAILED" },
          });
          if (draft) await refreshProductDraftBatchState(transaction, draft.batchId);
        });
      }
    }
    console.error(JSON.stringify({ event: "ai.worker.task_failed", taskId, attempt, queueAttempt, maxAttempts, willRetry, code: safeErrorCode(error), at: new Date().toISOString() }));
    throw error instanceof Error ? error : new Error("AI_CORE_UNAVAILABLE");
  }
}

function redactedSalesAuditInput(value: Prisma.JsonValue): Prisma.InputJsonObject {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const ids = (field: "catalog" | "knowledge") => Array.isArray(input[field])
    ? (input[field] as unknown[]).map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "").filter(Boolean).slice(0, 16)
    : [];
  return { redacted: true, sourceProductIds: ids("catalog"), policySourceIds: ids("knowledge"), requestFingerprint: typeof input.requestFingerprint === "string" ? input.requestFingerprint : "" };
}

async function refreshSalesInput(value: Prisma.JsonValue): Promise<Prisma.InputJsonObject> {
  const input = jsonRecord(value);
  const request = jsonRecord(input.request);
  const budget = typeof request.maxBudget === "number" && Number.isSafeInteger(request.maxBudget) ? request.maxBudget : null;
  const sourceProducts = Array.isArray(input.catalog) ? input.catalog.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const productIds = sourceProducts.map((item) => typeof item.id === "string" ? item.id : "").filter(Boolean);
  const now = new Date();
  const [products, sourceRows] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, status: "ACTIVE", OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }] },
      select: { id: true, sku: true, name: true, slug: true, description: true, stock: true, price: true, category: { select: { name: true, status: true } }, gemstoneType: { select: { name: true, status: true } }, materialOption: { select: { name: true, active: true } }, variants: { where: { stock: { gt: 0 } }, select: { price: true, stock: true, quality: true, beadSize: true, carat: true, gemstoneQuality: true }, orderBy: { sortOrder: "asc" }, take: 12 } },
    }),
    (Array.isArray(input.knowledge) ? input.knowledge : []).length
      ? prisma.aiSalesKnowledgeSource.findMany({
        where: {
          id: { in: (input.knowledge as unknown[]).map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "").filter(Boolean) },
          status: "ACTIVE",
          AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        select: { id: true, title: true, topic: true, sourceLabel: true, content: true, version: true, documentKey: true },
      })
      : Promise.resolve([]),
  ]);

  const catalog = products.map((product) => {
    const variants = product.variants.filter((variant) => budget === null || Number(variant.price) <= budget);
    const livePrice = variants.length ? variants.reduce((lowest, variant) => Math.min(lowest, Number(variant.price)), Number.POSITIVE_INFINITY) : product.variants.length ? null : product.price === null ? null : Number(product.price);
    const availableQuantity = variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : product.variants.length ? 0 : product.stock;
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      category: product.category?.status === "ACTIVE" ? product.category.name : null,
      gemstone: product.gemstoneType?.status === "ACTIVE" ? product.gemstoneType.name : null,
      material: product.materialOption?.active ? product.materialOption.name : null,
      description: (product.description || "").slice(0, 500),
      price: Number.isFinite(livePrice as number) ? livePrice : null,
      availableQuantity,
      variants: variants.slice(0, 8).map((variant) => ({ price: Number(variant.price), quality: variant.quality, size: variant.beadSize, carat: variant.carat?.toString() || null, gemstoneQuality: variant.gemstoneQuality, available: true })),
      publicPath: `/san-pham/${encodeURIComponent(product.slug)}`,
    };
  }).filter((product) => product.availableQuantity > 0 && (budget === null || (product.price !== null && product.price <= budget))).slice(0, 16);
  const knowledge = sourceRows.map((source) => ({ id: source.id, title: source.title, topic: source.topic, source: source.sourceLabel, content: source.content.slice(0, 3_000), version: source.version, documentKey: source.documentKey }));
  return {
    question: typeof input.question === "string" ? input.question : "",
    catalog: catalog.map(({ availableQuantity: _availableQuantity, variants, ...product }) => ({ ...product, available: true, variants: variants.map(({ available: _available, ...variant }) => variant) })),
    knowledge,
    request: { maxBudget: budget },
  } as Prisma.InputJsonObject;
}

async function validateSalesResult(result: Prisma.InputJsonObject, sourceInput: unknown): Promise<Prisma.InputJsonObject> {
  const generated = jsonRecord(result);
  const input = jsonRecord(sourceInput);
  const sourceCatalog = Array.isArray(input.catalog) ? input.catalog.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const catalogById = new Map(sourceCatalog.map((item) => [String(item.id || ""), item] as const));
  const generatedIds = Array.isArray(generated.recommended_product_ids) ? generated.recommended_product_ids.filter((id): id is string => typeof id === "string") : [];
  const requestedIds = [...new Set(generatedIds.filter((id) => catalogById.has(id)))].slice(0, 6);
  const now = new Date();
  const [products, sources] = await Promise.all([
    requestedIds.length ? prisma.product.findMany({
      where: { id: { in: requestedIds }, status: "ACTIVE", OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }] },
      select: { id: true, sku: true, name: true, slug: true, stock: true, price: true, variants: { where: { stock: { gt: 0 } }, select: { price: true, stock: true } } },
    }) : Promise.resolve([] as Array<{
      id: string; sku: string; name: string; slug: string; stock: number; price: Prisma.Decimal | null;
      variants: Array<{ price: Prisma.Decimal | null; stock: number }>;
    }>),
    Array.isArray(generated.knowledge_source_ids) && generated.knowledge_source_ids.length
      ? prisma.aiSalesKnowledgeSource.findMany({
        where: { id: { in: generated.knowledge_source_ids.filter((id): id is string => typeof id === "string") }, status: "ACTIVE", AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
        select: { id: true, title: true, topic: true, sourceLabel: true, version: true },
      })
      : Promise.resolve([] as Array<{ id: string; title: string; topic: string; sourceLabel: string; version: number }>),
  ]);
  const liveById = new Map(products.map((product) => [product.id, product] as const));
  const cards = requestedIds.flatMap((id) => {
    const product = liveById.get(id);
    const source = catalogById.get(id);
    if (!product || !source) return [];
    const availableQuantity = product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock;
    const price = product.variants.length ? product.variants.reduce((lowest, variant) => Math.min(lowest, Number(variant.price)), Number.POSITIVE_INFINITY) : product.price === null ? null : Number(product.price);
    return [{ id: product.id, name: product.name, sku: product.sku, slug: product.slug, category: source.category || null, gemstone: source.gemstone || null, material: source.material || null, price: Number.isFinite(price as number) ? price : null, availableQuantity, publicPath: `/san-pham/${encodeURIComponent(product.slug)}` }];
  });
  const pricesChanged = cards.some((card) => {
    const captured = catalogById.get(card.id)?.price;
    return captured !== null && captured !== undefined && card.price !== null && Number(captured) !== Number(card.price);
  });
  const staleProduct = cards.length !== requestedIds.length;
  const validSourceIds = new Set(sources.map((source) => source.id));
  const citations = Array.isArray(generated.knowledge_source_ids) ? generated.knowledge_source_ids.filter((id): id is string => typeof id === "string" && validSourceIds.has(id)) : [];
  const citedSources = sources.filter((source) => citations.includes(source.id)).map((source) => ({ id: source.id, title: source.title, topic: source.topic, source: source.sourceLabel, version: source.version }));
  const staleCitation = citations.length !== (Array.isArray(generated.knowledge_source_ids) ? generated.knowledge_source_ids.length : 0);
  if (staleProduct || staleCitation || pricesChanged) {
    return {
      ...generated,
      answer: staleProduct || staleCitation
        ? "Dữ liệu sản phẩm hoặc chính sách vừa thay đổi. Mình chưa thể xác nhận chính xác và sẽ chuyển câu hỏi cho nhân viên GEME."
        : "Giá sản phẩm vừa thay đổi kể từ lúc tra cứu. Vui lòng mở trang sản phẩm để xem giá hiện tại; mình sẽ chuyển câu hỏi cho nhân viên nếu bạn cần hỗ trợ.",
      recommended_product_ids: staleProduct ? [] : cards.map((card) => card.id),
      recommended_products: staleProduct ? [] : cards,
      knowledge_source_ids: staleCitation ? [] : citations,
      cited_sources: staleCitation ? [] : citedSources,
      needs_handoff: true,
      unresolved: true,
      handoff_reason: staleProduct ? "LIVE_PRODUCT_CHANGED" : staleCitation ? "LIVE_POLICY_CHANGED" : "LIVE_PRICE_CHANGED",
    } as Prisma.InputJsonObject;
  }
  return { ...generated, recommended_product_ids: cards.map((card) => card.id), recommended_products: cards, knowledge_source_ids: citations, cited_sources: citedSources } as Prisma.InputJsonObject;
}

function jsonRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function processStudioImage(task: { id: string; input: Prisma.JsonValue }) {
  const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
  const itemId = typeof input.imageItemId === "string" ? input.imageItemId : "";
  if (!itemId) throw new Error("IMAGE_ITEM_NOT_FOUND");
  const item = await prisma.aiImageItem.findUnique({
    where: { id: itemId },
    include: { batch: { include: { targetProduct: { select: { sku: true, name: true } } }, }, originalAsset: true },
  });
  if (!item?.originalAsset) throw new Error("IMAGE_ORIGINAL_NOT_FOUND");
  if (!item.originalAsset.isPrivate) throw new Error("IMAGE_ORIGINAL_NOT_PRIVATE");
  const sourceBytes = item.originalAsset.storageProvider === "r2" && item.originalAsset.objectKey
    ? await mediaStorage.getPrivateObject(item.originalAsset.objectKey)
    : item.originalAsset.data ? Buffer.from(item.originalAsset.data) : null;
  if (!sourceBytes) throw new Error("IMAGE_ORIGINAL_UNAVAILABLE");

  await prisma.aiImageItem.updateMany({ where: { id: itemId, status: "QUEUED" }, data: { status: "RUNNING" } });
  const form = new FormData();
  form.append("image_file", new Blob([Uint8Array.from(sourceBytes)], { type: item.originalAsset.mimeType }), item.originalFilename);
  const technical = item.batch.purpose === "TECHNICAL_DRAWING";
  let endpoint: string;
  if (technical) {
    if (!item.batch.targetProduct) throw new Error("TECHNICAL_DRAWING_TARGET_MISSING");
    form.append("product_name", item.batch.targetProduct.name);
    form.append("sku", item.batch.targetProduct.sku);
    endpoint = "technical-drawing";
  } else {
    form.append("preset", item.batch.preset);
    form.append("classification_hint", item.classificationHint || "");
    if (item.batch.visualPrompt) form.append("visual_prompt", item.batch.visualPrompt);
    endpoint = "process";
  }
  const response = await fetch(`${coreUrl}/internal/images/${endpoint}`, {
    method: "POST",
    headers: { "X-AI-Core-Key": coreSecret },
    body: form,
    signal: AbortSignal.timeout(540_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : "";
    throw new Error(/^[A-Z0-9_]{3,80}$/.test(detail) ? detail : `AI_CORE_HTTP_${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const outputMaxBytes = Number(process.env.AI_IMAGE_MAX_OUTPUT_BYTES) || 40 * 1024 * 1024;
  if (!bytes.byteLength || bytes.byteLength > Math.min(outputMaxBytes, 64 * 1024 * 1024)) throw new Error("AI_IMAGE_OUTPUT_TOO_LARGE");
  const encodedReport = response.headers.get("x-geme-image-qc") || "";
  let report: Record<string, unknown>;
  try {
    const decoded = JSON.parse(Buffer.from(encodedReport, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid report");
    report = decoded as Record<string, unknown>;
  } catch {
    throw new Error("AI_CORE_INVALID_QC_REPORT");
  }
  return { itemId, bytes, report };
}

type ProductDraftResult = {
  productName: string;
  shortDescription: string;
  detailedDescription: string;
  categorySuggestion: string | null;
  materialSuggestion: string | null;
  gemstoneSuggestion: string | null;
  seoTitle: string;
  seoMetaDescription: string;
  altText: string;
  confidenceScore: number;
  categoryConfidence: number | null;
  materialConfidence: number | null;
  gemstoneConfidence: number | null;
  needsReview: boolean;
  reviewReasons: string[];
  evidence: string[];
};

type MarketingDraftResult = {
  title: string;
  caption: string;
  body: string;
  call_to_action: string;
  seo_title: string;
  seo_description: string;
  alt_text: string;
  hashtags: string[];
  source_product_ids: string[];
  channel: string;
  fact_warnings: string[];
};

async function processProductDraft(task: { id: string; input: Prisma.JsonValue }) {
  const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
  if (typeof input.productDraftId !== "string" || typeof input.imageItemId !== "string") throw new Error("PRODUCT_DRAFT_INPUT_INVALID");
  const running = await prisma.aiProductDraft.updateMany({
    where: { id: input.productDraftId, taskId: task.id, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "RUNNING" },
  });
  if (running.count !== 1) throw new Error("PRODUCT_DRAFT_STATE_CONFLICT");
  const draft = await prisma.aiProductDraft.findUnique({
    where: { id: input.productDraftId },
    include: { sourceImageItem: { include: { batch: true, outputAsset: true } } },
  });
  const item = draft?.sourceImageItem;
  const asset = item?.outputAsset;
  if (!draft || draft.taskId !== task.id || item?.id !== input.imageItemId) throw new Error("PRODUCT_DRAFT_NOT_FOUND");
  if (item.status !== "APPROVED" || item.batch.purpose !== "PRODUCT_PHOTO" || !asset?.isPrivate) throw new Error("PRODUCT_DRAFT_IMAGE_NOT_APPROVED");
  const imageBytes = asset.storageProvider === "r2" && asset.objectKey
    ? await mediaStorage.getPrivateObject(asset.objectKey)
    : asset.data ? Buffer.from(asset.data) : null;
  if (!imageBytes) throw new Error("PRODUCT_DRAFT_IMAGE_UNAVAILABLE");
  if (imageBytes.byteLength > 8 * 1024 * 1024) throw new Error("PRODUCT_DRAFT_IMAGE_TOO_LARGE");

  const verifiedProductSku = typeof input.verifiedProductSku === "string" ? input.verifiedProductSku.trim() : "";
  const verifiedProductId = typeof input.verifiedProductId === "string" ? input.verifiedProductId.trim() : "";
  const verifiedProduct = verifiedProductSku ? await prisma.product.findUnique({
    where: { sku: verifiedProductSku },
    select: {
      id: true, sku: true, name: true, kind: true, status: true,
      category: { select: { name: true } }, gemstoneType: { select: { name: true } },
      materialOption: { select: { name: true, kind: true } },
    },
  }) : null;
  if (verifiedProductSku && (!verifiedProduct || verifiedProduct.id !== verifiedProductId || verifiedProduct.status !== "DRAFT")) {
    throw new Error("PRODUCT_DRAFT_VERIFIED_SKU_MISMATCH");
  }

  const [categories, materials, gemstoneCategories, gemstones] = await Promise.all([
    prisma.category.findMany({ where: { status: "ACTIVE", usage: "PRODUCT_CATEGORY", level: { lte: 2 } }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.materialOption.findMany({ where: { active: true, kind: "MATERIAL" }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.category.findMany({ where: { status: "ACTIVE", usage: "GEMSTONE_TYPE", level: 2 }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.materialOption.findMany({ where: { active: true, kind: "STONE" }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
  ]);
  const categoryOptions = [...new Set(categories.map(({ name }) => name))];
  const materialOptions = [...new Set(materials.map(({ name }) => name))];
  const gemstoneOptions = [...new Set([...gemstoneCategories, ...gemstones].map(({ name }) => name))];
  const form = new FormData();
  form.append("image_file", new Blob([Uint8Array.from(imageBytes)], { type: asset.mimeType }), asset.filename);
  form.append("category_options", JSON.stringify(categoryOptions));
  form.append("material_options", JSON.stringify(materialOptions));
  form.append("gemstone_options", JSON.stringify(gemstoneOptions));
  if (verifiedProduct) {
    const productFacts: Record<string, string> = { sku: verifiedProduct.sku, name: verifiedProduct.name };
    if (verifiedProduct.category?.name) productFacts.category = verifiedProduct.category.name;
    const verifiedGemstone = verifiedProduct.gemstoneType?.name || (verifiedProduct.materialOption?.kind === "STONE" ? verifiedProduct.materialOption.name : null);
    if (verifiedGemstone) productFacts.gemstone = verifiedGemstone;
    const verifiedMaterial = verifiedProduct.kind === "JEWELRY" ? "Bạc" : verifiedProduct.materialOption?.name;
    if (verifiedMaterial) productFacts.material = verifiedMaterial;
    form.append("verified_product_json", JSON.stringify(productFacts));
  }
  const response = await fetch(`${coreUrl}/internal/products/generate-draft`, {
    method: "POST",
    headers: { "X-AI-Core-Key": coreSecret },
    body: form,
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : "";
    throw new Error(/^[A-Z0-9_]{3,80}$/.test(detail) ? detail : `AI_CORE_HTTP_${response.status}`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("AI_CORE_RESPONSE_TOO_LARGE");
  const envelope = JSON.parse(raw) as { result?: unknown };
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) throw new Error("AI_CORE_INVALID_RESPONSE");
  const result = envelope.result as Record<string, unknown>;
  const canonical = (candidate: unknown, options: string[]) => {
    if (typeof candidate !== "string") return null;
    return options.find((value) => value.normalize("NFC").toLocaleLowerCase("vi-VN") === candidate.trim().normalize("NFC").toLocaleLowerCase("vi-VN")) || null;
  };
  const text = (key: string, max: number, fallback: string) => typeof result[key] === "string" ? (result[key] as string).trim().slice(0, max) || fallback : fallback;
  const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  const generatedCategorySuggestion = canonical(result.category_suggestion, categoryOptions);
  const categorySuggestion = verifiedProduct?.category?.name || generatedCategorySuggestion;
  const reasons = Array.isArray(result.review_reasons) ? result.review_reasons.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 180)).filter(Boolean).slice(0, 14) : [];
  if (!verifiedProduct && result.category_suggestion && !categorySuggestion) reasons.push("CATEGORY_NOT_IN_ACTIVE_CATALOG");
  // An image cannot verify metal purity or gemstone identity. Keep these fields
  // blank unless the image has an exact-SKU match to a trusted product record.
  if (!verifiedProduct && (result.material_suggestion || result.gemstone_suggestion)) reasons.push("MATERIAL_AND_GEMSTONE_REQUIRE_VERIFIED_PRODUCT_DATA");
  reasons.push("PRODUCT_CONTENT_REQUIRES_ADMIN_REVIEW");
  const confidence = result.confidence && typeof result.confidence === "object" && !Array.isArray(result.confidence) ? result.confidence as Record<string, unknown> : {};
  const categoryConfidence = verifiedProduct ? 100 : categorySuggestion ? score(confidence.category) : null;
  const evidence = Array.isArray(result.visible_evidence) ? result.visible_evidence.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 180)).filter(Boolean).slice(0, 12) : [];
  if (verifiedProduct) evidence.unshift(`SKU ${verifiedProduct.sku} khớp chính xác hồ sơ mới; tên, danh mục, loại đá và chất liệu lấy từ database.`);
  const distinctReasons = [...new Set(reasons)].slice(0, 16);
  const verifiedMaterial = verifiedProduct?.kind === "JEWELRY" ? "Bạc" : verifiedProduct?.materialOption?.name || null;
  const verifiedGemstone = verifiedProduct?.gemstoneType?.name || (verifiedProduct?.materialOption?.kind === "STONE" ? verifiedProduct.materialOption.name : null) || null;
  const materialConfidence = verifiedProduct && verifiedMaterial ? 100 : null;
  const gemstoneConfidence = verifiedProduct && verifiedGemstone ? 100 : null;
  const confidenceScore = verifiedProduct ? 100 : categoryConfidence ?? 0;
  const shortDescription = text("short_description", 500, "Sản phẩm GEME cần được đối chiếu với thông tin đã xác minh.");
  const productName = verifiedProduct?.name || text("product_name", 180, "Trang sức cần rà soát");
  const value: ProductDraftResult = {
    productName,
    shortDescription,
    detailedDescription: text("detailed_description", 6000, "Bản mô tả được tạo từ ảnh đã duyệt và cần quản trị viên rà soát trước khi sử dụng."),
    categorySuggestion,
    materialSuggestion: verifiedProduct ? verifiedMaterial : null,
    gemstoneSuggestion: verifiedProduct ? verifiedGemstone : null,
    seoTitle: verifiedProduct ? productName.slice(0, 180) : text("seo_title", 180, "Trang sức GEME"),
    seoMetaDescription: verifiedProduct ? shortDescription.slice(0, 320) : text("seo_meta_description", 320, "Khám phá thiết kế trang sức GEME với thông tin đã được quản trị viên kiểm duyệt."),
    altText: verifiedProduct ? productName.slice(0, 500) : text("alt_text", 500, "Hình ảnh sản phẩm trang sức GEME"),
    confidenceScore,
    categoryConfidence,
    materialConfidence,
    gemstoneConfidence,
    needsReview: true,
    reviewReasons: distinctReasons,
    evidence,
  };
  return { draftId: draft.id, batchId: draft.batchId, value };
}

async function refreshImageBatchState(transaction: Prisma.TransactionClient, batchId: string) {
  const rows = await transaction.aiImageItem.findMany({ where: { batchId }, select: { status: true } });
  const statuses = rows.map((row) => row.status);
  let status: "UPLOADING" | "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "PROCESSING";
  if (statuses.some((value) => value === "PENDING_UPLOAD")) status = "UPLOADING";
  else if (statuses.some((value) => value === "QUEUED" || value === "RUNNING")) status = "PROCESSING";
  else if (statuses.some((value) => value === "AWAITING_APPROVAL")) status = "REVIEW";
  else if (statuses.every((value) => value === "APPROVED")) status = "COMPLETE";
  else if (statuses.every((value) => value === "CANCELLED")) status = "CANCELLED";
  else if (statuses.every((value) => value === "FAILED")) status = "FAILED";
  else status = "PARTIAL";
  await transaction.aiImageBatch.update({ where: { id: batchId }, data: { status } });
}

async function refreshProductDraftBatchState(transaction: Prisma.TransactionClient, batchId: string) {
  const drafts = await transaction.aiProductDraft.findMany({ where: { batchId }, select: { status: true } });
  const statuses = drafts.map(({ status }) => status);
  let status: "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "REVIEW";
  if (statuses.some((value) => value === "QUEUED" || value === "RUNNING")) status = "PROCESSING";
  else if (statuses.every((value) => value === "CANCELLED")) status = "CANCELLED";
  else if (statuses.every((value) => value === "FAILED")) status = "FAILED";
  else if (statuses.every((value) => ["APPROVED", "REJECTED", "CANCELLED"].includes(value))) status = "COMPLETE";
  else if (statuses.some((value) => value === "FAILED" || value === "CANCELLED")) status = "PARTIAL";
  await transaction.aiProductDraftBatch.updateMany({ where: { id: batchId }, data: { status } });
}

await prisma.$connect();
const staleBefore = new Date(Date.now() - 15 * 60_000);
const staleRunning = await prisma.aiTask.findMany({ where: { status: "RUNNING", updatedAt: { lt: staleBefore } }, select: { id: true }, take: 1000 });
if (staleRunning.length) {
  const staleIds = staleRunning.map(({ id }) => id);
  await prisma.aiTask.updateMany({
    where: { id: { in: staleIds }, status: "RUNNING", updatedAt: { lt: staleBefore } },
    data: { status: "QUEUED", errorCode: "WORKER_RECOVERED", errorMessage: "Worker trước đó dừng giữa chừng; tác vụ được đưa lại vào hàng đợi.", completedAt: null },
  });
}
const queuedCount = await prisma.aiTask.count({ where: { status: "QUEUED" } });
for (let skip = 0; skip < queuedCount; skip += 500) {
  const pending = await prisma.aiTask.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip,
    take: 500,
  });
  if (pending.length) {
    await recoveryQueue.addBulk(pending.map(({ id }) => ({ name: "process-task", data: { taskId: id }, opts: { jobId: id } })));
  }
}
await recoveryQueue.close();
console.log(JSON.stringify({ event: "ai.worker.pending_tasks_recovered", recoveredStale: staleRunning.length, queued: queuedCount, at: new Date().toISOString() }));
const worker = new Worker<AiQueuePayload>(AI_STUDIO_QUEUE, processTask, {
  connection: redisConnectionOptions(true),
  concurrency: workerConcurrency(),
  lockDuration: 600_000,
  maxStalledCount: 2,
});

worker.on("ready", () => console.log(JSON.stringify({ event: "ai.worker.ready", queue: AI_STUDIO_QUEUE, concurrency: workerConcurrency(), at: new Date().toISOString() })));
worker.on("error", (error) => console.error(JSON.stringify({ event: "ai.worker.connection_error", message: error.message, at: new Date().toISOString() })));
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "ai.worker.job_failed", taskId: job?.data.taskId, code: safeErrorCode(error), at: new Date().toISOString() })));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "ai.worker.shutdown", signal, at: new Date().toISOString() }));
  await worker.close();
  await prisma.$disconnect();
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
