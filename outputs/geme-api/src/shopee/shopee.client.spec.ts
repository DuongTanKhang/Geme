import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import { decryptShopeeToken, encryptShopeeToken, ShopeeApiError, ShopeeClient, shopeeConfig, shopeeSafeConfig } from "./shopee.client.js";

const envNames = ["NODE_ENV", "SHOPEE_ENABLED", "SHOPEE_ENVIRONMENT", "SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI", "SHOPEE_ADMIN_RETURN_URL", "SHOPEE_TOKEN_ENCRYPTION_KEY", "SHOPEE_INITIAL_SYNC_DAYS", "SHOPEE_POLL_INTERVAL_MINUTES", "SHOPEE_WORKER_CONCURRENCY"] as const;
type SavedEnv = Partial<Record<(typeof envNames)[number], string | undefined>>;

function withShopeeConfig(run: () => void | Promise<void>) {
  const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]])) as SavedEnv;
  Object.assign(process.env, {
    NODE_ENV: "test",
    SHOPEE_ENABLED: "true",
    SHOPEE_ENVIRONMENT: "sandbox",
    SHOPEE_PARTNER_ID: "123456",
    SHOPEE_PARTNER_KEY: "server-only-test-key",
    SHOPEE_REDIRECT_URI: "https://api.geme.vn/api/v1/shopee/callback",
    SHOPEE_ADMIN_RETURN_URL: "https://admin.geme.vn/?view=shopee",
    SHOPEE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });
  return Promise.resolve().then(run).finally(() => {
    for (const name of envNames) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("Shopee credentials are encrypted at rest and reject a changed key", async () => withShopeeConfig(() => {
  const token = "sensitive-access-token";
  const encrypted = encryptShopeeToken(token);
  assert.equal(encrypted.includes(token), false);
  assert.equal(decryptShopeeToken(encrypted), token);
  process.env.SHOPEE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  assert.throws(() => decryptShopeeToken(encrypted));
}));

test("authorization URL uses the configured sandbox callback and never exposes Partner Key", async () => withShopeeConfig(() => {
  const url = new URL(new ShopeeClient().authorizationUrl("one-time-state"));
  assert.equal(url.origin, "https://open.test-stable.shopee.com");
  assert.equal(url.pathname, "/auth");
  assert.equal(url.searchParams.get("partner_id"), "123456");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.geme.vn/api/v1/shopee/callback");
  assert.equal(url.searchParams.get("state"), "one-time-state");
  assert.equal(url.searchParams.has("partner_key"), false);
  assert.equal(url.searchParams.get("auth_type"), "seller");
}));

test("invalid environment and out-of-range configuration never silently switch to production", async () => withShopeeConfig(() => {
  process.env.SHOPEE_ENVIRONMENT = "prodction";
  const config = shopeeConfig();
  assert.equal(config.environment, "sandbox");
  assert.equal(config.configurationStatus, "invalid_configuration");
  assert.equal(config.configured, false);
  assert.deepEqual(config.invalid, ["SHOPEE_ENVIRONMENT"]);
  process.env.SHOPEE_ENVIRONMENT = "production";
  process.env.SHOPEE_POLL_INTERVAL_MINUTES = "1";
  assert.equal(shopeeConfig().invalid.includes("SHOPEE_POLL_INTERVAL_MINUTES"), true);
}));

test("missing and invalid configuration are distinct and production callback URLs require HTTPS", async () => withShopeeConfig(() => {
  delete process.env.SHOPEE_PARTNER_KEY;
  delete process.env.SHOPEE_ADMIN_RETURN_URL;
  const missing = shopeeConfig();
  assert.equal(missing.configurationStatus, "missing_configuration");
  assert.deepEqual(missing.missing, ["SHOPEE_PARTNER_KEY", "SHOPEE_ADMIN_RETURN_URL"]);
  process.env.SHOPEE_PARTNER_KEY = "server-only-test-key";
  process.env.SHOPEE_ADMIN_RETURN_URL = "http://admin.geme.vn/?view=shopee";
  process.env.SHOPEE_ENVIRONMENT = "production";
  const invalid = shopeeConfig();
  assert.equal(invalid.configurationStatus, "invalid_configuration");
  assert.equal(invalid.invalid.includes("SHOPEE_ADMIN_RETURN_URL"), true);
}));

test("safe config status reports validation names without leaking any secret", async () => withShopeeConfig(() => {
  const safe = shopeeSafeConfig(shopeeConfig());
  const serialized = JSON.stringify(safe);
  assert.equal(safe.configurationStatus, "ready");
  assert.equal(safe.configured, true);
  assert.equal(serialized.includes(process.env.SHOPEE_PARTNER_KEY || ""), false);
  assert.equal(serialized.includes(process.env.SHOPEE_TOKEN_ENCRYPTION_KEY || ""), false);
}));

test("disabled integration does not authorize API calls and keeps disabled state distinct", async () => withShopeeConfig(async () => {
  process.env.SHOPEE_ENABLED = "false";
  const config = shopeeConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.configurationStatus, "ready");
  assert.equal(config.configured, false);
  await assert.rejects(new ShopeeClient().getOrderList({ accessToken: "token", shopId: "456", from: 1, to: 2 }), /đang tắt/);
}));

test("order list uses signed, bounded time-window requests and parses the response envelope", async () => withShopeeConfig(async () => {
  let requested: URL | null = null;
  const fetcher: typeof fetch = async (input) => {
    requested = new URL(String(input));
    return new Response(JSON.stringify({ response: { order_list: [{ order_sn: "ORDER-1" }], more: false } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await new ShopeeClient(fetcher).getOrderList({ accessToken: "access-token", shopId: "456", from: 1_700_000_000, to: 1_700_086_399, cursor: "page-cursor" });
  assert.equal(result.order_list?.[0]?.order_sn, "ORDER-1");
  assert.ok(requested);
  assert.equal(requested!.pathname, "/api/v2/order/get_order_list");
  assert.equal(requested!.searchParams.get("page_size"), "100");
  assert.equal(requested!.searchParams.get("time_range_field"), "update_time");
  assert.equal(requested!.searchParams.get("cursor"), "page-cursor");
  assert.equal(requested!.searchParams.get("sign")?.length, 64);
}));

test("order-detail batches are bounded and Shopee rate limits are retryable", async () => withShopeeConfig(async () => {
  const client = new ShopeeClient(async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }));
  await assert.rejects(client.getOrderDetails({ accessToken: "token", shopId: "456", orderSnList: [] }), /SHOPEE_ORDER_DETAIL_BATCH_INVALID/);
  await assert.rejects(client.getOrderDetails({ accessToken: "token", shopId: "456", orderSnList: Array.from({ length: 51 }, (_, index) => `ORDER-${index}`) }), /SHOPEE_ORDER_DETAIL_BATCH_INVALID/);
  await assert.rejects(client.getOrderDetails({ accessToken: "token", shopId: "456", orderSnList: ["ORDER-1"] }), (error: unknown) => error instanceof ShopeeApiError && error.code === "SHOPEE_RATE_LIMITED" && error.retryable && error.retryAfterSeconds === 2);
}));

test("token exchange uses the public endpoint signature and puts shop scope in the request body", async () => withShopeeConfig(async () => {
  let requested: URL | null = null;
  let requestBody: Record<string, unknown> = {};
  const client = new ShopeeClient(async (input, init) => {
    requested = new URL(String(input));
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ access_token: "access", refresh_token: "refresh", expire_in: 14400, shop_id: 456 });
  });
  await client.exchangeAuthorizationCode("one-time-code", "456");
  assert.equal(requested?.pathname, "/api/v2/auth/token/get");
  assert.equal(requested?.searchParams.has("shop_id"), false);
  const timestamp = requested?.searchParams.get("timestamp") || "";
  const expectedSign = createHmac("sha256", "server-only-test-key").update(`123456/api/v2/auth/token/get${timestamp}`).digest("hex");
  assert.equal(requested?.searchParams.get("sign"), expectedSign);
  assert.deepEqual(requestBody, { code: "one-time-code", shop_id: 456, partner_id: 123456 });
}));

test("refresh-token request signs the public path and keeps token credentials in its POST body", async () => withShopeeConfig(async () => {
  let requested: URL | null = null;
  let body: Record<string, unknown> = {};
  const client = new ShopeeClient(async (input, init) => {
    requested = new URL(String(input));
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expire_in: 3600 });
  });
  await client.refreshAccessToken("refresh-secret", "456");
  assert.equal(requested?.pathname, "/api/v2/auth/access_token/get");
  const timestamp = requested?.searchParams.get("timestamp") || "";
  const expectedSign = createHmac("sha256", "server-only-test-key").update(`123456/api/v2/auth/access_token/get${timestamp}`).digest("hex");
  assert.equal(requested?.searchParams.get("sign"), expectedSign);
  assert.equal(requested?.searchParams.has("shop_id"), false);
  assert.deepEqual(body, { refresh_token: "refresh-secret", partner_id: 123456, shop_id: 456 });
}));

test("Shopee token rejection is surfaced as a reauthorization requirement", async () => withShopeeConfig(async () => {
  const client = new ShopeeClient(async () => new Response(JSON.stringify({ error: "error_access_token_expired" }), { status: 200 }));
  await assert.rejects(client.getOrderList({ accessToken: "expired", shopId: "456", from: 1, to: 100 }), (error: unknown) => error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED" && !error.retryable);
}));
