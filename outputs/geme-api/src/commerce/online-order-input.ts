import { BadRequestException } from "@nestjs/common";

const ONLINE_PAYMENT_METHODS = new Set(["COD", "BANK_TRANSFER", "BANK_TRANSFER_QR", "MOMO", "CREDIT_CARD"]);

function onlineOrderItems(body: Record<string, any>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Thông tin đặt hàng không hợp lệ.");
  if (!Array.isArray(body.items) || body.items.length < 1) throw new BadRequestException("Đơn hàng cần ít nhất một sản phẩm.");
  if (body.items.length > 30) throw new BadRequestException("Giỏ hàng tối đa 30 dòng sản phẩm. Hãy gộp các dòng SKU trùng nhau rồi thử lại.");
  return body.items.map((line: Record<string, unknown>) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) throw new BadRequestException("Một dòng sản phẩm trong giỏ hàng không hợp lệ.");
    const productId = typeof line.productId === "string" ? line.productId.trim() : "";
    const variantId = typeof line.variantId === "string" ? line.variantId.trim() : "";
    const sku = typeof line.sku === "string" ? line.sku.trim() : "";
    if (productId.length > 64 || variantId.length > 64 || sku.length > 64) throw new BadRequestException("Mã sản phẩm hoặc SKU trong giỏ hàng quá dài.");
    return { productId, variantId: variantId || undefined, sku, quantity: line.quantity };
  });
}

/** A price/stock quote only needs cart lines. Contact details are required when creating the order. */
export function onlineOrderQuoteInput(body: Record<string, any>) {
  return { items: onlineOrderItems(body), shippingFee: 0, loyaltyPointsToRedeem: body.loyaltyPointsToRedeem ?? 0 };
}

/** Accept only checkout fields; validate instead of silently truncating buyer data. */
export function onlineOrderInput(body: Record<string, any>) {
  const items = onlineOrderItems(body);

  const requestedPaymentMethod = typeof body.paymentMethod === "string" && body.paymentMethod.trim()
    ? body.paymentMethod.trim()
    : "COD";
  if (!ONLINE_PAYMENT_METHODS.has(requestedPaymentMethod)) throw new BadRequestException("Phương thức thanh toán không được hỗ trợ.");
  const qrPayment = requestedPaymentMethod === "BANK_TRANSFER_QR";
  const paymentMethod = qrPayment ? "BANK_TRANSFER" : requestedPaymentMethod;

  const name = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const phoneInput = typeof body.phone === "string" ? body.phone.trim() : "";
  const digits = phoneInput.replace(/\D/g, "");
  const phone = phoneInput.startsWith("+84") && digits.startsWith("84") ? `0${digits.slice(2)}` : digits.startsWith("84") && digits.length === 11 ? `0${digits.slice(2)}` : phoneInput;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const shippingAddress = typeof body.shippingAddress === "string" ? body.shippingAddress.trim() : "";
  const note = typeof body.note === "string" ? body.note : "";
  if (!digits || digits.length < 9 || digits.length > 12 || /[^+\d().\s-]/.test(phoneInput)) throw new BadRequestException("Nhập số điện thoại người nhận hợp lệ (9–12 chữ số).");
  if (!shippingAddress || shippingAddress.length < 8) throw new BadRequestException("Nhập đầy đủ địa chỉ giao hàng trước khi đặt hàng.");
  if (name.length > 160 || phone.length > 32 || email.length > 320 || shippingAddress.length > 1000 || note.length > 2000) throw new BadRequestException("Thông tin giao hàng vượt quá độ dài cho phép. Hãy chỉnh nội dung rồi thử lại.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Địa chỉ email không hợp lệ.");

  let expectedTotalAmount: number | undefined;
  if (body.expectedTotalAmount !== undefined && body.expectedTotalAmount !== null && body.expectedTotalAmount !== "") {
    expectedTotalAmount = Number(body.expectedTotalAmount);
    if (!Number.isSafeInteger(expectedTotalAmount) || expectedTotalAmount < 0) throw new BadRequestException("Tổng tiền kiểm tra không hợp lệ. Hãy tải lại báo giá.");
  }

  const loyaltyPointsToRedeem = body.loyaltyPointsToRedeem === undefined || body.loyaltyPointsToRedeem === null || body.loyaltyPointsToRedeem === ""
    ? 0
    : Number(body.loyaltyPointsToRedeem);
  if (!Number.isSafeInteger(loyaltyPointsToRedeem) || loyaltyPointsToRedeem < 0) throw new BadRequestException("Số điểm dùng để thanh toán không hợp lệ.");

  return {
    customerName: name,
    phone,
    email,
    shippingAddress,
    note,
    paymentMethod,
    qrPayment,
    items,
    salesChannel: "ONLINE",
    channel: "ONLINE",
    paid: false,
    discountAmount: 0,
    shippingFee: 0,
    expectedTotalAmount,
    loyaltyPointsToRedeem,
    shippingMethod: "Giao hàng",
  };
}
