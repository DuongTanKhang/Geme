"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatStorePrice } from "../lib/store-format";
import { normalizeApiBaseUrl } from "../lib/api-base";
import { getVietQrImageUrl, getVietQrTransferInfo, type BankQrSettings } from "../lib/bank-qr";
import { PaymentCountdown } from "./payment-countdown";

type CheckoutLine = {
  key: string;
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  sku: string;
  price: number;
  shape?: string | null;
  quality: string | null;
  beadSize: string | null;
  carat?: number | null;
  gemstoneQuality?: string | null;
  quantity: number;
  stock: number;
};

type CheckoutQuoteItem = {
  productId: string;
  variantId: string | null;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  saleUnitPrice: number;
  lineDiscount: number;
  lineTotal: number;
  stock: number;
};

type CheckoutQuote = {
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  totalAmount: number;
  items: CheckoutQuoteItem[];
};

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
const CART_KEY = "geme-cart-v1";
const QUICK_CHECKOUT_KEY = "geme-checkout-v1";

export function StoreCheckout() {
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [quickCheckout, setQuickCheckout] = useState(false);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<{ code: string; totalAmount: number; paymentMethod: string; paymentExpiresAt: string | null; idempotencyKey: string; paymentStatus: string } | null>(null);
  const [bankQr, setBankQr] = useState<BankQrSettings>({ enabled: false, bankCode: "", accountNumber: "", accountName: "" });
  const [bankQrLoaded, setBankQrLoaded] = useState(false);
  const [bankQrImageFailed, setBankQrImageFailed] = useState(false);
  const [qrPaymentExpired, setQrPaymentExpired] = useState(false);
  const [quote, setQuote] = useState<{ signature: string; value: CheckoutQuote } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRefreshVersion, setQuoteRefreshVersion] = useState(0);
  const [accountSignedIn, setAccountSignedIn] = useState<boolean | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "", address: "", note: "" });
  const customerTouched = useRef(new Set<string>());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const quick = params.has("mua-ngay");
    setQuickCheckout(quick);
    const read = (key: string): CheckoutLine[] => {
      try {
        const value = JSON.parse(sessionStorage.getItem(key) || "[]");
        return Array.isArray(value) ? value.filter((line) => line && line.productId && Number(line.quantity) > 0) : [];
      } catch { return []; }
    };
    const directLines = quick ? read(QUICK_CHECKOUT_KEY) : [];
    setLines(directLines.length ? directLines : read(CART_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/settings/public`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không tải được thông tin thanh toán.");
        return response.json() as Promise<{ bankQr?: Partial<BankQrSettings> }>;
      })
      .then((settings) => {
        if (!alive) return;
        const value = settings.bankQr && typeof settings.bankQr === "object" ? settings.bankQr : {};
        setBankQr({ enabled: value.enabled === true, bankCode: String(value.bankCode || ""), accountNumber: String(value.accountNumber || ""), accountName: String(value.accountName || "") });
      })
      .catch(() => { /* The QR option stays unavailable until public bank details can be loaded. */ })
      .finally(() => { if (alive) setBankQrLoaded(true); });
    return () => { alive = false; };
  }, []);

  const bankQrReady = bankQr.enabled && /^[a-z0-9.-]{2,20}$/i.test(bankQr.bankCode.trim()) && /^[0-9]{6,20}$/.test(bankQr.accountNumber.trim()) && Boolean(bankQr.accountName.trim());

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .then(async (response) => {
        if (response.status === 401) {
          if (alive) setAccountSignedIn(false);
          return;
        }
        if (!response.ok) return;
        const result = await response.json() as { customer?: { name?: string | null; phone?: string | null; email?: string | null; defaultAddress?: string | null } };
        if (!alive || !result.customer) return;
        setAccountSignedIn(true);
        const profile = result.customer;
        setCustomer((current) => ({
          ...current,
          name: !customerTouched.current.has("name") && !current.name ? profile.name?.trim() || "" : current.name,
          phone: !customerTouched.current.has("phone") && !current.phone ? profile.phone?.trim() || "" : current.phone,
          email: !customerTouched.current.has("email") && !current.email ? profile.email?.trim() || "" : current.email,
          address: !customerTouched.current.has("address") && !current.address ? profile.defaultAddress?.trim() || "" : current.address,
        }));
      })
      .catch(() => { /* Guests can enter their details normally if no profile is available. */ });
    return () => { alive = false; };
  }, []);

  const cartSignature = useMemo(() => JSON.stringify(lines.map((line) => ({ productId: line.productId, variantId: line.variantId, sku: line.sku, quantity: line.quantity }))), [lines]);
  const activeQuote = quote?.signature === cartSignature ? quote.value : null;
  const total = activeQuote?.totalAmount ?? 0;

  useEffect(() => {
    if (!ready) return;
    if (!lines.length) {
      setQuote(null);
      setQuoteError("");
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    setQuote(null);
    setQuoteError("");
    setQuoteLoading(true);
    void fetch(`${API_BASE}/orders/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, sku: line.sku, quantity: line.quantity })) }),
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(" ") : result.message || "Không kiểm tra được giá và tồn kho.");
      setQuote({ signature: cartSignature, value: result as CheckoutQuote });
    }).catch((caught) => {
      if (!controller.signal.aborted) setQuoteError(caught instanceof Error ? caught.message : "Không thể kiểm tra giá và tồn kho.");
    }).finally(() => {
      if (!controller.signal.aborted) setQuoteLoading(false);
    });
    return () => controller.abort();
  }, [cartSignature, lines, ready, quoteRefreshVersion]);

  const changeQuantity = (key: string, direction: number) => {
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, quantity: Math.max(1, Math.min(Math.max(1, line.stock), line.quantity + direction)) }
      : line));
  };

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!lines.length) { setError("Giỏ hàng chưa có sản phẩm."); return; }
    if (!activeQuote || quoteLoading) { setError(quoteError || "Đang xác nhận giá và tồn kho. Vui lòng thử lại sau ít giây."); return; }
    setSubmitting(true);
    try {
      let authenticated = accountSignedIn;
      if (authenticated === null) {
        const session = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (session.status === 401) authenticated = false;
        else if (!session.ok) throw new Error("Không thể kiểm tra phiên tài khoản. Vui lòng thử lại trước khi đặt hàng.");
        else authenticated = true;
        setAccountSignedIn(authenticated);
      }
      const endpoint = authenticated ? "/api/account/orders" : `${API_BASE}/orders`;
      const payload = {
        customerName: customer.name,
        phone: customer.phone,
        email: customer.email,
        shippingAddress: customer.address,
        note: customer.note,
        paymentMethod,
        expectedTotalAmount: activeQuote.totalAmount,
        items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, sku: line.sku, quantity: line.quantity })),
      };
      const fingerprintBytes = new TextEncoder().encode(JSON.stringify(payload));
      const fingerprintDigest = await crypto.subtle.digest("SHA-256", fingerprintBytes);
      const fingerprint = Array.from(new Uint8Array(fingerprintDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const idempotencyStoreKey = "geme-checkout-idempotency-v1";
      let savedKeys: Record<string, string> = {};
      let idempotencyKey = "";
      try {
        savedKeys = JSON.parse(sessionStorage.getItem(idempotencyStoreKey) || "{}") as Record<string, string>;
        if (typeof savedKeys[fingerprint] === "string") idempotencyKey = savedKeys[fingerprint];
      } catch { savedKeys = {}; }
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        savedKeys[fingerprint] = idempotencyKey;
        const recent = Object.entries(savedKeys).slice(-8);
        sessionStorage.setItem(idempotencyStoreKey, JSON.stringify(Object.fromEntries(recent)));
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) setQuoteRefreshVersion((version) => version + 1);
        throw new Error(Array.isArray(result.message) ? result.message.join(" ") : result.message || "Không thể tạo đơn hàng.");
      }
      setOrder({ code: result.code, totalAmount: Number(result.totalAmount) || total, paymentMethod, paymentExpiresAt: result.qrPaymentExpiresAt ? String(result.qrPaymentExpiresAt) : null, idempotencyKey, paymentStatus: "PENDING" });
      setQrPaymentExpired(false);
      setBankQrImageFailed(false);
      try {
        const saved = JSON.parse(sessionStorage.getItem(idempotencyStoreKey) || "{}") as Record<string, string>;
        delete saved[fingerprint];
        if (Object.keys(saved).length) sessionStorage.setItem(idempotencyStoreKey, JSON.stringify(saved));
        else sessionStorage.removeItem(idempotencyStoreKey);
      } catch { sessionStorage.removeItem(idempotencyStoreKey); }
      sessionStorage.removeItem(QUICK_CHECKOUT_KEY);
      if (!quickCheckout) sessionStorage.removeItem(CART_KEY);
      window.dispatchEvent(new CustomEvent("geme:cart-updated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể kết nối API đặt hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  const orderCode = order?.code ?? "";
  const orderIdempotencyKey = order?.idempotencyKey ?? "";
  const orderPaymentMethod = order?.paymentMethod ?? "";
  const orderPaymentStatus = order?.paymentStatus ?? "";
  useEffect(() => {
    if (!orderCode || !orderIdempotencyKey || orderPaymentMethod !== "BANK_TRANSFER_QR" || orderPaymentStatus === "PAID") return;
    let stopped = false;
    let checking = false;
    const checkPayment = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderCode)}/payment-status`, {
          cache: "no-store",
          headers: { "Idempotency-Key": orderIdempotencyKey, "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return;
        const result = await response.json() as { paymentStatus?: string };
        if (!stopped && result.paymentStatus === "PAID") {
          setOrder((current) => current?.code === orderCode ? { ...current, paymentStatus: "PAID" } : current);
          setQrPaymentExpired(false);
        }
      } catch { /* Keep showing the QR and retry while the order is unpaid. */ }
      finally { checking = false; }
    };
    void checkPayment();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkPayment();
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [orderCode, orderIdempotencyKey, orderPaymentMethod, orderPaymentStatus]);

  if (!ready) return <main className="checkout-page"><p>Đang tải giỏ hàng…</p></main>;
  if (order) {
    const qrImageUrl = order.paymentMethod === "BANK_TRANSFER_QR" ? getVietQrImageUrl(bankQr, order.totalAmount, order.code) : null;
    return <main className="checkout-page"><section className="checkout-success" role="status"><span>✓</span><h1>Đặt hàng thành công</h1><p>Mã đơn hàng <strong>{order.code}</strong></p><p>Tổng tiền: <strong>{formatStorePrice(order.totalAmount)}</strong></p>{order.paymentMethod === "BANK_TRANSFER_QR" && (order.paymentStatus === "PAID" ? <div className="checkout-payment-success" role="status"><strong>✓　Thanh toán thành công</strong><p>GEME đã nhận đủ tiền. Đơn hàng đang chờ GEME xác nhận.</p></div> : <div className="checkout-bank-qr"><h2>Quét mã để chuyển khoản</h2><PaymentCountdown expiresAt={order.paymentExpiresAt} onExpire={() => setQrPaymentExpired(true)} />{qrPaymentExpired ? <p role="alert">Đã hết 15 phút thanh toán QR. Đơn đang được tự hủy và hoàn tồn kho.</p> : <>{qrImageUrl && !bankQrImageFailed ? <img src={qrImageUrl} alt={`Mã VietQR thanh toán đơn ${order.code}`} onError={() => setBankQrImageFailed(true)} /> : <p role="alert">Không tải được mã QR. Vui lòng chuyển khoản thủ công với nội dung <strong>{getVietQrTransferInfo(order.code, bankQr.bankCode)}</strong> hoặc liên hệ GEME.</p>}<p>Ngân hàng: <strong>{bankQr.bankCode}</strong></p><p>Số tài khoản: <strong>{bankQr.accountNumber}</strong></p><p>Chủ tài khoản: <strong>{bankQr.accountName}</strong></p><p>Nội dung: <strong>{getVietQrTransferInfo(order.code, bankQr.bankCode)}</strong></p><p>QR có hiệu lực 15 phút và đã điền sẵn tổng đơn <strong>{formatStorePrice(order.totalAmount)}</strong>. Trang sẽ tự cập nhật và ẩn mã QR khi GEME nhận đủ tiền.</p></>}</div>)}{accountSignedIn && <a href="/tai-khoan?tab=orders">Xem đơn hàng và trạng thái</a>}<a href="/san-pham">Tiếp tục mua sắm</a></section></main>;
  }

  return <main className="checkout-page">
    <nav className="detail-breadcrumb" aria-label="Đường dẫn"><a href="/">Trang chủ</a><span>/</span><span>Giỏ hàng</span><span>/</span><span>Đặt hàng</span></nav>
    <header className="checkout-heading"><span className="eyebrow">GEME · ĐẶT HÀNG</span><h1>{quickCheckout ? "Mua ngay" : "Thông tin đặt hàng"}</h1><p>Kiểm tra sản phẩm đã chọn và điền thông tin nhận hàng.</p></header>
    {lines.length ? <div className="checkout-layout">
      <section className="checkout-products" aria-label="Sản phẩm đặt hàng">
        {lines.map((line) => {
          const quoted = activeQuote?.items.find((item) => item.productId === line.productId && item.variantId === line.variantId);
          return <article className="checkout-line" key={line.key}>
            <div className="checkout-line-copy"><a href={`/san-pham/${encodeURIComponent(line.slug)}`}>{line.name}</a><small>SKU {line.sku}{line.shape ? ` · ${{ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" }[line.shape] || line.shape}` : ""}{line.quality ? ` · ${line.quality}` : ""}{line.beadSize ? ` · ${line.beadSize}` : ""}{line.carat != null ? ` · ${line.carat} ct` : ""}{line.gemstoneQuality ? ` · Chất lượng ${line.gemstoneQuality}` : ""}</small>{quoted ? <><strong>{formatStorePrice(quoted.saleUnitPrice)}</strong>{quoted.saleUnitPrice < quoted.unitPrice && <del>{formatStorePrice(quoted.unitPrice)}</del>}</> : <small>{quoteLoading ? "Đang xác nhận giá…" : "Chưa xác nhận giá"}</small>}</div>
            <div className="checkout-line-quantity"><button type="button" onClick={() => changeQuantity(line.key, -1)} aria-label={`Giảm số lượng ${line.name}`}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.key, 1)} disabled={line.quantity >= line.stock} aria-label={`Tăng số lượng ${line.name}`}>+</button></div>
          </article>;
        })}
        {quoteError && <p className="checkout-error" role="alert">{quoteError} <button type="button" onClick={() => setQuoteRefreshVersion((version) => version + 1)}>Kiểm tra lại</button></p>}
        <div className="checkout-total">
          {activeQuote ? <>
            <div className="checkout-total-row"><span>Tạm tính</span><strong>{formatStorePrice(activeQuote.subtotal)}</strong></div>
            {activeQuote.discountAmount > 0 && <div className="checkout-total-row"><span>Khuyến mãi</span><strong>− {formatStorePrice(activeQuote.discountAmount)}</strong></div>}
            <div className="checkout-total-row"><span>Phí vận chuyển</span><strong>{formatStorePrice(activeQuote.shippingFee)}</strong></div>
            <div className="checkout-total-row is-grand-total"><span>Tổng thanh toán</span><strong>{formatStorePrice(total)}</strong></div>
          </> : <span>{quoteLoading ? "Đang xác nhận giá và tồn kho…" : "Chưa thể xác nhận giá và tồn kho."}</span>}
        </div>
      </section>
      <form className="checkout-form" onSubmit={submitOrder}>
        <h2>Thông tin nhận hàng</h2>
        <label>Họ và tên<input required value={customer.name} onChange={(event) => { customerTouched.current.add("name"); setCustomer({ ...customer, name: event.target.value }); }} autoComplete="name" /></label>
        <div className="checkout-form-row"><label>Số điện thoại<input required type="tel" value={customer.phone} onChange={(event) => { customerTouched.current.add("phone"); setCustomer({ ...customer, phone: event.target.value }); }} autoComplete="tel" /></label><label>Email<input required type="email" value={customer.email} onChange={(event) => { customerTouched.current.add("email"); setCustomer({ ...customer, email: event.target.value }); }} autoComplete="email" /></label></div>
        <label>Địa chỉ nhận hàng<textarea required rows={3} value={customer.address} onChange={(event) => { customerTouched.current.add("address"); setCustomer({ ...customer, address: event.target.value }); }} autoComplete="street-address" /></label>
        <label>Phương thức thanh toán<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="COD">Thanh toán khi nhận hàng</option><option value="BANK_TRANSFER">Chuyển khoản thủ công</option><option value="BANK_TRANSFER_QR" disabled={!bankQrLoaded || !bankQrReady}>Quét mã QR VietQR · tự điền số tiền{!bankQrReady ? " (chưa cấu hình)" : ""}</option></select></label>
        {paymentMethod === "BANK_TRANSFER_QR" && <p className="checkout-payment-note">QR được tạo riêng theo đúng tổng tiền và mã đơn. GEME sẽ xác nhận sau khi đối soát giao dịch.</p>}
        <label>Ghi chú<textarea rows={2} value={customer.note} onChange={(event) => { customerTouched.current.add("note"); setCustomer({ ...customer, note: event.target.value }); }} /></label>
        {error && <p className="checkout-error" role="alert">{error}</p>}
        <button className="checkout-submit" type="submit" disabled={submitting || quoteLoading || !activeQuote}>{submitting ? "ĐANG GỬI ĐƠN…" : quoteLoading || !activeQuote ? "ĐANG KIỂM TRA GIÁ…" : `XÁC NHẬN ĐẶT HÀNG · ${formatStorePrice(total)}`}</button>
      </form>
    </div> : <section className="checkout-empty"><p>Giỏ hàng chưa có sản phẩm.</p><a href="/san-pham">Khám phá sản phẩm</a></section>}
  </main>;
}


