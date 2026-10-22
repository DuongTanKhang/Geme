import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { ShopeeSyncQueue } from "./shopee.queue.js";
import { decryptShopeeToken, encryptShopeeToken, ShopeeApiError } from "./shopee.client.js";
import { ShopeeService } from "./shopee.service.js";

const envNames = ["SHOPEE_ENABLED", "SHOPEE_ENVIRONMENT", "SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI", "SHOPEE_ADMIN_RETURN_URL", "SHOPEE_TOKEN_ENCRYPTION_KEY", "SHOPEE_INITIAL_SYNC_DAYS", "SHOPEE_POLL_INTERVAL_MINUTES", "SHOPEE_WORKER_CONCURRENCY"] as const;

test("missing order detail is retried without saving partial orders or advancing the shop checkpoint", async () => {
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const tokenKey = randomBytes(32).toString("base64");
  Object.assign(process.env, {
    SHOPEE_ENABLED: "true",
    SHOPEE_ENVIRONMENT: "sandbox",
    SHOPEE_PARTNER_ID: "123456",
    SHOPEE_PARTNER_KEY: "test-partner-key",
    SHOPEE_REDIRECT_URI: "https://api.geme.vn/api/v1/shopee/callback",
    SHOPEE_ADMIN_RETURN_URL: "https://admin.geme.vn/?view=shopee",
    SHOPEE_TOKEN_ENCRYPTION_KEY: tokenKey,
    SHOPEE_INITIAL_SYNC_DAYS: "30",
    SHOPEE_POLL_INTERVAL_MINUTES: "5",
    SHOPEE_WORKER_CONCURRENCY: "2",
  });

  const connectionId = randomUUID();
  const runId = randomUUID();
  const originalCursor = new Date(Date.now() - 60 * 60_000);
  const connection = {
    id: connectionId,
    status: "ACTIVE",
    environment: "sandbox",
    partnerId: "123456",
    shopId: "456",
    accessTokenCiphertext: encryptShopeeToken("test-access-token"),
    refreshTokenCiphertext: encryptShopeeToken("test-refresh-token"),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    refreshTokenExpiresAt: null,
    refreshLeaseUntil: null,
    syncCursorAt: originalCursor,
  };
  const runUpdates: Array<Record<string, unknown>> = [];
  let importedOrderWrites = 0;
  const prisma = {
    shopeeSyncRun: {
      findUnique: async () => ({ id: runId, connectionId }),
      update: async ({ data }: { data: Record<string, unknown> }) => { runUpdates.push(data); return data; },
    },
    shopeeConnection: {
      findUnique: async () => connection,
      update: async () => connection,
      updateMany: async () => ({ count: 1 }),
    },
    shopeeImportedOrder: { create: async () => { importedOrderWrites++; return { id: randomUUID() }; } },
    $transaction: async () => { throw new Error("Unexpected transaction: incomplete details must be rejected before import."); },
  };
  const queue = { waitForApiSlot: async () => undefined };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/order/get_order_list")) {
      return Response.json({ response: { order_list: [{ order_sn: "ORDER-1" }, { order_sn: "ORDER-2" }], more: false } });
    }
    if (url.pathname.endsWith("/order/get_order_detail")) {
      return Response.json({ response: { order_list: [{ order_sn: "ORDER-1", order_status: "READY_TO_SHIP", create_time: 1_700_000_000, update_time: 1_700_000_001, item_list: [{ item_id: 1, model_quantity_purchased: 1 }] }] } });
    }
    throw new Error(`Unexpected Shopee request path ${url.pathname}`);
  };

  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, queue as unknown as ShopeeSyncQueue);
    await assert.rejects(
      service.processSync(connectionId, runId),
      (error: unknown) => error instanceof ShopeeApiError && error.code === "SHOPEE_ORDER_DETAIL_MISSING" && error.retryable,
    );
    assert.equal(connection.syncCursorAt.getTime(), originalCursor.getTime());
    assert.equal(importedOrderWrites, 0);
    assert.equal(runUpdates.at(-1)?.status, "RETRYING");
    assert.equal(runUpdates.at(-1)?.errorCode, "SHOPEE_ORDER_DETAIL_MISSING");
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = savedEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a stale refresh rejection cannot mark a concurrently reconnected shop as needing authorization", async () => {
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    SHOPEE_ENABLED: "true", SHOPEE_ENVIRONMENT: "sandbox", SHOPEE_PARTNER_ID: "123456", SHOPEE_PARTNER_KEY: "test-partner-key",
    SHOPEE_REDIRECT_URI: "https://api.geme.vn/api/v1/shopee/callback", SHOPEE_ADMIN_RETURN_URL: "https://admin.geme.vn/?view=shopee",
    SHOPEE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), SHOPEE_INITIAL_SYNC_DAYS: "30", SHOPEE_POLL_INTERVAL_MINUTES: "5", SHOPEE_WORKER_CONCURRENCY: "2",
  });
  const connectionId = randomUUID();
  const runId = randomUUID();
  const connection: Record<string, any> = {
    id: connectionId, status: "ACTIVE", environment: "sandbox", partnerId: "123456", shopId: "456",
    accessTokenCiphertext: encryptShopeeToken("expired-access"), refreshTokenCiphertext: encryptShopeeToken("old-refresh"),
    accessTokenExpiresAt: new Date(Date.now() - 60_000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    refreshLeaseUntil: null, syncCursorAt: new Date(Date.now() - 60 * 60_000),
  };
  const prisma = {
    shopeeSyncRun: { findUnique: async () => ({ id: runId, connectionId }), update: async () => ({}) },
    shopeeConnection: {
      findUnique: async () => connection,
      update: async () => connection,
      updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        if (where.refreshLeaseUntil instanceof Date) {
          if (!(connection.refreshLeaseUntil instanceof Date) || connection.refreshLeaseUntil.getTime() !== where.refreshLeaseUntil.getTime()) return { count: 0 };
        } else if (where.OR) {
          if (connection.refreshLeaseUntil && connection.refreshLeaseUntil > new Date()) return { count: 0 };
        }
        Object.assign(connection, data);
        return { count: 1 };
      },
    },
    $transaction: async (operation: any) => typeof operation === "function" ? operation({
      shopeeConnection: { updateMany: async () => ({ count: 1 }) },
      shopeeSyncRun: { update: async () => ({}) },
    }) : Promise.all(operation),
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v2/auth/access_token/get") {
      // Simulate a successful reauthorization that wins while the old refresh request is in flight.
      connection.accessTokenCiphertext = encryptShopeeToken("new-access");
      connection.refreshTokenCiphertext = encryptShopeeToken("new-refresh");
      connection.accessTokenExpiresAt = new Date(Date.now() + 60 * 60_000);
      connection.refreshTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60_000);
      connection.refreshLeaseUntil = null;
      return Response.json({ error: "error_access_token_expired" });
    }
    if (url.pathname === "/api/v2/order/get_order_list") {
      assert.equal(url.searchParams.get("access_token"), "new-access");
      return Response.json({ response: { order_list: [], more: false } });
    }
    throw new Error(`Unexpected Shopee request path ${url.pathname}`);
  };

  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, { waitForApiSlot: async () => undefined } as unknown as ShopeeSyncQueue);
    await service.processSync(connectionId, runId);
    assert.equal(connection.status, "ACTIVE");
    assert.equal(connection.refreshLeaseUntil, null);
    assert.equal(decryptShopeeToken(connection.accessTokenCiphertext), "new-access");
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = savedEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("concurrent expired-token requests share one refresh lease and reuse the rotated token", async () => {
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    SHOPEE_ENABLED: "true", SHOPEE_ENVIRONMENT: "sandbox", SHOPEE_PARTNER_ID: "123456", SHOPEE_PARTNER_KEY: "test-partner-key",
    SHOPEE_REDIRECT_URI: "https://api.geme.vn/api/v1/shopee/callback", SHOPEE_ADMIN_RETURN_URL: "https://admin.geme.vn/?view=shopee",
    SHOPEE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), SHOPEE_INITIAL_SYNC_DAYS: "30", SHOPEE_POLL_INTERVAL_MINUTES: "5", SHOPEE_WORKER_CONCURRENCY: "2",
  });
  const connection: Record<string, any> = {
    id: randomUUID(), status: "ACTIVE", environment: "sandbox", partnerId: "123456", shopId: "456",
    accessTokenCiphertext: encryptShopeeToken("expired-access"), refreshTokenCiphertext: encryptShopeeToken("old-refresh"),
    accessTokenExpiresAt: new Date(Date.now() - 60_000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 60_000), refreshLeaseUntil: null,
  };
  let refreshCalls = 0;
  const prisma = {
    shopeeConnection: {
      findUnique: async () => ({ ...connection }),
      updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        if (Array.isArray(where.OR)) {
          if (connection.refreshLeaseUntil && connection.refreshLeaseUntil > new Date()) return { count: 0 };
          Object.assign(connection, data);
          return { count: 1 };
        }
        Object.assign(connection, data);
        return { count: 1 };
      },
    },
    $transaction: async (operation: any) => operation({ shopeeConnection: {
      updateMany: async ({ data }: { data: Record<string, any> }) => { Object.assign(connection, data); return { count: 1 }; },
    } }),
  };
  globalThis.fetch = async () => {
    refreshCalls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expire_in: 3600 });
  };
  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, { waitForApiSlot: async () => undefined } as unknown as ShopeeSyncQueue);
    const tokens = await Promise.all([
      (service as any).ensureAccessToken(connection.id),
      (service as any).ensureAccessToken(connection.id),
    ]);
    assert.deepEqual(tokens, ["fresh-access", "fresh-access"]);
    assert.equal(refreshCalls, 1);
    assert.equal(connection.refreshLeaseUntil, null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = savedEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("auto SKU matching never falls back from a Shopee variation to its parent item SKU", async () => {
  const lookedUp: string[] = [];
  const service = new ShopeeService({} as PrismaService, {} as ShopeeSyncQueue);
  const tx = {
    product: { findMany: async ({ where }: { where: { sku: string } }) => { lookedUp.push(`product:${where.sku}`); return []; } },
    productPriceVariant: { findMany: async ({ where }: { where: { sku: string } }) => { lookedUp.push(`variant:${where.sku}`); return []; } },
  };
  const result = await (service as any).findAutoSkuTarget(tx, { model_id: 7, model_sku: "UNKNOWN-MODEL", item_sku: "PARENT-SKU" });
  assert.equal(result, null);
  assert.deepEqual(lookedUp, ["product:UNKNOWN-MODEL", "variant:UNKNOWN-MODEL"]);

  const parentTx = {
    product: { findMany: async ({ where }: { where: { sku: string } }) => {
      if (where.sku === "PARENT-SKU") return [{ id: "parent-1", sku: "PARENT-SKU", status: "ACTIVE", variants: [] }];
      if (where.sku === "ARCHIVED-SKU") return [{ id: "archived-1", sku: "ARCHIVED-SKU", status: "ARCHIVED", variants: [] }];
      if (where.sku === "DUPLICATE-SKU") return [{ id: "parent-2", sku: "DUPLICATE-SKU", status: "ACTIVE", variants: [] }, { id: "parent-3", sku: "DUPLICATE-SKU", status: "ACTIVE", variants: [] }];
      return [];
    } },
    productPriceVariant: { findMany: async () => [] },
  };
  assert.deepEqual(await (service as any).findAutoSkuTarget(parentTx, { model_id: 0, model_sku: "", item_sku: "PARENT-SKU" }), { productId: "parent-1", variantId: null, sku: "PARENT-SKU" });
  assert.deepEqual(await (service as any).findAutoSkuTarget(parentTx, { model_id: "", item_sku: "PARENT-SKU" }), { productId: "parent-1", variantId: null, sku: "PARENT-SKU" });
  assert.equal(await (service as any).findAutoSkuTarget(parentTx, { model_id: 0, item_sku: "ARCHIVED-SKU" }), null);
  assert.equal(await (service as any).findAutoSkuTarget(parentTx, { model_id: 0, item_sku: "DUPLICATE-SKU" }), null);
});

test("successful import maps exact model SKU and preserves original and discounted prices without commerce writes", async () => {
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    SHOPEE_ENABLED: "true", SHOPEE_ENVIRONMENT: "sandbox", SHOPEE_PARTNER_ID: "123456", SHOPEE_PARTNER_KEY: "test-partner-key",
    SHOPEE_REDIRECT_URI: "https://api.geme.vn/api/v1/shopee/callback", SHOPEE_ADMIN_RETURN_URL: "https://admin.geme.vn/?view=shopee",
    SHOPEE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), SHOPEE_INITIAL_SYNC_DAYS: "30", SHOPEE_POLL_INTERVAL_MINUTES: "5", SHOPEE_WORKER_CONCURRENCY: "2",
  });
  const connectionId = randomUUID();
  const runId = randomUUID();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const connection: Record<string, any> = {
    id: connectionId, status: "ACTIVE", environment: "sandbox", partnerId: "123456", shopId: "456",
    accessTokenCiphertext: encryptShopeeToken("test-access-token"), refreshTokenCiphertext: encryptShopeeToken("test-refresh-token"),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000), refreshTokenExpiresAt: null, refreshLeaseUntil: null,
    syncCursorAt: new Date((nowSeconds - 1800) * 1000),
  };
  const importedItems: Array<Record<string, any>> = [];
  const runStatuses: string[] = [];
  const mapping = { id: randomUUID(), sku: "MODEL-SKU-7", productId: randomUUID(), variantId: randomUUID() };
  const tx = {
    shopeeImportedOrder: {
      findUnique: async () => null,
      create: async () => ({ id: randomUUID() }),
    },
    shopeeOrderStatusHistory: { createMany: async () => ({ count: 1 }) },
    shopeeImportedOrderItem: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Array<Record<string, any>> }) => { importedItems.push(...data); return { count: data.length }; },
    },
    shopeeItemMapping: {
      findUnique: async () => null,
      upsert: async () => mapping,
    },
    product: { findMany: async () => [] },
    productPriceVariant: { findMany: async ({ where }: { where: { sku: string } }) => where.sku === "MODEL-SKU-7" ? [{ id: mapping.variantId, productId: mapping.productId, sku: mapping.sku, product: { status: "ACTIVE" } }] : [] },
    shopeeConnection: { updateMany: async ({ data }: { data: Record<string, any> }) => { Object.assign(connection, data); return { count: 1 }; } },
    shopeeSyncRun: { update: async ({ data }: { data: Record<string, any> }) => { if (data.status) runStatuses.push(data.status); return data; } },
  };
  const prisma = {
    shopeeSyncRun: {
      findUnique: async () => ({ id: runId, connectionId }),
      update: async ({ data }: { data: Record<string, any> }) => { if (data.status) runStatuses.push(data.status); return data; },
    },
    shopeeConnection: {
      findUnique: async () => connection,
      update: async () => connection,
      updateMany: async ({ data }: { data: Record<string, any> }) => { Object.assign(connection, data); return { count: 1 }; },
    },
    $transaction: async (operation: any) => typeof operation === "function" ? operation(tx) : Promise.all(operation),
  };
  let listCalls = 0;
  let detailCalls = 0;
  let refreshCalls = 0;
  const requestAccessTokens: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v2/auth/access_token/get") {
      refreshCalls++;
      return Response.json({ access_token: `rotated-access-${refreshCalls}`, refresh_token: `rotated-refresh-${refreshCalls}`, expire_in: 3600 });
    }
    if (url.pathname.endsWith("/order/get_order_list")) {
      listCalls++;
      requestAccessTokens.push(url.searchParams.get("access_token") || "");
      if (listCalls === 1) return Response.json({ response: { order_list: [{ order_sn: "ORDER-1" }], more: true, next_cursor: "cursor-page-2" } });
      if (listCalls === 2) return Response.json({ error: "error_access_token_expired" });
      assert.equal(url.searchParams.get("cursor"), "cursor-page-2", "retry must keep the rejected page cursor");
      return Response.json({ response: { order_list: [{ order_sn: "ORDER-2" }], more: false } });
    }
    if (url.pathname.endsWith("/order/get_order_detail")) {
      detailCalls++;
      requestAccessTokens.push(url.searchParams.get("access_token") || "");
      if (detailCalls === 1) return Response.json({ error: "error_access_token_expired" });
      const detail = (order_sn: string, item_id: number) => ({
        order_sn, order_status: "READY_TO_SHIP", create_time: nowSeconds - 60, update_time: nowSeconds - 30,
        currency: "VND", total_amount: "900.25", item_list: [{ item_id, model_id: 7, item_name: "Gemstone item", model_sku: "MODEL-SKU-7", model_quantity_purchased: 1, model_original_price: "1000.50", model_discounted_price: "900.25" }],
      });
      return Response.json({ response: { order_list: [detail("ORDER-1", 12), detail("ORDER-2", 13)] } });
    }
    throw new Error(`Unexpected Shopee request path ${url.pathname}`);
  };

  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, { waitForApiSlot: async () => undefined } as unknown as ShopeeSyncQueue);
    await service.processSync(connectionId, runId);
    assert.deepEqual(runStatuses, ["RUNNING", "SUCCEEDED"]);
    assert.equal(listCalls, 3);
    assert.equal(detailCalls, 2);
    assert.equal(refreshCalls, 2);
    assert.deepEqual(requestAccessTokens, ["test-access-token", "test-access-token", "rotated-access-1", "rotated-access-1", "rotated-access-2"]);
    assert.equal(importedItems.length, 2);
    assert.equal(importedItems[0].modelId, "7");
    assert.equal(importedItems[0].mappedSku, "MODEL-SKU-7");
    assert.equal(importedItems[0].mappedVariantId, mapping.variantId);
    assert.equal(importedItems[0].modelOriginalPrice, 1000.5);
    assert.equal(importedItems[0].modelDiscountedPrice, 900.25);
    assert.equal(importedItems[0].unitPrice, 1000.5);
    assert.equal(importedItems[0].variationDiscountedPrice, 900.25);
    assert.ok(connection.syncCursorAt.getTime() >= (nowSeconds - 1) * 1000);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = savedEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
