import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";
import { adminOrderQrSnapshot } from "./admin-order-qr.js";
import { getQrPaymentWindow } from "./reservation-expiry.js";

const now = new Date("2026-11-14T04:00:00.000Z");
function order() {
  return { id: "order-1", code: "GME-TEST-QR", status: "PENDING_PAYMENT", totalAmount: 200_000,
    qrPaymentExpiresAt: getQrPaymentWindow(now).expiresAt,
    payments: [{ id: "payment-1", method: "BANK_TRANSFER", status: "PENDING", amount: 200_000, refunds: [] as Array<{ amount: number }> }],
  };
}

test("new counter QR has fifteen minutes, reopening uses the original deadline without mutation", () => {
  const original = order(); const before = structuredClone(original);
  const first = adminOrderQrSnapshot(original, now);
  assert.equal(first.qrState, "READY");
  assert.equal(Date.parse(first.paymentExpiresAt!) - Date.parse(first.serverNow), 900_000);
  const reopened = adminOrderQrSnapshot(original, new Date(now.getTime() + 300_000));
  assert.equal(reopened.paymentExpiresAt, first.paymentExpiresAt);
  assert.equal(Date.parse(reopened.paymentExpiresAt!) - Date.parse(reopened.serverNow), 600_000);
  assert.deepEqual(original, before);
});

test("missing or invalid old QR deadline is unavailable, never immediately expired", () => {
  for (const deadline of [null, new Date("invalid")]) {
    const snapshot = adminOrderQrSnapshot({ ...order(), qrPaymentExpiresAt: deadline }, now);
    assert.equal(snapshot.qrState, "UNAVAILABLE");
    assert.equal(snapshot.paymentExpiresAt, null);
  }
});

test("deadline closes QR at exactly fifteen minutes", () => {
  assert.equal(adminOrderQrSnapshot(order(), new Date(now.getTime() + 899_999)).qrState, "READY");
  assert.equal(adminOrderQrSnapshot(order(), new Date(now.getTime() + 900_000)).qrState, "EXPIRED");
});

test("confirmed payment closes QR even when deadline has passed", () => {
  const paid = order(); paid.payments[0].status = "PAID";
  const snapshot = adminOrderQrSnapshot(paid, new Date(now.getTime() + 960_000));
  assert.equal(snapshot.qrState, "PAID"); assert.equal(snapshot.paymentBalance, 0);
  assert.equal(snapshot.paymentCaptured, 200_000);
  assert.equal(snapshot.paymentEntries[0].status, "PAID");
});

test("partial payment, refund and cancelled order cannot reuse full-amount QR", () => {
  const partial = order(); partial.payments[0].status = "PAID"; partial.payments[0].amount = 50_000;
  assert.equal(adminOrderQrSnapshot(partial, now).qrState, "PARTIAL");
  const refunded = order(); refunded.payments[0].status = "PARTIALLY_REFUNDED"; refunded.payments[0].refunds = [{ amount: 10_000 }];
  assert.equal(adminOrderQrSnapshot(refunded, now).qrState, "REFUNDED");
  assert.equal(adminOrderQrSnapshot(refunded, now).paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(adminOrderQrSnapshot({ ...order(), status: "CANCELLED" }, now).qrState, "CANCELLED");
});

test("non-QR method and invalid amount cannot produce payable QR", () => {
  const cash = order(); cash.payments[0].method = "COD";
  assert.equal(adminOrderQrSnapshot(cash, now).qrState, "UNAVAILABLE");
  for (const totalAmount of [0, -1, 1.5, NaN]) assert.equal(adminOrderQrSnapshot({ ...order(), totalAmount }, now).qrState, "UNAVAILABLE");
});

test("admin QR service only reads the existing order and rejects missing IDs", async () => {
  let reads = 0;
  const service = new CommerceService({ order: { findUnique: async () => { reads++; return order(); } } } as any, {} as any, {} as any, {} as any);
  const a = await service.adminOrderPaymentQr("order-1");
  const b = await service.adminOrderPaymentQr("order-1");
  assert.equal(a.paymentExpiresAt, b.paymentExpiresAt); assert.equal(reads, 2);
  const missing = new CommerceService({ order: { findUnique: async () => null } } as any, {} as any, {} as any, {} as any);
  await assert.rejects(missing.adminOrderPaymentQr("missing"), NotFoundException);
});

test("QR controller uses the current SePay account and rechecks payment after account lookup", async () => {
  let reads = 0; let accounts = 0;
  const ready = adminOrderQrSnapshot(order(), now);
  const controller = new CommerceController({ adminOrderPaymentQr: async () => (++reads === 1 ? ready : { ...ready, qrState: "PAID" }) } as any,
    {} as any, {} as any, {} as any, { getPublicQrSettings: async () => { accounts++; return { enabled: true, bankCode: "MB", accountNumber: "test" }; } } as any, {} as any);
  const result = await controller.adminOrderPaymentQr("order-1");
  assert.equal(accounts, 1); assert.equal(reads, 2);
  assert.equal(result.qrState, "PAID"); assert.equal(result.bankQr, null);
});

test("QR controller never loads a bank account for an expired order", async () => {
  const expired = adminOrderQrSnapshot(order(), new Date(now.getTime() + 900_000));
  const controller = new CommerceController({ adminOrderPaymentQr: async () => expired } as any,
    {} as any, {} as any, {} as any, { getPublicQrSettings: async () => { throw new Error("must not fetch"); } } as any, {} as any);
  assert.equal((await controller.adminOrderPaymentQr("order-1")).bankQr, null);
});

test("admin QR route requires authentication and orders.read, with no public payment data", async () => {
  const handler = CommerceController.prototype.adminOrderPaymentQr;
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, handler).includes(AdminAuthGuard));
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {}, path: "/admin/orders/order-1/payment-qr" }) }), getHandler: () => handler, getClass: () => CommerceController } as any;
  const anonymous = new AdminAuthGuard({ authenticateAuthorization: async () => null } as any, {} as any, new Reflector());
  await assert.rejects(anonymous.canActivate(context), UnauthorizedException);
  const denied = new AdminAuthGuard({ authenticateAuthorization: async () => ({ id: "staff" }) } as any,
    { assertPermissions: async (_identity: unknown, required: string[]) => { assert.deepEqual(required, ["orders.read"]); throw new ForbiddenException(); }, recordAuthorizationDenied: async () => undefined } as any, new Reflector());
  await assert.rejects(denied.canActivate(context), ForbiddenException);
});

test("real createOrder service keeps counter QR pending, reserves stock and retries without extending TTL", async () => {
  let saved: any = null; let stock = 4; let inserts = 0; let reservation: any;
  const product = { id: "product-1", sku: "TEST-QR", name: "Test", price: 200_000, status: "ACTIVE", kind: "JEWELRY", variants: [], category: null };
  const db: any = {
    order: { findUnique: async () => saved, create: async ({ data }: any) => {
      inserts++; saved = { ...data, id: "order-1", items: data.items.create.map((line: any) => ({ ...line, id: "line-1" })), payments: [data.payments.create] }; return saved;
    } },
    product: { findFirst: async () => product, updateMany: async ({ data }: any) => { stock -= data.stock?.decrement ?? 0; return { count: 1 }; }, findUniqueOrThrow: async () => ({ stock }) },
    inventoryMovement: { create: async () => ({}) },
    inventoryReservation: { createMany: async ({ data }: any) => { reservation = data; } },
    inventoryIssue: { create: async () => { throw new Error("unpaid QR must not create a paid inventory issue"); } },
  };
  db.$transaction = (fn: any) => fn(db);
  const service = new CommerceService(db, { isSyncEnabled: () => false } as any, {} as any,
    { preview: async () => ({ discountAmount: 0, pointsToRedeem: 0 }), reserve: async () => undefined } as any);
  const input = { salesChannel: "STORE", paymentMethod: "BANK_TRANSFER", qrPayment: true, paid: true, items: [{ productId: product.id, quantity: 1 }] };
  const result = await service.createOrder(input, undefined, true, "counter-qr-test-request-0001");
  assert.equal(result.status, "PENDING_PAYMENT"); assert.equal(result.payments[0].status, "PENDING");
  assert.equal(result.qrPaymentExpiresAt.getTime() - result.qrPaymentStartedAt.getTime(), 900_000);
  assert.equal(result.totalAmount, 200_000); assert.equal(stock, 3);
  assert.equal(reservation[0].expiresAt.getTime(), result.qrPaymentExpiresAt.getTime());
  const retry = await service.createOrder(input, undefined, true, "counter-qr-test-request-0001");
  assert.equal(retry.id, result.id); assert.equal(retry.qrPaymentExpiresAt, result.qrPaymentExpiresAt);
  assert.equal(inserts, 1); assert.equal(stock, 3);
});
