"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialMutationValue, MaterialOption, MaterialScope, MaterialSyncStatus } from "./materials-model";
import { apiBaseUrl } from "../lib/api";

export { DEFAULT_MATERIALS, normalizeMaterialOptions } from "./materials-model";
export type { MaterialMutationValue, MaterialOption, MaterialScope, MaterialSyncStatus } from "./materials-model";
const slugify=(value:string)=>value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

/**
 * Taxonomy used by weight-managed items such as spheres. This is deliberately
 * separate from storefront categories: Cầu -> nhóm đá -> loại đá -> chất lượng.
 */
export type SphereStoneType = { id:string; groupId:string; name:string; slug:string; sortOrder:number; isActive:boolean; productCount:number; };
export type SphereStoneGroup = { id:string; name:string; slug:string; sortOrder:number; isActive:boolean; productCount:number; stoneTypes:SphereStoneType[]; };
type CatalogScope = MaterialScope | "Vật phẩm";

type Props = {
  materials: MaterialOption[];
  categories: AdminCategory[];
  sphereStoneGroups?: SphereStoneGroup[];
  onChange: (materials: MaterialOption[]) => void;
  onPersist: (method: "POST" | "PATCH" | "DELETE", id?: string, value?: MaterialMutationValue) => Promise<MaterialOption | null>;
  onSaveCategories: (categories: AdminCategory[]) => Promise<AdminCategory[]>;
  onDeleteCategory: (id: string) => Promise<AdminCategory[]>;
  onPersistSphereStone?: (kind:"groups"|"types", method:"POST"|"PATCH", id:string|undefined, value:Record<string, unknown>) => Promise<SphereStoneGroup[]>;
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

function SphereStoneCatalog({ groups, onPersist, onNotify, syncStatus }:{ groups:SphereStoneGroup[]; onPersist:NonNullable<Props["onPersistSphereStone"]>; onNotify:Props["onNotify"]; syncStatus:MaterialSyncStatus; }) {
  const [search, setSearch] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [editing, setEditing] = useState<{kind:"groups"|"types";id:string}|null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const normalizedSearch = search.trim().toLocaleLowerCase("vi");
  const visibleGroups = groups.filter((group) => !normalizedSearch || `${group.name} ${group.stoneTypes.map((type) => type.name).join(" ")}`.toLocaleLowerCase("vi").includes(normalizedSearch));
  const reset = () => { setEditing(null); setName(""); };
  const createGroup = () => { setSelectedGroupId(""); reset(); };
  const createType = (groupId:string) => { setSelectedGroupId(groupId); setEditing(null); setName(""); };
  const editGroup = (group:SphereStoneGroup) => { setSelectedGroupId(""); setEditing({kind:"groups",id:group.id}); setName(group.name); };
  const editType = (type:SphereStoneType) => { setSelectedGroupId(type.groupId); setEditing({kind:"types",id:type.id}); setName(type.name); };
  const save = async () => {
    const normalized = name.trim();
    const kind = editing?.kind ?? (selectedGroupId ? "types" : "groups");
    if (normalized.length < 2) { onNotify(kind === "groups" ? "Nhập tên nhóm đá mẹ." : "Nhập tên loại đá con."); return; }
    if (kind === "types" && !selectedGroupId) { onNotify("Chọn nhóm đá mẹ trước khi thêm loại đá con."); return; }
    setSaving(true);
    try {
      await onPersist(kind, editing ? "PATCH" : "POST", editing?.id, kind === "types" ? { name:normalized, groupId:selectedGroupId } : { name:normalized });
      reset();
      onNotify(editing ? "Đã cập nhật phân loại đá Vật phẩm." : kind === "groups" ? "Đã tạo nhóm đá mẹ cho Vật phẩm." : "Đã thêm loại đá con cho Vật phẩm.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu phân loại đá Vật phẩm."); }
    finally { setSaving(false); }
  };
  const toggleGroup = async (group:SphereStoneGroup) => {
    setSaving(true);
    try { await onPersist("groups", "PATCH", group.id, { isActive:!group.isActive }); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái nhóm đá."); }
    finally { setSaving(false); }
  };
  const toggleType = async (type:SphereStoneType) => {
    setSaving(true);
    try { await onPersist("types", "PATCH", type.id, { isActive:!type.isActive }); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái loại đá."); }
    finally { setSaving(false); }
  };
  const title = editing?.kind === "groups" ? "Sửa nhóm đá mẹ" : editing?.kind === "types" ? "Sửa loại đá con" : selectedGroup ? `Thêm loại đá thuộc ${selectedGroup.name}` : "Thêm nhóm đá mẹ";
  return <div className="sphere-stone-layout">
    <section className="materials-table-panel sphere-stone-panel">
      <div className="materials-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm nhóm đá hoặc loại đá..." /></label><span>{groups.reduce((total, group) => total + 1 + group.stoneTypes.length, 0)} mục</span></div>
      <div className="sphere-stone-help">Cấu trúc dùng riêng cho Vật phẩm: <strong>nhóm đá mẹ → loại đá → chất lượng → từng vật phẩm</strong>. Không thay đổi danh mục bán hàng hay số kg tồn kho.</div>
      <div className="materials-table-wrap"><table><thead><tr><th>Nhóm / loại đá</th><th>Sản phẩm đã gắn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{visibleGroups.length ? visibleGroups.map((group) => <Fragment key={group.id}>
        <tr className="sphere-stone-group-row" key={group.id}><td><span className="material-row-name"><span className="material-row-placeholder">◇</span><span><strong>{group.name}</strong><small>Nhóm đá mẹ</small></span></span></td><td>{group.productCount}</td><td><button className={`material-state ${group.isActive ? "active" : "inactive"}`} onClick={() => void toggleGroup(group)} disabled={saving}>{group.isActive ? "Đang dùng" : "Đã ẩn"}</button></td><td><div className="materials-actions"><button onClick={() => createType(group.id)} disabled={saving}>Thêm loại con</button><button onClick={() => editGroup(group)} disabled={saving}>Sửa</button></div></td></tr>
        {group.stoneTypes.map((type) => <tr key={type.id}><td><span className="material-row-name sphere-stone-child"><span className="material-row-placeholder">↳</span><span><strong>{type.name}</strong><small>Thuộc {group.name}</small></span></span></td><td>{type.productCount}</td><td><button className={`material-state ${type.isActive ? "active" : "inactive"}`} onClick={() => void toggleType(type)} disabled={saving}>{type.isActive ? "Đang dùng" : "Đã ẩn"}</button></td><td><div className="materials-actions"><button onClick={() => editType(type)} disabled={saving}>Sửa</button></div></td></tr>)}
      </Fragment>) : <tr><td className="materials-empty" colSpan={4}>Chưa có nhóm đá Vật phẩm phù hợp.</td></tr>}</tbody></table></div>
    </section>
    <aside className="materials-editor sphere-stone-editor"><h2>{title}</h2><p>Tạo nhóm như “Thạch Anh”, sau đó thêm các loại con như “Thạch Anh Trắng”, “Thạch Anh Hồng”, “Thạch Anh Tím”.</p>
      <label><span>Nhóm đá mẹ</span><select value={selectedGroupId} onChange={(event) => { setSelectedGroupId(event.target.value); setEditing(null); setName(""); }} disabled={saving || editing?.kind === "groups"}><option value="">Tạo / sửa nhóm đá mẹ</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label><span>{selectedGroupId || editing?.kind === "groups" ? "Tên loại đá" : "Tên nhóm đá"}</span><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} placeholder={selectedGroupId ? "Ví dụ: Thạch Anh Trắng" : "Ví dụ: Thạch Anh"} /></label>
      <div><button type="button" className="button button-quiet" onClick={createGroup} disabled={saving}>Tạo nhóm mới</button><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving || syncStatus !== "connected"}>{saving ? "Đang lưu…" : "Lưu phân loại"}</button></div>
    </aside>
  </div>;
}

export default function MaterialsWorkspace({ materials, categories, sphereStoneGroups, onChange, onPersist, onSaveCategories, onDeleteCategory, onPersistSphereStone, onNotify, syncStatus }: Props) {
  const [scope, setScope] = useState<CatalogScope>("Trang sức");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingCutId, setEditingCutId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftScope, setDraftScope] = useState<MaterialScope>("Trang sức");
  const [draftImage, setDraftImage] = useState("");
  const [draftAppliedCategoryIds, setDraftAppliedCategoryIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedSphereStoneGroups, setLoadedSphereStoneGroups] = useState<SphereStoneGroup[]>(sphereStoneGroups ?? []);
  const imageInput = useRef<HTMLInputElement>(null);
  const mapSphereStoneGroups = (records: unknown): SphereStoneGroup[] => Array.isArray(records) ? records.map((value) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const stoneTypes = Array.isArray(record.stoneTypes) ? record.stoneTypes.map((type) => {
      const item = type && typeof type === "object" ? type as Record<string, unknown> : {};
      const count = item._count && typeof item._count === "object" ? item._count as Record<string, unknown> : {};
      return { id:String(item.id ?? ""), groupId:String(item.groupId ?? ""), name:String(item.name ?? ""), slug:String(item.slug ?? ""), sortOrder:Number(item.sortOrder ?? 0), isActive:item.isActive !== false, productCount:Number(count.products ?? item.productCount ?? 0) };
    }) : [];
    return { id:String(record.id ?? ""), name:String(record.name ?? ""), slug:String(record.slug ?? ""), sortOrder:Number(record.sortOrder ?? 0), isActive:record.isActive !== false, productCount:stoneTypes.reduce((total, type) => total + type.productCount, 0), stoneTypes };
  }) : [];
  useEffect(() => { if (sphereStoneGroups) setLoadedSphereStoneGroups(sphereStoneGroups); }, [sphereStoneGroups]);
  useEffect(() => {
    if (sphereStoneGroups) return;
    let active = true;
    void fetch(`${apiBaseUrl}/sphere-stones`, { cache:"no-store", credentials:"include" })
      .then(async (response) => { if (!response.ok) throw new Error("Không tải được phân loại đá Vật phẩm."); return response.json(); })
      .then((records) => { if (active) setLoadedSphereStoneGroups(mapSphereStoneGroups(records)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sphereStoneGroups]);
  const activeSphereStoneGroups = sphereStoneGroups ?? loadedSphereStoneGroups;
  const persistSphereStone = async (kind:"groups"|"types", method:"POST"|"PATCH", id:string|undefined, value:Record<string, unknown>) => {
    if (onPersistSphereStone) return onPersistSphereStone(kind, method, id, value);
    const endpoint = `sphere-stones/${kind}${method === "PATCH" ? `/${id}` : ""}`;
    const response = await fetch(`${apiBaseUrl}/${endpoint}`, { method, credentials:"include", cache:"no-store", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(value) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(payload?.message || "Không thể lưu phân loại đá Vật phẩm."));
    const next = mapSphereStoneGroups(payload);
    setLoadedSphereStoneGroups(next);
    return next;
  };
  const materialRows = useMemo(() => scope === "Vật phẩm" ? [] : materials.filter((item) => item.scope === scope && item.kind === "STONE" && (!search.trim() || item.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))), [materials, scope, search]);
  // Active level-2 gemstone categories can be used for cuts, including existing product-category records.
  const gemstoneTypes = useMemo(() => categories.filter((category) => category.kind === "Đá quý" && (category.level ?? 1) === 2 && category.status === "Hoạt động"), [categories]);
  const gemstoneCuts = useMemo(() => categories.filter((category) => {
    const parent = categories.find((item) => item.id === category.parentId);
    return category.kind === "Đá quý" && (category.level ?? 1) === 3 && category.usage === "product" && parent?.kind === "Đá quý" && (parent.level ?? 1) === 2 && (!search.trim() || `${category.name} ${parent.name}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  }).sort((a, b) => (a.sortOrder || "").localeCompare(b.sortOrder || "", "vi", { numeric: true }) || a.name.localeCompare(b.name, "vi")), [categories, search]);
  const rowCount = scope === "Vật phẩm" ? activeSphereStoneGroups.reduce((total, group) => total + 1 + group.stoneTypes.length, 0) : scope === "Đá quý" ? gemstoneCuts.length : materialRows.length;
  const applicableCategories = useMemo(() => categories
    .filter((category) => category.status === "Hoạt động" && category.kind === (draftScope === "Đá quý" ? "Đá quý" : "Trang sức") && (draftScope === "Đá quý" ? (category.level ?? 1) === 2 : category.usage === "product" && (category.level ?? 1) > 1))
    .sort((a, b) => (a.sortOrder || "").localeCompare(b.sortOrder || "", "vi", { numeric: true }) || a.name.localeCompare(b.name, "vi")), [categories, draftScope]);

  const categoryLabel = (category: AdminCategory) => {
    const path = [category.name];
    let parent = categories.find((item) => item.id === category.parentId);
    while (parent) {
      path.unshift(parent.name);
      parent = parent.parentId ? categories.find((item) => item.id === parent?.parentId) : undefined;
    }
    return path.join(" / ");
  };

  const categoriesForScope = (materialScope: MaterialScope) => categories
    .filter((category) => category.status === "Hoạt động" && category.kind === materialScope && (materialScope === "Đá quý" ? (category.level ?? 1) === 2 : category.usage === "product" && (category.level ?? 1) > 1))
    .map((category) => category.id);
  const selectScope = (nextScope: CatalogScope) => {
    setScope(nextScope);
    setDraftScope(nextScope === "Vật phẩm" ? "Trang sức" : nextScope);
    setEditingId("");
    setEditingCutId("");
    setDraftName("");
    setDraftImage("");
    setDraftAppliedCategoryIds([]);
    if (imageInput.current) imageInput.current.value = "";
  };
  const startEdit = (item: MaterialOption) => {
    setEditingId(item.id);
    setEditingCutId("");
    setDraftName(item.name);
    setDraftScope(item.scope);
    setDraftImage(item.imageUrl ?? "");
    const validCategoryIds = new Set(categoriesForScope(item.scope));
    setDraftAppliedCategoryIds((item.appliedCategoryIds ?? [...validCategoryIds]).filter((id) => validCategoryIds.has(id)));
    if (imageInput.current) imageInput.current.value = "";
  };
  const startEditCut = (item: AdminCategory) => {
    setEditingId("");
    setEditingCutId(item.id);
    setDraftName(item.name);
    setDraftScope("Đá quý");
    setDraftImage("");
    setDraftAppliedCategoryIds(item.parentId ? [item.parentId] : []);
    if (imageInput.current) imageInput.current.value = "";
  };
  const resetForm = () => { setEditingId(""); setEditingCutId(""); setDraftName(""); setDraftScope(scope === "Vật phẩm" ? "Trang sức" : scope); setDraftImage(""); setDraftAppliedCategoryIds([]); if (imageInput.current) imageInput.current.value = ""; };

  const save = async () => {
    const name = draftName.trim();
    if (!name) { onNotify(draftScope === "Đá quý" ? "Nhập tên dạng cắt." : "Nhập tên chất liệu hoặc loại đá."); return; }
    if (draftScope === "Đá quý") {
      const parents = gemstoneTypes.filter((category) => draftAppliedCategoryIds.includes(category.id));
      if (!parents.length) { onNotify("Chọn ít nhất một danh mục sản phẩm loại đá để áp dụng dạng cắt."); return; }
      const currentCut = categories.find((category) => category.id === editingCutId);
      if (editingCutId && !currentCut) { onNotify("Không tìm thấy dạng cắt cần sửa. Hãy tải lại danh sách."); return; }
      const duplicate = categories.some((category) => category.kind === "Đá quý" && (category.level ?? 1) === 3 && category.usage === "product" && parents.some((parent) => parent.id === category.parentId) && category.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi") && category.id !== editingCutId);
      if (duplicate) { onNotify("Tên dạng cắt này đã được áp dụng cho một danh mục đã chọn."); return; }
      setSaving(true);
      try {
        const next = [...categories];
        for (const [index, parent] of parents.entries()) {
          const existing = index === 0 && currentCut ? currentCut : undefined;
          const baseSlug = slugify(`${name}-${parent.slug}`);
          const slugConflict = categories.some((category) => category.slug === baseSlug && category.id !== existing?.id);
          if (slugConflict) throw new Error(`Slug dạng cắt “${name}” đã được dùng. Hãy đổi tên hoặc kiểm tra danh mục ${parent.name}.`);
          const siblingOrders = categories.filter((category) => category.parentId === parent.id && category.id !== existing?.id).map((category) => Number(category.sortOrder.split(".").at(-1)) || 0);
          const sortOrder = String(Math.max(0, ...siblingOrders) + 1);
          const cut: AdminCategory = {
            ...(existing ?? { id: `CUT-${Date.now()}-${index}` }),
            name,
            slug: baseSlug,
            products: existing?.products ?? 0,
            status: existing?.status ?? "Hoạt động",
            kind: "Đá quý",
            usage: "product",
            level: 3,
            parentId: parent.id,
            description: existing?.description ?? "",
            pricingMode: "QUALITY",
            sortOrder,
          };
          const existingIndex = next.findIndex((category) => category.id === cut.id);
          if (existingIndex >= 0) next[existingIndex] = cut;
          else next.push(cut);
        }
        await onSaveCategories(next);
        resetForm();
        onNotify(editingCutId ? "Đã cập nhật dạng cắt và danh mục áp dụng." : `Đã thêm dạng cắt “${name}” cho ${parents.length} danh mục.`);
      } catch (error) {
        onNotify(error instanceof Error ? error.message : "Không thể lưu dạng cắt vào database.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const duplicate = materials.some((item) => item.scope === draftScope && item.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi") && item.id !== editingId);
    if (duplicate) { onNotify("Tên này đã có trong danh sách của nhóm sản phẩm."); return; }
    const current = materials.find((item) => item.id === editingId);
    const value: MaterialMutationValue = {
      name,
      scope: draftScope,
      kind: "STONE",
      active: current?.active ?? true,
      imageUrl: draftImage || null,
      sortOrder: current?.sortOrder ?? materialRows.length,
      appliedCategoryIds: draftAppliedCategoryIds,
    };
    setSaving(true);
    try {
      const saved = await onPersist(editingId ? "PATCH" : "POST", editingId || undefined, value);
      if (!saved) throw new Error("API không trả về dữ liệu đã lưu.");
      onChange(editingId ? materials.map((item) => item.id === editingId ? saved : item) : [saved, ...materials]);
      resetForm();
      onNotify(editingId ? "Đã cập nhật loại đá và các danh mục áp dụng." : "Đã thêm loại đá và các danh mục áp dụng.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu vào API.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: MaterialOption) => {
    if ((item.dependentProductCount || 0) > 0) { onNotify(`Không thể xóa “${item.name}” vì đang có ${item.dependentProductCount} sản phẩm phụ thuộc. Hãy ẩn loại đá hoặc chuyển sản phẩm trước.`); return; }
    if (!window.confirm(`Xóa “${item.name}” khỏi danh sách ${item.scope}?`)) return;
    setSaving(true);
    try {
      await onPersist("DELETE", item.id);
      onChange(materials.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) resetForm();
      onNotify(`Đã xóa “${item.name}” và cập nhật quy tắc SKU.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xóa từ API.");
    } finally {
      setSaving(false);
    }
  };

  const removeCut = async (item: AdminCategory) => {
    const parent = categories.find((category) => category.id === item.parentId);
    if ((item.products || 0) > 0) { onNotify(`Không thể xóa dạng cắt “${item.name}” vì đang có sản phẩm phụ thuộc. Hãy ẩn dạng cắt hoặc chuyển biến thể trước.`); return; }
    if (!window.confirm("Xóa dạng cắt “" + item.name + "” khỏi loại đá " + (parent?.name || "") + "?")) return;
    setSaving(true);
    try {
      await onDeleteCategory(item.id);
      if (editingCutId === item.id) resetForm();
      onNotify("Đã xóa dạng cắt “" + item.name + "”.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xóa dạng cắt.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCut = async (item: AdminCategory) => {
    setSaving(true);
    try {
      const next = categories.map((category) => category.id === item.id ? { ...category, status: item.status === "Hoạt động" ? "Đã ẩn" : "Hoạt động" } : category);
      await onSaveCategories(next);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái dạng cắt.");
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

  const applicableCategorySummary = (item: MaterialOption) => {
    if (item.appliedCategoryIds === undefined) return "Đang áp dụng mọi danh mục";
    if (!item.appliedCategoryIds.length) return "Chưa chọn danh mục";
    const labels = item.appliedCategoryIds.map((id) => categories.find((category) => category.id === id)).filter(Boolean).map((category) => categoryLabel(category!));
    return labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ");
  };

  const syncLabel = syncStatus === "connected" ? "API đã kết nối" : syncStatus === "connecting" ? "Đang kết nối API…" : "API chưa kết nối";

  return <div className="materials-workspace">
    <div className="materials-heading"><div><h1>Loại đá</h1><p>Quản lý loại đá cho trang sức, dạng cắt cho mặt đá quý và cây đá cha–con của Vật phẩm.</p><span className={"material-sync-status " + syncStatus}>{syncLabel}</span></div></div>
    {syncStatus === "offline" && <div className="material-api-warning" role="status">Chưa kết nối API. Danh mục ở admin chưa thể cập nhật lên menu website.</div>}
    <div className="materials-tabs" role="tablist" aria-label="Chọn danh sách">
      <button className={scope === "Trang sức" ? "active" : ""} role="tab" aria-selected={scope === "Trang sức"} onClick={() => selectScope("Trang sức")}>Trang sức <span>{materials.filter((item) => item.scope === "Trang sức").length}</span></button>
      <button className={scope === "Đá quý" ? "active" : ""} role="tab" aria-selected={scope === "Đá quý"} onClick={() => selectScope("Đá quý")}>Mặt đá quý <span>{gemstoneCuts.length}</span></button>
      <button className={scope === "Vật phẩm" ? "active" : ""} role="tab" aria-selected={scope === "Vật phẩm"} onClick={() => selectScope("Vật phẩm")}>Vật Phẩm <span>{activeSphereStoneGroups.reduce((total, group) => total + 1 + group.stoneTypes.length, 0)}</span></button>
    </div>
    {scope === "Vật phẩm" ? <SphereStoneCatalog groups={activeSphereStoneGroups} onPersist={persistSphereStone} onNotify={onNotify} syncStatus={syncStatus} /> : <div className="materials-layout">
      <section className="materials-table-panel">
        <div className="materials-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={scope === "Đá quý" ? "Tìm dạng cắt hoặc loại đá..." : "Tìm loại đá..."} /></label><span>{rowCount} mục</span></div>
        <div className="materials-table-wrap"><table>
          <thead><tr><th>{scope === "Đá quý" ? "Dạng cắt" : "Tên loại đá"}</th><th>Danh mục áp dụng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {scope === "Đá quý" ? (gemstoneCuts.length ? gemstoneCuts.map((item) => {
              const parent = categories.find((category) => category.id === item.parentId);
              return <tr key={item.id}><td><span className="material-row-name"><span className="material-row-placeholder">◇</span><span><strong>{item.name}</strong><small>Dạng cắt · {parent?.name || "Chưa gắn loại đá"}</small></span></span></td><td className="material-category-summary">{parent ? categoryLabel(parent) : "Chưa chọn"}</td><td><button className={"material-state " + (item.status === "Hoạt động" ? "active" : "inactive")} onClick={() => void toggleCut(item)} disabled={saving}>{item.status === "Hoạt động" ? "Đang dùng" : "Đã ẩn"}</button></td><td><div className="materials-actions"><button onClick={() => startEditCut(item)} disabled={saving}>Sửa</button><button className="danger" onClick={() => void removeCut(item)} disabled={saving || (item.products || 0) > 0} title={(item.products || 0) > 0 ? "Không thể xóa vì đang có sản phẩm phụ thuộc" : "Xóa dạng cắt"}>Xóa</button></div></td></tr>;
            }) : <tr><td className="materials-empty" colSpan={4}>Chưa có dạng cắt. Thêm dạng cắt ở khung bên phải.</td></tr>) : (materialRows.length ? materialRows.map((item) => <tr key={item.id}><td><span className="material-row-name">{item.imageUrl ? <img className="material-row-image" src={item.imageUrl} alt="" /> : <span className="material-row-placeholder">◇</span>}<span><strong>{item.name}</strong><small>Đá gắn trang sức · hiển thị trong menu</small></span></span></td><td className="material-category-summary">{applicableCategorySummary(item)}</td><td><button className={"material-state " + (item.active ? "active" : "inactive")} onClick={() => void toggle(item)} disabled={saving}>{item.active ? "Đang dùng" : "Đã ẩn"}</button></td><td><div className="materials-actions"><button onClick={() => startEdit(item)} disabled={saving}>Sửa</button><button className="danger" onClick={() => void remove(item)} disabled={saving || (item.dependentProductCount || 0) > 0} title={(item.dependentProductCount || 0) > 0 ? "Không thể xóa vì đang có sản phẩm phụ thuộc" : "Xóa loại đá"}>Xóa</button></div></td></tr>) : <tr><td className="materials-empty" colSpan={4}>Danh sách này chưa có mục nào.</td></tr>)}
          </tbody>
        </table></div>
      </section>
      <aside className="materials-editor">
        <h2>{scope === "Đá quý" ? (editingCutId ? "Sửa dạng cắt" : "Thêm dạng cắt") : (editingId ? "Sửa loại đá" : "Thêm loại đá")}</h2>
        <p>{scope === "Đá quý" ? "Chọn danh mục sản phẩm cấp 2 để áp dụng. GEME sẽ tạo dạng cắt cấp 3 bên dưới từng mục đã chọn." : "Chọn nhóm trang sức nào được dùng loại đá này. Danh sách loại đá khi nhập hàng sẽ lọc theo lựa chọn này."}</p>
        <section className="material-category-field"><div className="material-category-heading"><strong>Áp dụng cho danh mục sản phẩm</strong><span>{draftAppliedCategoryIds.length}/{applicableCategories.length} đã chọn</span></div>
          <p>{scope === "Đá quý" ? "Mỗi danh mục sản phẩm đã chọn sẽ có dạng cắt này khi nhập kho, tạo hồ sơ và lọc sản phẩm trên website." : "Chỉ các danh mục đã chọn mới thấy loại đá này khi nhập kho hoặc chọn loại đá cho sản phẩm."}</p>
          <div className="material-category-actions"><button type="button" onClick={() => setDraftAppliedCategoryIds(applicableCategories.map((category) => category.id))} disabled={saving || !applicableCategories.length}>Chọn tất cả</button><button type="button" onClick={() => setDraftAppliedCategoryIds([])} disabled={saving || !draftAppliedCategoryIds.length}>Bỏ chọn</button></div>
          <div className="material-category-list">{applicableCategories.length ? applicableCategories.map((category) => <label key={category.id}><input type="checkbox" checked={draftAppliedCategoryIds.includes(category.id)} onChange={(event) => setDraftAppliedCategoryIds((current) => event.target.checked ? [...new Set([...current, category.id])] : current.filter((id) => id !== category.id))} disabled={saving}/><span>{categoryLabel(category)}</span></label>) : <small>{scope === "Đá quý" ? "Chưa có danh mục sản phẩm đá quý cấp 2 đang hoạt động. Hãy tạo danh mục trong Danh mục trước." : "Chưa có danh mục sản phẩm đang hoạt động trong nhóm này."}</small>}</div>
          {!draftAppliedCategoryIds.length && <small className="material-category-empty-note">{scope === "Đá quý" ? "Chọn ít nhất một danh mục để thêm dạng cắt." : "Chưa chọn danh mục — loại đá sẽ không xuất hiện trong lựa chọn nhập kho."}</small>}
        </section>
        <label><span>{scope === "Đá quý" ? "Tên dạng cắt" : "Tên loại đá"}</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={scope === "Đá quý" ? "Ví dụ: Oval, Pear, Cabochon..." : "Ví dụ: Amethyst, Moonstone..."} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} /></label>
        {scope === "Trang sức" && <div className="material-image-field"><span>Ảnh đại diện loại đá</span><div className="material-image-control">{draftImage ? <img src={draftImage} alt="Xem trước ảnh loại đá" /> : <span className="material-image-placeholder">◇</span>}<div><button type="button" className="button button-quiet" onClick={() => imageInput.current?.click()} disabled={saving}>{draftImage ? "Đổi ảnh" : "Chọn ảnh"}</button>{draftImage && <button type="button" className="material-remove-image" onClick={() => setDraftImage("")} disabled={saving}>Gỡ ảnh</button>}<small>Ảnh sẽ được thu nhỏ và nén để hiển thị dạng tròn trong menu.</small></div></div><input ref={imageInput} className="material-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImage(event)} /></div>}
        <div><button type="button" className="button button-quiet" onClick={resetForm} disabled={saving}>Làm mới</button><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving || syncStatus !== "connected"}>{saving ? "Đang lưu…" : scope === "Đá quý" ? "Lưu dạng cắt" : "Lưu loại đá"}</button></div>
      </aside>
    </div>}
  </div>;
}
