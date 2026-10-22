import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptMetaToken, encryptMetaToken, MetaRequestError, SocialMetaClient, socialMetaConfig } from "./social-meta.client.js";

const names = ["NODE_ENV", "SOCIAL_META_APP_ID", "SOCIAL_META_APP_SECRET", "SOCIAL_META_REDIRECT_URI", "SOCIAL_META_GRAPH_API_VERSION", "SOCIAL_META_ADMIN_RETURN_URL", "SOCIAL_META_ADMIN_ORIGINS", "SOCIAL_META_ENCRYPTION_KEY"] as const;
type SavedEnv = Partial<Record<(typeof names)[number], string | undefined>>;

function withMetaConfig(run: () => void | Promise<void>) {
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]])) as SavedEnv;
  Object.assign(process.env, {
    NODE_ENV: "test",
    SOCIAL_META_APP_ID: "test-app-id",
    SOCIAL_META_APP_SECRET: "server-only-test-secret",
    SOCIAL_META_REDIRECT_URI: "https://api.geme.vn/api/v1/social/meta/callback",
    SOCIAL_META_GRAPH_API_VERSION: "v99.0",
    SOCIAL_META_ADMIN_RETURN_URL: "https://admin.geme.vn/",
    SOCIAL_META_ADMIN_ORIGINS: "https://admin.geme.vn",
    SOCIAL_META_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  return Promise.resolve().then(run).finally(() => {
    for (const name of names) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("Meta tokens are encrypted at rest and reject invalid/wrong keys", async () => withMetaConfig(() => {
  const token = "sensitive-meta-token-value";
  const encrypted = encryptMetaToken(token);
  assert.equal(encrypted.includes(token), false);
  assert.equal(decryptMetaToken(encrypted), token);
  process.env.SOCIAL_META_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  assert.throws(() => decryptMetaToken(encrypted));
}));

test("OAuth URL carries only the requested Meta scopes and configured callback", async () => withMetaConfig(() => {
  const authorization = new URL(new SocialMetaClient().authorizationUrl("one-time-state"));
  assert.equal(authorization.origin, "https://www.facebook.com");
  assert.equal(authorization.searchParams.get("client_id"), "test-app-id");
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://api.geme.vn/api/v1/social/meta/callback");
  assert.equal(authorization.searchParams.get("state"), "one-time-state");
  assert.deepEqual(new Set(authorization.searchParams.get("scope")?.split(",")), new Set(["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"]));
  assert.equal(authorization.searchParams.has("client_secret"), false);
}));

test("production OAuth requires HTTPS and an explicit Admin origin allowlist", async () => withMetaConfig(() => {
  process.env.NODE_ENV = "production";
  assert.doesNotThrow(() => socialMetaConfig());
  process.env.SOCIAL_META_ADMIN_ORIGINS = "";
  assert.throws(() => socialMetaConfig());
  process.env.SOCIAL_META_ADMIN_ORIGINS = "https://other.example";
  assert.throws(() => socialMetaConfig());
}));

test("ambiguous Meta 5xx during public publishing is marked unknown and is never auto-retried", async () => withMetaConfig(async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 1, is_transient: true } }), { status: 500, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      new SocialMetaClient().publishFacebook({ pageId: "page-1", token: "page-token", caption: "GEME", linkUrl: null, imageUrl: null }),
      (error: unknown) => error instanceof MetaRequestError && error.unknownOutcome && !error.retryable,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));

test("Facebook reconciliation confirms only the stored post owned by the expected Page", async () => withMetaConfig(async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ id: "post-1", from: { id: "page-1" }, permalink_url: "https://facebook.example/post-1", created_time: "2026-10-20T10:00:00Z" }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new SocialMetaClient();
    const confirmed = await client.reconcileFacebook({ pageId: "page-1", token: "server-token", mediaId: "post-1" });
    assert.equal(confirmed.decision, "CONFIRMED_PUBLISHED");
    assert.equal(confirmed.remoteId, "post-1");
    assert.equal(confirmed.permalink, "https://facebook.example/post-1");
    const wrongPage = await client.reconcileFacebook({ pageId: "page-2", token: "server-token", mediaId: "post-1" });
    assert.equal(wrongPage.decision, "UNRESOLVED");
    assert.equal(wrongPage.code, "META_TARGET_MISMATCH");
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.startsWith("https://graph.facebook.com/v99.0/post-1?")));
  } finally { globalThis.fetch = originalFetch; }
}));

test("Meta reconciliation handles missing IDs and Graph API errors without claiming success", async () => withMetaConfig(async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 }); }) as typeof fetch;
  try {
    const client = new SocialMetaClient();
    assert.equal((await client.reconcileFacebook({ pageId: "page-1", token: "token", mediaId: null })).code, "REMOTE_ID_MISSING");
    assert.equal(calls, 0);
    const result = await client.reconcileFacebook({ pageId: "page-1", token: "token", mediaId: "post-1" });
    assert.equal(result.decision, "UNRESOLVED");
    assert.equal(result.code, "META_GRAPH_190");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
}));

test("Instagram reconciliation checks the correct account and uses stored container status", async () => withMetaConfig(async () => {
  const originalFetch = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (async () => {
    const body = index++ === 0 ? { id: "ig-1" } : { id: "container-1", status_code: "FINISHED", status: "Finished" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await new SocialMetaClient().reconcileInstagram({ instagramId: "ig-1", token: "server-token", containerId: "container-1", mediaId: null });
    assert.equal(result.decision, "CONFIRMED_NOT_PUBLISHED");
    assert.equal(result.code, "META_CONTAINER_FINISHED");
    assert.equal(index, 2);
  } finally { globalThis.fetch = originalFetch; }
}));

test("Instagram container ID is durably handed off before the publish call", async () => withMetaConfig(async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/ig-1/media")) return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    if (url.includes("/container-1?")) return new Response(JSON.stringify({ id: "container-1", status_code: "FINISHED" }), { status: 200 });
    if (url.endsWith("/ig-1/media_publish")) { events.push("publish"); return new Response(JSON.stringify({ id: "media-1" }), { status: 200 }); }
    throw new Error(`Unexpected Meta URL ${url} ${String(init?.method)}`);
  }) as typeof fetch;
  try {
    const result = await new SocialMetaClient().publishInstagram({ instagramId: "ig-1", token: "token", caption: "GEME", imageUrl: "https://media.geme.vn/image.jpg", onContainerCreated: async (id) => { events.push(`saved:${id}`); } });
    assert.equal(result.containerId, "container-1");
    assert.equal(events[0], "saved:container-1");
    assert.equal(events[1], "publish");
  } finally { globalThis.fetch = originalFetch; }
}));
