import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "../queue/redis-connection.js";

export const SOCIAL_PUBLISH_QUEUE = "geme-social-publish";
export type SocialPublishPayload = { targetId: string; revision: number };

@Injectable()
export class SocialPublishQueue implements OnModuleDestroy {
  private readonly logger = new Logger(SocialPublishQueue.name);
  private readonly queue = new Queue<SocialPublishPayload>(SOCIAL_PUBLISH_QUEUE, {
    connection: redisConnectionOptions(),
    defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86_400, count: 3000 }, removeOnFail: { age: 604_800, count: 5000 } },
  });

  async enqueue(targetId: string, revision: number, scheduledAt: Date | null = null) {
    try {
      const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;
      const generation = scheduledAt?.getTime() ?? Date.now();
      const jobId = `${targetId}-r${revision}-t${generation}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "failed" || state === "completed") await existing.remove();
        else return;
      }
      await this.queue.add("publish-approved-target", { targetId, revision }, { jobId, delay });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "REDIS_UNAVAILABLE";
      this.logger.error(JSON.stringify({ event: "social.queue.enqueue_failed", targetId, revision, code }));
      throw new ServiceUnavailableException("Hàng đợi đăng bài chưa sẵn sàng. Nội dung vẫn được lưu để worker tự khôi phục.");
    }
  }

  async onModuleDestroy() { await this.queue.close(); }
}
