import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const AI_STUDIO_QUEUE = "geme-ai-studio";
export const AI_QUEUE_DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1500, jitter: 0.25 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800, count: 5000 },
};
export type AiQueuePayload = { taskId: string };

function safeRedisErrorCode(error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error ? error.name : "";
  return /^[A-Z0-9_]{3,80}$/.test(candidate) ? candidate : "REDIS_UNAVAILABLE";
}

export function redisConnectionOptions(worker = false) {
  const configuredUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379/2";
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("REDIS_URL phải là URL Redis hợp lệ.");
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL chỉ hỗ trợ redis:// hoặc rediss://.");
  }
  const dbText = url.pathname.replace(/^\//, "");
  const db = dbText ? Number(dbText) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("REDIS_URL có database không hợp lệ.");

  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    enableReadyCheck: true,
    maxRetriesPerRequest: worker ? null : 1,
  };
}

@Injectable()
export class AiStudioQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AiStudioQueue.name);
  private readonly limiter = new Redis({ ...redisConnectionOptions(), keyPrefix: "geme-ai-studio:" });
  private readonly queue = new Queue<AiQueuePayload>(AI_STUDIO_QUEUE, {
    connection: redisConnectionOptions(),
    defaultJobOptions: AI_QUEUE_DEFAULT_JOB_OPTIONS,
  });

  async consumeCreateQuota(adminId: string) {
    const configured = Number(process.env.AI_STUDIO_RATE_LIMIT_PER_MINUTE);
    const limit = Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 60) : 12;
    const key = `create:${adminId}`;
    try {
      const result = await this.limiter.eval(
        "local t = redis.call('TIME'); local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000); local window = 60000; redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window); local count = redis.call('ZCARD', KEYS[1]); if count >= tonumber(ARGV[1]) then local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES'); return {0, math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))} end; redis.call('ZADD', KEYS[1], now, tostring(now) .. ':' .. ARGV[2]); redis.call('PEXPIRE', KEYS[1], window); return {count + 1, 0}",
        1,
        key,
        limit,
        randomUUID(),
      ) as [number, number];
      if (Number(result[0]) === 0) {
        const retryAfter = Math.max(1, Number(result[1]));
        throw new HttpException(`Giới hạn ${limit} tác vụ AI mỗi phút đã đạt. Vui lòng thử lại sau ${retryAfter} giây.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw error;
      this.logger.error(JSON.stringify({ event: "ai.queue.rate_limit_failed", adminId, code: safeRedisErrorCode(error) }));
      throw new ServiceUnavailableException("Không xác thực được giới hạn tác vụ AI. Vui lòng thử lại.");
    }
  }

  async enqueue(taskId: string, recovery = false) {
    try {
      await this.queue.add("process-task", { taskId }, { jobId: recovery ? `${taskId}-recovery-${randomUUID()}` : taskId });
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "ai.queue.enqueue_failed", taskId, code: safeRedisErrorCode(error) }));
      throw new ServiceUnavailableException("Hàng đợi AI tạm thời chưa truy cập được. Tác vụ đã được ghi nhận là lỗi để có thể tra cứu.");
    }
  }

  async counts() {
    try {
      const result = await this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      return { waiting: result.waiting || 0, active: result.active || 0, delayed: result.delayed || 0, failed: result.failed || 0, completed: result.completed || 0 };
    } catch (error) {
      this.logger.error(JSON.stringify({ event: "ai.queue.stats_failed", code: safeRedisErrorCode(error) }));
      throw new ServiceUnavailableException("Không đọc được trạng thái hàng đợi AI.");
    }
  }

  async removeIfWaiting(taskId: string) {
    try {
      const job = await this.queue.getJob(taskId);
      if (!job) return;
      const state = await job.getState();
      if (state === "waiting" || state === "delayed") await job.remove();
    } catch (error) {
      // The PostgreSQL state remains authoritative; the worker checks it before
      // committing a result, so a Redis outage cannot undo a cancellation.
      this.logger.warn(JSON.stringify({ event: "ai.queue.cancel_cleanup_failed", taskId, code: safeRedisErrorCode(error) }));
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.limiter.quit();
  }
}
