import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { DELETE, GET, POST } from "../app/api/admin/[...path]/route.ts";
import { getCollectionState, socialPostStatusSummary } from "../lib/social-ui-state.mjs";
import { adminProxyTimeoutMs, isAdminEventStreamRequest } from "../lib/social-proxy.mjs";

const originalFetch = globalThis.fetch;
const originalApiBase = process.env.GEME_API_BASE_URL;

function makeRequest(path, { method = "GET", headers = {}, body } = {}) {
  return new NextRequest(`http://localhost:3001/api/admin/${path}`, { method, headers, body });
}

test("social admin GET maps to /api/v1/admin/social and preserves query and response status", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1/";
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return new Response(JSON.stringify({ posts: [] }), { status: 207, headers: { "content-type": "application/json" } });
  };
  const response = await GET(makeRequest("social/posts?status=PARTIAL&limit=5", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["social", "posts"] }) });
  assert.equal(observed.url, "http://geme-api:4000/api/v1/admin/social/posts?status=PARTIAL&limit=5");
  assert.equal(observed.init.method, "GET");
  assert.equal(observed.init.headers.get("authorization"), "Bearer secret");
  assert.equal(response.status, 207);
  assert.deepEqual(await response.json(), { posts: [] });
});

test("Admin EventSource requests keep their upstream stream open and follow client cancellation", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observed;
  const request = makeRequest("products/events", {
    headers: { cookie: "geme_admin_session=secret", accept: "text/event-stream" },
  });
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: connected\n\n")); },
    }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  };
  assert.equal(isAdminEventStreamRequest(request), true);
  const response = await GET(request, { params: Promise.resolve({ path: ["products", "events"] }) });
  assert.equal(observed.url, "http://geme-api:4000/api/v1/products/events");
  assert.equal(observed.init.signal, request.signal);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  await response.body.cancel();
});

test("ordinary Admin API calls retain the bounded upstream timeout", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observed;
  const request = makeRequest("products", { headers: { cookie: "geme_admin_session=secret", accept: "application/json" } });
  globalThis.fetch = async (_url, init) => {
    observed = init;
    return Response.json({ products: [] });
  };
  assert.equal(isAdminEventStreamRequest(request), false);
  await GET(request, { params: Promise.resolve({ path: ["products"] }) });
  assert.ok(observed.signal instanceof AbortSignal);
  assert.notEqual(observed.signal, request.signal);
  assert.equal(observed.signal.aborted, false);
});

test("long direct uploads keep their 120 second timeout while ordinary API calls stay bounded", () => {
  assert.equal(adminProxyTimeoutMs(["ai-studio", "product-agent", "direct-upload"]), 120_000);
  assert.equal(adminProxyTimeoutMs(["categories", "category-id"]), 30_000);
});

test("social admin POST preserves body and safe headers", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return Response.json({ authorized: true }, { status: 201 });
  };
  const response = await POST(makeRequest("social/meta/authorize", {
    method: "POST",
    headers: { host: "localhost:3001", origin: "http://localhost:3001", cookie: "geme_admin_session=secret", "content-type": "application/json", "idempotency-key": "req-123" },
    body: JSON.stringify({ intent: "connect" }),
  }), { params: Promise.resolve({ path: ["social", "meta", "authorize"] }) });
  assert.equal(observed.url, "http://geme-api:4000/api/v1/admin/social/meta/authorize");
  assert.equal(observed.init.method, "POST");
  assert.equal(observed.init.headers.get("authorization"), "Bearer secret");
  assert.equal(observed.init.headers.get("idempotency-key"), "req-123");
  assert.deepEqual(JSON.parse(Buffer.from(observed.init.body).toString("utf8")), { intent: "connect" });
  assert.equal(response.status, 201);
});

test("Shopee admin routes preserve method, query, body, session auth and same-origin protections", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1/";
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url: String(url), init };
    return Response.json({ queued: true }, { status: 202 });
  };
  const response = await POST(makeRequest("shopee/connections/abc/sync?source=admin", {
    method: "POST",
    headers: { host: "localhost:3001", origin: "http://localhost:3001", cookie: "geme_admin_session=secret", "content-type": "application/json" },
    body: JSON.stringify({ run: "now" }),
  }), { params: Promise.resolve({ path: ["shopee", "connections", "abc", "sync"] }) });
  assert.equal(observed.url, "http://geme-api:4000/api/v1/admin/shopee/connections/abc/sync?source=admin");
  assert.equal(observed.init.method, "POST");
  assert.equal(observed.init.headers.get("authorization"), "Bearer secret");
  assert.deepEqual(JSON.parse(Buffer.from(observed.init.body).toString("utf8")), { run: "now" });
  assert.equal(response.status, 202);
});

test("Shopee GET and DELETE keep the admin controller prefix and never forward cookies", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  const observed = [];
  globalThis.fetch = async (url, init) => {
    observed.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  const getResponse = await GET(makeRequest("shopee/orders?environment=sandbox&page=2", {
    headers: { host: "localhost:3001", cookie: "geme_admin_session=secret" },
  }), { params: Promise.resolve({ path: ["shopee", "orders"] }) });
  const deleteResponse = await DELETE(makeRequest("shopee/connections/connection-id", {
    method: "DELETE",
    headers: { host: "localhost:3001", origin: "http://localhost:3001", cookie: "geme_admin_session=secret" },
  }), { params: Promise.resolve({ path: ["shopee", "connections", "connection-id"] }) });
  assert.equal(observed[0].url, "http://geme-api:4000/api/v1/admin/shopee/orders?environment=sandbox&page=2");
  assert.equal(observed[0].init.method, "GET");
  assert.equal(observed[0].init.headers.get("authorization"), "Bearer secret");
  assert.equal(observed[0].init.headers.has("cookie"), false);
  assert.equal(observed[1].url, "http://geme-api:4000/api/v1/admin/shopee/connections/connection-id");
  assert.equal(observed[1].init.method, "DELETE");
  assert.equal(observed[1].init.headers.get("authorization"), "Bearer secret");
  assert.equal(observed[1].init.headers.has("cookie"), false);
  assert.equal(getResponse.status, 204);
  assert.equal(deleteResponse.status, 204);
});

test("non-social paths retain legacy mapping and OAuth callback stays outside admin mapping", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observedUrl = "";
  globalThis.fetch = async (url) => { observedUrl = String(url); return Response.json({}); };
  await GET(makeRequest("orders?limit=3", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["orders"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/orders?limit=3");
  await GET(makeRequest("social/meta/callback?state=redacted", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["social", "meta", "callback"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/social/meta/callback?state=redacted");
  await GET(makeRequest("orders?limit=3", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["orders"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/orders?limit=3");
});

test("proxy still rejects missing admin session and cross-origin mutations", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return Response.json({}); };
  const missingSession = await GET(makeRequest("social/status"), { params: Promise.resolve({ path: ["social", "status"] }) });
  assert.equal(missingSession.status, 401);
  const foreignMutation = await POST(makeRequest("social/accounts/selection", {
    method: "POST",
    headers: { host: "localhost:3001", origin: "https://evil.example", cookie: "geme_admin_session=secret", "content-type": "application/json" },
    body: JSON.stringify({ accountIds: [] }),
  }), { params: Promise.resolve({ path: ["social", "accounts", "selection"] }) });
  assert.equal(foreignMutation.status, 403);
  assert.equal(fetchCalled, false);
});

test("category delete preserves backend validation errors and uses the normal API route", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observedUrl = "";
  globalThis.fetch = async (url) => {
    observedUrl = String(url);
    return Response.json({ message: "Không thể xóa vì còn sản phẩm phụ thuộc." }, { status: 400 });
  };
  const response = await DELETE(makeRequest("categories/category-id", {
    method: "DELETE",
    headers: { host: "localhost:3001", origin: "http://localhost:3001", cookie: "geme_admin_session=secret" },
  }), { params: Promise.resolve({ path: ["categories", "category-id"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/categories/category-id");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Không thể xóa vì còn sản phẩm phụ thuộc." });
});

test("proxy reports an upstream timeout as a gateway timeout without treating it as an API response", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  globalThis.fetch = async () => { throw new DOMException("upstream timed out", "TimeoutError"); };
  const response = await GET(makeRequest("products", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["products"] }) });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { message: "API xử lý quá thời gian cho phép. Vui lòng thử lại." });
});

test("collection UI differentiates loading, error and empty results; PARTIAL retains each channel outcome", () => {
  assert.equal(getCollectionState({ loading: true, error: false, itemCount: 0 }), "loading");
  assert.equal(getCollectionState({ loading: false, error: true, itemCount: 0 }), "error");
  assert.equal(getCollectionState({ loading: false, error: false, itemCount: 0 }), "empty");
  const summary = socialPostStatusSummary({ status: "PARTIAL", targets: [{ status: "PUBLISHED" }, { status: "FAILED" }] });
  assert.deepEqual(summary, { overall: "Đăng một phần", targetStatuses: ["Đã đăng", "Thất bại"], needsReconciliation: false });
  const unknown = socialPostStatusSummary({ status: "UNKNOWN", targets: [{ status: "UNKNOWN" }] });
  assert.equal(unknown.needsReconciliation, true);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalApiBase === undefined) delete process.env.GEME_API_BASE_URL;
  else process.env.GEME_API_BASE_URL = originalApiBase;
});
