"use client";

import { useMemo, useState } from "react";
import { apiBaseUrl } from "../lib/api";
import { compressProductImage } from "./product-images";

export type CategoryKind = "Trang sức" | "Đá quý" | "Khác";
export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  products: number;
  status: string;
  kind: CategoryKind;
  usage?: "product" | "stone";
  level?: 1 | 2 | 3;
  pricingMode?: "FIXED" | "QUALITY" | "QUALITY_AND_BEAD_SIZE";
  parentId?: string;
  description?: string;
  sortOrder: string;
  image?: string;
  bannerUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  isHot?: boolean;
};

type Props = {
  categories: AdminCategory[];
  onSave: (categories: AdminCategory[]) => Promise<AdminCategory[]> | void;
  onDelete: (id: string) => Promise<AdminCategory[]>;
  onNotify: (message: string) => void;
  onCreateProduct: (category: AdminCategory) => void;
};

type PanelTab = "basic" | "seo" | "media";
type KindFilter = "Tất cả" | CategoryKind;

const tabs: { key: PanelTab; label: string }[] = [
  { key: "basic", label: "Thông tin cơ bản" },
  { key: "seo", label: "SEO" },
  { key: "media", label: "Ảnh" },
];

export const DEFAULT_CATEGORIES: AdminCategory[] = [
  { id: "CAT001", name: "Trang sức", slug: "trang-suc", products: 0, status: "Hoạt động", kind: "Trang sức", level: 1, sortOrder: "1", description: "Các thiết kế trang sức GEME chế tác từ đá quý tự nhiên." },
  { id: "CAT002", name: "Nhẫn", slug: "nhan", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.1" },
  { id: "CAT003", name: "Vòng tay", slug: "vong-tay", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.2" },
  { id: "CAT004", name: "Dây chuyền", slug: "day-chuyen", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.3" },
  { id: "CAT005", name: "Hoa tai", slug: "hoa-tai", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.4" },
  { id: "CAT007", name: "Lắc tay", slug: "lac-tay", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.6" },
  { id: "CAT008", name: "Vòng cổ", slug: "vong-co", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.7" },
  { id: "CAT009", name: "Mặt dây chuyền", slug: "mat-day-chuyen", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.8" },
  { id: "CAT010", name: "Charm", slug: "charm", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.9" },
  { id: "CAT011", name: "Bộ trang sức", slug: "bo-trang-suc", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.10" },
  { id: "CAT012", name: "Nhẫn cưới", slug: "nhan-cuoi", products: 0, status: "Hoạt động", kind: "Trang sức", level: 2, parentId: "CAT001", pricingMode: "FIXED", sortOrder: "1.11" },
  { id: "CAT014", name: "Vòng chuỗi đeo", slug: "vong-chuoi-deo", products: 0, status: "Hoạt động", kind: "Trang sức", level: 3, usage: "product", parentId: "CAT003", pricingMode: "QUALITY_AND_BEAD_SIZE", sortOrder: "1.2.1" },
  { id: "CAT015", name: "Vòng chuỗi tay", slug: "vong-chuoi-tay", products: 0, status: "Hoạt động", kind: "Trang sức", level: 3, usage: "product", parentId: "CAT003", pricingMode: "QUALITY_AND_BEAD_SIZE", sortOrder: "1.2.2" },
  { id: "CAT035", name: "Vòng chuỗi hạt", slug: "vong-chuoi-hat", products: 0, status: "Hoạt động", kind: "Trang sức", level: 3, usage: "product", parentId: "CAT003", pricingMode: "QUALITY_AND_BEAD_SIZE", sortOrder: "1.2.3" },
  { id: "CAT016", name: "Kiềng đá", slug: "kieng-da", products: 0, status: "Hoạt động", kind: "Trang sức", level: 3, usage: "product", parentId: "CAT003", pricingMode: "QUALITY", sortOrder: "1.2.4" },
  { id: "CAT025", name: "Vòng tay bạc", slug: "vong-tay-bac", products: 0, status: "Hoạt động", kind: "Trang sức", level: 3, usage: "product", parentId: "CAT003", pricingMode: "FIXED", sortOrder: "1.2.5" },
  { id: "CAT013", name: "Đá quý", slug: "da-quy", products: 0, status: "Hoạt động", kind: "Đá quý", level: 1, sortOrder: "2", description: "Các mặt đá quý tự nhiên được tuyển chọn tại GEME." },
  { id: "CAT018", name: "Mặt đá quý", slug: "mat-da", products: 0, status: "Hoạt động", kind: "Đá quý", level: 2, usage: "product", parentId: "CAT013", pricingMode: "QUALITY", sortOrder: "2.1" },
  { id: "CAT022", name: "Khác", slug: "khac", products: 0, status: "Hoạt động", kind: "Khác", level: 1, sortOrder: "3" },
  { id: "CAT023", name: "New Arrival", slug: "new-arrival", products: 0, status: "Hoạt động", kind: "Khác", level: 2, parentId: "CAT022", sortOrder: "3.1", isHot: true },
  { id: "CAT024", name: "Quà tặng", slug: "qua-tang", products: 0, status: "Hoạt động", kind: "Khác", level: 2, parentId: "CAT022", sortOrder: "3.2" },
];

const iconPaths: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9zM2 9h20M8 3l4 18 4-18"/>',
  star: '<path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9L12 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter: '<path d="M4 5h16M7 12h10m-7 7h4"/><circle cx="8" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="10" cy="19" r="1.5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
};

function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: iconPaths[name] ?? iconPaths.tag }} />;
}

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function makeCategoryThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Hãy chọn một tệp hình ảnh."));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Ảnh danh mục cần nhỏ hơn 8 MB để xử lý."));
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        // Category photos are menu thumbnails, so keep the database payload small.
        for (const dimension of [128, 96, 64]) {
          const ratio = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Không xử lý được ảnh này.");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.78, 0.62, 0.48]) {
            const thumbnail = canvas.toDataURL("image/webp", quality);
            // Stay comfortably below the default JSON request size limit.
            if (thumbnail.length < 72_000) {
              URL.revokeObjectURL(source);
              resolve(thumbnail);
              return;
            }
          }
        }
        throw new Error("Ảnh này không thể nén đủ nhỏ. Hãy chọn ảnh khác.");
      } catch (error) {
        URL.revokeObjectURL(source);
        reject(error);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Không đọc được tệp ảnh.")); };
    image.src = source;
  });
}

function categoryLevel(category: AdminCategory) {
  return category.level ?? (category.parentId ? 2 : 1);
}

function isGemstoneCut(category: AdminCategory, categories: AdminCategory[]) {
  const parent = categories.find((item) => item.id === category.parentId);
  return category.kind === "Đá quý" && categoryLevel(category) === 3 && parent?.kind === "Đá quý" && categoryLevel(parent) === 2;
}

const requiredJewelryChildSlugs = new Set(["nhan", "vong-tay", "mat-day-chuyen", "lac-tay"]);

function isFixedJewelryCategory(category: AdminCategory, categories: AdminCategory[]) {
  const level = categoryLevel(category);
  if (category.kind !== "Trang sức") return false;
  if (level === 1 && category.slug === "trang-suc") return true;
  const root = categories.find((item) => item.kind === "Trang sức" && categoryLevel(item) === 1 && item.slug === "trang-suc");
  return level === 2 && Boolean(root && category.parentId === root.id && requiredJewelryChildSlugs.has(category.slug));
}

function categoryImageUrl(url?: string) {
  if (!url || url.startsWith("data:") || /^https?:\/\//i.test(url)) return url || "";
  if (url.startsWith("/assets/") || url.startsWith("/media/")) return url;
  return `${apiBaseUrl}/${url.replace(/^\//, "")}`;
}

function CategoryStatus({ status }: { status: string }) {
  return <span className={`category-status ${status === "Hoạt động" ? "active" : "hidden"}`}><i/>{status}</span>;
}

export default function CategoriesWorkspace({ categories, onSave, onDelete, onNotify, onCreateProduct }: Props) {
  const [kindFilter, setKindFilter] = useState<KindFilter>("Tất cả");
  const [search, setSearch] = useState("");
  const [sortAscending, setSortAscending] = useState(true);
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [draft, setDraft] = useState<AdminCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("basic");
  const [slugEdited, setSlugEdited] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const selected = categories.find((category) => category.id === selectedId);
  const category = draft ?? selected;
  const categoryIsFixed = category ? isFixedJewelryCategory(category, categories) : false;
  const tabCounts = useMemo(() => ({ "Tất cả": categories.length, "Trang sức": categories.filter((item) => item.kind === "Trang sức").length, "Đá quý": categories.filter((item) => item.kind === "Đá quý").length, "Khác": categories.filter((item) => item.kind === "Khác").length }), [categories]);
  const tree = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    const matches = new Set(categories.filter((item) => (kindFilter === "Tất cả" || item.kind === kindFilter) && (!query || `${item.name} ${item.slug} ${item.kind}`.toLocaleLowerCase("vi").includes(query))).map((item) => item.id));
    // Keep ancestors visible when a search finds a nested category.
    for (const id of [...matches]) {
      let item = categories.find((candidate) => candidate.id === id);
      while (item?.parentId) {
        matches.add(item.parentId);
        item = categories.find((candidate) => candidate.id === item?.parentId);
      }
    }
    const compare = (a: AdminCategory, b: AdminCategory) => {
      const byOrder = a.sortOrder.localeCompare(b.sortOrder, "vi", { numeric: true });
      return sortAscending ? byOrder : -byOrder;
    };
    const included = (item: AdminCategory) => matches.has(item.id);
    const rootItems = categories.filter((item) => !item.parentId && included(item)).sort(compare);
    const rows: Array<{ item: AdminCategory; level: number }> = [];
    const append = (item: AdminCategory, level: number) => {
      rows.push({ item, level });
      if (collapsedIds.has(item.id) && !search.trim()) return;
      categories.filter((child) => child.parentId === item.id && included(child)).sort(compare).forEach((child) => append(child, level + 1));
    };
    const pageRoots = rootItems.slice((page - 1) * 10, page * 10);
    pageRoots.forEach((root) => append(root, 1));
    return { rows, rootCount: rootItems.length };
  }, [categories, kindFilter, search, sortAscending, collapsedIds, page]);
  const rows = tree.rows;
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(tree.rootCount / pageSize));

  const selectCategory = (item: AdminCategory) => {
    setSelectedId(item.id);
    setDraft({ ...item });
    setCreating(false);
    setActiveTab("basic");
    setSlugEdited(true);
  };

  const startCreate = (parent?: AdminCategory) => {
    if (parent?.status !== undefined && parent.status !== "Hoạt động") {
      onNotify("Chỉ tạo danh mục con dưới danh mục đang hoạt động.");
      return;
    }
    if (parent && (categoryLevel(parent) >= 3 || parent.kind === "Đá quý" && categoryLevel(parent) >= 2 && !(categoryLevel(parent) === 2 && parent.usage === "stone"))) {
      onNotify("Danh mục đã ở cấp sâu nhất cho nhóm này.");
      return;
    }
    const requestsJewelry = !parent && kindFilter !== "Đá quý";
    const defaultJewelryRoot = requestsJewelry
      ? categories.find((item) => item.kind === "Trang sức" && categoryLevel(item) === 1 && item.slug === "trang-suc" && item.status === "Hoạt động")
      : undefined;
    if (requestsJewelry && !defaultJewelryRoot) {
      onNotify("Hãy hiện danh mục gốc Trang sức trước khi thêm danh mục con.");
      return;
    }
    const effectiveParent = parent ?? defaultJewelryRoot;
    const level = (effectiveParent ? categoryLevel(effectiveParent) + 1 : 1) as 1 | 2 | 3;
    const next: AdminCategory = {
      id: `DM${String(Date.now()).slice(-6)}`,
      name: "",
      slug: "",
      products: 0,
      status: "Hoạt động",
      kind: effectiveParent?.kind ?? (kindFilter === "Đá quý" ? "Đá quý" : "Trang sức"),
      usage: effectiveParent ? "product" : undefined,
      level,
      parentId: effectiveParent?.id,
      description: "",
      sortOrder: effectiveParent ? `${effectiveParent.sortOrder}.1` : "1",
      pricingMode: !effectiveParent ? "FIXED" : effectiveParent.kind === "Đá quý" ? "QUALITY" : effectiveParent.slug === "vong-tay" ? "QUALITY_AND_BEAD_SIZE" : "FIXED",
      isHot: false,
    };
    setSelectedId("");
    setDraft(next);
    setCreating(true);
    setActiveTab("basic");
    setSlugEdited(false);
  };

  const update = <K extends keyof AdminCategory>(key: K, value: AdminCategory[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const updateName = (name: string) => {
    setDraft((current) => current ? { ...current, name, slug: slugEdited ? current.slug : slugify(name) } : current);
  };

  const changeLevel = (level: 1 | 2 | 3) => {
    if (!category) return;
    if (level === 1) {
      setDraft({ ...category, level, parentId: undefined, usage: undefined, pricingMode: "FIXED", sortOrder: "1" });
      return;
    }
    const allowedParentLevel = (level - 1) as 1 | 2;
    const parents = categories.filter((item) => categoryLevel(item) === allowedParentLevel && item.kind === category.kind && item.status === "Hoạt động" && (level !== 3 || (category.kind === "Đá quý" ? true : item.usage !== "stone")));
    const parent = parents.find((item) => item.id === category.parentId) ?? parents[0];
    if (!parent) {
      onNotify(level === 3 ? "Hãy tạo danh mục cấp 2 thuộc nhóm này trước." : "Hãy tạo danh mục cấp 1 trước.");
      return;
    }
    const usage = "product";
    setDraft({ ...category, level, parentId: parent.id, usage, pricingMode: category.pricingMode ?? (category.kind === "Đá quý" ? "QUALITY" : "FIXED"), sortOrder: `${parent.sortOrder}.1` });
  };

  const changeKind = (kind: CategoryKind) => {
    if (!category) return;
    const level = categoryLevel(category);
    const safeLevel = kind === "Khác" ? Math.min(level, 2) as 1 | 2 : level;
    const jewelryRoot = kind === "Trang sức" && safeLevel === 1
      ? categories.find((item) => item.kind === kind && categoryLevel(item) === 1 && item.slug === "trang-suc" && item.status === "Hoạt động")
      : undefined;
    const parent = safeLevel === 1 ? undefined : categories.find((item) => categoryLevel(item) === safeLevel - 1 && item.kind === kind && item.status === "Hoạt động" && (safeLevel !== 3 || (kind === "Đá quý" ? true : item.usage !== "stone")));
    const nextLevel = jewelryRoot ? 2 : safeLevel;
    const nextParent = jewelryRoot ?? parent;
    setDraft({ ...category, kind, level: nextLevel, usage: nextLevel === 1 ? undefined : "product", parentId: nextParent?.id, pricingMode: nextLevel === 1 ? "FIXED" : kind === "Đá quý" ? "QUALITY" : nextParent?.slug === "vong-tay" ? "QUALITY_AND_BEAD_SIZE" : "FIXED", sortOrder: nextParent ? `${nextParent.sortOrder}.1` : "1" });
  };

  const save = async () => {
    if (!category?.name.trim()) {
      onNotify("Nhập tên danh mục trước khi lưu.");
      setActiveTab("basic");
      return;
    }
    const saved = { ...category, slug: category.slug || slugify(category.name) };
    const updated = creating ? [saved, ...categories] : categories.map((item) => item.id === saved.id ? saved : item);
    setSaving(true);
    try {
      const persisted = await onSave(updated);
      const savedRecord = (Array.isArray(persisted) ? persisted : updated).find((item) => item.slug === saved.slug) ?? saved;
      setSelectedId(savedRecord.id);
      setDraft(null);
      setCreating(false);
      setSlugEdited(true);
      onNotify(creating ? `Đã thêm danh mục “${saved.name}”.` : `Đã lưu danh mục “${saved.name}”.`);
      if (creating && savedRecord.kind !== "Khác" && savedRecord.usage !== "stone" && !isGemstoneCut(savedRecord, updated)) onCreateProduct(savedRecord);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu danh mục vào database.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(null);
    setCreating(false);
    if (!selectedId && categories[0]) setSelectedId(categories[0].id);
  };

  const toggleVisibility = async (item = category) => {
    if (!item || saving) return;
    const nextStatus = item.status === "Hoạt động" ? "Đã ẩn" : "Hoạt động";
    setSaving(true);
    try {
      const persisted = await onSave(categories.map((candidate) => candidate.id === item.id ? { ...candidate, status: nextStatus } : candidate));
      const saved = (Array.isArray(persisted) ? persisted : categories).find((candidate) => candidate.id === item.id) ?? { ...item, status: nextStatus };
      setDraft((current) => current?.id === saved.id ? { ...saved } : current);
      onNotify(nextStatus === "Đã ẩn" ? `Đã ẩn danh mục “${item.name}”; sản phẩm và mục con thuộc nhánh này sẽ không còn hiện trên GEME.` : `Đã hiện danh mục “${item.name}” trên website.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái danh mục.");
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (item: AdminCategory) => {
    if (isFixedJewelryCategory(item, categories)) {
      onNotify("Danh mục trang sức bắt buộc không được xóa; chỉ có thể ẩn hoặc hiện.");
      return;
    }
    const descendantIds = new Set<string>([item.id]);
    for (const parentId of descendantIds) {
      categories.filter((candidate) => candidate.parentId === parentId).forEach((child) => descendantIds.add(child.id));
    }
    const affectedCount = categories.filter((candidate) => descendantIds.has(candidate.id)).reduce((sum, candidate) => sum + candidate.products, 0);
    if (affectedCount > 0) { onNotify(`Không thể xóa “${item.name}” vì đang có ${affectedCount} sản phẩm phụ thuộc. Hãy ẩn danh mục hoặc chuyển sản phẩm trước.`); return; }
    if (descendantIds.size > 1) { onNotify(`Không thể xóa “${item.name}” khi còn ${descendantIds.size - 1} danh mục con. Hãy xử lý danh mục con trước.`); return; }
    if (!window.confirm("Bạn có chắc muốn xóa danh mục “" + item.name + "”?")) return;
    try {
      const remaining = await onDelete(item.id);
      setSelectedId(remaining[0]?.id ?? "");
      setDraft(null);
      setCreating(false);
      setChecked((current) => current.filter((id) => !descendantIds.has(id)));
      onNotify("Đã xóa danh mục “" + item.name + "”.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xóa danh mục.");
    }
  };

  const duplicate = async () => {
    if (!category) return;
    if (isFixedJewelryCategory(category, categories)) {
      onNotify("Danh mục trang sức bắt buộc không thể sao chép hoặc chỉnh sửa.");
      return;
    }
    const copy = { ...category, id: `DM${String(Date.now()).slice(-6)}`, name: `${category.name} (Bản sao)`, slug: `${category.slug}-ban-sao`, products: 0, sortOrder: `${category.sortOrder}.1` };
    const persisted = await onSave([copy, ...categories]);
    const savedCopy = (Array.isArray(persisted) ? persisted : [copy, ...categories]).find((item) => item.slug === copy.slug) ?? copy;
    setSelectedId(savedCopy.id);
    setDraft(null);
    setCreating(false);
    onNotify(`Đã sao chép danh mục “${category.name}”.`);
  };

  const uploadImage = async (file?: File) => {
    if (!file || !category) return;
    try {
      update("image", await makeCategoryThumbnail(file));
      onNotify("Đã nén ảnh xem trước. Bấm Lưu thay đổi để lưu ảnh vào database.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xử lý ảnh danh mục.");
    }
  };

  const uploadBanner = async (file?: File) => {
    if (!file || !category) return;
    try {
      const dataUrl = await compressProductImage(file);
      const response = await fetch(`${apiBaseUrl}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: "image/webp", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), alt: `Banner danh mục ${category.name || "GEME"}` }) });
      if (!response.ok) {
        let message = "Không thể lưu ảnh banner vào database.";
        try { const detail = await response.json(); message = detail.message || message; } catch { /* keep fallback */ }
        throw new Error(Array.isArray(message) ? message.join(" ") : message);
      }
      const asset = await response.json();
      update("bannerUrl", String(asset.url || `/media/${asset.id}`));
      onNotify("Ảnh banner danh mục đã được lưu trong database. Bấm Lưu thay đổi để gắn vào danh mục.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể tải ảnh banner lên.");
    }
  };

  return <div className="categories-workspace">
    <div className="categories-heading"><div><h1>Danh mục</h1><p>Quản lý danh mục sản phẩm, sắp xếp và phân loại sản phẩm theo từng ngành hàng.</p></div><div className="categories-heading-actions"><button className="button button-primary" onClick={() => startCreate()}><Icon name="plus"/>Thêm danh mục</button><button className="button button-quiet" onClick={() => { setSortAscending((value) => !value); onNotify(sortAscending ? "Đã sắp xếp danh mục theo thứ tự giảm dần." : "Đã sắp xếp danh mục theo thứ tự tăng dần."); }}><span className="sort-glyph">↕</span>Sắp xếp thứ tự</button></div></div>
    <main className="categories-main">

      <section className="category-summary">
        <article className="category-metric"><span className="category-metric-icon mint"><Icon name="grid"/></span><span><small>Tổng danh mục</small><strong>{tabCounts["Tất cả"]}</strong></span></article>
        <article className="category-metric"><span className="category-metric-icon green"><Icon name="tag"/></span><span><small>Danh mục trang sức</small><strong>{tabCounts["Trang sức"]}</strong></span></article>
        <article className="category-metric"><span className="category-metric-icon slate"><Icon name="gem"/></span><span><small>Danh mục đá quý</small><strong>{tabCounts["Đá quý"]}</strong></span></article>
        <article className="category-metric"><span className="category-metric-icon amber"><Icon name="star"/></span><span><small>Danh mục khác</small><strong>{tabCounts["Khác"]}</strong></span></article>
      </section>

      <section className="category-table-panel">
        <div className="category-toolbar"><div className="category-tabs" role="tablist" aria-label="Lọc loại danh mục">{(["Tất cả", "Trang sức", "Đá quý", "Khác"] as KindFilter[]).map((kind) => <button key={kind} role="tab" aria-selected={kindFilter === kind} className={kindFilter === kind ? "active" : ""} onClick={() => { setKindFilter(kind); setPage(1); }}>{kind} <span>({tabCounts[kind]})</span></button>)}</div><div className="category-filters"><label className="category-search"><Icon name="search"/><input aria-label="Tìm kiếm danh mục" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm kiếm danh mục..."/></label><button className="category-filter-button" aria-label="Bộ lọc" onClick={() => onNotify("Bộ lọc nâng cao sẽ được bổ sung khi kết nối dữ liệu.")}><Icon name="filter"/></button></div></div>
        <div className="category-table-scroll"><table className="category-table"><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả danh mục" checked={rows.length > 0 && rows.every(({ item }) => checked.includes(item.id))} onChange={(event) => setChecked(event.target.checked ? [...new Set([...checked, ...rows.map(({ item }) => item.id)])] : checked.filter((id) => !rows.some(({ item }) => item.id === id)))}/></th><th>Hình ảnh</th><th>Tên danh mục</th><th>Slug</th><th>Số sản phẩm</th><th>Trạng thái</th><th>Thứ tự</th><th>Thao tác</th></tr></thead><tbody>{rows.length ? rows.map(({ item, level }) => { const children = categories.some((candidate) => candidate.parentId === item.id); const descendants = new Set([item.id]); for (const parentId of descendants) categories.filter((candidate) => candidate.parentId === parentId).forEach((child) => descendants.add(child.id)); const dependentProducts = categories.filter((candidate) => descendants.has(candidate.id)).reduce((sum, candidate) => sum + candidate.products, 0); const cannotDelete = children || dependentProducts > 0 || isFixedJewelryCategory(item, categories); return <tr key={item.id} className={`category-level-${level} ${selectedId === item.id ? "selected" : ""} ${isFixedJewelryCategory(item, categories) ? "is-fixed-category" : ""}`} onClick={() => selectCategory(item)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn danh mục ${item.name}`} checked={checked.includes(item.id)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}/></td><td><span className={`category-row-image category-row-placeholder ${level > 1 ? "child" : ""}`}>{item.image ? <img src={item.image} alt=""/> : <Icon name={item.kind === "Đá quý" ? "gem" : "tag"}/>}</span></td><td><div className={`category-name-block ${level > 1 ? "is-child" : ""} ${level === 3 ? "is-grandchild" : ""}`} style={{ paddingLeft: `${(level - 1) * 18}px` }}>{children ? <button className="category-tree-toggle" aria-label={collapsedIds.has(item.id) ? `Mở ${item.name}` : `Thu gọn ${item.name}`} aria-expanded={!collapsedIds.has(item.id)} onClick={(event) => { event.stopPropagation(); setCollapsedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); }}>{collapsedIds.has(item.id) ? "▸" : "▾"}</button> : <span className="category-tree-spacer"/>}<strong>{item.name}</strong>{item.isHot && <b className="category-hot">HOT</b>}</div></td><td className="category-slug">{item.slug}</td><td>{item.products}</td><td><button className="category-status-toggle" aria-label={`${item.status === "Hoạt động" ? "Ẩn" : "Hiện"} ${item.name}`} title={`${item.status === "Hoạt động" ? "Ẩn" : "Hiện"} danh mục trên website`} onClick={(event) => { event.stopPropagation(); void toggleVisibility(item); }}><CategoryStatus status={item.status}/></button></td><td className="category-order-cell">{item.sortOrder}</td><td className="category-row-actions" onClick={(event) => event.stopPropagation()}><button aria-label={`Sửa ${item.name}`} onClick={() => selectCategory(item)}><Icon name="edit"/></button><button className="danger" aria-label={`Xóa danh mục ${item.name}`} title={cannotDelete ? "Không thể xóa khi còn sản phẩm hoặc danh mục con phụ thuộc" : "Xóa danh mục"} disabled={cannotDelete} onClick={() => void deleteCategory(item)}><Icon name="trash"/></button></td></tr>; }) : <tr><td className="category-empty" colSpan={8}>Không tìm thấy danh mục phù hợp.</td></tr>}</tbody></table></div>
        <div className="category-pagination"><span>Hiển thị {rows.length} danh mục · {tree.rootCount} danh mục cấp 1{checked.length > 0 && ` · Đã chọn ${checked.length}`}</span><div><button aria-label="Trang trước" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>{Array.from({ length: pages }, (_, index) => index + 1).map((number) => <button key={number} className={number === page ? "current" : ""} onClick={() => setPage(number)}>{number}</button>)}<button aria-label="Trang sau" disabled={page === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>›</button><select value={pageSize} aria-label="Số danh mục cấp 1 mỗi trang" onChange={() => setPage(1)}><option value={10}>10 nhóm / trang</option></select></div></div>
      </section>
    </main>

    <aside className="category-editor-panel">
      <div className="category-editor-heading"><h2>{creating ? "Thêm danh mục" : "Thêm / Chỉnh sửa danh mục"}</h2>{category && <button className="category-close" onClick={() => { setDraft(null); setCreating(false); setSelectedId(""); }} aria-label="Đóng chi tiết"><Icon name="close"/></button>}</div>
      <nav className="category-editor-tabs" role="tablist" aria-label="Cài đặt danh mục">{(categoryIsFixed ? [tabs[0]] : tabs).map((tab) => <button key={tab.key} className={activeTab === tab.key ? "active" : ""} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}</nav>
      {!category ? <div className="category-editor-empty"><Icon name="tag"/><strong>Chọn một danh mục</strong><span>Chọn dòng danh mục để xem và cập nhật thông tin.</span></div> : <>
        {categoryIsFixed && activeTab === "basic" ? <div className="category-editor-fields category-fixed-editor"><strong>Danh mục bắt buộc</strong><p>{category.name} là danh mục cố định của GEME. Không thể sửa tên, cấu trúc hoặc xóa; chỉ có thể ẩn/hiện.</p><CategoryStatus status={category.status}/><button className={`button ${category.status === "Hoạt động" ? "button-quiet" : "button-primary"}`} disabled={saving} onClick={() => void toggleVisibility()}><Icon name="eye"/>{category.status === "Hoạt động" ? "Ẩn danh mục" : "Hiện danh mục"}</button></div> : activeTab === "basic" && <div className="category-editor-fields">
          <label className="category-field"><span>{category.kind === "Đá quý" && categoryLevel(category) === 3 ? "Tên dạng cắt" : "Tên danh mục"} <b>*</b></span><input value={category.name} onChange={(event) => updateName(event.target.value)} placeholder={category.kind === "Đá quý" && categoryLevel(category) === 3 ? "Ví dụ: Oval, Pear, Cabochon" : "Nhập tên danh mục"}/></label>
          <label className="category-field"><span>Slug <b>*</b></span><input value={category.slug} onChange={(event) => { setSlugEdited(true); update("slug", slugify(event.target.value)); }} placeholder="ten-danh-muc"/><small>Slug sẽ được tạo tự động nếu để trống</small></label>
          {creating && <label className="category-field"><span>Cấp danh mục</span><select value={categoryLevel(category)} onChange={(event) => changeLevel(Number(event.target.value) as 1 | 2 | 3)}>{category.kind === "Trang sức" ? <><option value={2}>Cấp 2 · Danh mục</option><option value={3}>Cấp 3 · Phân loại con</option></> : category.kind === "Đá quý" ? <><option value={1}>Cấp 1 · Nhóm chính</option><option value={2}>Cấp 2 · Loại đá / danh mục</option></> : <><option value={1}>Cấp 1 · Nhóm chính</option><option value={2}>Cấp 2 · Danh mục</option></>}</select><small>{category.kind === "Đá quý" && categoryLevel(category) === 3 ? "Dạng cắt cấp 3 được quản lý trong Sản phẩm → Loại đá → Mặt đá quý." : "Chọn danh mục cha bên dưới để đặt đúng vị trí trong cây danh mục."}</small></label>}
          {(creating || !category.parentId) && <label className="category-field"><span>Nhóm danh mục</span><select value={category.kind} onChange={(event) => changeKind(event.target.value as CategoryKind)}><option>Trang sức</option><option>Đá quý</option>{(!creating || category.kind === "Khác") && <option>Khác</option>}</select><small>Chọn nhóm hàng rồi đặt danh mục vào đúng cấp bên dưới.</small></label>}
          {category.parentId && <label className="category-field"><span>Danh mục cha cấp {categoryLevel(category) - 1}</span><select value={category.parentId} onChange={(event) => { const parent = categories.find((item) => item.id === event.target.value); setDraft((current) => current ? { ...current, parentId: parent?.id, kind: parent?.kind ?? current.kind, usage: categoryLevel(current) === 2 && parent?.kind === "Đá quý" ? current.usage ?? "product" : "product", pricingMode: current.usage === "stone" ? "FIXED" : parent?.slug === "vong-tay" ? "QUALITY_AND_BEAD_SIZE" : current.kind === "Đá quý" ? "QUALITY" : current.pricingMode ?? "FIXED", sortOrder: parent ? `${parent.sortOrder}.1` : "1" } : current); }}>{categories.filter((item) => item.id !== category.id && categoryLevel(item) === categoryLevel(category) - 1 && item.kind === category.kind && item.status === "Hoạt động" && (categoryLevel(category) !== 3 || (category.kind === "Đá quý" ? true : item.usage !== "stone"))).map((item) => <option key={item.id} value={item.id}>{item.name}{categoryLevel(item) > 1 ? ` · ${categories.find((parent) => parent.id === item.parentId)?.name ?? ""}` : ""}</option>)}</select></label>}
          {category.parentId && category.kind === "Đá quý" && categoryLevel(category) === 2 && <label className="category-field"><span>Dùng danh mục này làm</span><select value={category.usage ?? "product"} onChange={(event) => { const usage = event.target.value as "product" | "stone"; update("usage", usage); update("pricingMode", usage === "stone" ? "FIXED" : "QUALITY"); }}><option value="product">Danh mục sản phẩm (ví dụ: Mặt đá quý)</option><option value="stone">Loại đá để gắn vào mặt đá (ví dụ: Opal)</option></select><small>Loại đá sẽ xuất hiện trong danh sách chọn; có thể tạo các dạng cắt bên dưới loại đá này.</small></label>}
          {category.parentId && category.usage !== "stone" && category.kind !== "Khác" && <label className="category-field"><span>Cách định giá</span><select value={category.pricingMode ?? (category.kind === "Đá quý" ? "QUALITY" : "FIXED")} onChange={(event) => update("pricingMode", event.target.value as AdminCategory["pricingMode"])}><option value="FIXED">Giá cố định</option><option value="QUALITY">Giá theo chất lượng</option><option value="QUALITY_AND_BEAD_SIZE">Giá theo chất lượng và size hạt</option></select><small>Quy tắc giá sẽ tự áp dụng trong form tạo và sửa sản phẩm.</small></label>}
          {creating && category.parentId && category.kind !== "Khác" && <p className="category-create-next-step">{category.usage === "stone" ? "Sau khi lưu loại đá, thêm các dạng cắt trong Sản phẩm → Loại đá → Mặt đá quý." : isGemstoneCut(category, categories) || category.kind === "Đá quý" && categoryLevel(category) === 3 ? "Dạng cắt này có thể chọn làm danh mục khi tạo hồ sơ mặt đá quý." : `Sau khi lưu danh mục cấp ${categoryLevel(category)}, màn hình sẽ chuyển sang tạo sản phẩm thuộc danh mục này.`}</p>}
          <label className="category-field"><span>Mô tả ngắn</span><textarea rows={3} maxLength={200} value={category.description ?? ""} onChange={(event) => update("description", event.target.value)} placeholder="Nhập mô tả ngắn về danh mục..."/><small className="category-counter">{(category.description ?? "").length}/200</small></label>
          <div className="category-status-setting"><div><strong>Trạng thái</strong></div><label className="category-switch"><input type="checkbox" checked={category.status === "Hoạt động"} onChange={(event) => update("status", event.target.checked ? "Hoạt động" : "Đã ẩn")}/><span/><small>{category.status}</small></label></div>
          <label className="category-field category-order-setting"><span>Thứ tự hiển thị</span><input type="number" min="1" value={Number(category.sortOrder.split(".").at(-1)) || 1} onChange={(event) => { const order = event.target.value || "1"; update("sortOrder", category.parentId ? `${categories.find((item) => item.id === category.parentId)?.sortOrder ?? "1"}.${order}` : order); }}/><small>Thứ tự ưu tiên hiển thị (số nhỏ hơn sẽ hiển thị trước)</small></label>
          <div className="category-editor-actions"><button className="button button-quiet" onClick={cancel}>Hủy</button><button className="button button-primary" onClick={save}>{creating && category.parentId && category.kind !== "Khác" && categoryLevel(category) !== 3 ? "Lưu và tạo sản phẩm" : creating ? "Lưu danh mục" : "Lưu thay đổi"}</button></div>
        </div>}

        {activeTab === "seo" && <div className="category-editor-fields"><label className="category-field"><span>Tiêu đề SEO</span><input value={category.seoTitle ?? ""} onChange={(event) => update("seoTitle", event.target.value)} placeholder={category.name || "Tên danh mục"}/></label><label className="category-field"><span>Mô tả SEO</span><textarea rows={4} maxLength={160} value={category.seoDescription ?? ""} onChange={(event) => update("seoDescription", event.target.value)} placeholder="Mô tả danh mục cho công cụ tìm kiếm..."/></label><div className="category-seo-preview"><small>geme.vn › danh-muc › {category.slug || "ten-danh-muc"}</small><strong>{category.seoTitle || category.name || "Tên danh mục"} | GEME</strong><span>{category.seoDescription || category.description || "Khám phá các sản phẩm trong danh mục GEME."}</span></div><div className="category-editor-actions"><button className="button button-quiet" onClick={cancel}>Hủy</button><button className="button button-primary" onClick={save}>Lưu thay đổi</button></div></div>}

        {activeTab === "media" && <div className="category-editor-fields">
          <div className="category-field"><span>Ảnh đại diện danh mục</span><label className="category-upload"><input type="file" accept="image/*" onChange={(event) => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }}/>{category.image ? <img src={categoryImageUrl(category.image)} alt="Ảnh danh mục"/> : <><Icon name="image"/><strong>Chọn ảnh danh mục</strong><small>Ảnh sẽ tự thu nhỏ để dùng trong menu</small></>}</label></div>
          <div className="category-field"><span>Banner trang danh mục</span><label className="category-upload category-banner-upload"><input type="file" accept="image/*" onChange={(event) => { void uploadBanner(event.target.files?.[0]); event.currentTarget.value = ""; }}/>{category.bannerUrl ? <img src={categoryImageUrl(category.bannerUrl)} alt={`Banner ${category.name}`}/> : <><Icon name="image"/><strong>Chọn ảnh banner</strong><small>Ảnh sẽ hiện đầu trang khi khách chọn danh mục này</small></>}</label><small>Ảnh được lưu trong PostgreSQL, dùng được cho danh mục mới và danh mục đã có.</small>{category.bannerUrl && <button type="button" className="category-remove-banner" onClick={() => update("bannerUrl", "")}>Gỡ banner khỏi danh mục</button>}</div>
          <div className="category-editor-actions"><button className="button button-quiet" onClick={cancel}>Hủy</button><button className="button button-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button></div>
        </div>}

         <section className="category-quick-actions"><h3>Hành động nhanh</h3>{!(category.kind === "Đá quý" && categoryLevel(category) === 2 && category.usage === "stone") && <button disabled={categoryLevel(category) >= 3 || category.kind === "Đá quý" && categoryLevel(category) === 2} onClick={() => startCreate(category)}><Icon name="plus"/>Tạo danh mục con</button>}{!categoryIsFixed && <button onClick={duplicate}><Icon name="copy"/>Sao chép danh mục</button>}<button className={category.status === "Hoạt động" ? "danger" : ""} disabled={saving} onClick={() => void toggleVisibility()}><Icon name="eye"/>{category.status === "Hoạt động" ? "Ẩn danh mục" : "Hiện danh mục"}</button></section>
      </>}
    </aside>
  </div>;
}
