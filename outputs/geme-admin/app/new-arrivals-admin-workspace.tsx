"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialOption } from "./materials-model";

export type AdminJewelryStoneGroup = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  sortOrder: number;
  pinnedOrder: number | null;
  _count?: { products: number };
  categories?: Array<{ id: string }>;
  materials?: Array<{ id: string }>;
};

type Request = (path: string, method?: string, body?: unknown) => Promise<any>;

type Props = {
  request: Request;
  categories: AdminCategory[];
  materials: MaterialOption[];
  canReadCatalog: boolean;
  canWriteCatalog: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  onGroupsLoaded?: (groups: AdminJewelryStoneGroup[]) => void;
};

type Source = { id: string; name: string; jewelryStoneGroupId?: string | null };
type UnassignedProduct = { id: string; sku: string; name: string; issue: string };
type ConflictProduct = { id: string; sku: string; name: string; category_group: string; material_group: string };

const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function NewArrivalsAdminWorkspace({ request, categories, materials, canReadCatalog, canWriteCatalog, onClose, onNotify, onGroupsLoaded }: Props) {
  const [groups, setGroups] = useState<AdminJewelryStoneGroup[]>([]);
  const [unassignedProducts, setUnassignedProducts] = useState(0);
  const [mappingConflicts, setMappingConflicts] = useState(0);
  const [unassignedPreview, setUnassignedPreview] = useState<UnassignedProduct[]>([]);
  const [conflictPreview, setConflictPreview] = useState<ConflictProduct[]>([]);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const groupResult = canReadCatalog ? await request("admin/catalog/jewelry-stone-groups") : null;
      if (groupResult) {
        const nextGroups = Array.isArray(groupResult.groups) ? groupResult.groups : [];
        setGroups(nextGroups);
        onGroupsLoaded?.(nextGroups);
        setUnassignedProducts(Number(groupResult.unassignedProducts) || 0);
        setMappingConflicts(Number(groupResult.mappingConflicts) || 0);
        setUnassignedPreview(Array.isArray(groupResult.unassignedPreview) ? groupResult.unassignedPreview : []);
        setConflictPreview(Array.isArray(groupResult.conflictPreview) ? groupResult.conflictPreview : []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được cấu hình New Arrivals.");
    } finally {
      setLoading(false);
    }
  }, [canReadCatalog, onGroupsLoaded, request]);

  useEffect(() => { void load(); }, [load]);

  const saveGroup = async (group: AdminJewelryStoneGroup) => {
    setSaving(group.id);
    try {
      await request(`admin/catalog/jewelry-stone-groups/${encodeURIComponent(group.id)}`, "PATCH", {
        name: group.name,
        slug: group.slug,
        active: group.active,
        sortOrder: Number(group.sortOrder),
        pinnedOrder: group.pinnedOrder == null ? null : Number(group.pinnedOrder),
      });
      await load();
      onNotify(`Đã lưu nhóm đá ${group.name}.`);
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : "Không lưu được nhóm đá.");
    } finally { setSaving(""); }
  };

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setSaving("create");
    try {
      await request("admin/catalog/jewelry-stone-groups", "POST", { name: newName.trim(), slug: newSlug.trim() || slugify(newName), sortOrder: groups.length });
      setNewName(""); setNewSlug(""); await load(); onNotify("Đã tạo nhóm đá chuẩn hóa.");
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không tạo được nhóm đá."); }
    finally { setSaving(""); }
  };

  const saveMapping = async (type: "category" | "material", source: Source, groupId: string) => {
    setSaving(`${type}:${source.id}`);
    try {
      await request(`admin/catalog/jewelry-stone-group-mappings/${type}/${encodeURIComponent(source.id)}`, "PATCH", { jewelryStoneGroupId: groupId || null });
      await load(); onNotify(`Đã cập nhật nhóm đá cho ${source.name}.`);
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : "Không lưu được ánh xạ nhóm đá."); }
    finally { setSaving(""); }
  };

  const categorySources: Source[] = categories.filter((item) => item.kind === "Đá quý" && item.usage === "stone" && item.status === "Hoạt động").map((item: any) => ({ id: item.id, name: item.name, jewelryStoneGroupId: item.jewelryStoneGroupId ?? groups.find((group) => group.categories?.some((mapped) => mapped.id === item.id))?.id ?? null }));
  const materialSources: Source[] = materials.filter((item) => item.scope === "Trang sức" && item.active).map((item: any) => ({ id: item.id, name: item.name, jewelryStoneGroupId: item.jewelryStoneGroupId ?? groups.find((group) => group.materials?.some((mapped) => mapped.id === item.id))?.id ?? null }));

  return <div className="dialog-backdrop new-arrivals-admin-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="new-arrivals-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="new-arrivals-admin-title">
      <header className="new-arrivals-admin-heading"><div><span className="eyebrow">GEME / CATALOG</span><h2 id="new-arrivals-admin-title">New Arrivals &amp; nhóm đá</h2><p>Quản lý nhãn “Mới” và cách gom trang sức theo dữ liệu đã xác nhận.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Đóng">×</button></header>
      {loading ? <div className="new-arrivals-admin-state">Đang tải cấu hình…</div> : error ? <div className="new-arrivals-admin-state is-error" role="alert">{error}<button type="button" className="button button-quiet" onClick={() => void load()}>Thử lại</button></div> : <>
        {canWriteCatalog && <>
          <div className="new-arrivals-admin-health"><span><b>{unassignedProducts}</b> sản phẩm chưa xác định nhóm đá</span><span><b>{mappingConflicts}</b> xung đột mapping loại đá</span><small>Sản phẩm chưa phân loại vẫn hiện ở nhóm cuối “Trang sức khác”. Mapping chỉ áp dụng khi hai nguồn không mâu thuẫn.</small></div>
          {(unassignedPreview.length > 0 || conflictPreview.length > 0) && <div className="new-arrivals-admin-issues">{unassignedPreview.length > 0 && <details><summary>Chưa xác định nhóm ({unassignedProducts})</summary>{unassignedPreview.map((product) => <p key={product.id}><code>{product.sku}</code> · {product.name} <small>{product.issue}</small></p>)}</details>}{conflictPreview.length > 0 && <details><summary>Xung đột mapping ({mappingConflicts})</summary>{conflictPreview.map((product) => <p key={product.id}><code>{product.sku}</code> · {product.name} <small>Danh mục: {product.category_group} · Đá gắn: {product.material_group}</small></p>)}</details>}</div>}
          <form className="new-arrivals-admin-create" onSubmit={createGroup}><strong>Tạo nhóm đá chuẩn</strong><input value={newName} onChange={(event) => { setNewName(event.target.value); if (!newSlug) setNewSlug(slugify(event.target.value)); }} placeholder="Tên nhóm, ví dụ Emerald" aria-label="Tên nhóm đá mới" required/><input value={newSlug} onChange={(event) => setNewSlug(slugify(event.target.value))} placeholder="emerald" aria-label="Slug nhóm đá mới"/><button className="button button-primary" disabled={saving === "create"}>{saving === "create" ? "Đang tạo…" : "Thêm nhóm"}</button></form>
          <div className="new-arrivals-admin-groups">{groups.map((group, index) => <details className="new-arrivals-admin-group" key={group.id} open={index < 2}><summary><span><strong>{group.name}</strong><small>/{group.slug} · {group._count?.products ?? 0} sản phẩm</small></span><em>{group.active ? "Đang hoạt động" : "Tạm dừng"}</em></summary><div className="new-arrivals-admin-group-form">
            <label>Tên<input value={group.name} onChange={(event) => setGroups((old) => old.map((item) => item.id === group.id ? { ...item, name: event.target.value } : item))}/></label><label>Slug<input value={group.slug} onChange={(event) => setGroups((old) => old.map((item) => item.id === group.id ? { ...item, slug: slugify(event.target.value) } : item))}/></label><label>Thứ tự<input type="number" min="0" step="1" value={group.sortOrder} onChange={(event) => setGroups((old) => old.map((item) => item.id === group.id ? { ...item, sortOrder: Number(event.target.value) } : item))}/></label><label>Ghim (trống = bỏ ghim)<input type="number" min="0" step="1" value={group.pinnedOrder ?? ""} onChange={(event) => setGroups((old) => old.map((item) => item.id === group.id ? { ...item, pinnedOrder: event.target.value === "" ? null : Number(event.target.value) } : item))}/></label><label className="new-arrivals-admin-active"><input type="checkbox" checked={group.active} onChange={(event) => setGroups((old) => old.map((item) => item.id === group.id ? { ...item, active: event.target.checked } : item))}/>Hiện nhóm trên website</label><button className="button button-primary" type="button" disabled={saving === group.id} onClick={() => void saveGroup(group)}>{saving === group.id ? "Đang lưu…" : "Lưu nhóm"}</button>
          </div></details>)}</div>
          <div className="new-arrivals-admin-mappings"><h3>Ánh xạ nguồn loại đá</h3><p>Nếu sản phẩm có mapping loại đá và danh mục cùng chỉ vào hai nhóm khác nhau, backend sẽ đưa sản phẩm vào “Trang sức khác” cho đến khi xử lý xung đột.</p><div className="new-arrivals-admin-source-list"><strong>Taxonomy loại đá</strong>{categorySources.map((source) => <label key={`category:${source.id}`}><span>{source.name}</span><select value={source.jewelryStoneGroupId || ""} disabled={Boolean(saving)} onChange={(event) => void saveMapping("category", source, event.target.value)}><option value="">Chưa ánh xạ</option>{groups.filter((group) => group.active).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>)}{categorySources.length === 0 && <small>Chưa có taxonomy loại đá để ánh xạ.</small>}</div><div className="new-arrivals-admin-source-list"><strong>Đá gắn trang sức</strong>{materialSources.map((source) => <label key={`material:${source.id}`}><span>{source.name}</span><select value={source.jewelryStoneGroupId || ""} disabled={Boolean(saving)} onChange={(event) => void saveMapping("material", source, event.target.value)}><option value="">Chưa ánh xạ</option>{groups.filter((group) => group.active).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>)}{materialSources.length === 0 && <small>Chưa có đá gắn trang sức để ánh xạ.</small>}</div></div>
        </>}
      </>}
      <footer className="new-arrivals-admin-footer"><button type="button" className="button button-quiet" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>;
}
