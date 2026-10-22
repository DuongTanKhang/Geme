import "dotenv/config";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "../ai-studio/ai-studio.queue.js";
import { shopeeConfig } from "./shopee.client.js";
import { SHOPEE_WORKER_HEARTBEAT_KEY } from "./shopee.queue.js";

const config = shopeeConfig();
if (!config.enabled) process.exit(0);
if (!config.configured) process.exit(1);

const redis = new Redis({ ...redisConnectionOptions(), connectTimeout: 2_000, maxRetriesPerRequest: 1 });
try {
  const value = await redis.get(SHOPEE_WORKER_HEARTBEAT_KEY);
  const heartbeat = value ? JSON.parse(value) as { at?: string; ready?: boolean } : null;
  const age = heartbeat?.at ? Date.now() - new Date(heartbeat.at).getTime() : Infinity;
  if (!heartbeat?.ready || !Number.isFinite(age) || age > 30_000) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await redis.quit().catch(() => undefined);
}
