import { ShopeeApiError } from "./shopee.client.js";

export const SHOPEE_SYNC_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "custom" as const, delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 3000 },
  removeOnFail: { age: 604_800, count: 5000 },
};

export function shopeeBackoffStrategy(attemptsMade: number, type: string | undefined, error?: Error) {
  if (type !== "custom") return -1;
  const exponential = Math.min(300_000, 5_000 * 2 ** Math.max(0, attemptsMade - 1));
  const retryAfter = error instanceof ShopeeApiError ? Math.max(0, (error.retryAfterSeconds || 0) * 1000) : 0;
  // A bounded server delay protects the worker from an accidental multi-year
  // Retry-After while preserving normal seconds/minutes values from Shopee.
  return Math.min(86_400_000, Math.max(exponential, retryAfter));
}
