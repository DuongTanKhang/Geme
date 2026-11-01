import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "../queue/redis-connection.js";
import { RATE_LIMIT_SCRIPT } from "./request-rate-limit.js";

test("real Redis: parallel replicas share an atomic quota and expiry", { skip: process.env.SECURITY_TEST_REDIS !== "true" }, async () => {
  const clients = [new Redis(redisConnectionOptions()), new Redis(redisConnectionOptions())];
  const key = `geme:security-test:${randomUUID()}`;
  try {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => clients[i % 2].eval(RATE_LIMIT_SCRIPT, 1, key, 10))) as [number, number][];
    assert.equal(results.filter(([count]) => count <= 10).length, 10);
    assert.ok(results.every(([, ttl]) => ttl > 0 && ttl <= 60_000));
    const before = await clients[0].pttl(key);
    const [, remaining] = await clients[1].eval(RATE_LIMIT_SCRIPT, 1, key, 10) as [number, number];
    assert.ok(remaining <= before, "retries must not extend the window");
    await clients[0].pexpire(key, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    const [fresh] = await clients[1].eval(RATE_LIMIT_SCRIPT, 1, key, 10) as [number, number];
    assert.equal(fresh, 1);
  } finally {
    await clients[0].del(key).catch(() => undefined);
    clients.forEach(client => client.disconnect());
  }
});
