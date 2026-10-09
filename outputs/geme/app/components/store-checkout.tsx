"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatStorePrice } from "../lib/store-format";
import { normalizeApiBaseUrl } from "../lib/api-base";

type CheckoutLine = {
  key: string;
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  sku: string;
  price: number;
  quality: string | null;
  beadSize: string | null;
  quantity: number;
  stock: number;
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
  const [order, setOrder] = useState<{ code: string; totalAmount: number } | null>(null);
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

  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0), [lines]);

  const changeQuantity = (key: string, direction: number) => {
    setLines((current) => current.map((line) => line.key === key
      ? { ...line, quantity: Math.max(1, Math.min(Math.max(1, line.stock), line.quantity + direction)) }
      : line));
  };

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!lines.length) { setError("Giỏ hàng chưa có sản phẩm."); return; }
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customer.name,
          phone: customer.phone,
          email: customer.email,
          shippingAddress: customer.address,
          note: customer.note,
          paymentMethod,
          items: lines.map((line) => ({ productId: line.productId, variantId: line.variantId, sku: line.sku, quantity: line.quantity })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(" ") : result.message || "Không thể tạo đơn hàng.");
      setOrder({ code: result.code, totalAmount: Number(result.totalAmount) || total });
      sessionStorage.removeItem(QUICK_CHECKOUT_KEY);
      if (!quickCheckout) sessionStorage.removeItem(CART_KEY);
      window.dispatchEvent(new CustomEvent("geme:cart-updated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể kết nối API đặt hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <main className="checkout-page"><p>Đang tải giỏ hàng…</p></main>;
  if (order) return <main className="checkout-page"><section className="checkout-success" role="status"><span>✓</span><h1>Đặt hàng thành công</h1><p>Mã đơn hàng <strong>{order.code}</strong></p><p>Tổng tiền: <strong>{formatStorePrice(order.totalAmount)}</strong></p>{accountSignedIn && <a href="/tai-khoan?tab=orders">Xem đơn hàng và trạng thái</a>}<a href="/san-pham">Tiếp tục mua sắm</a></section></main>;

  return <main className="checkout-page">
    <nav className="detail-breadcrumb" aria-label="Đường dẫn"><a href="/">Trang chủ</a><span>/</span><span>Giỏ hàng</span><span>/</span><span>Đặt hàng</span></nav>
    <header className="checkout-heading"><span className="eyebrow">GEME · ĐẶT HÀNG</span><h1>{quickCheckout ? "Mua ngay" : "Thông tin đặt hàng"}</h1><p>Kiểm tra sản phẩm đã chọn và điền thông tin nhận hàng.</p></header>
    {lines.length ? <div className="checkout-layout">
      <section className="checkout-products" aria-label="Sản phẩm đặt hàng">
        {lines.map((line) => <article className="checkout-line" key={line.key}>
          <div className="checkout-line-copy"><a href={`/san-pham/${encodeURIComponent(line.slug)}`}>{line.name}</a><small>SKU {line.sku}{line.quality ? ` · ${line.quality}` : ""}{line.beadSize ? ` · ${line.beadSize}` : ""}</small><strong>{formatStorePrice(line.price)}</strong></div>
          <div className="checkout-line-quantity"><button type="button" onClick={() => changeQuantity(line.key, -1)} aria-label={`Giảm số lượng ${line.name}`}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.key, 1)} disabled={line.quantity >= line.stock} aria-label={`Tăng số lượng ${line.name}`}>+</button></div>
        </article>)}
        <div className="checkout-total"><span>Tạm tính</span><strong>{formatStorePrice(total)}</strong></div>
      </section>
      <form className="checkout-form" onSubmit={submitOrder}>
        <h2>Thông tin nhận hàng</h2>
        <label>Họ và tên<input required value={customer.name} onChange={(event) => { customerTouched.current.add("name"); setCustomer({ ...customer, name: event.target.value }); }} autoComplete="name" /></label>
        <div className="checkout-form-row"><label>Số điện thoại<input required type="tel" value={customer.phone} onChange={(event) => { customerTouched.current.add("phone"); setCustomer({ ...customer, phone: event.target.value }); }} autoComplete="tel" /></label><label>Email<input required type="email" value={customer.email} onChange={(event) => { customerTouched.current.add("email"); setCustomer({ ...customer, email: event.target.value }); }} autoComplete="email" /></label></div>
        <label>Địa chỉ nhận hàng<textarea required rows={3} value={customer.address} onChange={(event) => { customerTouched.current.add("address"); setCustomer({ ...customer, address: event.target.value }); }} autoComplete="street-address" /></label>
        <label>Phương thức thanh toán<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="COD">Thanh toán khi nhận hàng</option><option value="BANK_TRANSFER">Chuyển khoản</option></select></label>
        <label>Ghi chú<textarea rows={2} value={customer.note} onChange={(event) => { customerTouched.current.add("note"); setCustomer({ ...customer, note: event.target.value }); }} /></label>
        {error && <p className="checkout-error" role="alert">{error}</p>}
        <button className="checkout-submit" type="submit" disabled={submitting}>{submitting ? "ĐANG GỬI ĐƠN…" : `XÁC NHẬN ĐẶT HÀNG · ${formatStorePrice(total)}`}</button>
      </form>
    </div> : <section className="checkout-empty"><p>Giỏ hàng chưa có sản phẩm.</p><a href="/san-pham">Khám phá sản phẩm</a></section>}
  </main>;
}


