"use client";

import { useMemo, useState, type FormEvent } from "react";

type Promotion = {
  code: string;
  name: string;
  description: string;
  type: string;
  discount: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  status: string;
  uses: number;
  image: string;
  visible: boolean;
  conditions: string[];
  products: string[];
  history: { label: string; date: string }[];
  [key: string]: unknown;
};

type Props = {
  promotions: Record<string, any>[];
  onChange: (promotions: Record<string, any>[]) => void;
  onCreate: () => void;
  onNotify: (message: string) => void;
  onPersist: (promotion: Promotion) => Promise<Promotion>;
};

const campaignRows = (saved: Record<string, any>[]): Promotion[] => saved.map((item) => ({
  ...item, code: String(item.code || ""), name: String(item.name || ""), description: String(item.description || ""),
  type: String(item.type || "Giảm giá %"), discount: String(item.discount || ""), startDate: String(item.startDate || ""),
  startTime: String(item.startTime || ""), endDate: String(item.endDate || ""), endTime: String(item.endTime || ""), status: normalizeStatus(item.status, "Tạm dừng"), uses: Number(item.uses) || 0,
  image: String(item.image || ""), visible: item.visible ?? false, conditions: Array.isArray(item.conditions) ? item.conditions : [],
  products: Array.isArray(item.products) ? item.products : [], history: Array.isArray(item.history) ? item.history : [],
})) as Promotion[];

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value || 0)}₫`;
function normalizeStatus(status: unknown, fallback: string) {
  const value = String(status || "");
  if (["Đang diễn ra", "Sắp diễn ra", "Đã kết thúc", "Tạm dừng"].includes(value)) return value;
  if (["Đang áp dụng", "Đang hoạt động"].includes(value)) return "Đang diễn ra";
  if (["Sắp áp dụng", "Sắp diễn ra"].includes(value)) return "Sắp diễn ra";
  if (["Đã hết hạn", "Đã kết thúc"].includes(value)) return "Đã kết thúc";
  return fallback;
}

function Status({ value }: { value: string }) {
  const kind = value === "Đang diễn ra" ? "live" : value === "Sắp diễn ra" ? "upcoming" : value === "Tạm dừng" ? "paused" : "ended";
  return <span className={`promotion-status ${kind}`}><i/>{value}</span>;
}

function promotionWindow(item: Pick<Promotion, "startDate" | "startTime" | "endDate" | "endTime">) {
  const start = `${item.startDate}${item.startTime ? ` ${item.startTime}` : ""}`;
  const end = `${item.endDate}${item.endTime ? ` ${item.endTime}` : ""}`;
  return `${start} - ${end}`;
}

function PromotionEditor({ initial, onClose, onSave }: { initial?: Promotion; onClose: () => void; onSave: (item: Promotion) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Promotion>(initial || {
    code: "", name: "", description: "", type: "Giảm giá %", discount: "",
    startDate: "", startTime: "00:00", endDate: "", endTime: "23:59", status: "Tạm dừng", uses: 0,
    image: "", visible: false, conditions: [], products: [], history: [],
  });
  const update = (key: keyof Promotion, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(""); try { await onSave({ ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim(), description: draft.description.trim(), conditions: draft.conditions.filter(Boolean) }); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể lưu khuyến mãi."); } finally { setSaving(false); } };
  return <div className="promotion-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="promotion-modal" role="dialog" aria-modal="true" aria-labelledby="promotion-editor-title">
      <header><div><span className="eyebrow">GEME ADMIN</span><h2 id="promotion-editor-title">{initial ? "Chỉnh sửa khuyến mãi" : "Tạo khuyến mãi mới"}</h2><p>Tạo chương trình ưu đãi để khách hàng dễ dàng khám phá.</p></div><button className="promotion-icon-button" onClick={onClose} aria-label="Đóng">×</button></header>
      <form onSubmit={submit}>
        <div className="promotion-form-grid">
          <label className="promotion-field wide"><span>Tên chương trình <b>*</b></span><input required value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Ví dụ: Sale mùa thu"/></label>
          <label className="promotion-field"><span>Mã khuyến mãi <b>*</b></span><input required value={draft.code} onChange={(event) => update("code", event.target.value.toUpperCase())}/></label>
          <label className="promotion-field"><span>Loại khuyến mãi</span><select value={draft.type} onChange={(event) => update("type", event.target.value)}><option>Giảm giá %</option><option>Giảm giá theo tiền</option><option>Miễn phí ship</option><option>Quà tặng</option><option>Tích điểm</option></select></label>
          <label className="promotion-field wide"><span>Giá trị ưu đãi</span><input value={draft.discount} onChange={(event) => update("discount", event.target.value)} placeholder="Ví dụ: 15% hoặc 100.000₫"/></label>
          <label className="promotion-field"><span>Ngày bắt đầu</span><input required inputMode="numeric" pattern="\d{1,2}/\d{1,2}/\d{4}" value={draft.startDate} onChange={(event) => update("startDate", event.target.value)} placeholder="dd/mm/yyyy"/></label>
          <label className="promotion-field"><span>Ngày kết thúc</span><input required inputMode="numeric" pattern="\d{1,2}/\d{1,2}/\d{4}" value={draft.endDate} onChange={(event) => update("endDate", event.target.value)} placeholder="dd/mm/yyyy"/></label>
          <label className="promotion-field"><span>Giờ bắt đầu</span><input type="time" value={draft.startTime} onChange={(event) => update("startTime", event.target.value)} required/></label>
          <label className="promotion-field"><span>Giờ kết thúc</span><input type="time" value={draft.endTime} onChange={(event) => update("endTime", event.target.value)} required/></label>
          <label className="promotion-field wide"><span>Mô tả ngắn</span><textarea rows={2} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Mô tả ưu đãi dành cho khách hàng"/></label>
          <label className="promotion-field wide"><span>Sản phẩm áp dụng</span><input value={draft.products.join(", ")} onChange={(event) => update("products", event.target.value.split(",").map((part) => part.trim()))} placeholder="Tất cả sản phẩm hoặc nhập tên sản phẩm"/></label>
          <label className="promotion-field wide"><span>Điều kiện áp dụng</span><textarea rows={2} value={draft.conditions.join("\n")} onChange={(event) => update("conditions", event.target.value.split("\n"))} placeholder="Mỗi điều kiện một dòng"/></label>
        </div>
        <label className="promotion-visible-field"><input type="checkbox" checked={draft.visible} onChange={(event) => update("visible", event.target.checked)}/><span>Hiển thị chương trình trên website</span></label>
        {error && <p className="promotion-create-error" role="alert">{error}</p>}<footer><button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu khuyến mãi"}</button></footer>
      </form>
    </section>
  </div>;
}

export default function PromotionsWorkspace({ promotions, onChange, onCreate, onNotify, onPersist }: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("Tất cả loại khuyến mãi");
  const [status, setStatus] = useState("Tất cả trạng thái");
  const [selectedCode, setSelectedCode] = useState("");
  const [tab, setTab] = useState("Thông tin chung");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Promotion | undefined>();
  const [creating, setCreating] = useState(false);
  const allPromotions = useMemo(() => campaignRows(promotions), [promotions]);
  const filtered = useMemo(() => allPromotions.filter((item) => {
    const text = `${item.name} ${item.code} ${item.description}`.toLocaleLowerCase("vi");
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase("vi"))) && (type === "Tất cả loại khuyến mãi" || item.type === type) && (status === "Tất cả trạng thái" || item.status === status);
  }), [allPromotions, query, type, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const pageRows = filtered.slice((page - 1) * 10, page * 10);
  const selected = allPromotions.find((item) => item.code === selectedCode) || filtered[0] || allPromotions[0];
  const counts = { total: allPromotions.length, live: allPromotions.filter((item) => item.status === "Đang diễn ra").length, upcoming: allPromotions.filter((item) => item.status === "Sắp diễn ra").length, ended: allPromotions.filter((item) => item.status === "Đã kết thúc").length };
  const commit = (next: Promotion[]) => onChange(next as Record<string, any>[]);
  const savePromotion = (item: Promotion) => {
    return onPersist(item).then((saved) => {
    const exists = allPromotions.some((candidate) => candidate.code === editing?.code || candidate.code === item.code);
    const next = exists ? allPromotions.map((candidate) => candidate.code === (editing?.code || item.code) ? { ...saved, history: [...(candidate.history || []), { label: editing ? "Thông tin chương trình được cập nhật" : "Chương trình được tạo", date: new Date().toLocaleString("vi-VN") }] } : candidate) : [{ ...saved, history: [{ label: "Chương trình được tạo", date: new Date().toLocaleString("vi-VN") }] }, ...allPromotions];
    commit(next);
    setSelectedCode(saved.code);
    setCreating(false);
    setEditing(undefined);
    onNotify(editing ? "Đã cập nhật chương trình khuyến mãi vào database." : "Đã tạo chương trình khuyến mãi.");
    });
  };
  const updatePromotion = (code: string, changes: Partial<Promotion>, message: string) => {
    commit(allPromotions.map((item) => item.code === code ? { ...item, ...changes } : item));
    onNotify(message);
  };
  const copyPromotion = (item: Promotion) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(item.code).then(() => onNotify(`Đã sao chép mã ${item.code}.`)).catch(() => onNotify(`Mã khuyến mãi: ${item.code}`));
    else onNotify(`Mã khuyến mãi: ${item.code}`);
  };
  const duplicatePromotion = (item: Promotion) => {
    const base = `${item.code}-COPY`;
    let code = base;
    let counter = 2;
    while (allPromotions.some((row) => row.code === code)) code = `${base}${counter++}`;
    const copy = { ...item, code, name: `${item.name} (bản sao)`, status: "Tạm dừng", visible: false, uses: 0, history: [{ label: "Sao chép chương trình", date: new Date().toLocaleString("vi-VN") }] };
    commit([copy, ...allPromotions]);
    setSelectedCode(code);
    onNotify(`Đã sao chép chương trình thành mã ${code}.`);
  };
  const deletePromotion = (item: Promotion) => {
    if (!window.confirm(`Xóa chương trình “${item.name}”?`)) return;
    commit(allPromotions.filter((row) => row.code !== item.code));
    const next = allPromotions.find((row) => row.code !== item.code);
    setSelectedCode(next?.code || "");
    onNotify("Đã xóa chương trình khuyến mãi.");
  };
  const submitFilters = (event: FormEvent<HTMLFormElement>) => event.preventDefault();

  return <div className="promotions-workspace">
    <main className="promotions-main">
      <div className="promotions-heading"><div><h1>Khuyến mãi</h1><p>Quản lý các chương trình khuyến mãi, mã giảm giá và ưu đãi dành cho khách hàng.</p></div><button className="button button-primary" onClick={onCreate}><span className="promotion-plus">＋</span>Tạo khuyến mãi mới</button></div>
      <section className="promotion-stats" aria-label="Thống kê khuyến mãi">
        <button className="promotion-stat" onClick={() => setStatus("Tất cả trạng thái")}><span className="promotion-stat-icon green">◇</span><span><small>Tổng khuyến mãi</small><strong>{counts.total}</strong></span></button>
        <button className="promotion-stat" onClick={() => setStatus("Đang diễn ra")}><span className="promotion-stat-icon pink">％</span><span><small>Đang diễn ra</small><strong>{counts.live}</strong></span></button>
        <button className="promotion-stat" onClick={() => setStatus("Sắp diễn ra")}><span className="promotion-stat-icon amber">◷</span><span><small>Sắp diễn ra</small><strong>{counts.upcoming}</strong></span></button>
        <button className="promotion-stat" onClick={() => setStatus("Đã kết thúc")}><span className="promotion-stat-icon mint">✓</span><span><small>Đã kết thúc</small><strong>{counts.ended}</strong></span></button>
      </section>
      <section className="promotion-list-panel">
        <form className="promotion-toolbar" onSubmit={submitFilters}>
          <label className="promotion-search"><span>⌕</span><input aria-label="Tìm khuyến mãi" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Tìm kiếm chương trình, mã giảm giá..."/></label>
          <select aria-label="Loại khuyến mãi" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option>Tất cả loại khuyến mãi</option><option>Giảm giá %</option><option>Giảm giá theo tiền</option><option>Miễn phí ship</option><option>Quà tặng</option><option>Tích điểm</option></select>
          <select aria-label="Trạng thái khuyến mãi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option>Tất cả trạng thái</option><option>Đang diễn ra</option><option>Sắp diễn ra</option><option>Đã kết thúc</option><option>Tạm dừng</option></select>
          <button className="promotion-date-filter" type="button" onClick={() => onNotify("Bộ lọc ngày sẽ hoạt động khi kết nối dữ liệu.")}><span>▦</span>Lọc theo ngày</button>
          <button className="promotion-filter-button" type="button" aria-label="Bộ lọc nâng cao" onClick={() => onNotify("Bộ lọc nâng cao sẽ có sau khi kết nối dữ liệu.")}>☷</button>
        </form>
        <div className="promotion-table-scroll"><table className="promotion-table"><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả khuyến mãi"/></th><th>Tên chương trình</th><th>Loại</th><th>Mã giảm giá</th><th>Giá trị</th><th>Thời gian áp dụng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {pageRows.length ? pageRows.map((item) => <tr key={item.code} className={selected?.code === item.code ? "selected" : ""} onClick={() => { setSelectedCode(item.code); setTab("Thông tin chung"); }}>
            <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${item.name}`}/></td><td><div className="promotion-campaign-cell">{item.image ? <img src={item.image} alt=""/> : <span className="promotion-image-placeholder">◇</span>}<span><strong>{item.name}</strong><small>{item.description}</small></span></div></td><td><span className={`promotion-type ${item.type.includes("ship") ? "ship" : item.type === "Quà tặng" ? "gift" : item.type === "Tích điểm" ? "points" : "discount"}`}>{item.type}</span></td><td className="promotion-code-cell">{item.code}</td><td>{item.discount}</td><td className="promotion-dates-cell">{promotionWindow(item)}</td><td><Status value={item.status}/></td><td onClick={(event) => event.stopPropagation()}><div className="promotion-row-actions"><button aria-label={`Sửa ${item.name}`} onClick={() => { setEditing(item); setCreating(true); }}>✎</button><button aria-label={`Sao chép ${item.name}`} onClick={() => duplicatePromotion(item)}>•••</button></div></td>
          </tr>) : <tr><td colSpan={8} className="promotion-empty">{allPromotions.length ? "Không tìm thấy chương trình khuyến mãi phù hợp." : "Chưa có chương trình khuyến mãi."}</td></tr>}
        </tbody></table></div>
        <div className="promotion-pagination"><span>Hiển thị {filtered.length ? (page - 1) * 10 + 1 : 0} - {Math.min(page * 10, filtered.length)} / {filtered.length} khuyến mãi</span><div><button aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={page === number ? "current" : ""} onClick={() => setPage(number)}>{number}</button>)}<button aria-label="Trang sau" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></div>
      </section>
    </main>

    <aside className="promotion-detail-panel">
      {selected ? <>
        <div className="promotion-detail-heading"><h2>Chi tiết khuyến mãi</h2><button aria-label="Đóng chi tiết" onClick={() => setSelectedCode("")}>×</button></div>
        <div className="promotion-detail-overview">{selected.image ? <img src={selected.image} alt=""/> : <span className="promotion-image-placeholder">◇</span>}<div><h3>{selected.name}</h3><p>{selected.description}</p><Status value={selected.status}/><dl><dt>Mã giảm giá</dt><dd><strong>{selected.code}</strong><button aria-label="Sao chép mã" onClick={() => copyPromotion(selected)}>▢</button></dd><dt>Giá trị</dt><dd>{selected.discount}</dd><dt>Thời gian áp dụng</dt><dd>{promotionWindow(selected)}</dd></dl></div></div>
        <nav className="promotion-detail-tabs" aria-label="Chi tiết chương trình">{["Thông tin chung", "Sản phẩm áp dụng", "Lịch sử"].map((label) => <button key={label} className={tab === label ? "active" : ""} onClick={() => setTab(label)}>{label}</button>)}</nav>
        {tab === "Thông tin chung" ? <>
          <section className="promotion-detail-card"><h3>Thông tin chung</h3><dl><dt>Loại khuyến mãi</dt><dd><span className="promotion-type discount">{selected.type}</span></dd><dt>Giá trị giảm</dt><dd>{selected.discount}</dd><dt>Mã giảm giá</dt><dd>{selected.code}<button aria-label="Sao chép mã" onClick={() => copyPromotion(selected)}>▢</button></dd><dt>Thời gian áp dụng</dt><dd>{promotionWindow(selected)}</dd><dt>Trạng thái</dt><dd><Status value={selected.status}/></dd></dl></section>
          <section className="promotion-detail-card promotion-conditions"><h3>Điều kiện áp dụng</h3><ul>{selected.conditions.map((condition, index) => <li key={`${condition}-${index}`}>{condition}</li>)}</ul></section>
          <section className="promotion-visibility"><div><strong>Hiển thị trên website</strong><label className="promotion-switch"><input type="checkbox" checked={selected.visible} onChange={(event) => updatePromotion(selected.code, { visible: event.target.checked }, event.target.checked ? "Đã bật hiển thị chương trình." : "Đã ẩn chương trình trên website.")}/><span/><small>{selected.visible ? "Đang hiển thị" : "Đang ẩn"}</small></label></div></section>
          <section className="promotion-action-section"><h3>Hành động</h3><div className="promotion-actions"><button onClick={() => { setEditing(selected); setCreating(true); }}>✎ <span>Sửa</span></button><button onClick={() => duplicatePromotion(selected)}>▣ <span>Sao chép</span></button><button onClick={() => updatePromotion(selected.code, { status: selected.status === "Tạm dừng" ? "Đang diễn ra" : "Tạm dừng" }, selected.status === "Tạm dừng" ? "Đã tiếp tục chương trình." : "Đã tạm dừng chương trình.")}>{selected.status === "Tạm dừng" ? "▶" : "Ⅱ"} <span>{selected.status === "Tạm dừng" ? "Tiếp tục" : "Tạm dừng"}</span></button><button className="danger" onClick={() => deletePromotion(selected)}>× <span>Xóa</span></button></div></section>
        </> : tab === "Sản phẩm áp dụng" ? <section className="promotion-detail-card promotion-applied-products"><h3>Sản phẩm áp dụng <small>{selected.products.length} nhóm</small></h3>{selected.products.map((product, index) => <div key={`${product}-${index}`}><img src={selected.image} alt=""/><span><strong>{product}</strong><small>{product === "Tất cả sản phẩm" ? "Toàn bộ danh mục" : "Đang áp dụng ưu đãi"}</small></span><b>›</b></div>)}<button className="promotion-outline-button" onClick={() => { setEditing(selected); setCreating(true); }}>Chỉnh sửa phạm vi áp dụng</button></section> : <section className="promotion-detail-card promotion-history"><h3>Lịch sử hoạt động</h3>{selected.history.length ? selected.history.map((entry, index) => <div key={`${entry.label}-${index}`}><i/><span><strong>{entry.label}</strong><small>{entry.date}</small></span></div>) : <p>Chưa có lịch sử cập nhật.</p>}</section>}
      </> : <div className="promotion-detail-empty"><strong>Chọn chương trình</strong><span>Chọn một khuyến mãi để xem chi tiết.</span></div>}
    </aside>
    {creating && <PromotionEditor initial={editing} onClose={() => { setCreating(false); setEditing(undefined); }} onSave={savePromotion}/>}
  </div>;
}
