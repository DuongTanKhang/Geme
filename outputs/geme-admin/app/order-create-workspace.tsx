"use client";

import { useMemo, useState } from "react";
import type { AdminProduct, ProductPriceVariant } from "./products-workspace";

type Customer = Record<string, any>;
type Line = { product: AdminProduct; variant?: ProductPriceVariant; quantity: number };
type Props = {
  products: AdminProduct[];
  customers: Customer[];
  onBack: () => void;
  onCreateCustomer: (customer: { name: string; phone: string }) => Promise<Customer>;
  onCreateOrder: (order: Record<string, unknown>) => Promise<void>;
};

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value || 0)} ₫`;
const phoneDigits = (value: string) => value.replace(/\D/g, "");
const customerId = (customer: Customer) => String(customer.apiId || customer.id || "");

export default function OrderCreateWorkspace({ products, customers, onBack, onCreateCustomer, onCreateOrder }: Props) {
  const [customerMode, setCustomerMode] = useState<"guest" | "existing" | "new">("guest");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [guest, setGuest] = useState({ name: "", phone: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Tất cả");
  const [kind, setKind] = useState("Tất cả");
  const [variantChoices, setVariantChoices] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const availableProducts = useMemo(() => products.filter((product) => {
    const hasStock = product.priceVariants?.length
      ? product.priceVariants.some((variant) => variant.stock > 0)
      : product.stock > 0;
    return hasStock && product.status !== "Đã gỡ bài";
  }), [products]);
  const availableSkuCount = useMemo(() => availableProducts.reduce((total, product) => total + (
    product.priceVariants?.length
      ? product.priceVariants.filter((variant) => variant.stock > 0).length
      : product.stock > 0 ? 1 : 0
  ), 0), [availableProducts]);
  const categories = useMemo(() => [...new Set(availableProducts.map((product) => product.category || "Khác").filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [availableProducts]);
  const matchingProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return availableProducts.filter((product) =>
      (category === "Tất cả" || product.category === category)
      && (kind === "Tất cả" || product.productType === kind)
      && (!query || `${product.name} ${product.id} ${(product.priceVariants || []).filter((variant) => variant.stock > 0).map((variant) => variant.sku || "").join(" ")} ${product.category} ${product.subcategory}`.toLocaleLowerCase("vi").includes(query)),
    );
  }, [availableProducts, category, kind, search]);
  const shownProducts = matchingProducts.slice(0, 9);
  const matchingCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase("vi");
    return customers.filter((customer) => !query || `${customer.name || ""} ${customer.phone || ""} ${customer.email || ""}`.toLocaleLowerCase("vi").includes(query)).slice(0, 8);
  }, [customers, customerSearch]);
  const subtotal = lines.reduce((sum, line) => sum + (line.variant?.price || line.product.price) * line.quantity, 0);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const selectedCustomer = customers.find((customer) => customerId(customer) === selectedCustomerId);
  const duplicatePhoneCustomer = customerMode === "new" && phoneDigits(newCustomer.phone).length >= 8
    ? customers.find((customer) => phoneDigits(String(customer.phone || "")) === phoneDigits(newCustomer.phone))
    : undefined;

  function selectedVariant(product: AdminProduct) {
    const stockedVariants = (product.priceVariants || []).filter((variant) => variant.stock > 0);
    const wantedId = variantChoices[product.apiId || product.id];
    return stockedVariants.find((variant) => variant.id === wantedId) || stockedVariants[0];
  }

  function addProduct(product: AdminProduct) {
    const variant = selectedVariant(product);
    if ((product.priceVariants?.length || 0) > 0 && !variant) return;
    const key = `${product.apiId || product.id}:${variant?.id || "base"}`;
    setLines((current) => {
      const found = current.find((line) => `${line.product.apiId || line.product.id}:${line.variant?.id || "base"}` === key);
      if (found) return current.map((line) => line === found ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line);
      return [...current, { product, variant, quantity: 1 }];
    });
  }

  function changeQuantity(line: Line, next: number) {
    const available = line.variant?.stock ?? line.product.stock;
    setLines((current) => current.map((item) => item === line ? { ...item, quantity: Math.max(1, Math.min(available, next)) } : item));
  }

  function changeLineVariant(line: Line, variantId: string) {
    const variant = (line.product.priceVariants || []).find((item) => item.id === variantId && item.stock > 0);
    if (!variant) return;
    setLines((current) => current.map((item) => item === line ? { ...item, variant, quantity: Math.min(item.quantity, variant.stock) } : item));
  }

  async function submit(paid: boolean) {
    setError("");
    if (!lines.length) { setError("Chọn ít nhất một sản phẩm để tạo đơn."); return; }
    if (customerMode === "new" && duplicatePhoneCustomer) { setError("Số điện thoại này đã có trong Khách hàng. Hãy chọn khách hàng hiện có."); return; }
    if (customerMode === "new" && (!newCustomer.name.trim() || phoneDigits(newCustomer.phone).length < 8)) { setError("Nhập họ tên và số điện thoại hợp lệ để lưu hồ sơ khách hàng."); return; }
    if (customerMode === "existing" && !selectedCustomer) { setError("Chọn khách hàng đã có trong hệ thống."); return; }
    setBusy(true);
    try {
      let linkedCustomer: Customer | undefined = customerMode === "existing" ? selectedCustomer : undefined;
      if (customerMode === "new") linkedCustomer = await onCreateCustomer({ name: newCustomer.name.trim(), phone: newCustomer.phone.trim() });
      const name = customerMode === "new" ? newCustomer.name.trim() : customerMode === "existing" ? String(linkedCustomer?.name || "") : guest.name.trim();
      const phone = customerMode === "new" ? newCustomer.phone.trim() : customerMode === "existing" ? String(linkedCustomer?.phone || "") : guest.phone.trim();
      await onCreateOrder({
        salesChannel: "STORE",
        paid: paid || paymentMethod === "COD",
        customerId: linkedCustomer ? customerId(linkedCustomer) : undefined,
        customerName: name,
        phone,
        paymentMethod,
        note: note.trim(),
        items: lines.map((line) => ({ productId: line.product.apiId, sku: line.product.id, variantId: line.variant?.id || undefined, quantity: line.quantity })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu đơn hàng.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="pos-order-page">
    <header className="pos-order-heading">
      <div><div className="pos-order-breadcrumb"><button type="button" onClick={onBack}>Đơn hàng</button><span>›</span><span>Tạo đơn hàng</span></div><h1>Tạo đơn hàng mới</h1><p>Dành cho khách mua trực tiếp tại cửa hàng. Chọn sản phẩm, kiểm tra thông tin và hoàn tất thanh toán.</p></div>
      <div className="pos-order-heading-actions"><span>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</span><button type="button" className="pos-order-channel">Cửa hàng⌄</button></div>
    </header>
    <div className="pos-order-layout">
      <div className="pos-order-main-column">
        <section className="pos-panel pos-customer-panel">
          <h2>Thông tin khách hàng</h2>
          <div className="pos-customer-tabs" role="tablist" aria-label="Chọn khách hàng">
            <button type="button" className={customerMode === "guest" ? "active" : ""} onClick={() => setCustomerMode("guest")}>Khách lẻ (không lưu)</button>
            <button type="button" className={customerMode === "existing" ? "active" : ""} onClick={() => setCustomerMode("existing")}>Khách hàng đã có</button>
            <button type="button" className={customerMode === "new" ? "active" : ""} onClick={() => setCustomerMode("new")}>＋ Tạo khách hàng mới</button>
          </div>
          {customerMode === "guest" && <div className="pos-customer-fields"><label>Họ tên (tùy chọn)<input value={guest.name} onChange={(event) => setGuest((value) => ({ ...value, name: event.target.value }))} placeholder="Nhập tên khách" /></label><label>Số điện thoại (tùy chọn)<input inputMode="tel" value={guest.phone} onChange={(event) => setGuest((value) => ({ ...value, phone: event.target.value }))} placeholder="Nhập số điện thoại" /></label><label>Ghi chú<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: Khách mua trực tiếp tại cửa hàng" /></label></div>}
          {customerMode === "existing" && <div className="pos-existing-customer"><label>Tìm khách hàng<input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Tìm theo tên, số điện thoại hoặc email" /></label><div className="pos-customer-results">{matchingCustomers.map((customer) => <button type="button" key={customerId(customer)} className={selectedCustomerId === customerId(customer) ? "selected" : ""} onClick={() => setSelectedCustomerId(customerId(customer))}><strong>{customer.name}</strong><span>{customer.phone || "Chưa có số điện thoại"}{customer.email ? ` · ${customer.email}` : ""}</span></button>)}{!matchingCustomers.length && <span>Không tìm thấy khách hàng.</span>}</div>{selectedCustomer && <p className="pos-existing-selected">Đơn hàng sẽ được lưu vào hồ sơ {selectedCustomer.name} trong mục Khách hàng.</p>}</div>}
          {customerMode === "new" && <div className="pos-customer-fields pos-new-customer-fields"><label>Họ và tên *<input autoComplete="name" value={newCustomer.name} onChange={(event) => setNewCustomer((value) => ({ ...value, name: event.target.value }))} placeholder="Nhập họ tên khách hàng" /></label><label>Số điện thoại *<input inputMode="tel" autoComplete="tel" value={newCustomer.phone} onChange={(event) => setNewCustomer((value) => ({ ...value, phone: event.target.value }))} placeholder="Nhập số điện thoại" /></label><p>Không cần email để lưu hồ sơ tại cửa hàng. Khách có thể dùng số điện thoại này khi đăng ký tài khoản GEME trên web.</p></div>}
        </section>

        <section className="pos-panel pos-products-panel">
          <div className="pos-panel-heading"><div><h2>Thêm sản phẩm</h2><p>{availableSkuCount} SKU còn hàng trong kho</p></div></div>
          <div className="pos-product-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="⌕  Tìm tên sản phẩm, mã SKU, tên đá..." aria-label="Tìm sản phẩm"/><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Lọc danh mục"><option>Tất cả</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Lọc loại sản phẩm"><option>Tất cả</option><option>Trang sức</option><option>Đá quý</option></select></div>
           <p className="pos-results-note">Hiển thị {shownProducts.length} / {matchingProducts.length} sản phẩm phù hợp. Tìm theo mã SKU hoặc dùng bộ lọc để tìm mã khác.</p>
          <div className="pos-product-grid">{shownProducts.map((product) => {
            const variants = (product.priceVariants || []).filter((variant) => variant.stock > 0);
            const variant = selectedVariant(product);
            return <article className="pos-product-card" key={product.apiId || product.id}>
              {product.image ? <img src={product.image} alt="" loading="lazy" /> : <span className="pos-product-placeholder">◇</span>}
              <div className="pos-product-card-copy"><strong>{product.name}</strong><small>{product.id} · {product.category || product.productType}</small>
                {variants.length > 0 && <select aria-label={`Biến thể ${product.name}`} value={variant?.id || ""} onChange={(event) => setVariantChoices((current) => ({ ...current, [product.apiId || product.id]: event.target.value }))}>{variants.map((item, index) => <option key={item.id || index} value={item.id}>{[item.quality, item.beadSize].filter(Boolean).join(" · ")} · Tồn {item.stock}</option>)}</select>}
                <span>{money(variant?.price || product.price)}</span>
              </div><button type="button" aria-label={`Thêm ${product.name}`} onClick={() => addProduct(product)}>＋</button>
            </article>;
          })}{!shownProducts.length && <p className="pos-products-empty">Không có sản phẩm phù hợp còn hàng.</p>}</div>
        </section>

        <section className="pos-panel pos-cart-panel">
          <div className="pos-panel-heading"><div><h2>Danh sách sản phẩm đã chọn ({lines.length})</h2><p>Kiểm tra đúng mã hàng và số lượng trước khi thanh toán.</p></div></div>
          <div className="pos-cart-scroll"><table className="pos-cart-table"><thead><tr><th>#</th><th>Sản phẩm</th><th>Mã SKU</th><th>Đơn giá</th><th>Số lượng</th><th>Thành tiền</th><th></th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.product.apiId || line.product.id}-${line.variant?.id || "base"}-${index}`}>
            <td>{index + 1}</td><td><div className="pos-cart-product">{line.product.image && <img src={line.product.image} alt=""/>}<span><strong>{line.product.name}</strong>{(line.product.priceVariants?.length || 0) > 0 && <select aria-label={`Biến thể trong đơn ${line.product.name}`} value={line.variant?.id || ""} onChange={(event) => changeLineVariant(line, event.target.value)}>{(line.product.priceVariants || []).filter((item) => item.stock > 0).map((item, itemIndex) => <option key={item.id || itemIndex} value={item.id}>{[item.quality, item.beadSize].filter(Boolean).join(" · ")} · {item.stock} còn</option>)}</select>}</span></div></td>
            <td>{line.variant?.sku || line.product.id}</td><td>{money(line.variant?.price || line.product.price)}</td><td><div className="pos-quantity"><button type="button" onClick={() => changeQuantity(line, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line, line.quantity + 1)} disabled={line.quantity >= (line.variant?.stock ?? line.product.stock)}>＋</button></div></td><td>{money((line.variant?.price || line.product.price) * line.quantity)}</td><td><button className="pos-remove-line" type="button" onClick={() => setLines((current) => current.filter((item) => item !== line))} aria-label={`Xóa ${line.product.name}`}>×</button></td>
          </tr>)}{!lines.length && <tr><td colSpan={7} className="pos-cart-empty">Chưa có sản phẩm. Chọn sản phẩm ở phía trên để bắt đầu đơn.</td></tr>}</tbody></table></div>
          <div className="pos-cart-footer"><span>Tổng số lượng: <strong>{totalQuantity}</strong></span><b>Tổng tiền: {money(subtotal)}</b></div>
        </section>
      </div>

      <aside className="pos-order-sidebar">
        <section className="pos-panel"><h2>Thông tin đơn hàng</h2><label>Mã đơn hàng<input value="Tự tạo khi lưu đơn" readOnly /></label><label>Ngày tạo<input value={new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date())} readOnly /></label><label>Hình thức bán<select value="STORE" disabled><option value="STORE">Bán trực tiếp tại cửa hàng</option></select></label><label>Ghi chú đơn hàng<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú (nếu có)..." maxLength={500} /></label></section>
        <section className="pos-panel pos-payment-panel"><h2>Phương thức thanh toán</h2>{[["COD", "Tiền mặt", "▣"], ["BANK_TRANSFER", "Chuyển khoản", "▤"], ["CREDIT_CARD", "Thẻ ngân hàng", "▱"], ["MOMO", "Ví điện tử (Momo, ZaloPay...) ", "◉"]].map(([value, label, icon]) => <label key={value}><input type="radio" name="payment" value={value} checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} /><span aria-hidden="true">{icon}</span>{label}</label>)}</section>
        <section className="pos-panel pos-total-panel"><h2>Tóm tắt thanh toán</h2><div><span>Tổng tiền hàng</span><strong>{money(subtotal)}</strong></div><div><span>Giảm giá</span><strong>0 ₫</strong></div><div><span>Phí giao hàng</span><strong>0 ₫</strong></div><div className="pos-grand-total"><span>Tổng thanh toán</span><strong>{money(subtotal)}</strong></div>{error && <p className="pos-order-error" role="alert">{error}</p>}<button type="button" className="pos-pay-button" disabled={busy} onClick={() => void submit(true)}>{busy ? "ĐANG LƯU..." : paymentMethod === "COD" ? "Nhận tiền mặt & Hoàn tất" : "Thanh toán & Hoàn tất"}</button>{paymentMethod !== "COD" && <button type="button" className="pos-save-pending" disabled={busy} onClick={() => void submit(false)}>Lưu đơn hàng (chưa thanh toán)</button>}</section>
        <p className="pos-stock-note">Đơn thanh toán hoàn tất sẽ tự cập nhật tồn kho và lịch sử xuất hàng.</p>
      </aside>
    </div>
  </main>;
}
