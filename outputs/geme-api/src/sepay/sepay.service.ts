import { createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SePayBankAccountService } from "./sepay-bank-account.service.js";

type SePayPayload = {
  id?: string | number;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  subAccount?: string;
  code?: string | null;
  content?: string;
  description?: string;
  transferType?: string;
  transferAmount?: string | number;
  referenceCode?: string;
};

type WebhookAcceptance = "accepted" | "disabled" | "invalid-signature" | "invalid-request";

class NeedsReviewError extends Error {}

@Injectable()
export class SePayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SePayService.name);
  private workerTimer: NodeJS.Timeout | null = null;
  private workerRunning = false;

  constructor(private readonly prisma: PrismaService, private readonly commerce: CommerceService, private readonly sepayBankAccount: SePayBankAccountService) {}

  onModuleInit() {
    this.workerTimer = setInterval(() => void this.processQueue(), 2_000);
    this.workerTimer.unref();
    void this.processQueue();
  }

  onModuleDestroy() {
    if (this.workerTimer) clearInterval(this.workerTimer);
  }

  async acceptWebhook(rawBody: Buffer | undefined, body: unknown, signatureHeader: string | undefined, timestampHeader: string | undefined): Promise<WebhookAcceptance> {
    const secret = process.env.SEPAY_WEBHOOK_SECRET?.trim() ?? "";
    if (process.env.SEPAY_WEBHOOK_ENABLED !== "true" || Buffer.byteLength(secret, "utf8") < 32) return "disabled";
    if (!rawBody?.length || !this.verifySignature(rawBody, secret, signatureHeader, timestampHeader)) return "invalid-signature";

    if (!body || typeof body !== "object" || Array.isArray(body)) return "invalid-request";
    const payload = body as SePayPayload;
    const transactionId = String(payload.id ?? "").trim();
    const amount = Number(payload.transferAmount);
    const transferType = String(payload.transferType ?? "").trim().toLowerCase();
    if (!transactionId || transactionId.length > 80 || !Number.isSafeInteger(amount) || amount < 0 || !["in", "out"].includes(transferType)) return "invalid-request";

    const transactionText = String(payload.transactionDate ?? "").trim();
    const vietnamLocalDate = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(transactionText);
    const transactionDate = vietnamLocalDate
      ? new Date(`${vietnamLocalDate[1]}T${vietnamLocalDate[2]}+07:00`)
      : transactionText ? new Date(transactionText) : null;
    const safeDate = transactionDate && Number.isFinite(transactionDate.getTime()) ? transactionDate : null;
    const data = {
      transactionId,
      gateway: this.nullableString(payload.gateway, 80),
      accountNumber: this.nullableString(payload.accountNumber, 40),
      subAccount: this.nullableString(payload.subAccount, 80),
      paymentCode: this.nullableString(payload.code, 120),
      transferType,
      amount: new Prisma.Decimal(String(amount)),
      transactionDate: safeDate,
      referenceCode: this.nullableString(payload.referenceCode, 160),
      content: this.nullableString(payload.content ?? payload.description, 4000),
      rawPayload: body as Prisma.InputJsonValue,
      status: "RECEIVED",
    };

    try {
      await this.prisma.sePayWebhookEvent.create({ data });
    } catch (error: any) {
      if (error?.code === "P2002") return "accepted";
      throw error;
    }
    return "accepted";
  }

  private verifySignature(rawBody: Buffer, secret: string, signatureHeader?: string, timestampHeader?: string) {
    const timestampText = String(timestampHeader ?? "").trim();
    const signature = /^sha256=([a-f0-9]{64})$/i.exec(String(signatureHeader ?? "").trim())?.[1];
    const timestamp = Number(timestampText);
    if (!signature || !Number.isSafeInteger(timestamp)) return false;
    const timestampMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    if (Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
    const expected = createHmac("sha256", secret).update(`${timestampText}.`).update(rawBody).digest();
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private nullableString(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  private async processQueue() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      const now = new Date();
      await this.prisma.sePayWebhookEvent.updateMany({
        where: { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
        data: { status: "RETRYING", nextAttemptAt: now },
      });
      const due = await this.prisma.sePayWebhookEvent.findMany({
        where: { status: { in: ["RECEIVED", "RETRYING"] }, nextAttemptAt: { lte: now } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 20,
      });
      for (const event of due) {
        const claim = await this.prisma.sePayWebhookEvent.updateMany({
          where: { id: event.id, status: event.status },
          data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
        });
        if (claim.count !== 1) continue;
        await this.processEvent(event.id);
      }
    } catch (error) {
      this.logger.error("Không thể xử lý hàng đợi webhook SePay.", error instanceof Error ? error.stack : undefined);
    } finally {
      this.workerRunning = false;
    }
  }

  private async processEvent(id: string) {
    const event = await this.prisma.sePayWebhookEvent.findUnique({ where: { id } });
    if (!event) return;
    try {
      const idempotencyKey = `SEPAY_WEBHOOK_EVENT:${event.transactionId}`;
      const priorPayment = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
      if (priorPayment) {
        if (priorPayment.method !== "BANK_TRANSFER" || priorPayment.providerRef !== `SEPAY:${event.transactionId}` || Number(priorPayment.amount) !== Number(event.amount)) {
          throw new NeedsReviewError("Mã giao dịch SePay đã được sử dụng cho khoản thu khác.");
        }
        await this.prisma.sePayWebhookEvent.update({
          where: { id },
          data: { status: "APPLIED", orderId: priorPayment.orderId, processedAt: new Date(), lastError: null },
        });
        return;
      }

      if (event.transferType !== "in") {
        await this.prisma.sePayWebhookEvent.update({ where: { id }, data: { status: "IGNORED", processedAt: new Date() } });
        return;
      }

      const linkedAccount = await this.sepayBankAccount.getSingleActiveAccount();
      const allowedAccounts = this.sepayBankAccount.isApiConfigured()
        ? linkedAccount ? [linkedAccount.accountNumber.replace(/\D/g, "")] : []
        : (process.env.SEPAY_ACCOUNT_NUMBERS ?? "").split(",").map((account) => account.replace(/\D/g, "")).filter(Boolean);
      const receivedAccount = String(event.accountNumber ?? "").replace(/\D/g, "");
      if (!allowedAccounts.length) throw new NeedsReviewError(this.sepayBankAccount.isApiConfigured()
        ? "SePay chưa có đúng một tài khoản nhận đang hoạt động; giao dịch chưa được tự xác nhận."
        : "Chưa cấu hình API token SePay hoặc SEPAY_ACCOUNT_NUMBERS chuyển tiếp; giao dịch chưa được tự xác nhận.");
      if (!receivedAccount || !allowedAccounts.includes(receivedAccount)) throw new NeedsReviewError("Tài khoản nhận không nằm trong danh sách tài khoản GEME cho phép.");

      const candidate = this.extractOrderReference(event.paymentCode, event.content);
      if (!candidate) throw new NeedsReviewError("Không tìm thấy mã thanh toán GEME trong nội dung chuyển khoản.");
      const matches = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM orders
        WHERE regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = ${candidate}
        LIMIT 2
      `;
      if (matches.length !== 1) throw new NeedsReviewError(matches.length ? "Mã thanh toán khớp nhiều đơn hàng; cần kiểm tra thủ công." : "Không tìm thấy đơn hàng khớp mã thanh toán.");

      const order = await this.prisma.order.findUnique({
        where: { id: matches[0].id },
        include: { payments: { include: { refunds: true }, orderBy: { createdAt: "asc" } } },
      });
      if (!order) throw new NeedsReviewError("Đơn hàng không còn tồn tại.");
      await this.prisma.sePayWebhookEvent.update({ where: { id }, data: { orderId: order.id } });
      if (order.status !== "PENDING_PAYMENT") throw new NeedsReviewError(`Đơn ${order.code} không còn ở trạng thái chờ thanh toán (${order.status}).`);
      if (!order.payments.some((payment) => payment.method === "BANK_TRANSFER")) throw new NeedsReviewError("Đơn hàng không được tạo bằng chuyển khoản ngân hàng.");
      if (order.payments.some((payment) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status))) throw new NeedsReviewError("Đơn đã có giao dịch thanh toán được ghi nhận.");
      const minuteBoundaryStartSkew = this.isMinuteBoundaryStartSkewWithinQrWindow(event, order);
      if (order.qrPaymentExpiresAt && (!event.transactionDate || !order.qrPaymentStartedAt || event.transactionDate < order.qrPaymentStartedAt || event.transactionDate > order.qrPaymentExpiresAt)
        && !minuteBoundaryStartSkew) {
        throw new NeedsReviewError(`Giao dịch ${event.transactionId} nằm ngoài thời hạn thanh toán QR 15 phút của đơn ${order.code}; cần kiểm tra thủ công.`);
      }

      const expectedAmount = Number(order.totalAmount);
      const receivedAmount = Number(event.amount);
      if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || receivedAmount !== expectedAmount) {
        throw new NeedsReviewError(`Số tiền nhận ${receivedAmount.toLocaleString("vi-VN")} ₫ không bằng tổng đơn ${expectedAmount.toLocaleString("vi-VN")} ₫; cần đối soát thủ công.`);
      }

      await this.commerce.recordOrderPayment(order.id, { id: null }, {
        amount: receivedAmount,
        method: "BANK_TRANSFER",
        providerRef: `SEPAY:${event.transactionId}`,
        note: `SePay xác nhận đã nhận đủ ${receivedAmount.toLocaleString("vi-VN")} ₫ cho đơn ${order.code}.`,
        idempotencyKey,
      }, idempotencyKey, "SEPAY", minuteBoundaryStartSkew ? event.createdAt : event.transactionDate);

      await this.prisma.sePayWebhookEvent.update({
        where: { id },
        data: { status: "APPLIED", orderId: order.id, processedAt: new Date(), lastError: null },
      });
      this.logger.log(`SePay đã đối soát đủ tiền cho đơn ${order.code} (giao dịch ${event.transactionId}).`);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định khi xử lý giao dịch SePay.";
      const needsReview = error instanceof NeedsReviewError || error instanceof BadRequestException || error instanceof ConflictException || (error instanceof HttpException && error.getStatus() < 500);
      const attempts = event.attempts;
      const exhausted = attempts >= 10;
      const status = needsReview || exhausted ? "REVIEW" : "RETRYING";
      const delayMs = Math.min(30 * 60_000, 2_000 * 2 ** Math.min(attempts, 10));
      await this.prisma.$transaction(async (tx) => {
        await tx.sePayWebhookEvent.update({
          where: { id },
          data: {
            status,
            nextAttemptAt: status === "RETRYING" ? new Date(Date.now() + delayMs) : new Date(),
            lastError: message.slice(0, 1000),
            ...(status === "REVIEW" ? { processedAt: new Date() } : {}),
          },
        });
        if (status === "REVIEW") {
          const existing = await tx.adminNotification.findFirst({
            where: { type: "PAYMENT_REVIEW_REQUIRED", entityType: "SEPAY_WEBHOOK", entityId: id },
            select: { id: true },
          });
          if (!existing) await tx.adminNotification.create({ data: {
            type: "PAYMENT_REVIEW_REQUIRED",
            title: "Chuyển khoản SePay cần kiểm tra",
            message: `Giao dịch ${event.transactionId} (${Number(event.amount).toLocaleString("vi-VN")} ₫${event.gateway ? `, ${event.gateway}` : ""}): ${message}`,
            entityType: "SEPAY_WEBHOOK",
            entityId: id,
          } });
        }
      });
      if (status === "REVIEW") this.logger.warn(`SePay cần kiểm tra thủ công cho giao dịch ${event.transactionId}: ${message}`);
      else this.logger.error(`SePay gặp lỗi tạm thời ở giao dịch ${event.transactionId}; sẽ tự thử lại.`, error instanceof Error ? error.stack : undefined);
    }
  }

  private extractOrderReference(paymentCode: string | null, content: string | null) {
    const normalizedCode = String(paymentCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalizedCode.startsWith("GEME") && normalizedCode.length > 4) return normalizedCode.slice(4);
    const match = /(?:^|[^A-Z0-9])GEME\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,45})/i.exec(String(content ?? ""));
    return match?.[1]?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  }

  private isMinuteBoundaryStartSkewWithinQrWindow(event: { transactionDate: Date | null; createdAt: Date }, order: { qrPaymentStartedAt: Date | null; qrPaymentExpiresAt: Date | null }) {
    const transactionAt = event.transactionDate;
    const startedAt = order.qrPaymentStartedAt;
    const expiresAt = order.qrPaymentExpiresAt;
    if (!transactionAt || !startedAt || !expiresAt) return false;

    const transactionMs = transactionAt.getTime();
    const startedMs = startedAt.getTime();
    const receivedMs = event.createdAt.getTime();
    const minuteBoundaryTimestamp = transactionAt.getUTCSeconds() === 0 && transactionAt.getUTCMilliseconds() === 0;

    // SePay can report a minute-boundary timestamp just before QR creation; trust it only when
    // the matching webhook itself arrived inside this order's actual 15-minute payment window.
    return minuteBoundaryTimestamp
      && transactionMs < startedMs
      && startedMs - transactionMs < 60_000
      && receivedMs >= startedMs
      && receivedMs <= expiresAt.getTime();
  }
}
