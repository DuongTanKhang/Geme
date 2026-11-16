import assert from "node:assert/strict";
import test from "node:test";
import { canReopenOrderQr, qrRemainingMs } from "../app/order-payment-qr-state.ts";
import { getVietQrImageUrl, getVietQrTransferInfo } from "../app/bank-qr.ts";

const serverNow = "2026-11-14T04:00:00Z";
const paymentExpiresAt = "2026-11-14T04:15:00Z";
const pending = { payment: "BANK_TRANSFER", paymentStatus: "PENDING", status: "Chờ thanh toán", qrPaymentExpiresAt: paymentExpiresAt };

test("countdown uses server time and elapsed milliseconds, independent of PC timezone/clock", () => {
  const snapshot = { serverNow, paymentExpiresAt };
  assert.equal(qrRemainingMs(snapshot), 900_000);
  assert.equal(qrRemainingMs(snapshot, 1001), 898_999);
  assert.equal(qrRemainingMs(snapshot, 900_000), 0);
  assert.equal(qrRemainingMs(snapshot, 999_999), 0);
});

test("missing deadline cannot be mistaken for an expired new order", () => {
  for (const value of [null, "", "invalid"]) assert.equal(qrRemainingMs({ serverNow, paymentExpiresAt: value }), null);
});

test("reopening after leaving keeps the original payment window", () => {
  assert.equal(canReopenOrderQr(pending, Date.parse(serverNow) + 300_000), true);
  assert.equal(qrRemainingMs({ serverNow: "2026-11-14T04:05:00Z", paymentExpiresAt }), 600_000);
});

test("QR button is absent for paid, cancelled, expired, missing deadline and other payment methods", () => {
  const now = Date.parse(serverNow);
  assert.equal(canReopenOrderQr(pending, now), true);
  for (const paymentStatus of ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"]) assert.equal(canReopenOrderQr({ ...pending, paymentStatus }, now), false);
  assert.equal(canReopenOrderQr({ ...pending, status: "Đã hủy" }, now), false);
  assert.equal(canReopenOrderQr({ ...pending, payment: "COD" }, now), false);
  assert.equal(canReopenOrderQr({ ...pending, qrPaymentExpiresAt: null }, now), false);
  assert.equal(canReopenOrderQr(pending, Date.parse(paymentExpiresAt)), false);
});

test("QR image uses server order total and the existing transfer reference format", () => {
  const settings = { enabled: true, bankCode: "MB", accountNumber: "0123456789", accountName: "GEME TEST" };
  const image = getVietQrImageUrl(settings, 200_000, "GME-TEST-QR");
  assert.ok(image);
  const url = new URL(image);
  assert.equal(url.searchParams.get("amount"), "200000");
  assert.equal(url.searchParams.get("des"), getVietQrTransferInfo("GME-TEST-QR", "MB"));
});
