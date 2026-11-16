import assert from "node:assert/strict";
import test from "node:test";
import { getOrderPaymentFlags } from "./order-payment-mode.js";

test("counter bank-transfer QR remains unpaid until SePay reconciles it", () => {
  assert.deepEqual(getOrderPaymentFlags({
    storeSale: true,
    method: "BANK_TRANSFER",
    requestedQrPayment: true,
    requestedPaid: false,
  }), { qrPayment: true, paid: false });
});

test("cash counter order still completes immediately", () => {
  assert.deepEqual(getOrderPaymentFlags({
    storeSale: true,
    method: "COD",
    requestedQrPayment: false,
    requestedPaid: true,
  }), { qrPayment: false, paid: true });
});

test("website QR keeps its existing pending-payment behavior", () => {
  assert.deepEqual(getOrderPaymentFlags({
    storeSale: false,
    method: "BANK_TRANSFER",
    requestedQrPayment: true,
    requestedPaid: false,
  }), { qrPayment: true, paid: false });
});
