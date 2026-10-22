import assert from "node:assert/strict";
import test from "node:test";
import { Backoffs } from "bullmq";
import { ShopeeApiError } from "./shopee.client.js";
import { shopeeBackoffStrategy, SHOPEE_SYNC_JOB_OPTIONS } from "./shopee.retry.js";

test("BullMQ invokes the custom strategy because the queued job uses type=custom", async () => {
  const received: Array<[number, string | undefined]> = [];
  const strategy = (attemptsMade: number, type?: string, error?: Error) => {
    received.push([attemptsMade, type]);
    return shopeeBackoffStrategy(attemptsMade, type, error);
  };
  const delay = await Backoffs.calculate(
    SHOPEE_SYNC_JOB_OPTIONS.backoff,
    2,
    new ShopeeApiError("SHOPEE_NETWORK_ERROR", true),
    { id: "sync-test", name: "sync-orders", data: {}, timestamp: Date.now(), opts: SHOPEE_SYNC_JOB_OPTIONS },
    strategy,
  );
  assert.equal(SHOPEE_SYNC_JOB_OPTIONS.attempts, 5);
  assert.deepEqual(received, [[2, "custom"]]);
  assert.equal(delay, 10_000);
});

test("Shopee Retry-After controls the actual BullMQ delay and delay remains bounded", async () => {
  const job = { id: "sync-test", name: "sync-orders", data: {}, timestamp: Date.now(), opts: SHOPEE_SYNC_JOB_OPTIONS };
  const delay = await Backoffs.calculate(
    SHOPEE_SYNC_JOB_OPTIONS.backoff,
    1,
    new ShopeeApiError("SHOPEE_RATE_LIMITED", true, 429, 45),
    job,
    shopeeBackoffStrategy,
  );
  const bounded = await Backoffs.calculate(
    SHOPEE_SYNC_JOB_OPTIONS.backoff,
    1,
    new ShopeeApiError("SHOPEE_RATE_LIMITED", true, 429, 100_000),
    job,
    shopeeBackoffStrategy,
  );
  assert.equal(delay, 45_000);
  assert.equal(bounded, 86_400_000);
});
