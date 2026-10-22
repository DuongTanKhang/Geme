import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "../ai-studio/ai-studio.queue.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const SHOPEE_SYNC_QUEUE = "geme-shopee-readonly-sync";
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
  private readonly queue = new Queue<ShopeeSyncPayload>(SHOPEE_SYNC_QUEUE, {
    connection: redisConnectionOptions(),
    defaultJobOptions,
  });

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(connectionId: string, adminId?: string, retryOfId?: string) {
    const jobId = `sync-${connectionId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["waiting", "active", "delayed", "waiting-children"].includes(state)) {
        return { queued: false, syncRunId: existing.data.syncRunId };
      }
      await existing.remove();
    }

    const connection = await this.prisma.shopeeConnection.findUnique({ where: { id: connectionId }, select: { id: true, status: true, syncCursorAt: true } });
    if (!connection || connection.status !== "ACTIVE") throw new ServiceUnavailableException("Shop Shopee chưa kết nối hoặc đã ngắt kết nối.");
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
    const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    return { waiting: counts.waiting || 0, active: counts.active || 0, delayed: counts.delayed || 0, failed: counts.failed || 0, completed: counts.completed || 0 };
  }

  async enqueuePeriodic(connectionId: string) {
    return this.enqueue(connectionId);
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

  async onModuleDestroy() {
    await this.queue.close();
  }
}
