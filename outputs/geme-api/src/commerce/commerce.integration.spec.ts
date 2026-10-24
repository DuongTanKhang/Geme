import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AdminPermissionService } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";
import { OperationsService } from "../operations/operations.service.js";
import { ContactService } from "../contact/contact.service.js";

function isDedicatedLocalTestDatabase(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostIsLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(url.hostname);
    return hostIsLocal && /(test|integration|ci)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "1" && isDedicatedLocalTestDatabase(process.env.DATABASE_URL);
let prisma: PrismaService | null = null;
const orderIds: string[] = [];
const productIds: string[] = [];
const categoryIds: string[] = [];
const adminIds: string[] = [];
const contactKeys: string[] = [];
const customerPhones: string[] = [];
const actor = (): AdminIdentity => ({ id: adminIds[0], email: "commerce-ci@example.invalid", displayName: "Commerce CI", role: "ADMIN", correlationId: `ci-${randomUUID()}` });

before(async () => {
  if (!enabled) return;
  process.env.CORS_ORIGINS = "http://localhost:3000";
  prisma = new PrismaService();
  await prisma.$connect();
});

after(async () => {
  if (!prisma) return;
  const db = prisma;
  const ids = [...orderIds];
  if (ids.length) {
    await db.paymentRefund.deleteMany({ where: { payment: { orderId: { in: ids } } } });
    await db.codReconciliationBatch.deleteMany({ where: { items: { some: { orderId: { in: ids } } } } });
    await db.orderReturn.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderEmailOutbox.deleteMany({ where: { orderId: { in: ids } } });
    await db.inventoryReservation.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  if (productIds.length) {
    await db.inventoryMovement.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
  }
  if (categoryIds.length) await db.category.deleteMany({ where: { id: { in: categoryIds } } });
  if (contactKeys.length) await db.contactInquiry.deleteMany({ where: { idempotencyKey: { in: contactKeys } } });
  if (customerPhones.length) await db.customer.deleteMany({ where: { phone: { in: customerPhones } } });
  if (adminIds.length) {
    await db.auditLog.deleteMany({ where: { adminId: { in: adminIds } } });
    await db.adminUser.deleteMany({ where: { id: { in: adminIds } } });
  }
  await db.$disconnect();
});

async function createAdmin(role: "ADMIN" | "CONTENT_EDITOR" = "ADMIN") {
  const suffix = randomUUID();
  const user = await prisma!.adminUser.create({ data: {
    email: `${suffix}@example.invalid`, passwordHash: "integration-test-only", displayName: "Commerce CI", role,
  } });
  adminIds.push(user.id);
  return { ...user, correlationId: `ci-${randomUUID()}` } as AdminIdentity;
}

async function createOrder(options: {
  status?: "PENDING_CONFIRMATION" | "PROCESSING" | "SHIPPING" | "DELIVERED" | "CANCELLED";
  total?: number;
  payment?: { method: "COD" | "BANK_TRANSFER"; amount: number; status: "PENDING" | "PAID" | "PARTIALLY_REFUNDED"; paidAt?: Date }[];
  items?: { quantity: number; unitPrice: number; lineTotal: number; productId?: string; productSku?: string; variantId?: string }[];
  carrierShipmentStatus?: string;
}) {
  const id = randomUUID();
  const now = new Date();
  const order = await prisma!.order.create({ data: {
    id, code: `CI-${id.replaceAll("-", "").slice(0, 30)}`,
    customerName: "Integration Customer", customerPhone: `09${String(Date.now()).slice(-8)}`,
    shippingAddress: "PostgreSQL integration fixture", subtotal: options.total ?? 10_000,
    totalAmount: options.total ?? 10_000, status: options.status || "DELIVERED",
    carrierShipmentStatus: options.carrierShipmentStatus,
    carrierCodAmount: options.payment?.some((entry) => entry.method === "COD") ? options.total ?? 10_000 : null,
    placedAt: now,
    payments: { create: (options.payment || []).map((payment) => ({
      method: payment.method, amount: payment.amount, status: payment.status,
      ...(payment.paidAt ? { paidAt: payment.paidAt } : {}),
    })) },
    ...(options.items?.length ? { items: { create: options.items.map((item) => ({
      productId: item.productId || null, variantId: item.variantId || null, productName: "CI fixture item", productSku: item.productSku || `CI-${id.slice(0, 8)}`,
      quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
    })) } } : {}),
  }, include: { items: true, payments: true } });
  orderIds.push(order.id);
  return order;
}

test("PostgreSQL services protect COD, refunds, inventory races, permissions, reports and contact idempotency", { skip: !enabled }, async (t) => {
  if (!prisma) throw new Error("PostgreSQL test service did not initialize.");
  const operations = new OperationsService(prisma);
  const financeActor = await createAdmin();
  const statementDate = new Date().toISOString().slice(0, 10);

  await t.test("COD variances close at the wider state width, concurrent close is single-writer, and reversal preserves collected payment evidence", async () => {
    const underCollected = await createOrder({ total: 10_000, payment: [{ method: "COD", amount: 10_000, status: "PENDING" }] });
    const underBatch = await operations.createCodReconciliation(financeActor, {
      externalReference: `ci-under-${randomUUID()}`, statementDate,
      entries: [{ orderId: underCollected.id, receivedAmount: 9_000, carrierFee: 500, remittedAmount: 8_000 }],
    });
    const closedUnder = await operations.reconcileCod(underBatch.id, financeActor, { note: "Test xác nhận chênh lệch khách trả" });
    assert.equal(closedUnder.status, "RECONCILED_WITH_VARIANCE");
    assert.equal((await prisma!.payment.findFirstOrThrow({ where: { orderId: underCollected.id } })).status, "PENDING");

    const exactCustomer = await createOrder({ total: 10_000, payment: [{ method: "COD", amount: 10_000, status: "PENDING" }] });
    const exactBatch = await operations.createCodReconciliation(financeActor, {
      externalReference: `ci-exact-${randomUUID()}`, statementDate,
      entries: [{ orderId: exactCustomer.id, receivedAmount: 10_000, carrierFee: 500, remittedAmount: 9_000 }],
    });
    const closeResults = await Promise.allSettled([
      operations.reconcileCod(exactBatch.id, financeActor, { note: "Đóng kiểm thử lần một" }),
      operations.reconcileCod(exactBatch.id, financeActor, { note: "Đóng kiểm thử lần hai" }),
    ]);
    assert.equal(closeResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(closeResults.filter((result) => result.status === "rejected").length, 1);
    const closedExact = await prisma!.codReconciliationBatch.findUniqueOrThrow({ where: { id: exactBatch.id } });
    assert.equal(closedExact.status, "RECONCILED_WITH_VARIANCE");
    assert.equal((await prisma!.payment.findFirstOrThrow({ where: { orderId: exactCustomer.id } })).status, "PAID");
    const reversed = await operations.reverseCod(exactBatch.id, financeActor, { reason: "Đảo phiếu kiểm thử để nhập lại" });
    assert.equal(reversed.status, "REVERSED");
    assert.equal((await prisma!.payment.findFirstOrThrow({ where: { orderId: exactCustomer.id } })).status, "PAID");
    assert.ok((await operations.codEligibleOrders("200")).some((row: any) => row.id === exactCustomer.id));
  });

  await t.test("return refunds split over multiple captures, enforce returned value and replay idempotently", async () => {
    const order = await createOrder({
      total: 10_000,
      payment: [
        { method: "BANK_TRANSFER", amount: 6_000, status: "PAID", paidAt: new Date() },
        { method: "BANK_TRANSFER", amount: 4_000, status: "PAID", paidAt: new Date() },
      ],
      items: [{ quantity: 2, unitPrice: 5_000, lineTotal: 10_000 }],
    });
    const returnCase = await operations.createReturn(order.id, financeActor, {
      reason: "Khách gửi trả đủ hai món", idempotencyKey: `return-${randomUUID()}`,
      items: [{ orderItemId: order.items[0].id, quantity: 2 }],
    });
    await operations.updateReturnStatus(returnCase.id, financeActor, { status: "APPROVED" });
    await operations.updateReturnStatus(returnCase.id, financeActor, { status: "RECEIVED", items: [{ id: returnCase.items[0].id, restock: false, conditionNote: "Chưa nhập kho trong fixture" }] });

    const firstRequest = { amount: 2_500, externalReference: `bank-${randomUUID()}`, note: "Hoàn một phần theo sao kê", idempotencyKey: `refund-${randomUUID()}` };
    const repeated = await Promise.all([
      operations.recordRefund(returnCase.id, financeActor, firstRequest),
      operations.recordRefund(returnCase.id, financeActor, firstRequest),
    ]);
    assert.equal(repeated.reduce((sum, result: any) => sum + result.refunds.reduce((rowSum: number, row: any) => rowSum + Number(row.amount), 0), 0), 5_000);
    const second = await operations.recordRefund(returnCase.id, financeActor, {
      amount: 7_500, externalReference: `bank-${randomUUID()}`, note: "Hoàn phần còn lại theo sao kê", idempotencyKey: `refund-${randomUUID()}`,
    });
    assert.equal(second.refunds.reduce((sum: number, row: any) => sum + Number(row.amount), 0), 7_500);
    const refundRows = await prisma!.paymentRefund.findMany({ where: { returnId: returnCase.id } });
    assert.equal(refundRows.reduce((sum, row) => sum + Number(row.amount), 0), 10_000);
    assert.equal((await prisma!.orderReturn.findUniqueOrThrow({ where: { id: returnCase.id } })).refundStatus, "REFUNDED");
    await assert.rejects(() => operations.recordRefund(returnCase.id, financeActor, {
      amount: 1, externalReference: `bank-${randomUUID()}`, note: "Không được hoàn vượt giá trị", idempotencyKey: `refund-${randomUUID()}`,
    }), /vượt|Vượt/);
  });

  await t.test("two checkouts cannot reserve the last item; payment and cancel serialize without losing stock or money evidence", async () => {
    const productId = randomUUID();
    const product = await prisma!.product.create({ data: {
      id: productId, sku: `CI-${productId.slice(0, 10)}`, name: "Fixture ring", slug: `ci-${productId}`,
      kind: "JEWELRY", status: "ACTIVE", price: 10_000, stock: 1,
    } });
    productIds.push(product.id);
    const commerce = new CommerceService(prisma!, { isSyncEnabled: () => false } as any, {} as any);
    const makeCheckout = () => commerce.createOrder({
      customerName: "Race Customer", phone: `09${String(Date.now() + Math.random()).replace(/\D/g, "").slice(-8)}`,
      shippingAddress: "CI local only", paymentMethod: "BANK_TRANSFER", expectedTotalAmount: 10_000,
      items: [{ productId, quantity: 1 }],
    }, undefined, false, `checkout-${randomUUID()}`);
    const checkoutResults = await Promise.allSettled([makeCheckout(), makeCheckout()]);
    assert.equal(checkoutResults.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal((await prisma!.product.findUniqueOrThrow({ where: { id: productId } })).stock, 0);
    assert.equal(await prisma!.inventoryReservation.count({ where: { productId, status: "ACTIVE" } }), 1);
    const order = (checkoutResults.find((entry) => entry.status === "fulfilled") as PromiseFulfilledResult<any>).value;

    const phone = `09${String(Date.now()).slice(-8)}`;
    customerPhones.push(phone);
    await prisma!.order.update({ where: { id: order.id }, data: { customerPhone: phone } });
    const outcomes = await Promise.allSettled([
      commerce.recordOrderPayment(order.id, financeActor, { amount: 10_000, method: "BANK_TRANSFER", providerRef: `ci-${randomUUID()}`, note: "Khoản thu kiểm thử race" }, `payment-${randomUUID()}`),
      commerce.updateOrderStatus(order.id, "CANCELLED", financeActor, "Kiểm thử race giữa hủy và thu tiền"),
    ]);
    assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
    const current = await prisma!.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true, inventoryReservations: true } });
    const paid = current.payments.some((payment) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status));
    if (current.status === "CANCELLED") {
      assert.equal(current.inventoryReleasedAt == null, false);
      assert.equal((await prisma!.product.findUniqueOrThrow({ where: { id: productId } })).stock, 1);
      assert.equal(paid, true); // late payment is retained for a separate refund, stock stays released
    } else {
      assert.equal(paid, true);
      assert.equal((await prisma!.product.findUniqueOrThrow({ where: { id: productId } })).stock, 0);
    }
  });

  await t.test("content editor API handler rejects direct price, stock, delete and SKU payloads", async () => {
    const editor = await createAdmin("CONTENT_EDITOR");
    const calls: string[] = [];
    const commerceStub = {
      updateProductFields: async () => { calls.push("id"); return { ok: true }; },
      updateProductFieldsBySku: async () => { calls.push("sku"); return { ok: true }; },
      deleteProduct: async () => { calls.push("delete"); return { ok: true }; },
    };
    const controller = new CommerceController(commerceStub as any, {} as any, new AdminPermissionService(prisma!), {} as any);
    const request = { adminIdentity: editor };
    assert.deepEqual(await controller.updateProduct(request, randomUUID(), { description: "Updated content" }), { ok: true });
    await assert.rejects(() => controller.updateProduct(request, randomUUID(), { price: 99 }), (error: unknown) => error instanceof ForbiddenException);
    await assert.rejects(() => controller.updateProduct(request, randomUUID(), { stock: 999 }), (error: unknown) => error instanceof BadRequestException);
    await assert.rejects(() => controller.updateProductBySku(request, "CI-SKU", { sku: "NEW-SKU" }), (error: unknown) => error instanceof ForbiddenException);
    await assert.rejects(() => controller.deleteProduct(request, randomUUID(), { reason: "Test delete" }), (error: unknown) => error instanceof ForbiddenException);
    assert.deepEqual(calls, ["id"]);
  });

  await t.test("full bangle edit without variant photos preserves SKU, stock, order links, shape and product gallery", async () => {
    let category = await prisma!.category.findUnique({ where: { slug: "vong-kieng" } });
    if (!category) {
      category = await prisma!.category.create({ data: {
        name: "Vòng Kiềng CI", slug: "vong-kieng", kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 1,
        pricingMode: "QUALITY_AND_BEAD_SIZE", status: "ACTIVE",
      } });
      categoryIds.push(category.id);
    }
    const id = randomUUID();
    const sku = `CI-BANGLE-${id.replaceAll("-", "").slice(0, 12)}`;
    const variantSku = `${sku}R02S54`;
    const product = await prisma!.product.create({ data: {
      id, sku, name: "Kiềng Aquamarine trước sửa", slug: `ci-bangle-${id}`,
      kind: "JEWELRY", status: "HIDDEN", categoryId: category.id, price: 2_000_000, stock: 2,
      images: { create: [{ url: "https://cdn.example.test/bangle-original.webp", alt: "Kiềng", isPrimary: true }] },
      variants: { create: [{
        optionKey: "BANGLE::ROUND::2A::54", quality: "2A", shape: "ROUND", beadSize: "54", sku: variantSku,
        price: 2_000_000, stock: 2, imageUrls: [],
      }] },
    } });
    productIds.push(product.id);
    const variant = await prisma!.productPriceVariant.findUniqueOrThrow({ where: { sku: variantSku } });
    const order = await createOrder({ total: 2_000_000, items: [{ productId: product.id, productSku: variantSku, variantId: variant.id, quantity: 1, unitPrice: 2_000_000, lineTotal: 2_000_000 }] });
    const commerce = new CommerceService(prisma!, { isSyncEnabled: () => false } as any, {} as any);

    const saved = await commerce.saveProduct({
      sku, name: "Kiềng Aquamarine đã sửa", kind: "JEWELRY", categoryId: category.id, status: "HIDDEN",
      price: 2_100_000, description: "Mô tả đã cập nhật", gallery: ["https://cdn.example.test/bangle-updated.webp"],
      priceVariants: [{ id: variant.id, sku: variantSku, shape: "ROUND", quality: "2A", beadSize: "54", price: 2_100_000, stock: 2, imageUrls: [], videoUrl: null }],
    }, product.id);
    const updatedVariant = await prisma!.productPriceVariant.findUniqueOrThrow({ where: { id: variant.id } });
    const orderItem = await prisma!.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    assert.equal(saved.name, "Kiềng Aquamarine đã sửa");
    assert.equal(saved.description, "Mô tả đã cập nhật");
    assert.equal(Number(saved.price), 2_100_000);
    assert.equal(saved.images[0].url, "https://cdn.example.test/bangle-updated.webp");
    assert.equal(updatedVariant.id, variant.id);
    assert.equal(updatedVariant.sku, variantSku);
    assert.equal(updatedVariant.shape, "ROUND");
    assert.equal(updatedVariant.beadSize, "54");
    assert.equal(updatedVariant.stock, 2);
    assert.deepEqual(updatedVariant.imageUrls, []);
    assert.equal(orderItem.productId, product.id);
    assert.equal(orderItem.variantId, variant.id);
  });

  await t.test("report separates pending orders, collections, refunds, returned goods and unverified COD", async () => {
    const now = new Date();
    const paidAt = now;
    await createOrder({ status: "PENDING_CONFIRMATION", total: 1_000, payment: [{ method: "BANK_TRANSFER", amount: 1_000, status: "PENDING" }] });
    await createOrder({ status: "PROCESSING", total: 10_000, payment: [{ method: "BANK_TRANSFER", amount: 10_000, status: "PAID", paidAt }] });
    await createOrder({ status: "DELIVERED", total: 5_000, payment: [{ method: "COD", amount: 5_000, status: "PENDING" }] });
    const returned = await createOrder({ status: "DELIVERED", total: 4_000, payment: [{ method: "BANK_TRANSFER", amount: 4_000, status: "PARTIALLY_REFUNDED", paidAt }], items: [{ quantity: 2, unitPrice: 2_000, lineTotal: 4_000 }] });
    const returnRow = await prisma!.orderReturn.create({ data: {
      code: `CI-RET-${randomUUID().slice(0, 8)}`, orderId: returned.id, status: "RECEIVED", reason: "report fixture", receivedAt: now,
      items: { create: [{ orderItemId: returned.items[0].id, productName: "CI fixture item", productSku: returned.items[0].productSku, quantity: 1 }] },
    } });
    await prisma!.paymentRefund.create({ data: {
      returnId: returnRow.id, paymentId: returned.payments[0].id, idempotencyKey: `report-refund-${randomUUID()}`,
      amount: 1_000, note: "fixture refund", externalReference: `bank-${randomUUID()}`, createdByAdminId: financeActor.id, createdAt: now,
    } });
    await createOrder({ status: "CANCELLED", total: 999, payment: [{ method: "BANK_TRANSFER", amount: 999, status: "PENDING" }] });

    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const report = await new CommerceService(prisma!, { isSyncEnabled: () => false } as any, {} as any).report({ from: day, to: day });
    assert.equal(report.grossOrderValue, 20_000);
    assert.equal(report.capturedPayments, 14_000);
    assert.equal(report.refundAmount, 1_000);
    assert.equal(report.revenue, 13_000);
    assert.equal(report.returnedGoodsValue, 2_000);
    assert.equal(report.codUnreconciled, 5_000);
    assert.equal(report.orderCount, 4);
  });

  await t.test("contact submission persists once, replays the same payload and conflicts on altered replay", async () => {
    const contacts = new ContactService(prisma!);
    const key = `contact-ci-${randomUUID()}`;
    contactKeys.push(key);
    const body = { name: "Integration Test", email: "ci@example.invalid", phone: "0912345678", subject: "Khác", message: "PostgreSQL integration message" };
    const first = await contacts.submit(body, "http://localhost:3000", key);
    const replay = await contacts.submit(body, "http://localhost:3000", key);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(first.id, replay.id);
    await assert.rejects(() => contacts.submit({ ...body, message: `${body.message} altered` }, "http://localhost:3000", key));
    const row = await prisma!.contactInquiry.findUniqueOrThrow({ where: { idempotencyKey: key } });
    assert.equal(row.status, "NEW");
  });
});
