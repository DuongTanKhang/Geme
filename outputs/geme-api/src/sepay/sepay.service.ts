import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import { Prisma } from "../generated/prisma/client.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { redisConnectionOptions } from "../queue/redis-connection.js";
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

export type SePayApiTransaction = {
  id?: unknown;
  transaction_date?: unknown;
  account_number?: unknown;
  va?: unknown;
  transfer_type?: unknown;
  amount_in?: unknown;
  amount_out?: unknown;
  transaction_content?: unknown;
  reference_number?: unknown;
  code?: unknown;
  bank_brand_name?: unknown;
};

const nullableSePayString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

function parseSePayTransactionDate(value: unknown) {
  const transactionText = String(value ?? "").trim();
  const vietnamLocalDate = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(transactionText);
  const parsed = vietnamLocalDate
    ? new Date(`${vietnamLocalDate[1]}T${vietnamLocalDate[2]}+07:00`)
    : transactionText ? new Date(transactionText) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function mapSePayApiTransaction(row: SePayApiTransaction) {
  const transactionId = String(row.id ?? "").trim();
  const transferType = String(row.transfer_type ?? "").trim().toLowerCase();
  const amountValue = transferType === "in" ? row.amount_in : row.amount_out;
  const amount = Number(amountValue);
  if (!transactionId || transactionId.length > 80 || !Number.isSafeInteger(amount) || amount < 0 || !["in", "out"].includes(transferType)) return null;
  return {
    transactionId,
    gateway: nullableSePayString(row.bank_brand_name, 80),
    accountNumber: nullableSePayString(row.account_number, 40),
    subAccount: nullableSePayString(row.va, 80),
    paymentCode: nullableSePayString(row.code, 120),
    transferType,
    amount: new Prisma.Decimal(String(amount)),
    transactionDate: parseSePayTransactionDate(row.transaction_date),
    referenceCode: nullableSePayString(row.reference_number, 160),
    content: nullableSePayString(row.transaction_content, 4000),
    rawPayload: row as Prisma.InputJsonValue,
    status: "RECEIVED",
  };
}

type WebhookAcceptance = "accepted" | "disabled" | "invalid-signature" | "invalid-request";

type SePayReconciliationScan = {
  sinceId: string | null;
  from: string | null;
  page: number;
  latestId: string | null;
};

export function buildSePayReconciliationUrl(
  endpoint: URL,
  accountId: string,
  scan: Pick<SePayReconciliationScan, "sinceId" | "from" | "page">,
) {
  const url = new URL(endpoint);
  url.searchParams.set("bank_account_id", accountId);
  url.searchParams.set("transfer_type", "in");
  url.searchParams.set("transaction_date_sort", "asc");
  url.searchParams.set("timestamp_format", "iso8601");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(scan.page));
  if (scan.sinceId) url.searchParams.set("since_id", scan.sinceId);
  else if (scan.from) url.searchParams.set("transaction_date_from", scan.from);
  return url;
}

class NeedsReviewError extends Error {}

@Injectable()
export class SePayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SePayService.name);
  private readonly redis = new Redis({ ...redisConnectionOptions(), maxRetriesPerRequest: 1, lazyConnect: true });
  private workerTimer: NodeJS.Timeout | null = null;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private workerRunning = false;
  private reconciliationRunning = false;

  constructor(private readonly prisma: PrismaService, private readonly commerce: CommerceService, private readonly sepayBankAccount: SePayBankAccountService) {}

  onModuleInit() {
    this.workerTimer = setInterval(() => void this.processQueue(), 2_000);
    this.workerTimer.unref();
    this.reconciliationTimer = setInterval(() => void this.reconcileTransactions(), 5 * 60_000);
    this.reconciliationTimer.unref();
    void this.processQueue();
    void this.reconcileTransactions();
  }

  onModuleDestroy() {
    if (this.workerTimer) clearInterval(this.workerTimer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    void this.redis.quit().catch(() => undefined);
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
    return nullableSePayString(value, maxLength);
  }

  /**
   * Recover incoming transfers whose SePay webhook was not delivered. The API
   * response is authenticated with the server-only SePay token and each
   * transaction is inserted into the same idempotent queue as a webhook.
   */
  private async reconcileTransactions() {
    const token = process.env.SEPAY_API_TOKEN?.trim();
    if (process.env.SEPAY_WEBHOOK_ENABLED !== "true" || !token || this.reconciliationRunning) return;
    this.reconciliationRunning = true;
    const lockToken = randomUUID();
    let lockKey: string | null = null;
    try {
      const account = await this.sepayBankAccount.getSingleActiveAccount();
      if (!account) return;
      lockKey = `geme:sepay:reconcile:${account.id}:lock`;
      const locked = await this.redis.set(lockKey, lockToken, "PX", 180_000, "NX");
      if (locked !== "OK") return;

      const baseUrl = (process.env.SEPAY_API_BASE_URL?.trim() || "https://userapi.sepay.vn/v2").replace(/\/+$/, "");
      const endpoint = new URL(`${baseUrl}/transactions`);
      if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
        throw new Error("SePay API phải sử dụng HTTPS.");
      }
      const cursorKey = `geme:sepay:reconcile:${account.id}:cursor`;
      const scanKey = `geme:sepay:reconcile:${account.id}:scan`;
      const cursor = await this.redis.get(cursorKey);
      let scan: SePayReconciliationScan;
      const savedScan = await this.redis.get(scanKey);
      if (savedScan) {
        try {
          const parsed = JSON.parse(savedScan) as Partial<SePayReconciliationScan>;
          if (!Number.isSafeInteger(parsed.page) || Number(parsed.page) < 1) throw new Error("Trang đối soát không hợp lệ.");
          scan = {
            sinceId: typeof parsed.sinceId === "string" ? parsed.sinceId : null,
            from: typeof parsed.from === "string" ? parsed.from : null,
            page: Number(parsed.page),
            latestId: typeof parsed.latestId === "string" ? parsed.latestId : null,
          };
        } catch {
          // Restart a corrupt/incompatible scan from the last committed cursor.
          scan = {
            sinceId: cursor,
            from: cursor ? null : this.formatSePayLocalDate(new Date(Date.now() - 7 * 86_400_000)),
            page: 1,
            latestId: null,
          };
          await this.redis.set(scanKey, JSON.stringify(scan));
        }
      } else {
        scan = {
          sinceId: cursor,
          from: cursor ? null : this.formatSePayLocalDate(new Date(Date.now() - 7 * 86_400_000)),
          page: 1,
          latestId: null,
        };
        await this.redis.set(scanKey, JSON.stringify(scan));
      }
      let imported = 0;
      let pages = 0;
      let scanComplete = false;

      // Keep the same since_id/date window while paging. SePay documents that
      // since_id filters the result set but does not change its pagination; the
      // cursor must advance only after every page in the scan has been read.
      // Persist the page so a backlog larger than 1,000 rows resumes next pass.
      for (let requestIndex = 0; requestIndex < 10; requestIndex++) {
        const url = buildSePayReconciliationUrl(endpoint, account.id, scan);

        const response = await fetch(url, {
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) throw new Error(`SePay transaction API trả HTTP ${response.status}.`);
        const payload = await response.json() as {
          status?: unknown;
          data?: unknown;
          meta?: { pagination?: { has_more?: unknown } };
        };
        if (payload.status !== "success" || !Array.isArray(payload.data)) {
          throw new Error("SePay transaction API trả dữ liệu không hợp lệ.");
        }
        const sourceRows = payload.data as SePayApiTransaction[];
        if (!sourceRows.length) {
          scanComplete = true;
          break;
        }

        const rows = sourceRows.map(mapSePayApiTransaction).filter((row): row is NonNullable<typeof row> => Boolean(row));
        if (rows.length !== sourceRows.length) throw new Error("SePay trả giao dịch thiếu mã hoặc số tiền hợp lệ; giữ cursor để thử lại sau.");
        if (rows.length) {
          const latestId = rows[rows.length - 1].transactionId;
          if (scan.page > 1 && latestId === scan.latestId) {
            throw new Error("SePay không tiến trang đối soát; giữ cursor để thử lại sau.");
          }
          const result = await this.prisma.sePayWebhookEvent.createMany({ data: rows, skipDuplicates: true });
          imported += result.count;
          scan.latestId = latestId;
        }
        pages += 1;
        const hasMore = payload.meta?.pagination?.has_more;
        scanComplete = typeof hasMore === "boolean" ? !hasMore : sourceRows.length < 100;
        if (scanComplete) break;
        scan.page += 1;
        await this.redis.set(scanKey, JSON.stringify(scan));
        // Respect SePay API's documented limit of three requests per second.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      if (scanComplete) {
        const commit = this.redis.multi();
        if (scan.latestId) commit.set(cursorKey, scan.latestId);
        commit.del(scanKey);
        await commit.exec();
      }

      if (pages) this.logger.log(`SePay API đối soát ${pages} trang giao dịch; thêm ${imported} giao dịch mới vào hàng đợi.`);
      if (imported) void this.processQueue();
    } catch (error) {
      // Keep the polling loop alive; never log the bearer token or raw bank data.
      this.logger.warn(`Đối soát giao dịch SePay chưa hoàn tất: ${error instanceof Error ? error.message : "lỗi không xác định"}`);
    } finally {
      if (lockKey) {
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken,
        ).catch(() => undefined);
      }
      this.reconciliationRunning = false;
    }
  }

  private formatSePayLocalDate(date: Date) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(date);
    return parts.replace("T", " ");
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
