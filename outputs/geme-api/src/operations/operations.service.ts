import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
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
  constructor(private readonly prisma: PrismaService, private readonly loyalty: LoyaltyService) {}

  async dashboard() {
    const soon = new Date(Date.now() + 15 * 60_000);
    const [pendingOrders, activeReservations, inTransitReservations, availableStock, expiringReservations, openReturns, openCodBatches, codVariance, emailQueue, lowStock] = await Promise.all([
      this.prisma.order.count({ where: { status: { in: ["PENDING_CONFIRMATION", "PROCESSING"] } } }),
      this.prisma.inventoryReservation.aggregate({ where: { status: "ACTIVE", product: { status: "ACTIVE" }, order: { status: { not: "SHIPPING" } } }, _count: { _all: true }, _sum: { quantity: true } }),
      // Include legacy active rows for already-shipping orders without rewriting
      // ambiguous historical reservation records during migration.
      this.prisma.inventoryReservation.aggregate({ where: { status: { in: ["COMMITTED", "ACTIVE"] }, product: { status: "ACTIVE" }, order: { status: "SHIPPING" } }, _sum: { quantity: true } }),
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
        inTransitUnits: Number(inTransitReservations._sum.quantity || 0),
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
      where: { OR: [{ status: "DELIVERED" }, { status: "SHIPPING", carrierShipmentStatus: "RETURNING" }] },
      select: {
        id: true, code: true, placedAt: true, customerName: true, totalAmount: true, carrierShipmentStatus: true,
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
        AND: [
          { OR: [{ status: "DELIVERED" }, { carrierShipmentStatus: "DELIVERED" }] },
          { payments: { some: { method: "COD" } } },
          { codReconciliationItems: { none: { batch: { is: { status: { not: "REVERSED" } } } } } },
        ],
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
      const delivered = order.status === "DELIVERED" || order.carrierShipmentStatus === "DELIVERED";
      const carrierReturning = order.status === "SHIPPING" && order.carrierShipmentStatus === "RETURNING";
      if (!delivered && !carrierReturning) throw new BadRequestException("Chỉ tiếp nhận trả hàng cho đơn đã giao, hoặc kiện Viettel Post đang được hãng hoàn về.");
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
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "RETURN_REQUESTED", entityType: "ORDER_RETURN", entityId: created.id, after: { orderId, code: created.code, itemCount: created.items.length, reason } } });
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
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: `RETURN_${target}`, entityType: "ORDER_RETURN", entityId: id, before: { status: current.status }, after: { status: target, note: note || null, restockedItemCount: current.items.filter((item: Row) => restockByPlaceholder(item, changeRows)).length } } });
      return updated;
    });
    return returnCase;
  }

  async recordRefund(id: string, actor: AdminIdentity, body: Row) {
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const amount = positiveInt(body.amount, "Số tiền hoàn");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const externalReference = typeof body.externalReference === "string" ? body.externalReference.trim() : "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho giao dịch hoàn tiền.");
    if (note.length < 5 || note.length > 1000) throw new BadRequestException("Ghi chú hoàn tiền cần từ 5 đến 1.000 ký tự.");
    if (externalReference.length < 4 || externalReference.length > 160) throw new BadRequestException("Cần mã giao dịch hoàn tiền thực tế từ ngân hàng hoặc cổng thanh toán.");
    const requestHash = hash({ returnId: id, amount, note, externalReference });
    const findReplay = async (db: any) => {
      const grouped = await db.paymentRefund.findMany({ where: { OR: [{ requestKey: idempotencyKey }, { idempotencyKey }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!grouped.length) return null;
      if (grouped.reduce((sum: number, row: Row) => sum + Number(row.amount), 0) !== amount || grouped.some((row: Row) => row.returnId !== id || (row.requestHash && row.requestHash !== requestHash) || (!row.requestHash && (grouped.length !== 1 || Number(row.amount) !== amount || row.note !== note || row.externalReference !== externalReference)))) {
        throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
      }
      return { requestKey: idempotencyKey, amount, refunds: grouped, replayed: true };
    };
    const prior = await findReplay(this.prisma);
    if (prior) return prior;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const returnIdentity = await tx.orderReturn.findUnique({ where: { id }, select: { orderId: true } });
        if (!returnIdentity) throw new NotFoundException("Không tìm thấy phiếu trả hàng.");
        // Serialize refunds for the whole order, even when the order has split
        // payments or multiple return cases. This is the financial invariant.
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${returnIdentity.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "order_returns" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const committedReplay = await findReplay(tx);
        if (committedReplay) return committedReplay;
        const returnCase = await tx.orderReturn.findUnique({ where: { id }, include: { order: { include: { items: true } }, items: true } });
        if (!returnCase) throw new NotFoundException("Không tìm thấy phiếu trả hàng.");
        if (!["RECEIVED", "CLOSED"].includes(returnCase.status)) throw new BadRequestException("Chỉ ghi nhận hoàn tiền sau khi đã nhận và kiểm tra hàng trả.");
        const returnCases = await tx.orderReturn.findMany({
          where: { orderId: returnCase.orderId, status: { in: ["RECEIVED", "CLOSED"] } },
          include: { items: true, refunds: true },
          orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        });
        const lineById = new Map(returnCase.order.items.map((line: Row) => [line.id, line]));
        const returnedQuantities = new Map<string, number>();
        let thisReturnValue = 0;
        for (const candidate of returnCases) {
          let candidateValue = 0;
          for (const line of candidate.items as Row[]) {
            const orderLine = lineById.get(line.orderItemId) as Row | undefined;
            if (!orderLine || orderLine.quantity <= 0 || line.quantity <= 0) throw new ConflictException("Dữ liệu dòng trả hàng không còn khớp với đơn gốc; cần rà soát thủ công.");
            const previousQty = returnedQuantities.get(line.orderItemId) || 0;
            const nextQty = previousQty + line.quantity;
            if (nextQty > orderLine.quantity) throw new ConflictException(`Tổng số lượng trả của SKU ${line.productSku} vượt số lượng đã mua.`);
            const previousValue = Math.floor(Number(orderLine.lineTotal) * previousQty / orderLine.quantity);
            const cumulativeValue = Math.floor(Number(orderLine.lineTotal) * nextQty / orderLine.quantity);
            candidateValue += cumulativeValue - previousValue;
            returnedQuantities.set(line.orderItemId, nextQty);
          }
          if (candidate.id === id) thisReturnValue = candidateValue;
        }
        const alreadyReturnedOnCase = returnCases.find((candidate) => candidate.id === id)!.refunds.reduce((sum: number, refund: Row) => sum + Number(refund.amount), 0);
        if (amount > thisReturnValue - alreadyReturnedOnCase) throw new ConflictException(`Số tiền vượt giá trị hàng được trả còn lại của phiếu (${Math.max(0, thisReturnValue - alreadyReturnedOnCase)} ₫).`);

        const payments = await tx.payment.findMany({
          where: { orderId: returnCase.orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
          include: { refunds: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (!payments.length) throw new BadRequestException("Đơn chưa có khoản thanh toán đã thu để hoàn tiền.");
        const remainingByPayment = payments.map((payment: Row) => ({
          payment,
          refunded: payment.refunds.reduce((sum: number, refund: Row) => sum + Number(refund.amount), 0),
          remaining: Math.max(0, Number(payment.amount) - payment.refunds.reduce((sum: number, refund: Row) => sum + Number(refund.amount), 0)),
        }));
        const remainingCaptured = remainingByPayment.reduce((sum, row) => sum + row.remaining, 0);
        if (amount > remainingCaptured) throw new ConflictException("Số tiền hoàn vượt tổng số tiền đã thu còn lại của đơn hàng.");
        const allocations: Array<{ paymentId: string; amount: number; before: number; after: number; total: number }> = [];
        let toAllocate = amount;
        for (const row of remainingByPayment) {
          if (!toAllocate) break;
          const allocated = Math.min(toAllocate, row.remaining);
          if (!allocated) continue;
          allocations.push({ paymentId: row.payment.id, amount: allocated, before: row.refunded, after: row.refunded + allocated, total: Number(row.payment.amount) });
          toAllocate -= allocated;
        }
        const created: Row[] = [];
        const childIdempotencyPrefix = `refund-${hash(idempotencyKey)}`;
        for (const [index, allocation] of allocations.entries()) {
          const refund = await tx.paymentRefund.create({ data: {
            returnId: id, paymentId: allocation.paymentId, idempotencyKey: `${childIdempotencyPrefix}-${index}`,
            requestKey: idempotencyKey, requestHash, externalReference, amount: allocation.amount, note, createdByAdminId: actor.id,
          } });
          created.push(refund);
          const status = allocation.after >= allocation.total ? "REFUNDED" : "PARTIALLY_REFUNDED";
          await tx.payment.update({ where: { id: allocation.paymentId }, data: { status: status as any } });
        }
        await this.loyalty.recordRefund(tx, returnCase.order, idempotencyKey, amount);
        const totalCaseRefunded = alreadyReturnedOnCase + amount;
        const returnRefundStatus = totalCaseRefunded >= thisReturnValue ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await tx.orderReturn.update({ where: { id }, data: { refundStatus: returnRefundStatus } });
        await tx.auditLog.create({ data: {
          adminId: actor.id, correlationId: actor.correlationId, action: "PAYMENT_REFUND_RECORDED", entityType: "ORDER_RETURN", entityId: id,
          before: { refundedAmount: alreadyReturnedOnCase, returnValue: thisReturnValue },
          after: { refundAmount: amount, refundedAmount: totalCaseRefunded, returnRefundStatus, externalReference, allocations, note },
        } });
        return { requestKey: idempotencyKey, amount, refunds: created, replayed: false };
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await findReplay(this.prisma);
        if (raced) return raced;
      }
      throw error;
    }
  }

  async recordPreShipmentRefund(orderId: string, actor: AdminIdentity, body: Row) {
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const amount = positiveInt(body.amount, "Số tiền hoàn");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const externalReference = typeof body.externalReference === "string" ? body.externalReference.trim() : "";
    const paymentIdInput = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho giao dịch hoàn tiền.");
    if (note.length < 5 || note.length > 1000) throw new BadRequestException("Ghi chú hoàn tiền cần từ 5 đến 1.000 ký tự.");
    if (externalReference.length < 4 || externalReference.length > 160) throw new BadRequestException("Cần mã giao dịch hoàn tiền thực tế từ cổng thanh toán hoặc ngân hàng.");
    const prior = await this.prisma.paymentRefund.findUnique({ where: { idempotencyKey }, include: { payment: { select: { orderId: true } } } });
    if (prior) {
      if (prior.returnId !== null || prior.payment.orderId !== orderId || (paymentIdInput && prior.paymentId !== paymentIdInput) || Number(prior.amount) !== amount || prior.note !== note || prior.externalReference !== externalReference) throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
      return prior;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
        if (!order) throw new NotFoundException("Không tìm thấy đơn hàng.");
        const cancelledBeforeHandoff = order.status === "CANCELLED" && Boolean(order.inventoryReleasedAt) && !order.inventoryCommittedAt;
        if (!["PENDING_CONFIRMATION", "PROCESSING"].includes(order.status) && !cancelledBeforeHandoff) throw new ConflictException("Chỉ hoàn trước bàn giao, hoặc hoàn khoản tiền đến muộn của đơn đã hủy trước xuất hàng.");
        if (order.inventoryCommittedAt || (["PENDING_CONFIRMATION", "PROCESSING"].includes(order.status) && order.inventoryReleasedAt)) throw new ConflictException("Đơn đã được xuất hoặc tồn kho đã xử lý theo luồng khác.");
        if (["IN_TRANSIT", "DELIVERED", "RETURNING"].includes(String(order.carrierShipmentStatus || ""))) throw new ConflictException("Vận đơn đã rời GEME; hãy xử lý theo quy trình trả hàng/hoàn hàng.");
        const candidates = order.payments.filter((payment: Row) => ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) && payment.method !== "COD");
        const payment = candidates.find((row: Row) => paymentIdInput ? row.id === paymentIdInput : true);
        if (!payment) throw new BadRequestException("Không tìm thấy khoản thanh toán đã thu hợp lệ để hoàn.");
        await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${payment.id}::uuid FOR UPDATE`;
        const replay = await tx.paymentRefund.findUnique({ where: { idempotencyKey } });
        if (replay) {
          if (replay.returnId !== null || replay.paymentId !== payment.id || Number(replay.amount) !== amount || replay.note !== note || replay.externalReference !== externalReference) throw new ConflictException("Idempotency-Key đã được dùng cho giao dịch hoàn tiền khác.");
          return replay;
        }
        const sum = await tx.paymentRefund.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
        const refundedBefore = Number(sum._sum.amount || 0);
        if (amount > Number(payment.amount) - refundedBefore) throw new ConflictException("Số tiền hoàn vượt phần tiền đã thu còn lại.");
        const created = await tx.paymentRefund.create({ data: { returnId: null, paymentId: payment.id, idempotencyKey, externalReference, amount, note, createdByAdminId: actor.id } });
        const refundedAfter = refundedBefore + amount;
        const status = refundedAfter >= Number(payment.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
        await tx.payment.update({ where: { id: payment.id }, data: { status: status as any } });
        await this.loyalty.recordRefund(tx, order, idempotencyKey, amount);
        await tx.auditLog.create({ data: {
          adminId: actor.id,
          correlationId: actor.correlationId,
          action: "PRE_SHIPMENT_PAYMENT_REFUND_RECORDED",
          entityType: "ORDER",
          entityId: orderId,
          before: { paymentId: payment.id, paymentStatus: payment.status, refundedAmount: refundedBefore },
          after: { paymentId: payment.id, paymentStatus: status, refundAmount: amount, refundedAmount: refundedAfter, externalReference, note },
        } });
        return created;
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await this.prisma.paymentRefund.findUnique({ where: { idempotencyKey }, include: { payment: { select: { orderId: true } } } });
        if (raced && raced.returnId === null && raced.payment.orderId === orderId && (!paymentIdInput || raced.paymentId === paymentIdInput) && Number(raced.amount) === amount && raced.note === note && raced.externalReference === externalReference) return raced;
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
    const entryByOrderId = new Map<string, { receivedAmount: number; carrierFee: number; remittedAmount: number; note: string | null }>();
    for (const value of rows) {
      const row = value && typeof value === "object" ? value as Row : {};
      const orderId = String(row.orderId || "").trim();
      if (!orderId || entryByOrderId.has(orderId)) throw new BadRequestException("Mã đơn COD bị thiếu hoặc trùng trong bảng kê.");
      entryByOrderId.set(orderId, {
        receivedAmount: positiveInt(row.receivedAmount, "Tiền COD khách đã trả", true),
        carrierFee: positiveInt(row.carrierFee ?? 0, "Phí vận chuyển", true),
        remittedAmount: positiveInt(row.remittedAmount, "Tiền hãng đã chuyển về", true),
        note: typeof row.note === "string" ? row.note.trim().slice(0, 1000) : null,
      });
    }
    const requestHash = hash({ externalReference, carrier, statementDate: statementDate.toISOString().slice(0, 10), entries: [...entryByOrderId].sort(([a], [b]) => a.localeCompare(b)) });
    const existing = await this.prisma.codReconciliationBatch.findUnique({ where: { externalReference }, include: { items: true } });
    if (existing) {
      if (existing.status === "REVERSED") throw new ConflictException("Mã bảng kê này đã được đảo. Dùng mã bảng kê mới cho dữ liệu điều chỉnh.");
      if (existing.requestHash !== requestHash) throw new ConflictException("Mã bảng kê đã được dùng cho dữ liệu COD khác.");
      return existing;
    }
    const orders = await this.prisma.order.findMany({ where: { id: { in: [...entryByOrderId.keys()] } }, include: { payments: true } });
    if (orders.length !== entryByOrderId.size) throw new BadRequestException("Có đơn hàng trong bảng kê không tồn tại.");
    const orderById = new Map(orders.map((order: Row) => [order.id, order]));
    let expectedTotal = 0;
    let receivedTotal = 0;
    let feeTotal = 0;
    let remittedTotal = 0;
    const entries = [...entryByOrderId].map(([orderId, data]) => {
      const order = orderById.get(orderId)!;
      const payment = order.payments.find((row: Row) => row.method === "COD");
      if (!payment) throw new BadRequestException(`Đơn ${order.code} không phải đơn COD.`);
      if (order.status !== "DELIVERED" && order.carrierShipmentStatus !== "DELIVERED") throw new BadRequestException(`Đơn ${order.code} chưa được xác nhận giao thành công.`);
      const expectedAmount = Number(order.carrierCodAmount ?? order.totalAmount);
      const varianceAmount = data.receivedAmount - expectedAmount;
      const expectedRemittedAmount = data.receivedAmount - data.carrierFee;
      if (expectedRemittedAmount < 0) throw new BadRequestException(`Phí của đơn ${order.code} vượt số tiền COD khách đã trả.`);
      const remittanceVariance = data.remittedAmount - expectedRemittedAmount;
      expectedTotal += expectedAmount;
      receivedTotal += data.receivedAmount;
      feeTotal += data.carrierFee;
      remittedTotal += data.remittedAmount;
      return {
        orderId, expectedAmount, receivedAmount: data.receivedAmount, carrierFee: data.carrierFee,
        varianceAmount, remittedAmount: data.remittedAmount, remittanceVariance,
        status: varianceAmount === 0 && remittanceVariance === 0 ? "MATCHED" : "VARIANCE", note: data.note,
      };
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock in stable order so competing statements for one parcel cannot both
        // pass the active-batch check after the historical unique index is removed.
        for (const orderId of [...entryByOrderId.keys()].sort()) {
          await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        }
        const activeItems = await tx.codReconciliationItem.findMany({
          where: { orderId: { in: [...entryByOrderId.keys()] }, batch: { is: { status: { not: "REVERSED" } } } },
          select: { order: { select: { code: true } } },
        });
        if (activeItems.length) throw new ConflictException(`Đơn ${activeItems[0].order.code} đã có bảng kê chưa được đảo.`);
        const batch = await tx.codReconciliationBatch.create({ data: {
          externalReference, carrier, statementDate, requestHash, expectedTotal, receivedTotal, feeTotal, remittedTotal, status: "OPEN", createdByAdminId: actor.id,
          items: { create: entries },
        }, include: { items: true } });
        await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "COD_RECONCILIATION_CREATED", entityType: "COD_RECONCILIATION", entityId: batch.id, after: { externalReference, carrier, expectedTotal, receivedTotal, feeTotal, remittedTotal, varianceLines: entries.filter((item) => item.status === "VARIANCE").length } } });
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
      const collectedOrderIds = batch.items.filter((item: Row) => Number(item.varianceAmount) === 0).map((item: Row) => item.orderId);
      if (collectedOrderIds.length) await tx.payment.updateMany({
        where: { orderId: { in: collectedOrderIds }, method: "COD", status: "PENDING" },
        data: { status: "PAID", paidAt: new Date() },
      });
      for (const orderId of collectedOrderIds) {
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: { select: { status: true, amount: true } } } });
        if (!order) continue;
        await this.loyalty.settleReservation(tx, orderId);
        await this.loyalty.awardIfDeliveredAndPaid(tx, order);
      }
      const saved = await tx.codReconciliationBatch.findUniqueOrThrow({ where: { id }, include: { items: true } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "COD_RECONCILIATION_CLOSED", entityType: "COD_RECONCILIATION", entityId: id, before: { status: "OPEN" }, after: { status: saved.status, decisionNote: note || null } } });
      return saved;
    });
    return updated;
  }

  async reverseCod(id: string, actor: AdminIdentity, body: Row) {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
    if (reason.length < 5) throw new BadRequestException("Nhập lý do đảo bảng kê tối thiểu 5 ký tự.");
    const prior = await this.prisma.codReconciliationBatch.findUnique({ where: { id }, include: { items: true } });
    if (!prior) throw new NotFoundException("Không tìm thấy bảng đối soát COD.");
    const reversed = await this.prisma.$transaction(async (tx) => {
      for (const orderId of prior.items.map((item: Row) => item.orderId).sort()) {
        await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "cod_reconciliation_batches" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.codReconciliationBatch.findUnique({ where: { id }, include: { items: true } });
      if (!current) throw new NotFoundException("Không tìm thấy bảng đối soát COD.");
      if (current.status === "REVERSED") return current;
      const result = await tx.codReconciliationBatch.updateMany({
        where: { id, status: current.status },
        data: { status: "REVERSED", decisionNote: reason, reconciledAt: current.reconciledAt || new Date() },
      });
      if (result.count !== 1) throw new ConflictException("Bảng kê vừa được thay đổi; tải lại rồi thử lại.");
      await tx.codReconciliationItem.updateMany({ where: { batchId: id }, data: { status: "REVERSED", note: reason } });
      const saved = await tx.codReconciliationBatch.findUniqueOrThrow({ where: { id }, include: { items: true } });
      await tx.auditLog.create({ data: {
        adminId: actor.id, correlationId: actor.correlationId, action: "COD_RECONCILIATION_REVERSED", entityType: "COD_RECONCILIATION", entityId: id,
        before: { status: current.status, externalReference: current.externalReference },
        after: { status: "REVERSED", reason, affectedOrders: current.items.length, note: "Payment states preserve evidence of customer collection; use a new statement reference for corrections." },
      } });
      return saved;
    });
    return reversed;
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
