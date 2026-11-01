import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryRateStore, rateLimitMiddleware, ratePolicy, type RateRequest } from "./request-rate-limit.js";

const request = (path: string, method = "POST"): RateRequest => ({ path, method, ip: "192.0.2.1", socket: {} });
function response() {
  return { code: 200, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.code = code; return this; }, json(value: unknown) { this.body = value; } };
}

test("Express case/trailing-slash aliases cannot evade sensitive route limits", () => {
  for (const path of ["/api/v1/admin/auth/login", "/API/v1/Admin/Auth/Login/", "/api/v1/admin/auth/login///"])
    assert.deepEqual(ratePolicy(request(path)), { bucket: "admin-login", limit: 10, read: false });
  assert.equal(ratePolicy(request("/api/v1/integrations/sepay/webhook/"))?.limit, 1200);
  assert.equal(ratePolicy(request("/api/v1/orders/"))?.limit, 5);
});

test("only real read-only health endpoints bypass the limiter", () => {
  assert.equal(ratePolicy(request("/api/v1/health/ready", "GET")), null);
  assert.notEqual(ratePolicy(request("/api/v1/health/ready")), null);
  assert.notEqual(ratePolicy(request("/api/v1/health/attacker", "GET")), null);
});

test("fixed window expires and traffic does not extend it", async () => {
  let now = 0;
  const memory = new MemoryRateStore(() => now);
  assert.equal((await memory.consume("a", 1)).allowed, true);
  now = 59_100;
  assert.deepEqual(await memory.consume("a", 1), { allowed: false, retryAfter: 1 });
  assert.equal((await memory.consume("b", 1)).allowed, true);
  now = 60_000;
  assert.equal((await memory.consume("a", 1)).allowed, true);
});

test("two API instances share quota and do not store raw client addresses", async () => {
  const shared = new MemoryRateStore(); const keys: string[] = [];
  const store = { consume: (key: string, limit: number) => { keys.push(key); return shared.consume(key, limit); } };
  const instances = [rateLimitMiddleware(store), rateLimitMiddleware(store)];
  let accepted = 0;
  const replies = await Promise.all(Array.from({ length: 40 }, async (_, index) => {
    const reply = response(); await instances[index % 2](request("/api/v1/admin/auth/login"), reply, () => accepted++); return reply;
  }));
  assert.equal(accepted, 10);
  assert.equal(replies.filter(r => r.code === 429).length, 30);
  assert.ok(keys.every(key => !key.includes("192.0.2.1")));
  assert.ok(replies.filter(r => r.code === 429).every(r => Number(r.headers["Retry-After"]) > 0));
});

test("Redis failure blocks writes and webhook processing; only reads get bounded fallback", async () => {
  const middleware = rateLimitMiddleware({ consume: async () => { throw new Error("private connection detail"); } }, { readLimit: 1, readFallback: new MemoryRateStore() });
  let accepted = 0;
  for (const path of ["/api/v1/orders", "/api/v1/admin/auth/login", "/api/v1/integrations/sepay/webhook"]) {
    const reply = response(); await middleware(request(path), reply, () => accepted++);
    assert.equal(reply.code, 503); assert.equal(reply.headers["Retry-After"], "5");
    assert.ok(!JSON.stringify(reply.body).includes("private"));
  }
  assert.equal(accepted, 0);
  const first = response(); await middleware(request("/api/v1/products", "GET"), first, () => accepted++);
  const second = response(); await middleware(request("/api/v1/products", "GET"), second, () => accepted++);
  assert.equal(accepted, 1); assert.equal(second.code, 429);
});
