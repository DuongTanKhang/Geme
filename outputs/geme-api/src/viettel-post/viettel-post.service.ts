import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { Pos365Service } from "../pos365/pos365.service.js";

type Input = Record<string, any>;
type VtpConfig = { baseUrl: string; token: string; senderName: string; senderPhone: string; senderAddress: string; enabled: boolean };
type ParcelInput = { packageWeightGrams: number; lengthCm: number; widthCm: number; heightCm: number };
type VtpServiceQuote = { code: string; name: string; price: number; deliveryTime: string; exchangeWeight: number; extraServices: Array<{ code: string; name: string; description: string }> };

const orderInclude = {
  items: {
    include: {
      product: {
        select: {
          weightGrams: true,
          images: { orderBy: { sortOrder: "asc" as const }, take: 1, select: { url: true } },
        },
      },
    },
    orderBy: { id: "asc" as const },
  },
  payments: { orderBy: { createdAt: "desc" as const } },
  customer: true,
};
const invalidTrackingCodes = new Set(["", "null", "undefined"]);

@Injectable()
export class ViettelPostService {
  private readonly logger = new Logger(ViettelPostService.name);

  constructor(private readonly prisma: PrismaService, private readonly pos365: Pos365Service) {}

  status() {
    const config = this.config();
    const missing: string[] = [];
    if (!config.enabled) missing.push("VIETTELPOST_ENABLED=true");
    if (!config.baseUrl) missing.push("VIETTELPOST_API_BASE_URL");
    if (!config.token) missing.push("VIETTELPOST_TOKEN");
    if (!config.senderName || !config.senderPhone || !config.senderAddress) missing.push("VIETTELPOST_SENDER_NAME / PHONE / ADDRESS");
    return {
      configured: missing.length === 0,
      enabled: config.enabled,
      environment: config.baseUrl.includes("partnerdev.") ? "development" : config.baseUrl ? "production" : null,
      senderConfigured: Boolean(config.senderName && config.senderPhone && config.senderAddress),
      webhookConfigured: Boolean(process.env.VIETTELPOST_WEBHOOK_TOKEN?.trim()),
      missing,
    };
  }

  async servicesForOrder(orderId: string, input: Input) {
    const config = this.requireConfig();
    const order = await this.getShipmentOrder(orderId);
    this.validateOrder(order);
    const parcel = this.parcelInput(input);
    this.validateShippingContact(order);
    const result = await this.quote(config, order, parcel, this.freightPayment(order, input.freightPayment));
    return { services: result };
  }

  async createShipment(orderId: string, input: Input) {
    const config = this.requireConfig();
    const order = await this.getShipmentOrder(orderId);
    this.validateOrder(order);
    const parcel = this.parcelInput(input);
    this.validateShippingContact(order);
    const freightPayment = this.freightPayment(order, input.freightPayment);
    const serviceCode = String(input.serviceCode || "").trim().toUpperCase();
    if (!serviceCode) throw new BadRequestException("Chọn dịch vụ Viettel Post trước khi tạo vận đơn.");

    const now = new Date();
    const staleCreatingBefore = new Date(now.getTime() - 2 * 60_000);
    const claim = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        trackingCode: null,
        status: { in: ["PROCESSING", "SHIPPING"] },
        OR: [
          { carrierShipmentStatus: null },
          { carrierShipmentStatus: "FAILED" },
          { carrierShipmentStatus: "CREATING", carrierShipmentStartedAt: { lt: staleCreatingBefore } },
        ],
      },
      data: { carrierShipmentStatus: "CREATING", carrierShipmentStartedAt: now, carrierShipmentError: null },
    });
    if (claim.count !== 1) {
      const latest = await this.prisma.order.findUnique({ where: { id: orderId }, select: { trackingCode: true, carrierShipmentStatus: true } });
      if (latest?.trackingCode) throw new ConflictException(`Đơn này đã có vận đơn ${latest.trackingCode}.`);
      if (latest?.carrierShipmentStatus === "CREATING") throw new ConflictException("Vận đơn của đơn này đang được tạo. Hãy chờ vài giây rồi tải lại.");
      throw new BadRequestException("Đơn hàng vừa thay đổi trạng thái hoặc không còn đủ điều kiện giao Viettel Post.");
    }

    try {
      const services = await this.quote(config, order, parcel, freightPayment);
      const selectedService = services.find((service) => service.code.toUpperCase() === serviceCode);
      if (!selectedService) throw new BadRequestException("Dịch vụ đã chọn không còn phù hợp. Hãy tải lại danh sách dịch vụ.");

      const goodsAmount = Math.max(0, Math.round(Number(order.subtotal) - Number(order.discountAmount)));
      const orderAmountDue = Math.max(0, Math.round(Number(order.totalAmount)));
      const payment = order.payments[0];
      const isCod = payment?.method === "COD" && payment.status !== "PAID";
      const orderPayment = isCod ? (freightPayment === "RECEIVER" ? 2 : 3) : (freightPayment === "RECEIVER" ? 4 : 1);
      const codAmount = isCod ? (freightPayment === "SENDER" ? orderAmountDue : goodsAmount) : 0;
      const note = String(input.shippingNote ?? order.note ?? "").trim();
      if (Buffer.byteLength(note, "utf8") > 150) throw new BadRequestException("Ghi chú gửi Viettel Post tối đa 150 byte.");
      const productName = this.truncateUtf8(order.items.map((item: Input) => `${item.productName} x${item.quantity}`).join(", "), 150);
      const details = order.items.map((item: Input) => ({
        PRODUCT_NAME: this.truncateUtf8(item.productName, 150),
        PRODUCT_QUANTITY: item.quantity,
        PRODUCT_PRICE: Number(item.lineTotal),
        ...(item.product?.weightGrams ? { PRODUCT_WEIGHT: Math.max(1, Math.round(Number(item.product.weightGrams) * item.quantity)) } : {}),
      }));
      const payload: Input = {
        ORDER_NUMBER: order.code,
        CHECK_UNIQUE: true,
        SENDER_FULLNAME: config.senderName,
        SENDER_PHONE: config.senderPhone,
        SENDER_ADDRESS: config.senderAddress,
        RECEIVER_FULLNAME: order.customerName,
        RECEIVER_PHONE: this.phoneDigits(order.customerPhone),
        RECEIVER_ADDRESS: order.shippingAddress.trim(),
        PRODUCT_NAME: productName,
        PRODUCT_TYPE: "HH",
        PRODUCT_QUANTITY: order.items.reduce((sum: number, item: Input) => sum + Number(item.quantity || 0), 0),
        PRODUCT_PRICE: goodsAmount,
        PRODUCT_WEIGHT: parcel.packageWeightGrams,
        PRODUCT_LENGTH: parcel.lengthCm,
        PRODUCT_WIDTH: parcel.widthCm,
        PRODUCT_HEIGHT: parcel.heightCm,
        PRODUCT_DETAIL: details,
        ORDER_PAYMENT: orderPayment,
        MONEY_COLLECTION: codAmount,
        EXTRA_MONEY: 0,
        ORDER_SERVICE: selectedService.code,
        ORDER_SERVICE_ADD: "",
        ORDER_NOTE: note,
        ENABLE_SORT_CODE: false,
      };
      const result = await this.vtpRequest(config, "/v2/order/createOrderNlp", payload);
      const trackingCode = String(result.ORDER_NUMBER || "").trim();
      if (!trackingCode || invalidTrackingCodes.has(trackingCode.toLowerCase())) throw new Error("Viettel Post không trả về mã vận đơn; kiểm tra lại tài khoản trước khi thử tạo lại.");

      const saved = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          shippingProvider: "VIETTEL_POST",
          shippingServiceCode: selectedService.code,
          carrierFreightPayment: freightPayment,
          carrierCodAmount: codAmount,
          shippingMethod: `Viettel Post · ${selectedService.name}`.slice(0, 120),
          trackingCode: trackingCode.slice(0, 120),
          carrierShipmentStatus: "AWAITING_PICKUP",
          carrierShipmentError: null,
          carrierStatusName: "Đã tạo vận đơn · chờ Viettel Post lấy hàng",
          carrierStatusAt: new Date(),
          carrierFee: Number(result.MONEY_TOTAL ?? result.MONEY_TOTAL_FEE ?? selectedService.price) || null,
        },
        include: orderInclude,
      });
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tạo vận đơn Viettel Post.";
      await this.prisma.order.updateMany({ where: { id: orderId, carrierShipmentStatus: "CREATING", trackingCode: null }, data: { carrierShipmentStatus: "FAILED", carrierShipmentError: message.slice(0, 1000) } }).catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      this.logger.warn(`Không tạo được vận đơn Viettel Post cho đơn ${order.code}: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  async printUrl(orderId: string) {
    const config = this.requireConfig();
    const order = await this.getShipmentOrder(orderId);
    if (order.shippingProvider !== "VIETTEL_POST" || !order.trackingCode) throw new BadRequestException("Đơn hàng chưa có vận đơn Viettel Post để in.");
    const result = await this.vtpRequest(config, "/v2/order/printing-code", {
      EXPIRY_TIME: Date.now() + 30 * 60_000,
      ORDER_ARRAY: [order.trackingCode],
    });
    const printCode = String(result.message || "").trim();
    if (!printCode) throw new BadGatewayException("Viettel Post chưa trả về mã in nhãn.");
    const printHost = config.baseUrl.includes("partnerdev.") ? "https://dev-release-print.viettelpost.vn" : "https://digitalize.viettelpost.vn";
    const query = new URLSearchParams({ type: "1", bill: printCode, showPostage: "1" });
    return { url: `${printHost}/DigitalizePrint/report.do?${query.toString()}` };
  }

  async receiveWebhook(payload: Input) {
    const expected = process.env.VIETTELPOST_WEBHOOK_TOKEN?.trim() || "";
    const supplied = String(payload?.DATA?.TOKEN || payload?.TOKEN || "").trim();
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    if (!expected || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      throw new UnauthorizedException("Webhook Viettel Post không hợp lệ.");
    }

    const data = payload?.DATA;
    const trackingCode = String(data?.ORDER_NUMBER || "").trim();
    if (!trackingCode) return { accepted: true };
    const order = await this.prisma.order.findFirst({ where: { trackingCode }, select: { id: true, code: true, status: true, carrierStatusAt: true, carrierShipmentStatus: true } });
    if (!order) return { accepted: true };
    const statusCode = Number(data?.ORDER_STATUS);
    if (!Number.isInteger(statusCode)) return { accepted: true };
    const occurredAt = this.parseVtpDate(data?.ORDER_STATUSDATE) || new Date();
    if (order.carrierStatusAt && occurredAt < order.carrierStatusAt) return { accepted: true };

    const carrierStatusName = String(data?.STATUS_NAME || "").trim().slice(0, 180) || null;
    const normalizedStatusName = (carrierStatusName || "").toLocaleLowerCase("vi");
    const delivered = statusCode === 501 || /giao hàng thành công|giao thành công|đã giao hàng/.test(normalizedStatusName);
    const returning = /hoàn hàng|đang hoàn|trả hàng|chuyển hoàn/.test(normalizedStatusName);
    const cancelled = /hủy vận đơn|huỷ vận đơn|đã hủy|đã huỷ|hủy đơn|huỷ đơn/.test(normalizedStatusName);
    const deliveryFailed = /giao thất bại|giao không thành công|không giao được|giao hàng thất bại/.test(normalizedStatusName);
    const moving = /đã lấy hàng|đã nhận hàng|đang vận chuyển|đang giao|đã nhập kho|rời bưu cục|đến bưu cục|đang khai thác/.test(normalizedStatusName);
    const previousShipmentStatus = String(order.carrierShipmentStatus || "").toUpperCase();
    const carrierShipmentStatus = delivered ? "DELIVERED" : returning ? "RETURNING" : cancelled ? "CANCELLED" : deliveryFailed ? "EXCEPTION" : moving ? "IN_TRANSIT" : ["IN_TRANSIT", "EXCEPTION", "RETURNING", "CANCELLED"].includes(previousShipmentStatus) ? previousShipmentStatus : "AWAITING_PICKUP";
    const orderStatus = delivered
      ? ("DELIVERED" as const)
      : moving && order.status !== "DELIVERED" && order.status !== "CANCELLED"
        ? ("SHIPPING" as const)
        : order.status;

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...(orderStatus !== order.status ? { status: orderStatus } : {}),
        carrierShipmentStatus,
        carrierStatusCode: Number.isFinite(statusCode) ? statusCode : null,
        carrierStatusName,
        carrierStatusAt: occurredAt,
        carrierLocation: String(data?.LOCALION_CURRENTLY || data?.LOCATION_CURRENTLY || "").slice(0, 255) || null,
        ...(Number.isFinite(Number(data?.MONEY_TOTALFEE)) ? { carrierFee: Number(data.MONEY_TOTALFEE) } : {}),
      },
    });
    if (updated.status !== order.status) void this.pos365.queueOrderSync(order.id).catch((error) => this.logger.warn(`Không thể đưa trạng thái đơn ${order.code} vào hàng đợi POS365.`, error));
    return { accepted: true };
  }

  private async getShipmentOrder(id: string): Promise<Input> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException("Không tìm thấy đơn hàng.");
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException("Không tìm thấy đơn hàng.");
    return order as Input;
  }

  private validateOrder(order: Input) {
    if (order.trackingCode) throw new ConflictException(`Đơn này đã có vận đơn ${order.trackingCode}.`);
    if (order.shippingMethod === "Bán trực tiếp tại cửa hàng") throw new BadRequestException("Đơn bán tại cửa hàng không cần vận đơn giao hàng.");
    if (!(order.status === "PROCESSING" || order.status === "SHIPPING")) throw new BadRequestException("Chỉ tạo vận đơn cho đơn đang xử lý hoặc đang giao.");
    const payment = order.payments[0];
    if (payment?.method !== "COD" && payment?.status !== "PAID") throw new BadRequestException("Cần ghi nhận thanh toán cho đơn chuyển khoản/thẻ trước khi tạo vận đơn.");
  }

  private validateShippingContact(order: Input) {
    if (!String(order.customerName || "").trim()) throw new BadRequestException("Đơn hàng thiếu tên người nhận.");
    const phone = this.phoneDigits(order.customerPhone);
    if (!/^\d{9,12}$/.test(phone)) throw new BadRequestException("Đơn hàng cần có số điện thoại người nhận hợp lệ.");
    const address = String(order.shippingAddress || "").trim();
    if (!address) throw new BadRequestException("Đơn hàng cần có địa chỉ giao hàng.");
    if (Buffer.byteLength(address, "utf8") > 150) throw new BadRequestException("Địa chỉ người nhận vượt quá giới hạn 150 byte của Viettel Post.");
  }

  private parcelInput(input: Input): ParcelInput {
    const packageWeightGrams = Number(input.packageWeightGrams);
    if (!Number.isInteger(packageWeightGrams) || packageWeightGrams < 1 || packageWeightGrams > 100_000) throw new BadRequestException("Nhập khối lượng kiện hàng theo gram (từ 1 đến 100.000 g).");
    const dimension = (key: string) => {
      const value = Number(input[key] ?? 0);
      if (!Number.isInteger(value) || value < 0 || value > 300) throw new BadRequestException("Kích thước kiện hàng phải là số nguyên từ 0 đến 300 cm.");
      return value;
    };
    return { packageWeightGrams, lengthCm: dimension("lengthCm"), widthCm: dimension("widthCm"), heightCm: dimension("heightCm") };
  }

  private freightPayment(order: Input, value: unknown): "SENDER" | "RECEIVER" {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "SENDER" || normalized === "RECEIVER") return normalized;
    return Number(order.shippingFee) > 0 ? "SENDER" : "RECEIVER";
  }

  private async quote(config: VtpConfig, order: Input, parcel: ParcelInput, freightPayment: "SENDER" | "RECEIVER"): Promise<VtpServiceQuote[]> {
    const payment = order.payments[0];
    const isCod = payment?.method === "COD" && payment.status !== "PAID";
    const goodsAmount = Math.max(0, Math.round(Number(order.subtotal) - Number(order.discountAmount)));
    const orderAmountDue = Math.max(0, Math.round(Number(order.totalAmount)));
    const codAmount = isCod ? (freightPayment === "SENDER" ? orderAmountDue : goodsAmount) : 0;
    const result = await this.vtpRequest(config, "/v2/order/getPriceAllNlp", {
      SENDER_ADDRESS: config.senderAddress,
      RECEIVER_ADDRESS: String(order.shippingAddress || "").trim(),
      PRODUCT_TYPE: "HH",
      PRODUCT_WEIGHT: parcel.packageWeightGrams,
      PRODUCT_PRICE: goodsAmount,
      MONEY_COLLECTION: codAmount,
      PRODUCT_LENGTH: parcel.lengthCm,
      PRODUCT_WIDTH: parcel.widthCm,
      PRODUCT_HEIGHT: parcel.heightCm,
      TYPE: 1,
    });
    const rawServices = Array.isArray(result?.RESULT) ? result.RESULT : Array.isArray(result) ? result : [];
    return rawServices.map((service: Input): VtpServiceQuote | null => {
      const code = String(service.MA_DV_CHINH || "").trim();
      const name = String(service.TEN_DICHVU || "").trim();
      if (!code || !name) return null;
      return {
        code,
        name,
        price: Number(service.GIA_CUOC) || 0,
        deliveryTime: String(service.THOI_GIAN || ""),
        exchangeWeight: Number(service.EXCHANGE_WEIGHT) || 0,
        extraServices: Array.isArray(service.EXTRA_SERVICE) ? service.EXTRA_SERVICE.map((extra: Input) => ({ code: String(extra.SERVICE_CODE || ""), name: String(extra.SERVICE_NAME || ""), description: String(extra.DESCRIPTION || "") })).filter((extra: VtpServiceQuote["extraServices"][number]) => extra.code && extra.name) : [],
      };
    }).filter((service: VtpServiceQuote | null): service is VtpServiceQuote => service !== null);
  }

  private async vtpRequest(config: VtpConfig, path: string, body: Input): Promise<Input> {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { Token: config.token, "Content-Type": "application/json;charset=UTF-8", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const responseBody = await response.json().catch(() => null) as Input | null;
    if (!response.ok || responseBody?.error === true) {
      const apiMessage = Array.isArray(responseBody?.message) ? responseBody.message.join("; ") : responseBody?.message;
      const message = typeof apiMessage === "string" && apiMessage.trim() ? apiMessage.trim() : `Viettel Post trả về lỗi HTTP ${response.status}.`;
      throw new Error(message.slice(0, 500));
    }
    if (!responseBody) throw new Error("Viettel Post trả về phản hồi không đọc được.");
    return responseBody.data ?? responseBody;
  }

  private requireConfig(): VtpConfig {
    const config = this.config();
    const status = this.status();
    if (!status.configured) throw new BadRequestException(`Chưa cấu hình Viettel Post ở backend: ${status.missing.join(", ")}.`);
    return config;
  }

  private config(): VtpConfig {
    const rawUrl = process.env.VIETTELPOST_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
    let baseUrl = "";
    try {
      const url = new URL(rawUrl);
      const allowedHosts = new Set(["partner.viettelpost.vn", "partnerdev.viettelpost.vn"]);
      if (url.protocol === "https:" && allowedHosts.has(url.hostname) && !url.username && !url.password) baseUrl = url.origin;
    } catch { /* report as missing base URL in status */ }
    return {
      baseUrl,
      token: process.env.VIETTELPOST_TOKEN?.trim() || "",
      senderName: process.env.VIETTELPOST_SENDER_NAME?.trim() || "",
      senderPhone: this.phoneDigits(process.env.VIETTELPOST_SENDER_PHONE),
      senderAddress: process.env.VIETTELPOST_SENDER_ADDRESS?.trim() || "",
      enabled: process.env.VIETTELPOST_ENABLED?.trim().toLowerCase() === "true",
    };
  }

  private phoneDigits(value: unknown) { return String(value || "").replace(/\D/g, ""); }

  private truncateUtf8(value: string, maxBytes: number) {
    let result = "";
    for (const character of value) {
      if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
      result += character;
    }
    return result;
  }

  private parseVtpDate(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
      const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+07:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
