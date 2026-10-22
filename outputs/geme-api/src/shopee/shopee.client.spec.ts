import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptShopeeToken, encryptShopeeToken, ShopeeApiError, ShopeeClient } from "./shopee.client.js";

const envNames = ["NODE_ENV", "SHOPEE_ENVIRONMENT", "SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI", "SHOPEE_ADMIN_RETURN_URL", "SHOPEE_TOKEN_ENCRYPTION_KEY"] as const;
type SavedEnv = Partial<Record<(typeof envNames)[number], string | undefined>>;

function withShopeeConfig(run: () => void | Promise<void>) {
  const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]])) as SavedEnv;
  Object.assign(process.env, {
    NODE_ENV: "test",
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

test("Shopee token rejection is surfaced as a reauthorization requirement", async () => withShopeeConfig(async () => {
  const client = new ShopeeClient(async () => new Response(JSON.stringify({ error: "error_access_token_expired" }), { status: 200 }));
  await assert.rejects(client.getOrderList({ accessToken: "expired", shopId: "456", from: 1, to: 100 }), (error: unknown) => error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED" && !error.retryable);
}));
