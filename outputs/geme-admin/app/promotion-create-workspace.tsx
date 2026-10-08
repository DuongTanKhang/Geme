"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { AdminProduct } from "./products-workspace";
import type { AdminCategory } from "./categories-workspace";

type PromotionDraft = {
  name: string;
  category: string;
  type: "percent" | "amount" | "gift";
  value: string;
  code: string;
  codeLimit: string;
  startAt: string;
  endAt: string;
  autoEnd: boolean;
  minOrder: string;
  condition: "none" | "minimum" | "member";
  products: "category" | "specific";
  description: string;
};

type PreviewProduct = { name: string; price: number; image?: string };
type Props = { existingCodes: string[]; products: AdminProduct[]; categories: AdminCategory[]; onBack: () => void; onSave: (promotion: Record<string, any>) => Promise<void> | void };
const formatMoney = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
const formatDate = (value: string) => { const [year, month, day] = value.split("-"); return day && month && year ? `${day}/${month}/${year}` : value; };
const formatDateTime = (value: string) => { if (!value) return ""; const [date, time] = value.split("T"); return `${formatDate(date)}${time ? ` ${time.slice(0, 5)}` : ""}`; };

export default function PromotionCreateWorkspace({ existingCodes, products, categories, onBack, onSave }: Props) {
  const [draft, setDraft] = useState<PromotionDraft>({
    name: "", category: "", type: "percent", value: "", code: "",
    codeLimit: "", startAt: "", endAt: "", autoEnd: false, minOrder: "",
    condition: "none", products: "category", description: "",
  });
  const [categorySearch, setCategorySearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const promotionCategories = categories.filter((item) => item.status === "Hoạt động" && item.kind !== "Khác");
  const selectedCategory = promotionCategories.find((item) => item.id === draft.category);
  const applicableCategoryIds = useMemo(() => {
    if (!selectedCategory) return new Set<string>();
    const ids = new Set([selectedCategory.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of promotionCategories) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
    }
    return ids;
  }, [selectedCategory, promotionCategories]);
  const previewProducts = useMemo(() => products.filter((item) => {
    const hasStock = item.priceVariants?.length
      ? item.priceVariants.some((variant) => variant.stock > 0)
      : item.stock > 0;
    return hasStock && applicableCategoryIds.has(item.categoryId || "");
  }).map((item) => ({ id: item.apiId || item.id, sku: item.id, name: item.name, price: item.price, image: item.image })), [products, applicableCategoryIds]);
  const filteredProducts = useMemo(() => previewProducts.filter((item) => `${item.sku} ${item.name}`.toLocaleLowerCase("vi").includes(categorySearch.toLocaleLowerCase("vi"))), [categorySearch, previewProducts]);
  const set = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const categoryLabel = selectedCategory?.name || "Chọn danh mục";
  const endDate = formatDate(draft.endAt.slice(0, 10));
  const startDate = formatDate(draft.startAt.slice(0, 10));
  const startDateTime = formatDateTime(draft.startAt);
  const endDateTime = formatDateTime(draft.endAt);
  const codeValue = draft.code || "Tự động tạo mã";
  const discountLabel = draft.type === "percent" ? `${draft.value || 0}%` : draft.type === "amount" ? `${formatMoney(Number(draft.value) || 0)}` : "Quà tặng";
  const discountPreview = draft.type === "percent" ? `-${draft.value || 0}%` : draft.type === "amount" ? `-${formatMoney(Number(draft.value) || 0)}` : "Quà tặng";

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.type === "percent" && (Number(draft.value) <= 0 || Number(draft.value) > 100)) { setError("Mức giảm phải lớn hơn 0% và không vượt quá 100%."); return; }
    if (draft.products === "specific" && !previewProducts.some((item) => item.id === selectedProduct)) { setSelectedProduct(""); setError("SKU đã hết tồn hoặc không còn phù hợp. Hãy chọn một SKU còn hàng."); return; }
    const used = new Set(existingCodes.map((code) => code.toUpperCase()));
    const initialCode = (draft.code || `GEME${Date.now().toString().slice(-5)}`).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    let code = initialCode;
    let number = 2;
    while (used.has(code)) code = `${initialCode}${number++}`;
    const type = draft.type === "percent" ? "Giảm giá %" : draft.type === "amount" ? "Giảm giá theo tiền" : "Quà tặng";
    const startsAt = new Date(draft.startAt).getTime();
    const endsAt = new Date(draft.endAt).getTime();
    const now = Date.now();
    const selectedRows = previewProducts.filter((item) => item.id === selectedProduct);
    setSaving(true);
    setError("");
    try { await onSave({
      code, name: draft.name.trim(), description: draft.description.trim() || (draft.products === "specific" ? `Ưu đãi ${discountLabel} cho ${selectedRows[0]?.name || "sản phẩm đã chọn"}` : `Ưu đãi ${discountLabel} cho danh mục ${categoryLabel}`),
      type, discount: discountLabel, startDate, endDate, startsAt: new Date(draft.startAt).toISOString(), endsAt: new Date(draft.endAt).toISOString(),
      status: startsAt > now ? "Sắp diễn ra" : endsAt < now ? "Đã kết thúc" : "Đang diễn ra", uses: 0,
      image: selectedRows[0]?.image || "",
      visible: true, category: categoryLabel, categoryId: selectedCategory?.id || "", categoryScope: draft.products === "category",
      productIds: draft.products === "specific" ? [selectedProduct] : [], excludedProductIds: [],
      categories: [categoryLabel], products: draft.products === "category" ? [`Toàn bộ danh mục ${categoryLabel}`] : selectedRows.map((item) => `${item.sku} · ${item.name}`),
      conditions: [draft.condition === "none" ? "Không có điều kiện đơn hàng" : draft.condition === "minimum" ? `Đơn hàng tối thiểu ${formatMoney(Number(draft.minOrder) || 0)}` : "Áp dụng cho khách hàng thành viên", draft.codeLimit ? `Giới hạn ${draft.codeLimit} mã khuyến mãi` : "Không giới hạn số lượng mã", ...(draft.autoEnd ? ["Tự động kết thúc khi hết số lượng ưu đãi"] : [])],
      codeLimit: draft.codeLimit, autoEnd: draft.autoEnd, minOrder: draft.condition === "minimum" ? draft.minOrder : "",
      history: [{ label: "Chương trình được tạo", date: new Date().toLocaleString("vi-VN") }],
    }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu khuyến mãi."); } finally { setSaving(false); }
  };

  return <div className="promotion-create-workspace">
    <header className="promotion-create-heading"><div><button className="promotion-back-button" onClick={onBack} aria-label="Quay lại danh sách">←</button><div><h1>Tạo khuyến mãi</h1><p>Lập chương trình khuyến mãi để thu hút khách hàng và tăng doanh số bán hàng.</p></div></div></header>
    <form className="promotion-create-layout" onSubmit={save}>
      <main className="promotion-create-form">
        <section className="promotion-create-section">
          <h2><i>1</i> 1. Thông tin cơ bản</h2>
          <label className="create-field"><span>Tên chương trình khuyến mãi <b>*</b></span><input required maxLength={100} value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="Nhập tên chương trình"/><small>{draft.name.length}/100</small></label>
          <div className="create-field category-picker"><span>Danh mục áp dụng <b>*</b></span><div className="category-picker-control"><select value={draft.category} onChange={(event) => { set("category", event.target.value); setSelectedProduct(""); }} required><option value="">Chọn danh mục</option>{promotionCategories.map((item) => <option key={item.id} value={item.id}>{"　".repeat(Math.max(0, (item.level || 1) - 1))}{item.name}</option>)}</select><span className="category-chip">{draft.category && <>× {categoryLabel} <button type="button" aria-label="Bỏ danh mục" onClick={() => set("category", "")}>×</button></>}</span><b>⌄</b></div></div>
          <fieldset className="create-field promotion-type-choice"><legend>Loại khuyến mãi <b>*</b></legend><label><input type="radio" checked={draft.type === "percent"} onChange={() => set("type", "percent")} name="promotion-type"/><span>Giảm giá theo %</span></label><label><input type="radio" checked={draft.type === "amount"} onChange={() => set("type", "amount")} name="promotion-type"/><span>Giảm giá theo số tiền</span></label><label><input type="radio" checked={draft.type === "gift"} onChange={() => set("type", "gift")} name="promotion-type"/><span>Tặng quà / Voucher ↗</span></label></fieldset>
          <div className="create-two-fields"><label className="create-field"><span>Giá trị khuyến mãi <b>*</b></span><div className="input-suffix"><input required type="number" min={draft.type === "percent" ? "1" : "0"} max={draft.type === "percent" ? "100" : undefined} value={draft.value} onChange={(event) => set("value", event.target.value)}/><i>{draft.type === "percent" ? "%" : "₫"}</i></div></label><label className="create-field"><span>Số lượng mã (nếu có) <small>ⓘ</small></span><input type="number" min="1" value={draft.codeLimit} onChange={(event) => set("codeLimit", event.target.value)} placeholder="Không giới hạn"/></label></div>
          <fieldset className="create-field promotion-apply-choice"><legend>Áp dụng cho <b>*</b></legend><label className={draft.products === "category" ? "active" : ""}><input type="radio" name="promotion-scope" checked={draft.products === "category"} onChange={() => set("products", "category")}/><span><strong>1. Toàn bộ sản phẩm</strong><small>Áp dụng ưu đãi cho toàn bộ sản phẩm trong danh mục đã chọn.</small></span></label><label className={draft.products === "specific" ? "active" : ""}><input type="radio" name="promotion-scope" checked={draft.products === "specific"} onChange={() => set("products", "specific")}/><span><strong>2. Chọn một sản phẩm</strong><small>Chỉ áp dụng ưu đãi cho SKU bạn chọn bên dưới.</small></span></label></fieldset>
          <label className="create-field code-field"><span>Mã khuyến mãi</span><input maxLength={24} value={draft.code} onChange={(event) => set("code", event.target.value.toUpperCase())} placeholder="Tự tạo mã từ tên chương trình"/><small>Nếu để trống, hệ thống sẽ tạo mã tự động.</small></label>
        </section>

        <section className="promotion-create-section">
          <h2><i>2</i> 2. Thời gian áp dụng</h2>
          <div className="create-two-fields"><label className="create-field"><span>Thời gian bắt đầu <b>*</b></span><input required type="datetime-local" value={draft.startAt} onChange={(event) => set("startAt", event.target.value)}/></label><label className="create-field"><span>Thời gian kết thúc <b>*</b></span><input required type="datetime-local" value={draft.endAt} onChange={(event) => set("endAt", event.target.value)}/></label></div>
          <label className="create-switch-row"><input type="checkbox" checked={draft.autoEnd} onChange={(event) => set("autoEnd", event.target.checked)}/><span/>Tự động kết thúc khi đạt đủ số lượng <small>ⓘ</small></label>
          <label className="create-field minimum-quantity"><span>Số lượng đơn tối thiểu (tùy chọn) <small>ⓘ</small></span><div className="input-suffix"><input type="number" min="0" value={draft.minOrder} onChange={(event) => set("minOrder", event.target.value)}/><i>đơn</i></div></label>
        </section>

        <section className="promotion-create-section">
          <h2><i>3</i> 3. Điều kiện áp dụng</h2>
          <div className="create-radio-line"><label><input type="radio" name="condition" checked={draft.condition === "none"} onChange={() => set("condition", "none")}/>Không có điều kiện</label><label><input type="radio" name="condition" checked={draft.condition === "minimum"} onChange={() => set("condition", "minimum")}/>Đơn hàng tối thiểu</label><input className="condition-amount" disabled={draft.condition !== "minimum"} type="number" value={draft.minOrder} onChange={(event) => set("minOrder", event.target.value)}/><label><input type="radio" name="condition" checked={draft.condition === "member"} onChange={() => set("condition", "member")}/>Áp dụng cho thành viên GEME</label></div>
        </section>

        <section className="promotion-create-section">
          <h2><i>4</i> 4. Sản phẩm áp dụng</h2>
          <p className="promotion-sku-hint">{selectedCategory ? <>Danh mục đang chọn: <strong>{categoryLabel}</strong>{draft.products === "specific" ? ". Chọn đúng một sản phẩm trong danh mục để áp dụng." : ". Khuyến mãi áp dụng cho toàn bộ sản phẩm thuộc danh mục này."}</> : "Chọn danh mục ở trên để xác định sản phẩm áp dụng."}</p>
          {draft.products === "specific" && <div className="create-product-picker"><label className="create-search"><span>⌕</span><input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Tìm theo mã SKU hoặc tên sản phẩm..."/></label><label className="promotion-sku-select">Chọn một sản phẩm / SKU<select required value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Chọn sản phẩm trong danh mục {categoryLabel}</option>{filteredProducts.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} · {formatMoney(item.price)}</option>)}</select></label>{selectedProduct && <div className="promotion-selected-skus"><span><b>{previewProducts.find((item) => item.id === selectedProduct)?.sku}</b> · {previewProducts.find((item) => item.id === selectedProduct)?.name}<button type="button" aria-label="Bỏ sản phẩm đã chọn" onClick={() => setSelectedProduct("")}>×</button></span></div>}</div>}
        </section>

        <section className="promotion-create-section description-create-section"><h2><i>5</i> 5. Mô tả chi tiết (tùy chọn)</h2><label className="create-field"><textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => set("description", event.target.value)} placeholder="Nhập mô tả chi tiết về chương trình khuyến mãi, điều khoản áp dụng..."/><small>{draft.description.length}/500</small></label></section>
        {error && <p className="promotion-create-error" role="alert">{error}</p>}<div className="promotion-create-note"><span>ⓘ</span>Lưu ý: Khuyến mãi sẽ tự động được áp dụng khi khách hàng thỏa mãn điều kiện. Vui lòng kiểm tra kỹ thông tin trước khi lưu.</div>
      </main>

      <aside className="promotion-create-preview">
        <section className="promotion-preview-card">
          <h2>Xem trước chương trình khuyến mãi</h2>
          <article className="promotion-preview-banner"><div><span>{draft.type === "gift" ? "Quà tặng" : `Giảm ${discountLabel}`}</span><strong>{draft.name || "Tên chương trình khuyến mãi"}</strong><p>Thời gian: {startDateTime} - {endDateTime}</p></div>{previewProducts.find((item) => item.id === selectedProduct)?.image ? <img src={previewProducts.find((item) => item.id === selectedProduct)?.image} alt="Sản phẩm áp dụng"/> : <span className="promotion-image-placeholder">◇</span>}<i>● ·</i></article>
          <div className="promotion-preview-products-heading"><h3>Sản phẩm áp dụng</h3><button type="button" onClick={() => set("products", "specific")}>Chọn SKU →</button></div>
          <div className="promotion-preview-products">{previewProducts.filter((product) => draft.products === "category" || product.id === selectedProduct).slice(0, 8).map((product) => <article key={product.id}>{product.image ? <img src={product.image} alt={product.name}/> : <span className="promotion-image-placeholder">◇</span>}<strong>{product.sku} · {product.name}</strong><b>{formatMoney(product.price)}</b><span>{discountPreview}</span></article>)}{!previewProducts.length && <p>Danh mục này chưa có sản phẩm.</p>}{draft.products === "specific" && !selectedProduct && previewProducts.length > 0 && <p>Chọn một sản phẩm để xem trước ưu đãi.</p>}</div>
          <section className="promotion-quick-info"><h3><span>♧</span> Thông tin nhanh</h3><dl><dt>Loại khuyến mãi</dt><dd>{draft.type === "percent" ? "Giảm giá theo %" : draft.type === "amount" ? "Giảm giá theo số tiền" : "Tặng quà / Voucher"}</dd><dt>Danh mục áp dụng</dt><dd>{categoryLabel}</dd><dt>Thời gian</dt><dd>{startDateTime} - {endDateTime}</dd><dt>Số lượng mã</dt><dd>{draft.codeLimit || "Không giới hạn"}</dd></dl></section>
        </section>
        <div className="promotion-create-actions"><button type="button" className="button button-quiet" onClick={onBack} disabled={saving}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Đang lưu…" : "▦  Lưu khuyến mãi"}</button></div>
      </aside>
    </form>
  </div>;
}
