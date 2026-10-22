import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { chunk, createShopeeState, orderStatusCanAdvance, parseShopeeAmount, shopeeApiOrigin, shopeeAuthorizationOrigin, signShopeeRequest, unixSecondsDate } from "./shopee.contract.js";

test("Shopee signatures include shop credentials only for shop-scoped API paths", () => {
  const signature = signShopeeRequest({ partnerId: "123", partnerKey: "secret", path: "/api/v2/order/get_order_list", timestamp: 1_700_000_000, accessToken: "token", shopId: "456" });
  const expected = createHmac("sha256", "secret").update("123/api/v2/order/get_order_list1700000000token456", "utf8").digest("hex");
  assert.equal(signature, expected);
  assert.notEqual(signature, signShopeeRequest({ partnerId: "123", partnerKey: "secret", path: "/api/v2/order/get_order_list", timestamp: 1_700_000_000, accessToken: "other-token", shopId: "456" }));
});

test("Shopee production and sandbox endpoints are isolated", () => {
  assert.equal(shopeeApiOrigin("production"), "https://partner.shopeemobile.com");
  assert.equal(shopeeApiOrigin("sandbox"), "https://partner.test-stable.shopeemobile.com");
  assert.equal(shopeeAuthorizationOrigin("sandbox"), "https://open.test-stable.shopee.com");
});

test("OAuth state is unpredictable and stored as a one-way hash", () => {
  const first = createShopeeState();
  const second = createShopeeState();
  assert.equal(first.value.length >= 40, true);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.value, first.hash);
  assert.notEqual(first.value, second.value);
});

test("timestamps, money, chunking and status ordering reject malformed data", () => {
  assert.equal(unixSecondsDate("1700000000")?.toISOString(), "2023-11-14T22:13:20.000Z");
  assert.equal(unixSecondsDate("not-a-time"), null);
  assert.equal(unixSecondsDate(-1), null);
  assert.equal(parseShopeeAmount("1200.50"), 1200.5);
  assert.equal(parseShopeeAmount("NaN"), null);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(orderStatusCanAdvance(new Date(100), new Date(99)), false);
  assert.equal(orderStatusCanAdvance(new Date(100), new Date(100)), true);
});
