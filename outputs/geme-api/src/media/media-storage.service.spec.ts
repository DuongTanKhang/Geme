import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { MediaStorageService } from "./media-storage.service.js";

const envKeys = ["MEDIA_STORAGE_PROVIDER", "R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_REQUEST_TIMEOUT_MS"];
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function configureR2() {
  process.env.MEDIA_STORAGE_PROVIDER = "r2";
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_BUCKET_NAME = "test-public";
  process.env.R2_ACCESS_KEY_ID = "test-key-id";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-value-never-log";
  process.env.R2_REQUEST_TIMEOUT_MS = "1000";
}

test("idempotent R2 uploads retry transient server responses a bounded number of times", async () => {
  configureR2();
  let calls = 0;
  const headers: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    calls++;
    headers.push(new Headers(init?.headers).get("Authorization") || "");
    return new Response(null, { status: calls < 3 ? 503 : 200 });
  }) as typeof fetch;
  const storage = new MediaStorageService();
  await storage.putPublicObject("media/immutable-key.webp", new Uint8Array([1, 2, 3]), "image/webp");
  assert.equal(calls, 3);
  assert.ok(headers.every((header) => header.includes("test-key-id")));
});

test("R2 timeout is bounded, classified, and does not log credentials", async () => {
  configureR2();
  let calls = 0;
  const logs: string[] = [];
  globalThis.fetch = (async () => { calls++; const error = new Error("timeout"); error.name = "TimeoutError"; throw error; }) as typeof fetch;
  const storage = new MediaStorageService();
  (storage as any).logger = { warn: (message: string) => logs.push(message), error: (message: string) => logs.push(message) };
  await assert.rejects(() => storage.getPublicObject("media/slow.webp"), (error: unknown) => error instanceof ServiceUnavailableException && /hết thời gian chờ/i.test(error.message));
  assert.equal(calls, 3);
  assert.ok(logs.some((line) => line.includes("timeout")));
  assert.ok(logs.every((line) => !line.includes("test-secret-value-never-log") && !line.includes("test-key-id")));
});

test("R2 network failures retry only a bounded number of times and classify distinctly", async () => {
  configureR2();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new TypeError("socket closed"); }) as typeof fetch;
  const storage = new MediaStorageService();
  await assert.rejects(() => storage.getPublicObject("media/offline.webp"), (error: unknown) => error instanceof ServiceUnavailableException && /Không kết nối/i.test(error.message));
  assert.equal(calls, 3);
});

test("R2 HTTP failures are distinguished from transport and timeout failures", async () => {
  configureR2();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch;
  const storage = new MediaStorageService();
  await assert.rejects(() => storage.getPublicObject("media/server-error.webp"), (error: unknown) => error instanceof ServiceUnavailableException && /lỗi HTTP 503/i.test(error.message));
  assert.equal(calls, 3);
});
