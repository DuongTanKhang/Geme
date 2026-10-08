"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";

const JEWELRY_SCOPE="Trang sức";
const GEMSTONE_SCOPE="Đá quý";
export type MaterialScope=typeof JEWELRY_SCOPE|typeof GEMSTONE_SCOPE;
export type MaterialOptionKind = "STONE";
export type MaterialOption = {
  id: string;
  name: string;
  scope: MaterialScope;
  kind: MaterialOptionKind;
  active: boolean;
  imageUrl?: string;
  sortOrder?: number;
};
export type MaterialMutationValue = Partial<Omit<MaterialOption, "id" | "imageUrl">> & { imageUrl?: string | null };
export type MaterialSyncStatus = "connecting" | "connected" | "offline";

export const DEFAULT_MATERIALS: MaterialOption[] = [];
export function normalizeMaterialOptions(options: unknown): MaterialOption[] {
  if (!Array.isArray(options)) return DEFAULT_MATERIALS;
  return options.map((raw, index) => {
    const item = raw as Partial<Omit<MaterialOption, "scope">> & { kind?: string; scope?: string };
    const scope: MaterialScope=item.scope===GEMSTONE_SCOPE||item.scope==="GEMSTONE"?GEMSTONE_SCOPE:JEWELRY_SCOPE;
    return {
      id: String(item.id ?? `MAT-${scope === "Trang sức" ? "J" : "G"}-${index + 1}`),
      name: String(item.name ?? ""),
      scope,
      kind: "STONE" as const,
      active: item.active !== false,
      ...(typeof item.imageUrl === "string" ? { imageUrl: item.imageUrl } : {}),
      sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
    };
  }).filter((item) => item.name.trim().length > 0);
}

type Props = {
  materials: MaterialOption[];
  onChange: (materials: MaterialOption[]) => void;
  onPersist: (method: "POST" | "PATCH" | "DELETE", id?: string, value?: MaterialMutationValue) => Promise<MaterialOption | null>;
  onNotify: (message: string) => void;
  syncStatus: MaterialSyncStatus;
};

function makeThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Chọn một tệp ảnh hợp lệ."));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Ảnh cần nhỏ hơn 8 MB."));
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxDimension = 96;
      const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(source);
        reject(new Error("Không xử lý được ảnh này."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL("image/webp", 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Không đọc được tệp ảnh.")); };
    image.src = source;
  });
}

export default function MaterialsWorkspace({ materials, onChange, onPersist, onNotify, syncStatus }: Props) {
  const [scope, setScope] = useState<MaterialScope>("Trang sức");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftScope, setDraftScope] = useState<MaterialScope>("Trang sức");
  const [draftImage, setDraftImage] = useState("");
  const [saving, setSaving] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => materials.filter((item) => item.scope === scope && item.kind === "STONE" && (!search.trim() || item.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))), [materials, scope, search]);

  const startEdit = (item: MaterialOption) => { setEditingId(item.id); setDraftName(item.name); setDraftScope(item.scope); setDraftImage(item.imageUrl ?? ""); if (imageInput.current) imageInput.current.value = ""; };
  const resetForm = () => { setEditingId(""); setDraftName(""); setDraftScope(scope); setDraftImage(""); if (imageInput.current) imageInput.current.value = ""; };

  const save = async () => {
    const name = draftName.trim();
    if (!name) { onNotify("Nhập tên chất liệu hoặc loại đá."); return; }
    const duplicate = materials.some((item) => item.scope === draftScope && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi") && item.id !== editingId);
    if (duplicate) { onNotify("Tên này đã có trong danh sách của nhóm sản phẩm."); return; }
    const current = materials.find((item) => item.id === editingId);
    const value: MaterialMutationValue = {
      name,
      scope: draftScope,
      kind: "STONE",
      active: current?.active ?? true,
      imageUrl: draftImage || null,
      sortOrder: current?.sortOrder ?? rows.length,
    };
    setSaving(true);
    try {
      const saved = await onPersist(editingId ? "PATCH" : "POST", editingId || undefined, value);
      if (!saved) throw new Error("API không trả về dữ liệu đã lưu.");
      onChange(editingId ? materials.map((item) => item.id === editingId ? saved : item) : [saved, ...materials]);
      resetForm();
      onNotify(editingId ? "Đã cập nhật và đồng bộ menu loại đá." : "Đã thêm và đồng bộ menu loại đá.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu vào API.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: MaterialOption) => {
    if (!window.confirm(`Xóa “${item.name}” khỏi danh sách ${item.scope}? Sản phẩm đang dùng loại đá này sẽ bỏ liên kết; quy tắc SKU cũng được cập nhật.`)) return;
    setSaving(true);
    try {
      await onPersist("DELETE", item.id);
      onChange(materials.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) resetForm();
      onNotify(`Đã xóa “${item.name}”, gỡ liên kết trên sản phẩm và cập nhật quy tắc SKU.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xóa từ API.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: MaterialOption) => {
    setSaving(true);
    try {
      const saved = await onPersist("PATCH", item.id, { active: !item.active });
      if (!saved) throw new Error("API không trả về trạng thái mới.");
      onChange(materials.map((entry) => entry.id === item.id ? saved : entry));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái qua API.");
    } finally {
      setSaving(false);
    }
  };

  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try { setDraftImage(await makeThumbnail(file)); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không xử lý được ảnh."); }
  };

  const syncLabel = syncStatus === "connected" ? "API đã kết nối" : syncStatus === "connecting" ? "Đang kết nối API…" : "API chưa kết nối";

  return <div className="materials-workspace">
    <div className="materials-heading"><div><h1>Loại đá</h1><p>Quản lý riêng loại đá gắn với trang sức và sản phẩm mặt đá quý.</p><span className={`material-sync-status ${syncStatus}`}>{syncLabel}</span></div></div>
    {syncStatus === "offline" && <div className="material-api-warning" role="status">Chưa kết nối API. Danh mục ở admin chưa thể cập nhật lên menu website.</div>}
    <div className="materials-tabs" role="tablist" aria-label="Chọn danh sách"><button className={scope === "Trang sức" ? "active" : ""} role="tab" aria-selected={scope === "Trang sức"} onClick={() => { setScope("Trang sức"); setDraftScope("Trang sức"); setEditingId(""); }}>Trang sức <span>{materials.filter((item) => item.scope === "Trang sức").length}</span></button><button className={scope === "Đá quý" ? "active" : ""} role="tab" aria-selected={scope === "Đá quý"} onClick={() => { setScope("Đá quý"); setDraftScope("Đá quý"); setEditingId(""); }}>Mặt đá quý <span>{materials.filter((item) => item.scope === "Đá quý").length}</span></button></div>
    <div className="materials-layout">
      <section className="materials-table-panel"><div className="materials-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm loại đá..." /></label><span>{rows.length} mục</span></div><div className="materials-table-wrap"><table><thead><tr><th>Tên loại đá</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.length ? rows.map((item) => <tr key={item.id}><td><span className="material-row-name">{item.imageUrl ? <img className="material-row-image" src={item.imageUrl} alt="" /> : <span className="material-row-placeholder">◇</span>}<span><strong>{item.name}</strong><small>{item.scope === "Trang sức" ? "Đá gắn trang sức · hiển thị trong menu" : "Phân loại sản phẩm mặt đá quý"}</small></span></span></td><td><button className={`material-state ${item.active ? "active" : "inactive"}`} onClick={() => void toggle(item)} disabled={saving}>{item.active ? "Đang dùng" : "Đã ẩn"}</button></td><td><div className="materials-actions"><button onClick={() => startEdit(item)} disabled={saving}>Sửa</button><button className="danger" onClick={() => void remove(item)} disabled={saving}>Xóa</button></div></td></tr>) : <tr><td className="materials-empty" colSpan={3}>Danh sách này chưa có mục nào.</td></tr>}</tbody></table></div></section>
      <aside className="materials-editor"><h2>{editingId ? "Sửa loại đá" : "Thêm loại đá"}</h2><p>{draftScope === "Đá quý" ? "Danh sách loại đá dùng riêng để phân loại sản phẩm mặt đá quý." : "Loại đá gắn với trang sức và hiển thị trong menu website."}</p><label><span>Danh sách áp dụng</span><select value={draftScope} onChange={(event) => setDraftScope(event.target.value as MaterialScope)}><option>Trang sức</option><option>Đá quý</option></select></label><label><span>Tên loại đá</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Ví dụ: Amethyst, Moonstone..." onKeyDown={(event) => { if (event.key === "Enter") void save(); }} /></label><div className="material-image-field"><span>Ảnh đại diện loại đá</span><div className="material-image-control">{draftImage ? <img src={draftImage} alt="Xem trước ảnh loại đá" /> : <span className="material-image-placeholder">◇</span>}<div><button type="button" className="button button-quiet" onClick={() => imageInput.current?.click()} disabled={saving}>{draftImage ? "Đổi ảnh" : "Chọn ảnh"}</button>{draftImage && <button type="button" className="material-remove-image" onClick={() => setDraftImage("")} disabled={saving}>Gỡ ảnh</button>}<small>Ảnh sẽ được thu nhỏ và nén để hiển thị dạng tròn trong menu.</small></div></div><input ref={imageInput} className="material-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImage(event)} /></div><div><button className="button button-quiet" onClick={resetForm} disabled={saving}>Làm mới</button><button className="button button-primary" onClick={() => void save()} disabled={saving || syncStatus !== "connected"}>{saving ? "Đang lưu…" : "Lưu mục"}</button></div></aside>
    </div>
  </div>;
}
