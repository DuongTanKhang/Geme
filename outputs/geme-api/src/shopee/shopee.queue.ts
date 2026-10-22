import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "../ai-studio/ai-studio.queue.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { shopeeConfig } from "./shopee.client.js";

export const SHOPEE_SYNC_QUEUE = "geme-shopee-readonly-sync";
export const SHOPEE_WORKER_HEARTBEAT_KEY = "geme-shopee-readonly-worker:heartbeat";
export type ShopeeSyncPayload = { connectionId?: string; syncRunId?: string };
const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5_000, jitter: 0.25 },
  removeOnComplete: { age: 86_400, count: 3000 },
  removeOnFail: { age: 604_800, count: 5000 },
};

@Injectable()
export class ShopeeSyncQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ShopeeSyncQueue.name);
  private readonly redis = new Redis({ ...redisConnectionOptions(), maxRetriesPerRequest: 1, lazyConnect: true });
  private readonly queue = new Queue<ShopeeSyncPayload>(SHOPEE_SYNC_QUEUE, {
    connection: redisConnectionOptions(),
    defaultJobOptions,
  });

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(connectionId: string, adminId?: string, retryOfId?: string) {
    const config = shopeeConfig();
    if (!config.configured) throw new ServiceUnavailableException("Shopee đang tắt hoặc cấu hình chưa hợp lệ.");
    const jobId = `sync-${connectionId}`;
    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true, environment: true, partnerId: true, syncCursorAt: true } });
    if (!connection || connection.status !== "ACTIVE" || connection.environment !== config.environment || connection.partnerId !== config.partnerId) throw new ServiceUnavailableException("Shop Shopee chưa kết nối với ứng dụng/môi trường đang cấu hình.");
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["waiting", "active", "delayed", "waiting-children"].includes(state)) {
        return { queued: false, syncRunId: existing.data.syncRunId };
      }
      await existing.remove();
    }

    const syncRun = await this.prisma.shopeeSyncRun.create({ data: { connectionId, status: "QUEUED", fromTime: connection.syncCursorAt, retryOfId: retryOfId ?? null, createdByAdminId: adminId ?? null } });
    try {
      const job = await this.queue.add("sync-orders", { connectionId, syncRunId: syncRun.id }, { jobId, ...defaultJobOptions });
      if (job.data.syncRunId !== syncRun.id) {
        await this.prisma.shopeeSyncRun.update({ where: { id: syncRun.id }, data: { status: "CANCELLED", finishedAt: new Date(), errorCode: "SHOPEE_SYNC_ALREADY_QUEUED" } });
        return { queued: false, syncRunId: job.data.syncRunId };
      }
      return { queued: true, syncRunId: syncRun.id };
    } catch (error) {
      await this.prisma.shopeeSyncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", finishedAt: new Date(), errorCode: "SHOPEE_QUEUE_UNAVAILABLE" } }).catch(() => undefined);
      const candidate = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "REDIS_UNAVAILABLE";
      this.logger.error(JSON.stringify({ event: "shopee.sync.enqueue_failed", connectionId, code: /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : "REDIS_UNAVAILABLE" }));
      throw new ServiceUnavailableException("Không đưa được tác vụ Shopee vào hàng đợi. Có thể thử lại sau.");
    }
  }

  async summary() {
    try {
      const [counts, heartbeat, waitingJobs] = await Promise.all([
        this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
        this.redis.get(SHOPEE_WORKER_HEARTBEAT_KEY),
        this.queue.getJobs(["waiting"], 0, 0),
      ]);
      const config = shopeeConfig();
      const workerBeat = heartbeat ? JSON.parse(heartbeat) as { at?: string; ready?: boolean } : null;
      const age = waitingJobs[0] ? Math.max(0, Math.floor((Date.now() - waitingJobs[0].timestamp) / 1000)) : 0;
      const fresh = workerBeat?.at && Date.now() - new Date(workerBeat.at).getTime() <= 30_000;
      return {
        available: true,
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        delayed: counts.delayed || 0,
        failed: counts.failed || 0,
        completed: counts.completed || 0,
        workerStatus: !config.enabled ? "disabled" : config.configurationStatus !== "ready" ? "not_configured" : fresh && workerBeat?.ready ? "online" : "offline",
        oldestWaitingSeconds: age,
        workerWarning: Boolean((counts.waiting || 0) > 0 && (!fresh || age > 60)),
      };
    } catch {
      return { available: false, workerStatus: "unavailable", errorCode: "REDIS_UNAVAILABLE" };
    }
  }

  async enqueuePeriodic(connectionId: string) {
    return this.enqueue(connectionId);
  }

  async waitForApiSlot() {
    const config = shopeeConfig();
    const key = `geme-shopee:api-rate:${config.environment}:${config.partnerId || "unconfigured"}`;
    const token = randomUUID();
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if (await this.redis.set(key, token, "PX", 1000, "NX") === "OK") return;
      } catch {
        throw new ServiceUnavailableException("Không kết nối được Redis để giới hạn an toàn các yêu cầu Shopee.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ServiceUnavailableException("Hàng đợi yêu cầu Shopee đang bận. Hãy thử lại sau.");
  }

  async schedulePoll(intervalMinutes: number) {
    await this.queue.upsertJobScheduler("poll-active-shops", { every: intervalMinutes * 60_000 }, {
      name: "poll-active-shops",
      data: {},
      opts: {
        removeOnComplete: { age: 86_400, count: 3000 },
        removeOnFail: { age: 604_800, count: 5000 },
      },
    });
  }

  async removePollSchedule() {
    await this.queue.removeJobScheduler("poll-active-shops").catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.redis.quit().catch(() => undefined);
  }
}
