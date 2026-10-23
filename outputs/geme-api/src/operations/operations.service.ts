import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";

type Row = Record<string, any>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const positiveInt = (value: unknown, label: string, allowZero = false) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) throw new BadRequestException(`${label} phải là số nguyên ${allowZero ? "không âm" : "lớn hơn 0"}.`);
  return parsed;
};
const shortCode = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const soon = new Date(Date.now() + 15 * 60_000);
    const [pendingOrders, activeReservations, availableStock, expiringReservations, openReturns, openCodBatches, codVariance, emailQueue, lowStock] = await Promise.all([
      this.prisma.order.count({ where: { status: { in: ["PENDING_CONFIRMATION", "PROCESSING"] } } }),
      this.prisma.inventoryReservation.aggregate({ where: { status: "ACTIVE" }, _count: { _all: true }, _sum: { quantity: true } }),
      this.prisma.product.aggregate({ where: { status: "ACTIVE" }, _sum: { stock: true } }),
      this.prisma.inventoryReservation.count({ where: { status: "ACTIVE", expiresAt: { lte: soon } } }),
      this.prisma.orderReturn.count({ where: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } } }),
      this.prisma.codReconciliationBatch.count({ where: { status: "OPEN" } }),
      this.prisma.codReconciliationItem.aggregate({ where: { status: "VARIANCE", batch: { status: "OPEN" } }, _sum: { varianceAmount: true }, _count: { _all: true } }),
      this.prisma.orderEmailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "products" WHERE "status" = 'ACTIVE' AND "stock" <= "minimum_stock"`,
    ]);
    const emailCounts = Object.fromEntries(emailQueue.map((row) => [row.status, row._count._all]));
    return {
      pendingOrders,
      inventory: {
        activeReservations: activeReservations._count._all,
        availableUnits: availableStock._sum.stock || 0,
        reservedUnits: activeReservations._sum.quantity || 0,
        onHandUnits: Number(availableStock._sum.stock || 0) + Number(activeReservations._sum.quantity || 0),
        expiringSoon: expiringReservations,
        lowStockProducts: Number(lowStock[0]?.count || 0),
      },
      returns: { open: openReturns },
      cod: { openBatches: openCodBatches, varianceLines: codVariance._count._all, varianceAmount: codVariance._sum.varianceAmount || 0 },
      orderEmail: { pending: emailCounts.PENDING || 0, failed: emailCounts.FAILED || 0, unknown: emailCounts.UNKNOWN || 0 },
      generatedAt: new Date().toISOString(),
    };
  }

  listReturns(limitInput?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    return this.prisma.orderReturn.findMany({
      include: { order: { select: { id: true, code: true, status: true, totalAmount: true, payments: true } }, items: true, refunds: true },
      orderBy: { createdAt: "desc" }, take,
    });
  }

  async returnEligibleOrders(limitInput?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 100, 1), 200);
    return this.prisma.order.findMany({
      where: { status: "DELIVERED" },
      select: {
        id: true, code: true, placedAt: true, customerName: true, totalAmount: true,
        items: { select: { id: true, productName: true, productSku: true, quantity: true, unitPrice: true, lineTotal: true } },
        returns: { where: { status: { not: "REJECTED" } }, select: { items: { select: { orderItemId: true, quantity: true } } } },
      },
      orderBy: { placedAt: "desc" }, take,
    });
  }

  async codEligibleOrders(limitInput?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 100, 1), 200);
    return this.prisma.order.findMany({
      where: {
        OR: [{ status: "DELIVERED" }, { carrierShipmentStatus: "DELIVERED" }],
        payments: { some: { method: "COD" } },
        codReconciliationItem: null,
      },
      select: { id: true, code: true, customerName: true, totalAmount: true, carrierCodAmount: true, placedAt: true, payments: { select: { status: true }, where: { method: "COD" }, take: 1 } },
      orderBy: { placedAt: "desc" }, take,
    });
  }

  async createReturn(orderId: string, actor: AdminIdentity, body: Row) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const rows = Array.isArray(body.items) ? body.items : [];
    if (reason.length < 5 || reason.length > 2000) throw new BadRequestException("Lý do trả hàng cần từ 5 đến 2.000 ký tự.");
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho yêu cầu trả hàng.");
    if (!rows.length || rows.length > 50) throw new BadRequestException("Phiếu trả hàng cần từ 1 đến 50 dòng sản phẩm.");
    const quantities = new Map<string, number>();
    for (const value of rows) {
      const row = value && typeof value === "object" ? value as Row : {};
      const itemId = String(row.orderItemId || "").trim();
      if (!itemId || quantities.has(itemId)) throw new BadRequestException("Dòng hàng trong yêu cầu thiếu mã hoặc bị lặp.");
      quantities.set(itemId, positiveInt(row.quantity, "Số lượng trả"));
    }
    const requestHash = hash({ orderId, reason, items: [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)) });
    const prior = await this.prisma.orderReturn.findUnique({ where: { idempotencyKey }, include: { items: true, refunds: true } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ConflictException("Idempotency-Key đã được dùng cho nội dung trả hàng khác.");
      return prior;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true } });
      if (!order) throw new NotFoundException("Không tìm thấy đơn hàng.");
      if (order.status !== "DELIVERED") throw new BadRequestException("Chỉ tiếp nhận trả hàng cho đơn đã giao thành công.");
      const selected = order.items.filter((item: Row) => quantities.has(item.id));
      if (selected.length !== quantities.size) throw new BadRequestException("Có dòng sản phẩm không thuộc đơn hàng này.");
      const previous = await tx.orderReturnItem.findMany({
        where: { orderItemId: { in: [...quantities.keys()] }, returnCase: { orderId, status: { not: "REJECTED" } } },
        select: { orderItemId: true, quantity: true },
      });
      const returned = new Map<string, number>();
      for (const line of previous) returned.set(line.orderItemId, (returned.get(line.orderItemId) || 0) + line.quantity);
      for (const item of selected) {
        if ((returned.get(item.id) || 0) + quantities.get(item.id)! > item.quantity) throw new ConflictException(`Số lượng trả của SKU ${item.productSku} vượt số lượng đã mua.`);
      }
      const created = await tx.orderReturn.create({
        data: {
          code: shortCode("RET"), orderId, status: "REQUESTED", reason, idempotencyKey, requestHash, createdByAdminId: actor.id,
          items: { create: selected.map((item: Row) => ({
            orderItemId: item.id, productId: item.productId, variantId: item.variantId,
            productName: item.productName, productSku: item.productSku, quantity: quantities.get(item.id)!,
          })) },
        },
        include: { items: true, refunds: true },
      });
      await tx.auditLog.create({ data: { adminId: actor.id, action: "RETURN_REQUESTED", entityType: "ORDER_RETURN", entityId: created.id, after: { orderId, code: created.code, itemCount: created.items.length, reason } } });
      return created;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await this.prisma.orderReturn.findUnique({ where: { idempotencyKey }, include: { items: true, refunds: true } });
        if (raced) {
          if (raced.requestHash !== requestHash) throw new ConflictException("Idempotency-Key đã được dùng cho nội dung trả hàng khác.");
          return raced;
        }
      }
      throw error;
    }
  }

  async updateReturnStatus(id: string, actor: AdminIdentity, body: Row) {
    const target = String(body.status || "").toUpperCase();
    if (!["APPROVED", "REJECTED", "RECEIVED", "CLOSED"].includes(target)) throw new BadRequestException("Trạng thái trả hàng không hợp lệ.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if ((target === "REJECTED" || target === "CLOSED") && note.length < 5) throw new BadRequestException("Cần ghi chú tối thiểu 5 ký tự cho quyết định này.");
    const changeRows = Array.isArray(body.items) ? body.items : [];
    const returnCase = await this.prisma.$transaction(async (tx) => {
      // Serialize state changes so two admins cannot both receive/restock the same return.
      await tx.$queryRaw`SELECT "id" FROM "order_returns" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.orderReturn.findUnique({ where: { id }, include: { items: true, order: { include: { payments: true } } } });
      if (!current) throw new NotFoundException("Không tìm thấy phiếu trả hàng.");
      const allowed: Record<string, string[]> = { REQUESTED: ["APPROVED", "REJECTED"], APPROVED: ["RECEIVED"], RECEIVED: ["CLOSED"], REJECTED: [], CLOSED: [] };
      if (current.status === target) return current;
      if (!allowed[current.status]?.includes(target)) throw new ConflictException(`Không thể chuyển phiếu trả từ ${current.status} sang ${target}.`);
      const changedProductIds = new Set<string>();
      if (target === "RECEIVED") {
        const restockById = new Map<string, Row>();
        for (const value of changeRows) {
          const row = value && typeof value === "object" ? value as Row : {};
          const itemId = String(row.id || "");
          if (!current.items.some((item: Row) => item.id === itemId) || restockById.has(itemId) || typeof row.restock !== "boolean") throw new BadRequestException("Xác nhận nhận hàng cần lựa chọn nhập kho cho từng dòng hợp lệ.");
          restockById.set(itemId, row);
        }
        if (restockById.size !== current.items.length) throw new BadRequestException("Cần xác nhận kiểm tra cho tất cả dòng sản phẩm trả về.");
        for (const item of current.items as Row[]) {
          const choice = restockById.get(item.id)!;
          const conditionNote = typeof choice.conditionNote === "string" ? choice.conditionNote.trim().slice(0, 1000) : null;
          if (choice.restock && !item.productId) throw new ConflictException(`SKU ${item.productSku} chưa liên kết sản phẩm; không thể nhập lại kho tự động.`);
          if (choice.restock && item.productId) {
            if (item.variantId) {
              const variant = await tx.productPriceVariant.findFirst({ where: { id: item.variantId, productId: item.productId }, select: { stock: true } });
              if (!variant) throw new ConflictException(`Không tìm thấy biến thể cần nhập lại kho (${item.productSku}).`);
              await tx.productPriceVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
              await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, soldOutAt: null } });
              await tx.inventoryMovement.create({ data: { productId: item.productId, variantId: item.variantId, productName: item.productName, productSku: item.productSku, type: "IN", quantity: item.quantity, stockBefore: variant.stock, stockAfter: variant.stock + item.quantity, reference: current.code, note: "Nhập kho hàng trả lại đã kiểm tra" } });
            } else {
              const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
              if (!product) throw new ConflictException(`Không tìm thấy sản phẩm cần nhập lại kho (${item.productSku}).`);
              await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity }, soldOutAt: null } });
              await tx.inventoryMovement.create({ data: { productId: item.productId, productName: item.productName, productSku: item.productSku, type: "IN", quantity: item.quantity, stockBefore: product.stock, stockAfter: product.stock + item.quantity, reference: current.code, note: "Nhập kho hàng trả lại đã kiểm tra" } });
            }
            changedProductIds.add(item.productId);
          }
          await tx.orderReturnItem.update({ where: { id: item.id }, data: { restock: choice.restock, conditionNote, ...(choice.restock && item.productId ? { restockedAt: new Date() } : {}) } });
        }
        if (changedProductIds.size) await tx.product.updateMany({
          where: { id: { in: [...changedProductIds] } },
          data: { pos365StockSyncStatus: "PENDING", pos365StockSyncAttempts: 0, pos365StockSyncLastAttemptAt: null, pos365StockSyncNextAttemptAt: new Date(), pos365StockSyncedAt: null, pos365StockSyncError: null },
        });
      }
      const updated = await tx.orderReturn.update({ where: { id }, data: {
        status: target,
        ...(note ? { decisionNote: note } : {}),
        ...(target === "RECEIVED" ? { receivedAt: new Date() } : {}),
        ...(target === "CLOSED" ? { closedAt: new Date() } : {}),
      }, include: { items: true, refunds: true, order: true } });
      await tx.auditLog.create({ data: { adminId: actor.id, action: `RETURN_${target}`, entityType: "ORDER_RETURN", entityId: id, before: { status: current.status }, after: { status: target, note: note || null, restockedItemCount: current.items.filter((item: Row) => restockByPlaceholder(item, changeRows)).length } } });
      return updated;
    });
    return returnCase;
  }

  async recordRefund(id: string, actor: AdminIdentity, body: Row) {
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const amount = positiveInt(body.amount, "Số tiền hoàn");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho giao dịch hoàn tiền.");
    if (note.length < 5 || note.length > 1000) throw new BadRequestException("Ghi chú hoàn tiền cần từ 5 đến 1.000 ký tự.");
    const prior = await this.prisma.paymentRefund.findUnique({ where: { idempotencyKey } });
    if (prior) {
      if (prior.returnId !== id || Number(prior.amount) !== amount || prior.note !== note) throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
      return prior;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const returnCase = await tx.orderReturn.findUnique({ where: { id }, include: { order: { include: { payments: true } } } });
        if (!returnCase) throw new NotFoundException("Không tìm thấy phiếu trả hàng.");
        if (!["RECEIVED", "CLOSED"].includes(returnCase.status)) throw new BadRequestException("Chỉ ghi nhận hoàn tiền sau khi đã nhận và kiểm tra hàng trả.");
        const payment = returnCase.order.payments.find((row: Row) => row.status === "PAID" || row.status === "PARTIALLY_REFUNDED");
        if (!payment) throw new BadRequestException("Đơn chưa có khoản thanh toán đã thu để hoàn tiền.");
        await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
        // Re-check after taking the payment lock so a concurrent replay of the
        // same key returns the committed refund instead of failing as over-refund.
        const committedReplay = await tx.paymentRefund.findUnique({ where: { idempotencyKey } });
        if (committedReplay) {
          if (committedReplay.returnId !== id || Number(committedReplay.amount) !== amount || committedReplay.note !== note) {
            throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
          }
          return committedReplay;
        }
        const sum = await tx.paymentRefund.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
        const refundedBefore = Number(sum._sum.amount || 0);
        if (amount > Number(payment.amount) - refundedBefore) throw new ConflictException("Số tiền hoàn vượt phần tiền đã thu còn lại.");
        const created = await tx.paymentRefund.create({ data: { returnId: id, paymentId: payment.id, idempotencyKey, amount, note, createdByAdminId: actor.id } });
        const refundedAfter = refundedBefore + amount;
        const status = refundedAfter >= Number(payment.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await tx.payment.update({ where: { id: payment.id }, data: { status: status as any } });
        await tx.orderReturn.update({ where: { id }, data: { refundStatus: status } });
        await tx.auditLog.create({ data: { adminId: actor.id, action: "PAYMENT_REFUND_RECORDED", entityType: "PAYMENT", entityId: payment.id, before: { status: payment.status, refundedAmount: refundedBefore }, after: { status, refundAmount: amount, refundedAmount: refundedAfter, returnId: id, note } } });
        return created;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await this.prisma.paymentRefund.findUnique({ where: { idempotencyKey } });
        if (raced && raced.returnId === id && Number(raced.amount) === amount && raced.note === note) return raced;
        if (raced) throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
      }
      throw error;
    }
  }

  listCodReconciliations(limitInput?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    return this.prisma.codReconciliationBatch.findMany({ include: { items: { include: { order: { select: { code: true, status: true } } } } }, orderBy: { statementDate: "desc" }, take });
  }

  async createCodReconciliation(actor: AdminIdentity, body: Row) {
    const externalReference = typeof body.externalReference === "string" ? body.externalReference.trim() : "";
    const carrier = String(body.carrier || "VIETTEL_POST").toUpperCase();
    const statementDate = new Date(String(body.statementDate || ""));
    const rows = Array.isArray(body.entries) ? body.entries : [];
    if (!externalReference || externalReference.length > 120) throw new BadRequestException("Mã bảng kê COD không hợp lệ.");
    if (!Number.isFinite(statementDate.getTime())) throw new BadRequestException("Ngày bảng kê không hợp lệ.");
    if (!["VIETTEL_POST", "MANUAL"].includes(carrier)) throw new BadRequestException("Chỉ hỗ trợ đối soát Viettel Post hoặc bảng kê thủ công.");
    if (!rows.length || rows.length > 500) throw new BadRequestException("Bảng kê cần từ 1 đến 500 đơn COD.");
    const entryByOrderId = new Map<string, { receivedAmount: number; carrierFee: number; note: string | null }>();
    for (const value of rows) {
      const row = value && typeof value === "object" ? value as Row : {};
      const orderId = String(row.orderId || "").trim();
      if (!orderId || entryByOrderId.has(orderId)) throw new BadRequestException("Mã đơn COD bị thiếu hoặc trùng trong bảng kê.");
      entryByOrderId.set(orderId, { receivedAmount: positiveInt(row.receivedAmount, "Tiền COD đã thu", true), carrierFee: positiveInt(row.carrierFee ?? 0, "Phí vận chuyển", true), note: typeof row.note === "string" ? row.note.trim().slice(0, 1000) : null });
    }
    const requestHash = hash({ externalReference, carrier, statementDate: statementDate.toISOString().slice(0, 10), entries: [...entryByOrderId].sort(([a], [b]) => a.localeCompare(b)) });
    const existing = await this.prisma.codReconciliationBatch.findUnique({ where: { externalReference }, include: { items: true } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException("Mã bảng kê đã được dùng cho dữ liệu COD khác.");
      return existing;
    }
    const orders = await this.prisma.order.findMany({ where: { id: { in: [...entryByOrderId.keys()] } }, include: { payments: true } });
    if (orders.length !== entryByOrderId.size) throw new BadRequestException("Có đơn hàng trong bảng kê không tồn tại.");
    const orderById = new Map(orders.map((order: Row) => [order.id, order]));
    let expectedTotal = 0;
    let receivedTotal = 0;
    let feeTotal = 0;
    const entries = [...entryByOrderId].map(([orderId, data]) => {
      const order = orderById.get(orderId)!;
      const payment = order.payments.find((row: Row) => row.method === "COD");
      if (!payment) throw new BadRequestException(`Đơn ${order.code} không phải đơn COD.`);
      if (order.status !== "DELIVERED" && order.carrierShipmentStatus !== "DELIVERED") throw new BadRequestException(`Đơn ${order.code} chưa được xác nhận giao thành công.`);
      const expectedAmount = Number(order.carrierCodAmount ?? order.totalAmount);
      const varianceAmount = data.receivedAmount - expectedAmount;
      expectedTotal += expectedAmount;
      receivedTotal += data.receivedAmount;
      feeTotal += data.carrierFee;
      return { orderId, expectedAmount, receivedAmount: data.receivedAmount, carrierFee: data.carrierFee, varianceAmount, status: varianceAmount === 0 ? "MATCHED" : "VARIANCE", note: data.note };
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.codReconciliationBatch.create({ data: {
          externalReference, carrier, statementDate, requestHash, expectedTotal, receivedTotal, feeTotal, status: "OPEN", createdByAdminId: actor.id,
          items: { create: entries },
        }, include: { items: true } });
        await tx.auditLog.create({ data: { adminId: actor.id, action: "COD_RECONCILIATION_CREATED", entityType: "COD_RECONCILIATION", entityId: batch.id, after: { externalReference, carrier, expectedTotal, receivedTotal, feeTotal, varianceLines: entries.filter((item) => item.status === "VARIANCE").length } } });
        return batch;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await this.prisma.codReconciliationBatch.findUnique({ where: { externalReference }, include: { items: true } });
        if (raced) {
          if (raced.requestHash !== requestHash) throw new ConflictException("Mã bảng kê đã được dùng cho dữ liệu COD khác.");
          return raced;
        }
        throw new ConflictException("Một đơn COD đã được đưa vào bảng kê khác.");
      }
      throw error;
    }
  }

  async reconcileCod(id: string, actor: AdminIdentity, body: Row) {
    const batch = await this.prisma.codReconciliationBatch.findUnique({ where: { id }, include: { items: true } });
    if (!batch) throw new NotFoundException("Không tìm thấy bảng đối soát COD.");
    if (batch.status !== "OPEN") return batch;
    const hasVariance = batch.items.some((item: Row) => item.status === "VARIANCE");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (hasVariance && note.length < 5) throw new BadRequestException("Bảng kê có chênh lệch; cần ghi rõ quyết định xử lý tối thiểu 5 ký tự.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.codReconciliationBatch.updateMany({ where: { id, status: "OPEN" }, data: { status: hasVariance ? "RECONCILED_WITH_VARIANCE" : "RECONCILED", decisionNote: note || null, reconciledAt: new Date() } });
      if (result.count !== 1) throw new ConflictException("Bảng kê vừa được đối soát bởi tài khoản khác.");
      const matchedOrderIds = batch.items.filter((item: Row) => item.status === "MATCHED").map((item: Row) => item.orderId);
      if (matchedOrderIds.length) await tx.payment.updateMany({
        where: { orderId: { in: matchedOrderIds }, method: "COD", status: "PENDING" },
        data: { status: "PAID", paidAt: new Date() },
      });
      const saved = await tx.codReconciliationBatch.findUniqueOrThrow({ where: { id }, include: { items: true } });
      await tx.auditLog.create({ data: { adminId: actor.id, action: "COD_RECONCILIATION_CLOSED", entityType: "COD_RECONCILIATION", entityId: id, before: { status: "OPEN" }, after: { status: saved.status, decisionNote: note || null } } });
      return saved;
    });
    return updated;
  }

  async auditLogs(query: Row) {
    const take = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const rows = await this.prisma.auditLog.findMany({
      include: { admin: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: "desc" }, take,
      ...(typeof query.cursor === "string" && query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return rows;
  }
}

function restockByPlaceholder(item: Row, rows: Row[]) {
  return rows.some((row) => row?.id === item.id && row.restock === true);
}
