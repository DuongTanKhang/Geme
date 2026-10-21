import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { GET, POST } from "../app/api/admin/[...path]/route.ts";
import { getCollectionState, socialPostStatusSummary } from "../lib/social-ui-state.mjs";

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

test("non-social paths retain legacy mapping and OAuth callback stays outside admin mapping", async () => {
  process.env.GEME_API_BASE_URL = "http://geme-api:4000/api/v1";
  let observedUrl = "";
  globalThis.fetch = async (url) => { observedUrl = String(url); return Response.json({}); };
  await GET(makeRequest("orders?limit=3", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["orders"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/orders?limit=3");
  await GET(makeRequest("social/meta/callback?state=redacted", { headers: { cookie: "geme_admin_session=secret" } }), { params: Promise.resolve({ path: ["social", "meta", "callback"] }) });
  assert.equal(observedUrl, "http://geme-api:4000/api/v1/social/meta/callback?state=redacted");
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
