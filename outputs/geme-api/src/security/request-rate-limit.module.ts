import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "../queue/redis-connection.js";
import { MemoryRateStore, RATE_LIMIT_SCRIPT, rateLimitMiddleware, type RateResult, type RateStore } from "./request-rate-limit.js";

@Injectable()
export class RequestRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestRateLimitService.name);
  private readonly redis?: Redis;
  private lastWarning = 0;
  readonly middleware;

  constructor() {
    const production = process.env.NODE_ENV === "production";
    if (production && !process.env.REDIS_URL?.trim()) throw new Error("REDIS_URL is required for shared production rate limits.");
    const prefix = process.env.API_RATE_LIMIT_PREFIX || "geme:rate-limit:v1";
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(prefix)) throw new Error("API_RATE_LIMIT_PREFIX must contain 1–100 letters, digits, :, _, or -.");
    const memory = new MemoryRateStore();
    let store: RateStore = memory;
    if (process.env.REDIS_URL?.trim()) {
      const redis = this.redis = new Redis({ ...redisConnectionOptions(), lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 2_000, commandTimeout: 1_000, retryStrategy: (attempt) => Math.min(attempt * 250, 5_000) });
      redis.on("error", () => this.warnUnavailable());
      store = { consume: async (key, limit): Promise<RateResult> => {
        if (redis.status !== "ready") throw new Error("Rate limit Redis unavailable");
        const [count, ttl] = await redis.eval(RATE_LIMIT_SCRIPT, 1, key, limit) as [number, number];
        return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
      } };
    }
    const limit = (name: string, fallback: number, minimum: number) => {
      const value = Number(process.env[name]);
      return Number.isInteger(value) && value >= minimum ? Math.min(value, 60_000) : fallback;
    };
    this.middleware = rateLimitMiddleware(store, {
      prefix, readLimit: limit("API_READ_REQUESTS_PER_MINUTE", 30_000, 100),
      writeLimit: limit("API_WRITE_REQUESTS_PER_MINUTE", 120, 20),
      onUnavailable: () => this.warnUnavailable(), readFallback: memory,
    });
  }

  async onModuleInit() {
    if (this.redis) await this.redis.connect().catch(() => this.warnUnavailable());
  }
  onModuleDestroy() { this.redis?.disconnect(); }
  ready() { return !this.redis || this.redis.status === "ready"; }
  private warnUnavailable() {
    if (Date.now() - this.lastWarning < 30_000) return;
    this.lastWarning = Date.now();
    // Never log Redis URLs/passwords or raw request contents.
    this.logger.warn("Rate limit Redis unavailable: reads use a local limit; writes return 503 for retry.");
  }
}

@Global()
@Module({ providers: [RequestRateLimitService], exports: [RequestRateLimitService] })
export class RequestRateLimitModule {}
