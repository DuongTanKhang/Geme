import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { onlineOrderInput } from "./online-order-input.js";

const valid = {
  customerName: "GEME Buyer",
  phone: "+84 912 345 678",
  email: "buyer@example.vn",
  shippingAddress: "12 Nguyễn Huệ, Quận 1, TP HCM",
  paymentMethod: "COD",
  items: [{ productId: "product-1", sku: "SKU-1", quantity: 1 }],
};

test("checkout accepts and normalizes common Vietnamese international phone format", () => {
  const input = onlineOrderInput(valid);
  assert.equal(input.phone, "0912345678");
  assert.equal(input.email, "buyer@example.vn");
});

test("checkout requires a shipping phone and deliverable address", () => {
  assert.throws(() => onlineOrderInput(null as any), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, phone: "" }), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, shippingAddress: "" }), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, shippingAddress: "123" }), BadRequestException);
});

test("checkout rejects invalid contact, payment, item count and oversized text instead of truncating", () => {
  assert.throws(() => onlineOrderInput({ ...valid, email: "not-an-email" }), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, paymentMethod: "CRYPTO" }), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, items: Array.from({ length: 31 }, () => valid.items[0]) }), BadRequestException);
  assert.throws(() => onlineOrderInput({ ...valid, shippingAddress: "a".repeat(1001) }), BadRequestException);
});

test("checkout preserves exact item identity and validates safe expected totals", () => {
  const input = onlineOrderInput({ ...valid, expectedTotalAmount: 1_250_000, items: [{ productId: " product-1 ", variantId: "variant-2", sku: " SKU-2 ", quantity: 2 }] });
  assert.deepEqual(input.items[0], { productId: "product-1", variantId: "variant-2", sku: "SKU-2", quantity: 2 });
  assert.equal(input.expectedTotalAmount, 1_250_000);
  assert.throws(() => onlineOrderInput({ ...valid, expectedTotalAmount: 1.5 }), BadRequestException);
});
