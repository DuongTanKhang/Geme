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

async function processTask(job: Job<AiQueuePayload>) {
  const { taskId } = job.data;
  const task = await prisma.aiTask.findUnique({ where: { id: taskId } });
  if (!task || task.status === "CANCELLED") return { skipped: true };

  const attempt = job.attemptsMade + 1;
  const claimed = await prisma.aiTask.updateMany({
    where: { id: taskId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "RUNNING", startedAt: task.startedAt || new Date(), attemptCount: attempt, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) return { skipped: true };

  let pendingImageOutput: { itemId: string; bytes: Buffer; report: Record<string, unknown> } | null = null;
  let orphanPrivateObjectKey: string | null = null;
  try {
    let result: Prisma.InputJsonObject;
    if (task.type === "IMAGE_STUDIO_PROCESSING") {
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
      const response = await fetch(`${coreUrl}/internal/tasks/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AI-Core-Key": coreSecret },
        body: JSON.stringify({ task_id: task.id, idempotency_key: task.idempotencyKey, type: task.type, input: task.input }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`AI_CORE_HTTP_${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("AI_CORE_RESPONSE_TOO_LARGE");
      const envelope = JSON.parse(raw) as { result?: unknown };
      if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) throw new Error("AI_CORE_INVALID_RESPONSE");
      result = envelope.result as Prisma.InputJsonObject;
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
        data: { status: requiresApproval ? "AWAITING_APPROVAL" : "SUCCEEDED", result, completedAt: new Date(), errorCode: null, errorMessage: null },
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
    const willRetry = attempt < maxAttempts;
    await prisma.aiTask.updateMany({
      where: { id: taskId, status: "RUNNING" },
      data: {
        status: willRetry ? "QUEUED" : "FAILED",
        errorCode: safeErrorCode(error),
        errorMessage: willRetry ? "AI Core tạm thời chưa xử lý được; tác vụ sẽ tự thử lại." : "Tác vụ AI thất bại sau các lần thử lại.",
        ...(willRetry ? {} : { completedAt: new Date() }),
      },
    });
    if (task.type === "IMAGE_STUDIO_PROCESSING") {
      const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
      if (typeof input.imageItemId === "string") {
        await prisma.$transaction(async (transaction) => {
          await transaction.aiImageItem.updateMany({
            where: { id: input.imageItemId as string, status: { in: ["QUEUED", "RUNNING"] } },
            data: { status: willRetry ? "QUEUED" : "FAILED", errorCode: safeErrorCode(error), attemptCount: attempt },
          });
          const item = await transaction.aiImageItem.findUnique({ where: { id: input.imageItemId as string }, select: { batchId: true } });
          if (item) await refreshImageBatchState(transaction, item.batchId);
        });
      }
    }
    console.error(JSON.stringify({ event: "ai.worker.task_failed", taskId, attempt, maxAttempts, willRetry, code: safeErrorCode(error), at: new Date().toISOString() }));
    throw error instanceof Error ? error : new Error("AI_CORE_UNAVAILABLE");
  }
}

async function processStudioImage(task: { id: string; input: Prisma.JsonValue }) {
  const input = task.input && typeof task.input === "object" && !Array.isArray(task.input) ? task.input as Record<string, unknown> : {};
  const itemId = typeof input.imageItemId === "string" ? input.imageItemId : "";
  if (!itemId) throw new Error("IMAGE_ITEM_NOT_FOUND");
  const item = await prisma.aiImageItem.findUnique({
    where: { id: itemId },
    include: { batch: true, originalAsset: true },
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
  form.append("preset", item.batch.preset);
  form.append("classification_hint", item.classificationHint || "");
  const response = await fetch(`${coreUrl}/internal/images/process`, {
    method: "POST",
    headers: { "X-AI-Core-Key": coreSecret },
    body: form,
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) throw new Error(`AI_CORE_HTTP_${response.status}`);
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

await prisma.$connect();
const staleBefore = new Date(Date.now() - 5 * 60_000);
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
  lockDuration: 180_000,
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
