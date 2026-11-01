import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

export type LoyaltyProgramSettings = {
  enabled: boolean;
  enabledAt: string | null;
  spendPerPoint: number;
  pointsPerSpend: number;
  pointValueVnd: number;
  minimumRedeemPoints: number;
  maximumRedeemPercent: number;
};

export const DEFAULT_LOYALTY_SETTINGS: LoyaltyProgramSettings = {
  enabled: false,
  enabledAt: null,
  spendPerPoint: 10_000,
  pointsPerSpend: 1,
  pointValueVnd: 100,
  minimumRedeemPoints: 500,
  maximumRedeemPercent: 20,
};

function asSettings(value: unknown): LoyaltyProgramSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (key: keyof LoyaltyProgramSettings, fallback: number) => {
    const candidate = Number(raw[key]);
    return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
  };
  const percent = Number(raw.maximumRedeemPercent);
  const enabledAt = typeof raw.enabledAt === "string" && Number.isFinite(Date.parse(raw.enabledAt))
    ? new Date(raw.enabledAt).toISOString()
    : null;
  return {
    enabled: raw.enabled === true,
    enabledAt,
    spendPerPoint: number("spendPerPoint", DEFAULT_LOYALTY_SETTINGS.spendPerPoint),
    pointsPerSpend: number("pointsPerSpend", DEFAULT_LOYALTY_SETTINGS.pointsPerSpend),
    pointValueVnd: number("pointValueVnd", DEFAULT_LOYALTY_SETTINGS.pointValueVnd),
    minimumRedeemPoints: number("minimumRedeemPoints", DEFAULT_LOYALTY_SETTINGS.minimumRedeemPoints),
    maximumRedeemPercent: Number.isFinite(percent) && percent >= 1 && percent <= 100 ? percent : DEFAULT_LOYALTY_SETTINGS.maximumRedeemPercent,
  };
}

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(client: any = this.prisma): Promise<LoyaltyProgramSettings> {
    const stored = await client.siteSetting.findUnique({ where: { key: "loyalty.program" }, select: { value: true } });
    return asSettings(stored?.value);
  }

  async saveSettings(input: Record<string, unknown>, actor: { id: string; correlationId?: string }) {
    const before = await this.settings();
    const next = asSettings({ ...before, ...input, enabledAt: before.enabledAt });
    if (input.enabled === true && !before.enabled) next.enabledAt = new Date().toISOString();
    if (input.enabled === false) next.enabledAt = null;
    if (input.spendPerPoint !== undefined && (!Number.isSafeInteger(Number(input.spendPerPoint)) || Number(input.spendPerPoint) < 1 || Number(input.spendPerPoint) > 100_000_000)) throw new BadRequestException("Chi tiêu để nhận điểm phải từ 1 đến 100.000.000 ₫.");
    if (input.pointsPerSpend !== undefined && (!Number.isSafeInteger(Number(input.pointsPerSpend)) || Number(input.pointsPerSpend) < 1 || Number(input.pointsPerSpend) > 1_000_000)) throw new BadRequestException("Số điểm nhận mỗi mốc không hợp lệ.");
    if (input.pointValueVnd !== undefined && (!Number.isSafeInteger(Number(input.pointValueVnd)) || Number(input.pointValueVnd) < 1 || Number(input.pointValueVnd) > 10_000_000)) throw new BadRequestException("Giá trị quy đổi điểm không hợp lệ.");
    if (input.minimumRedeemPoints !== undefined && (!Number.isSafeInteger(Number(input.minimumRedeemPoints)) || Number(input.minimumRedeemPoints) < 1 || Number(input.minimumRedeemPoints) > 1_000_000_000)) throw new BadRequestException("Điểm tối thiểu đổi quà không hợp lệ.");
    if (input.maximumRedeemPercent !== undefined && (!Number.isFinite(Number(input.maximumRedeemPercent)) || Number(input.maximumRedeemPercent) < 1 || Number(input.maximumRedeemPercent) > 100)) throw new BadRequestException("Tỷ lệ đổi điểm tối đa phải từ 1% đến 100%.");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new BadRequestException("Trạng thái chương trình phải là true hoặc false.");
    await this.prisma.$transaction(async (tx) => {
      await tx.siteSetting.upsert({ where: { key: "loyalty.program" }, create: { key: "loyalty.program", value: next as any }, update: { value: next as any } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId: actor.correlationId,
        action: "LOYALTY_PROGRAM_UPDATED",
        entityType: "LOYALTY_PROGRAM",
        entityId: "loyalty.program",
        before: before as any,
        after: next as any,
      } });
    });
    return next;
  }

  async balance(customerId: string, client: any = this.prisma) {
    const aggregate = await client.loyaltyPointTransaction.aggregate({
      where: { customerId, status: { in: ["POSTED", "RESERVED"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      _sum: { points: true },
    });
    return Math.max(0, Number(aggregate._sum.points) || 0);
  }

  async preview(client: any, customerId: string | null | undefined, eligibleSubtotal: number, requestedPoints: unknown) {
    const settings = await this.settings(client);
    const availablePoints = settings.enabled && customerId ? await this.balance(customerId, client) : 0;
    const maxBySubtotal = settings.enabled
      ? Math.floor(Math.max(0, eligibleSubtotal) * settings.maximumRedeemPercent / 100 / settings.pointValueVnd)
      : 0;
    const maxRedeemablePoints = Math.min(availablePoints, maxBySubtotal);
    const points = requestedPoints == null || requestedPoints === "" ? 0 : Number(requestedPoints);
    if (!Number.isSafeInteger(points) || points < 0) throw new BadRequestException("Số điểm dùng để thanh toán không hợp lệ.");
    if (points > 0) {
      if (!customerId) throw new BadRequestException("Đăng nhập để sử dụng điểm thưởng.");
      if (!settings.enabled) throw new BadRequestException("Chương trình điểm thưởng đang tạm dừng.");
      if (points < settings.minimumRedeemPoints) throw new BadRequestException(`Cần dùng tối thiểu ${settings.minimumRedeemPoints.toLocaleString("vi-VN")} điểm.`);
      if (points > maxRedeemablePoints) throw new ConflictException(`Số điểm tối đa có thể dùng cho giỏ này là ${maxRedeemablePoints.toLocaleString("vi-VN")} điểm.`);
    }
    return {
      enabled: settings.enabled,
      availablePoints,
      pointsToRedeem: points,
      discountAmount: points * settings.pointValueVnd,
      pointValueVnd: settings.pointValueVnd,
      minimumRedeemPoints: settings.minimumRedeemPoints,
      maximumRedeemPercent: settings.maximumRedeemPercent,
      maxRedeemablePoints,
    };
  }

  async reserve(tx: any, customerId: string | null, orderId: string, points: number, amountVnd: number) {
    if (!points) return;
    if (!customerId) throw new BadRequestException("Đăng nhập để dùng điểm thưởng.");
    await tx.loyaltyPointTransaction.create({ data: {
      customerId, orderId, points: -points, amountVnd, status: "RESERVED", type: "REDEEM_RESERVED",
      idempotencyKey: `LOYALTY:REDEEM:${orderId}`,
      note: "Điểm được giữ chỗ cho đơn; sẽ trừ khi thanh toán đủ.",
    } });
  }

  async settleReservation(tx: any, orderId: string) {
    await tx.loyaltyPointTransaction.updateMany({ where: { orderId, type: "REDEEM_RESERVED", status: "RESERVED" }, data: { status: "POSTED", note: "Điểm đã sử dụng cho đơn thanh toán thành công." } });
  }

  async releaseReservation(tx: any, orderId: string) {
    await tx.loyaltyPointTransaction.updateMany({ where: { orderId, type: "REDEEM_RESERVED", status: "RESERVED" }, data: { status: "VOID", note: "Đơn bị hủy; điểm giữ chỗ đã được trả lại." } });
  }

  async awardIfDeliveredAndPaid(tx: any, order: any) {
    if (!order || order.status !== "DELIVERED" || !order.customerId) return 0;
    const payments = await tx.payment.findMany({
      where: { orderId: order.id },
      select: { status: true, amount: true, refunds: { select: { amount: true } } },
    });
    const captured = payments
      .filter((payment: any) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status))
      .reduce((sum: number, payment: any) => {
        const refunded = payment.refunds.reduce((refundSum: number, refund: any) => refundSum + Number(refund.amount), 0);
        return sum + Math.max(0, Number(payment.amount) - refunded);
      }, 0);
    if (captured < Number(order.totalAmount)) return 0;
    const existing = await tx.loyaltyPointTransaction.findUnique({ where: { idempotencyKey: `LOYALTY:EARN:${order.id}` }, select: { id: true } });
    if (existing) return 0;
    const settings = await this.settings(tx);
    if (!settings.enabled || !settings.enabledAt) return 0;
    const placedAt = new Date(order.placedAt ?? order.createdAt ?? NaN);
    if (!Number.isFinite(placedAt.getTime()) || placedAt < new Date(settings.enabledAt)) return 0;
    const eligibleAmount = Math.max(0, Number(order.subtotal) - Number(order.discountAmount) - Number(order.loyaltyDiscountAmount || 0));
    const points = Math.floor(eligibleAmount / settings.spendPerPoint) * settings.pointsPerSpend;
    if (points <= 0) return 0;
    await tx.loyaltyPointTransaction.create({ data: {
      customerId: order.customerId, orderId: order.id, points, amountVnd: eligibleAmount,
      status: "POSTED", type: "ORDER_EARNED", idempotencyKey: `LOYALTY:EARN:${order.id}`,
      note: `Tích điểm sau khi giao và thanh toán đủ đơn ${order.code}.`,
    } });
    return points;
  }

  async recordRefund(tx: any, order: any, refundId: string, amount: number) {
    if (!order?.customerId || !order.id || !refundId || amount <= 0) return;
    const redeemed = Number(order.loyaltyPointsRedeemed) || 0;
    const cashGoodsValue = Math.max(1, Number(order.subtotal) - Number(order.discountAmount) - Number(order.loyaltyDiscountAmount || 0));
    const earned = await tx.loyaltyPointTransaction.findUnique({ where: { idempotencyKey: `LOYALTY:EARN:${order.id}` }, select: { points: true } });
    const key = `LOYALTY:REFUND:${refundId}`;
    const existing = await tx.loyaltyPointTransaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (existing) return;

    // Calculate each adjustment against cumulative refunded value so several
    // small refunds cannot lose points to repeated floor rounding.
    const previousRefunds = await tx.loyaltyPointTransaction.findMany({
      where: { orderId: order.id, type: "ORDER_REFUND_ADJUSTMENT", status: "POSTED" },
      select: { points: true, amountVnd: true },
    });
    const refundedBefore = previousRefunds.reduce((sum: number, row: any) => sum + Number(row.amountVnd || 0), 0);
    const previousAdjustmentPoints = previousRefunds.reduce((sum: number, row: any) => sum + Number(row.points || 0), 0);
    const refundedAfter = Math.min(Math.max(0, Number(order.totalAmount)), refundedBefore + amount);
    const targetRedeemedPoints = redeemed
      ? Math.min(redeemed, Math.floor(redeemed * refundedAfter / Math.max(1, Number(order.totalAmount))))
      : 0;
    const targetEarnedReversal = earned
      ? Math.min(earned.points, Math.floor(earned.points * refundedAfter / cashGoodsValue))
      : 0;
    const targetAdjustmentPoints = targetRedeemedPoints - targetEarnedReversal;
    const points = targetAdjustmentPoints - previousAdjustmentPoints;
    await tx.loyaltyPointTransaction.create({ data: {
      customerId: order.customerId, orderId: order.id, points, amountVnd: amount,
      status: "POSTED", type: "ORDER_REFUND_ADJUSTMENT", idempotencyKey: key,
      note: `Điều chỉnh lũy kế ${targetRedeemedPoints} điểm đã dùng và ${targetEarnedReversal} điểm đã tích theo khoản hoàn tiền.`,
    } });
  }

  async customerSummary(customerId: string) {
    const [availablePoints, settings, ledger] = await Promise.all([
      this.balance(customerId), this.settings(),
      this.prisma.loyaltyPointTransaction.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { availablePoints, settings: { enabled: settings.enabled, pointValueVnd: settings.pointValueVnd, minimumRedeemPoints: settings.minimumRedeemPoints, maximumRedeemPercent: settings.maximumRedeemPercent }, ledger };
  }

  async adminOverview(limitInput?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 100, 1), 300);
    const [settings, ledger, customers] = await Promise.all([
      this.settings(),
      this.prisma.loyaltyPointTransaction.findMany({ take, orderBy: { createdAt: "desc" }, include: { customer: { select: { id: true, name: true, email: true, phone: true } } } }),
      this.prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true, name: true, email: true, phone: true, createdAt: true } }),
    ]);
    const grouped = customers.length ? await this.prisma.loyaltyPointTransaction.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customers.map((customer: any) => customer.id) }, status: { in: ["POSTED", "RESERVED"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      _sum: { points: true },
    }) : [];
    const balanceByCustomer = new Map(grouped.map((row: any) => [row.customerId, Math.max(0, Number(row._sum.points) || 0)]));
    return { settings, customers: customers.map((customer: any) => ({ ...customer, points: balanceByCustomer.get(customer.id) || 0 })), ledger };
  }

  async adjustCustomer(customerId: string, pointsInput: unknown, noteInput: unknown, actor: { id: string; correlationId?: string }) {
    const points = Number(pointsInput);
    const note = typeof noteInput === "string" ? noteInput.trim() : "";
    if (!Number.isSafeInteger(points) || points === 0 || Math.abs(points) > 1_000_000_000) throw new BadRequestException("Điều chỉnh phải là số điểm nguyên khác 0, tối đa 1 tỷ.");
    if (note.length < 5 || note.length > 500) throw new BadRequestException("Lý do điều chỉnh cần từ 5 đến 500 ký tự.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId}::uuid FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } });
      if (!customer) throw new NotFoundException("Không tìm thấy khách hàng.");
      const beforeBalance = await this.balance(customerId, tx);
      if (points < 0 && Math.abs(points) > beforeBalance) {
        throw new BadRequestException(`Khách hiện chỉ có ${beforeBalance.toLocaleString("vi-VN")} điểm khả dụng để trừ.`);
      }
      const row = await tx.loyaltyPointTransaction.create({ data: {
        customerId, points, type: "ADMIN_ADJUSTMENT", status: "POSTED",
        idempotencyKey: `LOYALTY:ADMIN:${randomUUID()}`,
        note,
      } });
      await tx.auditLog.create({ data: {
        adminId: actor.id, correlationId: actor.correlationId, action: "LOYALTY_POINTS_ADJUSTED",
        entityType: "CUSTOMER", entityId: customerId,
        before: { points: beforeBalance },
        after: { points: await this.balance(customerId, tx), adjustment: points, note },
      } });
      return { transaction: row, customer, availablePoints: await this.balance(customerId, tx) };
    });
  }
}
