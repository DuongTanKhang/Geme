import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { chunk, createShopeeState, isShopeeVariantLine, orderStatusCanAdvance, parseShopeeAmount, selectUniqueShopeeSkuTarget, shopeeApiOrigin, shopeeAuthorizationOrigin, shopeeEnvironment, shopeeTokenExpiry, signShopeeRequest, unixSecondsDate, validateShopeeCursor, validateShopeeOrderDetails, validateShopeeOrderListPage } from "./shopee.contract.js";

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
  assert.equal(shopeeEnvironment("prod"), null);
  assert.equal(shopeeEnvironment("production"), "production");
});

test("variant detection treats positive model IDs or model SKU as variation evidence and handles zero/blank explicitly", () => {
  assert.equal(isShopeeVariantLine({ modelId: 7, modelSku: "" }), true);
  assert.equal(isShopeeVariantLine({ modelId: "0", modelSku: "MODEL-1" }), true);
  assert.equal(isShopeeVariantLine({ modelId: "000", modelSku: null }), false);
  assert.equal(isShopeeVariantLine({ modelId: "", modelSku: " " }), false);
});

test("SKU auto-match requires one unique target of the permitted type", () => {
  const variant = { productId: "p1", variantId: "v1", sku: "SKU-1" };
  assert.deepEqual(selectUniqueShopeeSkuTarget([variant]), variant);
  assert.equal(selectUniqueShopeeSkuTarget([variant, { productId: "p2", variantId: "v2", sku: "SKU-1" }]), null);
  assert.equal(selectUniqueShopeeSkuTarget([]), null);
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
  assert.equal(parseShopeeAmount(""), null);
  assert.equal(parseShopeeAmount(null), null);
  assert.equal(parseShopeeAmount("NaN"), null);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(orderStatusCanAdvance(new Date(100), new Date(99)), false);
  assert.equal(orderStatusCanAdvance(new Date(100), new Date(100)), true);
});

test("token expiry accepts bounded TTL values without inventing a fallback", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(shopeeTokenExpiry(14_400, now)?.toISOString(), "2026-01-01T04:00:00.000Z");
  assert.equal(shopeeTokenExpiry("14400", now)?.getTime(), now + 14_400_000);
  for (const invalid of [undefined, null, "", "NaN", 0, -1, 31_536_001, 1.5]) assert.equal(shopeeTokenExpiry(invalid, now), null);
});

test("order list page and cursor validation reject missing IDs, malformed pages and repeated cursors", () => {
  const parsed = validateShopeeOrderListPage({ order_list: [{ order_sn: " A-1 " }, { order_sn: "A-2" }], more: true, next_cursor: "page-2" });
  assert.deepEqual(parsed, { ok: true, value: { orderSns: ["A-1", "A-2"], more: true, cursor: "page-2" } });
  assert.deepEqual(validateShopeeOrderListPage({ order_list: [{ order_sn: "A-1" }], more: true }), { ok: false, code: "SHOPEE_CURSOR_MISSING" });
  assert.deepEqual(validateShopeeOrderListPage({ order_list: [{}], more: false }), { ok: false, code: "SHOPEE_ORDER_ID_MISSING" });
  assert.deepEqual(validateShopeeOrderListPage({ order_list: [], more: "false" }), { ok: false, code: "SHOPEE_ORDER_LIST_INVALID" });
  assert.equal(validateShopeeCursor(true, "page-2", undefined, new Set()), true);
  assert.equal(validateShopeeCursor(true, "page-2", "page-2", new Set()), false);
  assert.equal(validateShopeeCursor(true, "page-1", "page-2", new Set(["page-1"])), false);
  assert.equal(validateShopeeCursor(false, "", undefined, new Set()), true);
});

test("order detail must cover exactly every requested order and include item_list", () => {
  const valid = (order_sn: string) => ({ order_sn, order_status: "READY_TO_SHIP", create_time: 1_700_000_000, update_time: 1_700_000_001, item_list: [{ item_id: 1, model_quantity_purchased: 1 }] });
  assert.deepEqual(validateShopeeOrderDetails([valid("A"), valid("B")], ["A", "B"]).ok, true);
  assert.deepEqual(validateShopeeOrderDetails([valid("A")], ["A", "B"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_MISSING" });
  assert.deepEqual(validateShopeeOrderDetails([valid("A"), valid("A")], ["A", "B"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_SET_INVALID" });
  assert.deepEqual(validateShopeeOrderDetails([valid("OTHER")], ["A"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_SET_INVALID" });
  const withoutItems = { ...valid("A") } as Record<string, unknown>;
  delete withoutItems.item_list;
  assert.deepEqual(validateShopeeOrderDetails([withoutItems], ["A"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_INCOMPLETE" });
  assert.deepEqual(validateShopeeOrderDetails([valid("A")], ["A"]).ok, true);
  assert.deepEqual(validateShopeeOrderDetails([{ ...valid("A"), item_list: [] }], ["A"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_INCOMPLETE" });
  assert.deepEqual(validateShopeeOrderDetails({ order_list: [] }, ["A"]), { ok: false, code: "SHOPEE_ORDER_DETAIL_LIST_INVALID" });
});
