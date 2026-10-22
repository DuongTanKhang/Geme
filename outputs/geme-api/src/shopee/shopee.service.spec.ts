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
    $transaction: async () => { throw new Error("Unexpected transaction during refresh failure."); },
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v2/auth/access_token/get");
    // Simulate a successful reauthorization that wins while the old refresh request is in flight.
    connection.accessTokenCiphertext = encryptShopeeToken("new-access");
    connection.refreshTokenCiphertext = encryptShopeeToken("new-refresh");
    connection.accessTokenExpiresAt = new Date(Date.now() + 60 * 60_000);
    connection.refreshTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    connection.refreshLeaseUntil = null;
    return Response.json({ error: "error_access_token_expired" });
  };

  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, { waitForApiSlot: async () => undefined } as unknown as ShopeeSyncQueue);
    await assert.rejects(service.processSync(connectionId, runId), (error: unknown) => error instanceof ShopeeApiError && error.code === "SHOPEE_REAUTH_REQUIRED");
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
    productPriceVariant: { findMany: async ({ where }: { where: { sku: string } }) => where.sku === "MODEL-SKU-7" ? [{ id: mapping.variantId, productId: mapping.productId, sku: mapping.sku }] : [] },
  };
  const runStatuses: string[] = [];
  const prisma = {
    shopeeSyncRun: {
      findUnique: async () => ({ id: runId, connectionId }),
      update: async ({ data }: { data: Record<string, any> }) => { if (data.status) runStatuses.push(data.status); return data; },
    },
    shopeeConnection: {
      findUnique: async () => connection,
      update: async () => connection,
      updateMany: async ({ data }: { data: Record<string, any> }) => { if (data.syncCursorAt) connection.syncCursorAt = data.syncCursorAt; return { count: 1 }; },
    },
    $transaction: async (operation: any) => typeof operation === "function" ? operation(tx) : Promise.all(operation),
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/order/get_order_list")) return Response.json({ response: { order_list: [{ order_sn: "ORDER-1" }], more: false } });
    if (url.pathname.endsWith("/order/get_order_detail")) return Response.json({ response: { order_list: [{
      order_sn: "ORDER-1", order_status: "READY_TO_SHIP", create_time: nowSeconds - 60, update_time: nowSeconds - 30,
      currency: "VND", total_amount: "900.25", item_list: [{ item_id: 12, model_id: 7, item_name: "Gemstone item", model_sku: "MODEL-SKU-7", model_quantity_purchased: 1, model_original_price: "1000.50", model_discounted_price: "900.25" }],
    }] } });
    throw new Error(`Unexpected Shopee request path ${url.pathname}`);
  };

  try {
    const service = new ShopeeService(prisma as unknown as PrismaService, { waitForApiSlot: async () => undefined } as unknown as ShopeeSyncQueue);
    await service.processSync(connectionId, runId);
    assert.deepEqual(runStatuses, ["RUNNING", "SUCCEEDED"]);
    assert.equal(importedItems.length, 1);
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
