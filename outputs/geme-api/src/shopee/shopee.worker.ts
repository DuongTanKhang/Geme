import "dotenv/config";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { redisConnectionOptions } from "../ai-studio/ai-studio.queue.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopeeSyncQueue, SHOPEE_SYNC_QUEUE, type ShopeeSyncPayload } from "./shopee.queue.js";
import { ShopeeService } from "./shopee.service.js";
import { ShopeeApiError, shopeeConfig } from "./shopee.client.js";

const logger = new Logger("ShopeeReadOnlyWorker");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Shopee worker.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const syncQueue = new ShopeeSyncQueue(prisma as unknown as PrismaService);
const service = new ShopeeService(prisma as unknown as PrismaService, syncQueue);
const concurrencyInput = Number(process.env.SHOPEE_WORKER_CONCURRENCY);
const concurrency = Number.isInteger(concurrencyInput) ? Math.max(1, Math.min(8, concurrencyInput)) : 2;

async function pollActiveShops() {
  const connections = await prisma.shopeeConnection.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let queued = 0;
  for (const connection of connections) {
    try {
      const result = await syncQueue.enqueuePeriodic(connection.id);
      if (result.queued) queued++;
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : "SHOPEE_POLL_ENQUEUE_FAILED";
      logger.warn(JSON.stringify({ event: "shopee.poll.enqueue_failed", connectionId: connection.id, code }));
    }
  }
  logger.log(JSON.stringify({ event: "shopee.poll.completed", activeShops: connections.length, queued }));
}

const worker = new Worker<ShopeeSyncPayload>(SHOPEE_SYNC_QUEUE, async (job: Job<ShopeeSyncPayload>) => {
  if (job.name === "poll-active-shops") {
    await pollActiveShops();
    return;
  }
  if (job.name !== "sync-orders") throw new UnrecoverableError("SHOPEE_UNKNOWN_JOB");
  const { connectionId, syncRunId } = job.data;
  if (!connectionId || !syncRunId) throw new UnrecoverableError("SHOPEE_SYNC_PAYLOAD_INVALID");
  try {
    await service.processSync(connectionId, syncRunId);
  } catch (error) {
    if (error instanceof ShopeeApiError && !error.retryable) throw new UnrecoverableError(error.code);
    if (error instanceof Error && ["SHOPEE_CONNECTION_INACTIVE", "SHOPEE_SYNC_RUN_NOT_FOUND", "SHOPEE_SYNC_CANCELLED"].includes(error.message)) throw new UnrecoverableError(error.message);
    throw error;
  }
}, { connection: redisConnectionOptions(true), concurrency, lockDuration: 10 * 60_000, stalledInterval: 60_000 });

worker.on("completed", (job) => logger.log(JSON.stringify({ event: "shopee.worker.job_completed", jobId: job.id, name: job.name })));
worker.on("failed", (job, error) => {
  const code = error instanceof ShopeeApiError ? error.code : error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : "SHOPEE_SYNC_FAILED";
  logger.error(JSON.stringify({ event: "shopee.worker.job_failed", jobId: job?.id, name: job?.name, attempt: job?.attemptsMade, code }));
  if (job?.name === "sync-orders" && (error instanceof UnrecoverableError || job.attemptsMade >= Number(job.opts.attempts ?? 1))) {
    if (job.data.syncRunId) void prisma.shopeeSyncRun.updateMany({ where: { id: job.data.syncRunId, status: { in: ["RETRYING", "RUNNING", "QUEUED"] } }, data: { status: "FAILED", finishedAt: new Date(), errorCode: code } });
    if (job.data.connectionId) void prisma.shopeeConnection.updateMany({ where: { id: job.data.connectionId, status: "ACTIVE" }, data: { lastErrorCode: code } });
  }
});
worker.on("error", (error) => logger.error(JSON.stringify({ event: "shopee.worker.error", code: error.name })));

await syncQueue.schedulePoll(shopeeConfig().pollIntervalMinutes);
logger.log(JSON.stringify({ event: "shopee.worker.started", concurrency, pollIntervalMinutes: shopeeConfig().pollIntervalMinutes }));

async function shutdown() {
  await worker.close();
  await syncQueue.onModuleDestroy();
  await prisma.$disconnect();
}
process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
