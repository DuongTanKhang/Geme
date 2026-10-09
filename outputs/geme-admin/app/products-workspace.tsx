"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialOption } from "./materials-workspace";
import { uploadProductImage, uploadProductVideo, MAX_PRODUCT_IMAGES, MAX_VARIANT_MEDIA_ITEMS, parsePriceInput } from "./product-images";
import { TechnicalImagePicker } from "./technical-image-picker";

export type AdminProduct = {
  id: string;
  apiId?: string;
  name: string;
  price: number;
  sold: number;
  revenue: number;
  stock: number;
  status: string;
  isNew?: boolean;
  productType?: "Trang sức" | "Đá quý";
  category?: string;
  categoryId?: string;
  materialOptionId?: string;
  categoryPricingMode?: "FIXED" | "QUALITY" | "QUALITY_AND_BEAD_SIZE";
  subcategory?: string;
  qualityGrades?: string[];
  beadSizes?: string[];
  priceVariants?: ProductPriceVariant[];
  originalPrice?: number;
  description?: string;
  fullDescription?: string;
  image?: string;
  gallery?: string[];
  coverVideoUrl?: string;
  technicalImage?: string;
  technicalVideo?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  rating?: number;
  reviews?: number;
  seoTitle?: string;
  seoDescription?: string;
  pos365PriceSyncStatus?: string | null;
  pos365PriceSyncError?: string | null;
  pos365PriceSyncedAt?: string | null;
};

export type ProductPriceVariant = {
  id?: string;
  sku?: string | null;
  quality: string;
  beadSize?: string;
  price: number;
  originalPrice?: number;
  stock: number;
  imageUrls?: string[];
  videoUrl?: string | null;
};

type Props = {
  products: AdminProduct[];
  onSave: (product: AdminProduct) => Promise<AdminProduct | void> | AdminProduct | void;
  onDelete: (product: AdminProduct) => Promise<void>;
  onAdd: () => void;
  onNotify: (message: string) => void;
  categories: AdminCategory[];
  materials: MaterialOption[];
};

const qualityPricing = (mode?: AdminProduct["categoryPricingMode"]) => mode === "QUALITY" || mode === "QUALITY_AND_BEAD_SIZE";

const iconPaths: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9zM2 9h20M8 3l4 18 4-18"/>',
  bag: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 6V4a4 4 0 0 1 8 0v2"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12m0 0 5-5m-5 5-5-5M4 17v3h16v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.9M6.2 6.2C3.4 8.1 2 12 2 12s3.5 7 10 7c1.3 0 2.4-.3 3.4-.7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reset: '<path d="M3 12a9 9 0 0 1 15-6l2 2m1-5v5h-5M21 12a9 9 0 0 1-15 6l-2-2m-1 5v-5h5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m4 4v7m6-7v7"/>',
};

function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: iconPaths[name] ?? iconPaths.gem }} />;
}

function money(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

function Status({ children }: { children: string }) {
  const tone = children === "Đang hoạt động" ? "green" : children === "Tạm ẩn" || children === "Bản nháp" ? "muted" : "red";
  return <span className={`product-status ${tone}`}><i />{children}</span>;
}

const tabs = [
  { key: "basic", label: "Thông tin cơ bản", icon: "edit" },
  { key: "variants", label: "Biến thể & Giá", icon: "layers" },
  { key: "images", label: "Hình ảnh", icon: "image" },
  { key: "seo", label: "SEO", icon: "code" },
  { key: "history", label: "Lịch sử", icon: "clock" },
];

export default function ProductsWorkspace({ products, categories: categoryRecords, materials, onSave, onDelete, onAdd, onNotify }: Props) {
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState("basic");
  const [imageIndex, setImageIndex] = useState(0);
  const [draft, setDraft] = useState<Partial<AdminProduct>>({});
  const [search, setSearch] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingCoverVideo, setUploadingCoverVideo] = useState(false);
  const [uploadingTechnicalImage, setUploadingTechnicalImage] = useState(false);
  const [uploadingTechnicalVideo, setUploadingTechnicalVideo] = useState(false);
  const [uploadingVariantMedia, setUploadingVariantMedia] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [busyActionId, setBusyActionId] = useState("");
  const [previewVariantImage, setPreviewVariantImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!previewVariantImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewVariantImage(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewVariantImage]);

  const selected = products.find((product) => product.id === selectedId);
  const product = selected ? { ...selected, ...draft } : undefined;
  const isGemstone = product?.productType === "Đá quý";
  const selectedCategory = product && (categoryRecords.find((item) => item.id === product.categoryId) ?? categoryRecords.find((item) => item.kind === product.productType && item.name === product.category));
  const pricingMode = product?.categoryPricingMode ?? selectedCategory?.pricingMode ?? (isGemstone ? (product?.category?.toLocaleLowerCase("vi").includes("vòng") ? "QUALITY_AND_BEAD_SIZE" : "QUALITY") : "FIXED");
  const usesQualityPricing = qualityPricing(pricingMode);
  const productRoot = categoryRecords.find((item) => !item.parentId && item.kind === product?.productType);
  const productCategories = categoryRecords.filter((item) => item.kind === product?.productType && item.parentId && item.status === "Hoạt động" && item.usage !== "stone" && (item.level ?? 2) > 1);
  const materialCategoryId = product?.categoryId || selectedCategory?.id;
  const isApplicableMaterial = (item: MaterialOption) => item.id === product?.materialOptionId || !Array.isArray(item.appliedCategoryIds) || !materialCategoryId || item.appliedCategoryIds.includes(materialCategoryId);
  const stoneOptions = materials.filter((item) => item.scope === "Đá quý" && item.active && item.kind === "STONE" && isApplicableMaterial(item));
  const materialOptions = materials.filter((item) => item.scope === "Trang sức" && item.active && isApplicableMaterial(item));
  const categories = useMemo(() => [...new Set(products.filter((item) => !productTypeFilter || item.productType === productTypeFilter).map((item) => item.category).filter(Boolean))] as string[], [products, productTypeFilter]);
  const types = useMemo(() => [...new Set(products.filter((item) => (!productTypeFilter || item.productType === productTypeFilter) && (!categoryFilter || item.category === categoryFilter)).map((item) => item.subcategory).filter(Boolean))] as string[], [products, productTypeFilter, categoryFilter]);
  const rows = useMemo(() => products.filter((item) => {
    const query = search.trim().toLocaleLowerCase("vi");
    const matchesText = !query || `${item.id} ${item.name} ${item.category ?? ""} ${item.subcategory ?? ""}`.toLocaleLowerCase("vi").includes(query);
    return matchesText && (!productTypeFilter || item.productType === productTypeFilter) && (!categoryFilter || item.category === categoryFilter) && (!typeFilter || item.subcategory === typeFilter) && (!statusFilter || item.status === statusFilter);
  }), [products, search, productTypeFilter, categoryFilter, typeFilter, statusFilter]);
  const gallery = product?.gallery?.length ? product.gallery : product?.image ? [product.image] : [];

  const selectProduct = (id: string) => {
    setSelectedId(id);
    setDraft({});
    setActiveTab("basic");
    setImageIndex(0);
  };
  const update = (key: keyof AdminProduct, value: string | number | boolean | string[] | ProductPriceVariant[] | undefined) => setDraft((old) => ({ ...old, [key]: value }));
  const cancelChanges = () => setDraft({});
  const categoryTypeChanged = (value: "Trang sức" | "Đá quý") => {
    update("productType", value);
    update("category", "");
    update("categoryId", "");
    update("materialOptionId", "");
    update("categoryPricingMode", value === "Đá quý" ? "QUALITY" : "FIXED");
    update("subcategory", "");
    update("qualityGrades", value === "Đá quý" ? ["A", "AA", "AAA"] : []);
    update("beadSizes", []);
  };
  const categoryChanged = (categoryId: string) => {
    const record = productCategories.find((item) => item.id === categoryId);
    const mode = record?.pricingMode ?? (product?.productType === "Đá quý" ? "QUALITY" : "FIXED");
    update("categoryId", record?.id ?? "");
    update("category", record?.name ?? "");
    update("materialOptionId", "");
    update("subcategory", "");
    update("categoryPricingMode", mode);
    update("qualityGrades", qualityPricing(mode) ? (product?.qualityGrades?.length ? product.qualityGrades : ["A", "AA", "AAA"]) : []);
    update("beadSizes", mode === "QUALITY_AND_BEAD_SIZE" ? (product?.beadSizes?.length ? product.beadSizes : ["6mm", "8mm", "10mm"]) : []);
  };
  const combinationRows = (value: AdminProduct): ProductPriceVariant[] => {
    return value.priceVariants ?? [];
  };
  const updatePriceVariant = (variant: ProductPriceVariant, key: "price", value: number) => {
    if (!product) return;
    const keyOf = (item: ProductPriceVariant) => `${item.quality}::${item.beadSize ?? ""}`;
    const map = new Map(combinationRows(product).map((item) => [keyOf(item), item]));
    const itemKey = keyOf(variant);
    map.set(itemKey, { ...map.get(itemKey)!, [key]: value });
    update("priceVariants", [...map.values()]);
  };
  const updateVariantMedia = (variant: ProductPriceVariant, patch: Partial<ProductPriceVariant>) => {
    if (!product) return;
    const keyOf = (item: ProductPriceVariant) => `${item.quality}::${item.beadSize ?? ""}`;
    const itemKey = keyOf(variant);
    update("priceVariants", combinationRows(product).map((item) => keyOf(item) === itemKey ? { ...item, ...patch } : item));
  };
  const handleVariantImages = async (variant: ProductPriceVariant, fileList?: FileList | File[]) => {
    if (!fileList?.length || !product) return;
    const existing = variant.imageUrls || [];
    const mediaCount = existing.length + (variant.videoUrl ? 1 : 0);
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_VARIANT_MEDIA_ITEMS - mediaCount));
    if (!files.length) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; }
    const key = variant.sku || `${variant.quality}-${variant.beadSize || ""}`;
    setUploadingVariantMedia((current) => ({ ...current, [key]: true }));
    try {
      const added: string[] = [];
      for (let index = 0; index < files.length; index += 1) added.push(await uploadProductImage(files[index], `variant-${product.id}-${key}-${existing.length + index + 1}.webp`, `${product.name} · ${variant.quality}`));
      updateVariantMedia(variant, { imageUrls: [...existing, ...added].slice(0, 8) });
      onNotify(`Đã tải ${added.length} ảnh cho SKU ${variant.sku || "biến thể"} lên.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không xử lý được ảnh biến thể."); }
    finally { setUploadingVariantMedia((current) => ({ ...current, [key]: false })); }
  };
  const handleVariantVideo = async (variant: ProductPriceVariant, file?: File) => {
    if (!file || !product) return;
    if (!variant.videoUrl && (variant.imageUrls?.length || 0) >= MAX_VARIANT_MEDIA_ITEMS) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "mp4" && extension !== "webm") { onNotify("Chỉ nhận video MP4 hoặc WebM."); return; }
    const key = variant.sku || `${variant.quality}-${variant.beadSize || ""}`;
    setUploadingVariantMedia((current) => ({ ...current, [key]: true }));
    try {
      const url = await uploadProductVideo(file, `variant-${product.id}-${key}.${extension}`, `${product.name} · ${variant.quality}`);
      updateVariantMedia(variant, { videoUrl: url });
      onNotify(`Đã tải video cho SKU ${variant.sku || "biến thể"}. Lưu thay đổi để hoàn tất.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu video biến thể."); }
    finally { setUploadingVariantMedia((current) => ({ ...current, [key]: false })); }
  };
  const save = async () => {
    if (!product || saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)) return;
    if (combinationRows(product).some((variant) => (variant.imageUrls?.length || 0) + (variant.videoUrl ? 1 : 0) > MAX_VARIANT_MEDIA_ITEMS)) {
      onNotify(`Mỗi biến thể chỉ lưu tối đa ${MAX_VARIANT_MEDIA_ITEMS} ảnh/video cộng lại.`);
      setActiveTab("variants");
      return;
    }
    if (!product.name.trim() || !product.category) {
      onNotify("Nhập tên sản phẩm và chọn danh mục cấp 2 trước khi lưu.");
      setActiveTab("basic");
      return;
    }
    if (usesQualityPricing && !combinationRows(product).length && product.status === "Đang hoạt động") {
      onNotify("Danh mục này cần biến thể được tạo từ phiếu nhập kho trước khi đăng bán.");
      setActiveTab("variants");
      return;
    }
    const saved = { ...product, ...draft, categoryId: product.categoryId ?? selectedCategory?.id, categoryPricingMode: pricingMode };
    if (combinationRows(saved).length) {
      saved.priceVariants = combinationRows(saved);
      if (saved.priceVariants.some((variant) => variant.price <= 0)) {
        onNotify("Nhập giá bán cho từng biến thể đã có trong kho trước khi lưu.");
        setActiveTab("variants");
        return;
      }
      const prices = saved.priceVariants.map((variant) => variant.price).filter((price) => price > 0);
      if (prices.length) saved.price = Math.min(...prices);
    } else if (saved.price <= 0) {
      onNotify("Nhập giá bán lớn hơn 0 trước khi lưu.");
      setActiveTab("basic");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...saved, gallery: saved.gallery ?? [], image: saved.gallery?.[0] ?? saved.image ?? "" });
      onNotify(`Đã lưu ${saved.id} vào database.`);
      setDraft({});
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu sản phẩm.");
    } finally {
      setSaving(false);
    }
  };

  const toggleVisibility = async (item: AdminProduct) => {
    if (busyActionId) return;
    const nextStatus = item.status === "Đang hoạt động" ? "Tạm ẩn" : "Đang hoạt động";
    setBusyActionId(item.id);
    try {
      await onSave({ ...item, status: nextStatus });
      if (selectedId === item.id) setDraft((current) => ({ ...current, status: nextStatus }));
      onNotify(nextStatus === "Tạm ẩn" ? "Đã ẩn sản phẩm “" + item.name + "” khỏi website." : "Đã hiện sản phẩm “" + item.name + "” trên website.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái sản phẩm.");
    } finally {
      setBusyActionId("");
    }
  };

  const deleteProduct = async (item: AdminProduct) => {
    if (busyActionId) return;
    if (!item.apiId) { onNotify("Không tìm thấy mã sản phẩm trong database."); return; }
    const confirmed = window.confirm(`Xóa vĩnh viễn “${item.name}” (SKU ${item.id}) khỏi GEME và SKU tương ứng khỏi POS365? Lịch sử đơn/phiếu nhập sẽ giữ tên và mã hàng đã ghi nhận.`);
    if (!confirmed) return;
    setBusyActionId(item.id);
    try {
      await onDelete(item);
      setCheckedIds((current) => current.filter((id) => id !== item.id));
      if (selectedId === item.id) {
        setSelectedId(products.find((candidate) => candidate.id !== item.id)?.id ?? "");
        setDraft({});
      }
      onNotify(`Đã xóa ${item.name} khỏi GEME và các SKU khớp trên POS365.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xóa sản phẩm.");
    } finally {
      setBusyActionId("");
    }
  };

  const uploadProductImages = async (fileList?: FileList | File[]) => {
    if (!fileList?.length || !product) return;
    const currentGallery = gallery;
    const capacity = MAX_PRODUCT_IMAGES - currentGallery.length;
    if (capacity <= 0) { onNotify(`Sản phẩm đã đủ ${MAX_PRODUCT_IMAGES} ảnh.`); return; }
    const files = Array.from(fileList).slice(0, capacity);
    setUploadingImages(true);
    const added: string[] = [];
    let failure = "";
    try {
      for (const file of files) {
        try { added.push(await uploadProductImage(file, `product-${product.id}-${currentGallery.length + added.length + 1}.webp`, product.name)); }
        catch (error) { failure = error instanceof Error ? error.message : "Không thể xử lý ảnh."; }
      }
      if (added.length) {
        const next = [...currentGallery, ...added].slice(0, MAX_PRODUCT_IMAGES);
        update("gallery", next);
        update("image", next[0] ?? "");
        setImageIndex(0);
        onNotify(`Đã tải ${added.length} ảnh lên. Ảnh đầu tiên là ảnh bìa; bấm Lưu thay đổi để hoàn tất.`);
      }
      if (files.length < fileList.length) onNotify(`Mỗi sản phẩm tối đa ${MAX_PRODUCT_IMAGES} ảnh; các ảnh vượt giới hạn chưa được thêm.`);
      else if (failure) onNotify(failure);
    } finally {
      setUploadingImages(false);
    }
  };
  const uploadCoverVideo = async (file?: File) => {
    if (!product || !file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "mp4" && extension !== "webm") { onNotify("Chỉ nhận video MP4 hoặc WebM."); return; }
    setUploadingCoverVideo(true);
    try {
      const url = await uploadProductVideo(file, `product-${product.id}-cover.${extension}`, `${product.name} · video bìa`);
      update("coverVideoUrl", url);
      onNotify("Đã tải video bìa lên. Video sẽ tự chạy, tắt tiếng và lặp trên website.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể tải video bìa.");
    } finally {
      setUploadingCoverVideo(false);
    }
  };
  const uploadTechnicalImage = async (file: File) => {
    if (!product) return;
    setUploadingTechnicalImage(true);
    try {
      update("technicalImage", await uploadProductImage(file, `product-${product.id}-technical.webp`, `${product.name} · ảnh kỹ thuật`));
      update("technicalVideo", "");
      onNotify("Đã tải ảnh kỹ thuật lên. Bấm Lưu thay đổi để hoàn tất.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xử lý ảnh kỹ thuật.");
    } finally {
      setUploadingTechnicalImage(false);
    }
  };
  const uploadTechnicalVideo = async (file: File) => {
    if (!product) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "mp4" && extension !== "webm") { onNotify("Chỉ nhận video MP4 hoặc WebM."); return; }
    setUploadingTechnicalVideo(true);
    try {
      update("technicalVideo", await uploadProductVideo(file, `product-${product.id}-technical.${extension}`, `${product.name} · video kỹ thuật`));
      update("technicalImage", "");
      onNotify("Đã tải video kỹ thuật lên. Bấm Lưu thay đổi để hoàn tất.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể tải video kỹ thuật."); }
    finally { setUploadingTechnicalVideo(false); }
  };
  const removeProductImage = (index: number) => {
    const next = gallery.filter((_, imageIndex) => imageIndex !== index);
    update("gallery", next);
    update("image", next[0] ?? "");
    setImageIndex(Math.max(0, Math.min(imageIndex, next.length - 1)));
  };
  const exportCsv = () => {
    const columns = ["Mã SKU", "Tên sản phẩm", "Danh mục", "Giá bán", "Tồn kho", "Trạng thái"];
    const csv = [columns.join(","), ...rows.map((item) => [item.id, item.name, item.category ?? "", item.price, item.stock, item.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "geme-san-pham.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const clearFilters = () => { setSearch(""); setProductTypeFilter(""); setCategoryFilter(""); setTypeFilter(""); setStatusFilter(""); };

  return <div className="products-workspace">
    <main className="products-main">
      <div className="products-heading">
        <div><h1>Sản phẩm</h1><p>Quản lý bài đăng trên website. SKU, biến thể và số lượng lấy từ mục Quản lý tồn kho.</p></div>
        <div className="products-actions">
          <button className="button button-quiet" onClick={() => onNotify("Nhập Excel sẽ được kết nối ở bước backend.")}><Icon name="upload"/>Nhập Excel</button>
          <button className="button button-quiet" onClick={exportCsv}><Icon name="download"/>Xuất Excel</button>
          <button className="button button-primary" onClick={onAdd}><Icon name="plus"/>Thêm bài đăng</button>
        </div>
      </div>

      <section className="product-summary">
        <button className="product-metric" onClick={() => setStatusFilter("")}><span className="metric-icon green"><Icon name="cart"/></span><span><small>Tổng sản phẩm</small><strong>{products.length}</strong></span></button>
        <button className="product-metric" onClick={() => setStatusFilter("Đang hoạt động")}><span className="metric-icon mint"><Icon name="gem"/></span><span><small>Đang hoạt động</small><strong>{products.filter((item) => item.status === "Đang hoạt động").length}</strong></span></button>
        <button className="product-metric" onClick={() => setStatusFilter("Tạm ẩn")}><span className="metric-icon amber"><Icon name="eye"/></span><span><small>Tạm ẩn</small><strong>{products.filter((item) => item.status === "Tạm ẩn").length}</strong></span></button>
        <button className="product-metric" onClick={() => setStatusFilter("Hết hàng")}><span className="metric-icon rose"><Icon name="bag"/></span><span><small>Hết hàng</small><strong>{products.filter((item) => item.stock === 0).length}</strong></span></button>
      </section>

      <section className="products-table-panel">
        <div className="product-filterbar">
          <label className="product-search"><Icon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm sản phẩm, mã SKU, tên sản phẩm..." aria-label="Tìm sản phẩm"/></label>
          <select value={productTypeFilter} onChange={(event) => { setProductTypeFilter(event.target.value); setCategoryFilter(""); setTypeFilter(""); }} aria-label="Lọc nhóm sản phẩm"><option value="">Trang sức &amp; đá quý</option><option>Trang sức</option><option>Đá quý</option></select>
          <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setTypeFilter(""); }} aria-label="Lọc danh mục"><option value="">Tất cả danh mục</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Lọc loại"><option value="">Tất cả loại</option>{types.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Lọc trạng thái"><option value="">Tất cả trạng thái</option><option>Đang hoạt động</option><option>Tạm ẩn</option><option>Bản nháp</option><option>Hết hàng</option></select>
          <button className="filter-reset" onClick={clearFilters}><Icon name="reset"/>Đặt lại</button>
        </div>
        <div className="page-table-wrap product-table-scroll">
          <table className="data-table product-table">
            <thead><tr><th className="product-check-col"><input type="checkbox" aria-label="Chọn tất cả sản phẩm" checked={rows.length > 0 && rows.every((item) => checkedIds.includes(item.id))} onChange={(event) => setCheckedIds(event.target.checked ? rows.map((item) => item.id) : [])}/></th><th>Ảnh</th><th>Tên sản phẩm</th><th>Danh mục</th><th>Giá bán</th><th>Tồn kho</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>{rows.length ? rows.map((item) => <tr key={item.id} onClick={() => selectProduct(item.id)} className={selectedId === item.id ? "selected" : ""}>
              <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${item.name}`} checked={checkedIds.includes(item.id)} onChange={(event) => setCheckedIds((old) => event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))}/></td>
              <td>{item.image ? <img className="product-row-image" src={item.image} alt=""/> : <span className="product-row-image product-image-placeholder">◇</span>}</td>
              <td><span className="product-name-cell">{item.name}</span><small>SKU: {item.id}</small></td>
              <td><span className="category-cell">{item.category ?? "Chưa phân loại"}</span><small>{item.productType ?? "Trang sức"} · {item.subcategory ?? "—"}</small></td>
              <td className="product-price-cell">{money(item.price)}</td><td>{item.stock}</td><td><span className="product-row-status"><Status>{item.status}</Status>{item.isNew && <span className="new-product-badge">Mới</span>}</span></td>
              <td className="product-row-actions" onClick={(event) => event.stopPropagation()}><button disabled={busyActionId === item.id} aria-label={(item.status === "Đang hoạt động" ? "Ẩn " : "Hiện ") + item.name} title={(item.status === "Đang hoạt động" ? "Ẩn" : "Hiện") + " sản phẩm trên website"} onClick={() => void toggleVisibility(item)}><Icon name={item.status === "Đang hoạt động" ? "eye" : "eyeOff"}/></button><button className="danger" disabled={busyActionId === item.id} aria-label={`Xóa ${item.name}`} title="Xóa sản phẩm khỏi GEME và POS365" onClick={() => void deleteProduct(item)}><Icon name="trash"/></button></td>
            </tr>) : <tr><td className="table-empty" colSpan={8}>{products.length ? "Không tìm thấy sản phẩm phù hợp." : "Chưa có sản phẩm."}</td></tr>}</tbody>
          </table>
        </div>
        <div className="product-pagination"><span>Hiển thị {rows.length ? 1 : 0} - {rows.length} / {rows.length} sản phẩm{checkedIds.length > 0 && ` · Đã chọn ${checkedIds.length}`}</span></div>
      </section>
    </main>

    {previewVariantImage && <div className="variant-image-lightbox" role="presentation" onClick={() => setPreviewVariantImage(null)}><div className="variant-image-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Xem ảnh biến thể" onClick={(event) => event.stopPropagation()}><button type="button" className="variant-image-lightbox-close" aria-label="Đóng ảnh lớn" onClick={() => setPreviewVariantImage(null)}><Icon name="close"/></button><img src={previewVariantImage.src} alt={previewVariantImage.alt}/><span>{previewVariantImage.alt}</span></div></div>}

    {product && <aside className="product-detail-panel">
      <div className="product-detail-title"><h2>Chi tiết sản phẩm</h2><button className="product-close" aria-label="Đóng chi tiết" onClick={() => setSelectedId("")}><Icon name="close"/></button></div>
      <div className="product-overview">
        <div className="product-gallery-preview">{product.coverVideoUrl ? <video className="product-large-image" src={product.coverVideoUrl} muted autoPlay loop playsInline preload="metadata" aria-label={`${product.name} · video bìa`}/> : gallery.length ? <img className="product-large-image" src={gallery[imageIndex % gallery.length]} alt={product.name || "Ảnh sản phẩm"}/> : <div className="product-image-placeholder product-large-image">Chưa có ảnh sản phẩm</div>}<div className="product-gallery-thumbs">{gallery.slice(0, 4).map((src, index) => <button key={`${src}-${index}`} className={!product.coverVideoUrl && index === imageIndex ? "active" : ""} onClick={() => setImageIndex(index)} aria-label={`Xem ảnh ${index + 1}`}><img src={src} alt=""/></button>)}</div></div>
        <div className="product-overview-copy"><h3>{product.name}</h3><small>SKU: {product.id}</small><div className="product-overview-price"><strong>{money(product.price)}</strong><Status>{product.status}</Status>{product.isNew && <span className="new-product-badge">Mới</span>}</div><p className="product-crumb">{product.productType ?? "Trang sức"}{product.category ? `　›　${product.category}` : "　›　Chưa chọn danh mục"}{product.subcategory ? `　›　${product.subcategory}` : ""}</p><div className="product-meta-line"><span>Tồn kho · quản lý riêng</span><strong>{product.stock}</strong></div><div className="product-meta-line"><span>Đã bán</span><strong>{product.sold}</strong></div><div className="product-rating"><span>Đánh giá</span><b>{product.reviews ? `${product.rating ?? ""} (${product.reviews})` : "Chưa có đánh giá"}</b></div></div>
      </div>

      <div className="product-tabs" role="tablist" aria-label="Chi tiết sản phẩm">{tabs.map((tab) => <button key={tab.key} role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}</div>

      {activeTab === "basic" && <section className="product-editor" aria-label="Thông tin cơ bản">
        <label className="product-field"><span>Tên sản phẩm <b>*</b></span><input value={product.name} onChange={(event) => update("name", event.target.value)} /></label>
        <div className="product-field-grid"><label className="product-field"><span>Danh mục cấp 1 <b>*</b></span><select value={product.productType ?? "Trang sức"} onChange={(event) => categoryTypeChanged(event.target.value as "Trang sức" | "Đá quý")}><option>Trang sức</option><option>Đá quý</option></select></label><label className="product-field"><span>Danh mục cấp 2 / 3 <b>*</b></span><select value={product.categoryId ?? selectedCategory?.id ?? ""} onChange={(event) => categoryChanged(event.target.value)}><option value="">Chọn danh mục</option>{productCategories.map((category) => {const parent = categoryRecords.find((item) => item.id === category.parentId);return <option key={category.id} value={category.id}>{parent && parent.id !== productRoot?.id ? parent.name + " / " + category.name : category.name}</option>;})}</select></label></div>
        <label className="product-field"><span>{isGemstone ? "Loại đá" : "Đá gắn / Chất liệu"}</span><select value={product.materialOptionId ?? ""} onChange={(event) => { const option = materials.find((item) => item.id === event.target.value); update("materialOptionId", option?.id ?? ""); update("subcategory", option?.name ?? ""); }}><option value="">Chọn {isGemstone ? "loại đá" : "đá gắn hoặc chất liệu"}</option>{(isGemstone ? stoneOptions : materialOptions).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <label className="product-field"><span>Khối lượng</span><div className="price-input"><input aria-label="Khối lượng (gram)" type="number" min="0" step="0.01" value={product.weightGrams ?? ""} onChange={(event) => update("weightGrams", event.target.value === "" ? undefined : Number(event.target.value))}/><i>g</i></div></label>
        <div className="product-field"><span>Kích thước (dài × rộng × cao, cm)</span><div className="product-dimension-fields"><input aria-label="Dài (cm)" type="number" min="0" step="0.01" value={product.lengthCm ?? ""} onChange={(event) => update("lengthCm", event.target.value === "" ? undefined : Number(event.target.value))}/><b>×</b><input aria-label="Rộng (cm)" type="number" min="0" step="0.01" value={product.widthCm ?? ""} onChange={(event) => update("widthCm", event.target.value === "" ? undefined : Number(event.target.value))}/><b>×</b><input aria-label="Cao (cm)" type="number" min="0" step="0.01" value={product.heightCm ?? ""} onChange={(event) => update("heightCm", event.target.value === "" ? undefined : Number(event.target.value))}/></div></div>
        <label className="product-field"><span>Mô tả ngắn</span><textarea rows={2} maxLength={160} value={product.description ?? ""} onChange={(event) => update("description", event.target.value)}/><small className="field-counter">{(product.description ?? "").length}/160</small></label>
        <div className="product-field"><span>Mô tả chi tiết</span><div className="rich-toolbar"><button type="button"><b>B</b></button><button type="button"><i>I</i></button><button type="button"><u>U</u></button><button type="button">☷</button><button type="button">☰</button><button type="button">↔</button><button type="button">↗</button><button type="button"><Icon name="image"/></button><button type="button">ⓘ</button></div><textarea className="detail-description" rows={4} maxLength={1000} value={product.fullDescription ?? ""} onChange={(event) => update("fullDescription", event.target.value)}/><small className="field-counter">{(product.fullDescription ?? "").length}/1000</small></div>
        <div className="product-section-caption">Giá bán</div>{product.priceVariants?.length || usesQualityPricing ? <div className="variant-price-note">Giá bán được nhập cho từng biến thể trong tab <b>Biến thể &amp; Giá</b>. Các lựa chọn và số lượng chỉ được tạo/cập nhật tại Quản lý tồn kho.</div> : <div className="product-field-grid price-stock-grid"><label className="product-field"><span>Giá bán <b>*</b></span><div className="price-input"><input type="text" inputMode="numeric" value={product.price || ""} onChange={(event) => update("price", parsePriceInput(event.target.value))}/><i>₫</i></div></label><label className="product-field"><span>Giá gốc</span><div className="price-input"><input type="text" inputMode="numeric" value={product.originalPrice || ""} onChange={(event) => update("originalPrice", parsePriceInput(event.target.value))}/><i>₫</i></div></label></div>}{!product.priceVariants?.length && !usesQualityPricing && <small className="inventory-management-hint">Số lượng tồn kho được quản lý riêng trong mục Quản lý tồn kho.</small>}
        <div className="product-publish"><div><strong>Trạng thái</strong><small>Hiển thị sản phẩm trên website</small></div><label className="product-switch"><input type="checkbox" checked={product.status === "Đang hoạt động"} onChange={(event) => update("status", event.target.checked ? "Đang hoạt động" : "Tạm ẩn")}/><span/><small>{product.status === "Đang hoạt động" ? "Hiển thị trên website" : "Tạm ẩn sản phẩm"}</small></label></div>
        <div className="product-new-flag"><div><strong>Sản phẩm mới</strong><small>Hiện nhãn “Mới” riêng trong danh sách sản phẩm</small></div><label className="product-switch"><input type="checkbox" checked={Boolean(product.isNew)} onChange={(event) => update("isNew", event.target.checked)}/><span/><small>{product.isNew ? "Đang gắn nhãn" : "Không gắn nhãn"}</small></label></div>
      </section>}

      {activeTab === "variants" && <section className="product-tab-content">
        <div className="product-tab-title"><div><h3>Biến thể, giá &amp; hình ảnh</h3><p>Biến thể và tồn kho lấy từ kho; tại đây chỉnh giá cùng ảnh/video theo từng SKU con, không tạo hoặc xóa biến thể.</p></div></div>
        {combinationRows(product).length ? <div className="variant-table product-variant-edit-list">
          {combinationRows(product).map((variant) => { const uploadKey = variant.sku || `${variant.quality}-${variant.beadSize || ""}`; const mediaCount = (variant.imageUrls?.length || 0) + (variant.videoUrl ? 1 : 0); return <div className="variant-edit-card" key={`${variant.sku || variant.quality}-${variant.beadSize ?? "standard"}`}><div className="variant-edit-card-heading"><div><strong>{variant.quality === "Kích thước" ? "Vòng tay" : variant.quality}{variant.beadSize ? ` · ${variant.beadSize}` : ""}</strong><small>{variant.sku || "SKU chưa có"} · Tồn {Number(variant.stock) || 0}</small></div><label className="variant-number-field"><span>Giá bán</span><div><input aria-label={`Giá ${variant.quality} ${variant.beadSize ?? ""}`} type="text" inputMode="numeric" value={variant.price || ""} onChange={(event) => updatePriceVariant(variant, "price", parsePriceInput(event.target.value))}/><small>₫</small></div></label></div><div className="variant-edit-media"><div className="variant-edit-media-heading"><strong>Ảnh &amp; video biến thể</strong><span>{mediaCount}/{MAX_VARIANT_MEDIA_ITEMS} tệp · lưu riêng theo SKU con</span></div><div className="variant-edit-media-images">{(variant.imageUrls || []).map((url, index) => { const alt = `Ảnh ${variant.sku || variant.quality} ${index + 1}`; return <span key={`${url.slice(0, 40)}-${index}`}><button type="button" className="variant-edit-image-preview" aria-label={`Phóng to ${alt}`} title="Bấm để xem ảnh lớn" onClick={() => setPreviewVariantImage({ src: url, alt })}><img src={url} alt={alt}/></button><button type="button" className="variant-edit-image-remove" aria-label={`Xóa ảnh biến thể ${index + 1}`} onClick={() => updateVariantMedia(variant, { imageUrls: (variant.imageUrls || []).filter((_, imageIndex) => imageIndex !== index) })}>×</button></span>; })}</div><div className="create-variant-media-actions"><label className="create-variant-media-picker"><input type="file" accept="image/*" multiple disabled={Boolean(uploadingVariantMedia[uploadKey]) || mediaCount >= MAX_VARIANT_MEDIA_ITEMS} onChange={(event) => { void handleVariantImages(variant, event.target.files ?? undefined); event.currentTarget.value = ""; }}/><span>{uploadingVariantMedia[uploadKey] ? "Đang xử lý ảnh…" : "＋ Thêm ảnh"}</span></label><label className="create-variant-media-picker"><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={Boolean(uploadingVariantMedia[uploadKey]) || (!variant.videoUrl && mediaCount >= MAX_VARIANT_MEDIA_ITEMS)} onChange={(event) => { void handleVariantVideo(variant, event.target.files?.[0]); event.currentTarget.value = ""; }}/><span>{uploadingVariantMedia[uploadKey] ? "Đang tải video…" : variant.videoUrl ? "＋ Đổi video" : "＋ Tải video"}</span></label></div><label className="variant-edit-video-url"><span>Đường dẫn video</span><input type="url" value={variant.videoUrl || ""} onChange={(event) => { const value = event.target.value || null; if (value && !variant.videoUrl && (variant.imageUrls?.length || 0) >= MAX_VARIANT_MEDIA_ITEMS) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; } updateVariantMedia(variant, { videoUrl: value }); }} placeholder="https://… hoặc /media/…"/></label>{variant.videoUrl && <video className="create-variant-video-preview" src={variant.videoUrl} controls playsInline preload="metadata" aria-label={`Video ${variant.sku || variant.quality}`}/>}</div></div>; })}
        </div> : <div className="jewelry-variant-note"><strong>{usesQualityPricing ? "Chưa có biến thể trong kho." : "Sản phẩm đang dùng một giá chung."}</strong><span>{usesQualityPricing ? "Tạo các phân loại và số lượng trong phiếu nhập kho trước. Sau đó nhập giá bán tại đây." : "Số lượng tồn kho được quản lý riêng trong mục Quản lý tồn kho."}</span></div>}
      </section>}

      {activeTab === "images" && <section className="product-tab-content"><div className="product-tab-title"><div><h3>Ảnh &amp; video bìa</h3><p>Video tự chạy khi khách nhìn thấy sản phẩm, tắt tiếng và lặp liên tục.</p></div><span>{gallery.length}/{MAX_PRODUCT_IMAGES} ảnh</span></div><div className="product-cover-video-field"><div><strong>Video bìa (không bắt buộc)</strong><small>MP4 hoặc WebM, tối đa 8 MB. Nếu có video, website ưu tiên hiển thị video thay ảnh bìa.</small></div>{product.coverVideoUrl && <video className="product-cover-video-preview" src={product.coverVideoUrl} muted autoPlay loop playsInline preload="metadata" aria-label={`${product.name} · video bìa`}/>}<label className="product-cover-video-picker"><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={uploadingCoverVideo} onChange={(event) => { void uploadCoverVideo(event.target.files?.[0]); event.currentTarget.value = ""; }}/><span>{uploadingCoverVideo ? "Đang tải video…" : product.coverVideoUrl ? "Đổi video bìa" : "Chọn video bìa"}</span></label>{product.coverVideoUrl && <button type="button" className="product-cover-video-remove" onClick={() => update("coverVideoUrl", "")}>Gỡ video</button>}<label className="product-cover-video-url"><span>Hoặc dán đường dẫn video</span><input type="url" value={product.coverVideoUrl || ""} onChange={(event) => update("coverVideoUrl", event.target.value)} placeholder="https://… hoặc /media/…"/></label></div><div className="product-tab-title product-gallery-heading"><div><h3>Thư viện ảnh</h3><p>Ảnh đầu tiên làm ảnh bìa nếu chưa chọn video. Ảnh tải lên ngay sau khi chọn.</p></div></div><div className="product-image-grid">{gallery.map((src, index) => <div className="product-image-item" key={`${src}-${index}`}><button type="button" className={index === imageIndex ? "active" : ""} onClick={() => setImageIndex(index)}><img src={src} alt={`Ảnh sản phẩm ${index + 1}`}/><small>{index === 0 && !product.coverVideoUrl ? "Ảnh bìa dự phòng" : `Ảnh ${index + 1}`}</small></button><button type="button" className="product-image-remove" aria-label={`Xóa ảnh ${index + 1}`} onClick={() => removeProductImage(index)}>×</button></div>)}</div><label className="image-dropzone"><input className="product-image-file-input" type="file" accept="image/*" multiple disabled={uploadingImages || gallery.length >= MAX_PRODUCT_IMAGES} onChange={(event) => { void uploadProductImages(event.target.files ?? undefined); event.currentTarget.value = ""; }}/><Icon name="image"/><strong>{uploadingImages ? "Đang tải ảnh lên…" : "Chọn một hoặc nhiều ảnh"}</strong><span>{uploadingImages ? "Đang tối ưu và lưu ảnh; không cần chờ đến lúc bấm lưu sản phẩm." : "Ảnh được tối ưu và tải lên ngay khi chọn. Bấm Lưu thay đổi để cập nhật thông tin sản phẩm."}</span></label><TechnicalImagePicker image={product.technicalImage} video={product.technicalVideo} uploading={uploadingTechnicalImage} uploadingVideo={uploadingTechnicalVideo} onSelect={(file) => void uploadTechnicalImage(file)} onSelectVideo={(file) => void uploadTechnicalVideo(file)} onRemove={() => update("technicalImage", "")} onRemoveVideo={() => update("technicalVideo", "")}/></section>}

      {activeTab === "seo" && <section className="product-tab-content"><div className="product-tab-title"><div><h3>Tối ưu tìm kiếm</h3><p>Xem trước cách sản phẩm xuất hiện trên công cụ tìm kiếm.</p></div></div><label className="product-field"><span>Tiêu đề SEO</span><input value={product.seoTitle ?? product.name} onChange={(event) => update("seoTitle", event.target.value)}/><small className="field-counter">{(product.seoTitle ?? product.name).length}/70</small></label><label className="product-field"><span>Mô tả SEO</span><textarea rows={4} maxLength={160} value={product.seoDescription ?? product.description ?? ""} onChange={(event) => update("seoDescription", event.target.value)}/><small className="field-counter">{(product.seoDescription ?? product.description ?? "").length}/160</small></label><div className="seo-preview"><small>geme.vn › san-pham › {product.id.toLowerCase()}</small><strong>{product.seoTitle ?? product.name}</strong><span>{product.seoDescription ?? product.description ?? "Khám phá trang sức đá quý thiên nhiên tinh tế tại GEME."}</span></div></section>}

      {activeTab === "history" && <section className="product-tab-content"><div className="product-tab-title"><div><h3>Lịch sử cập nhật</h3><p>Các hoạt động gần đây của sản phẩm này.</p></div></div><div className="product-history product-history-empty">Chưa có lịch sử cập nhật.</div></section>}

      <div className="product-editor-actions"><button className="button button-quiet" disabled={saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)} onClick={cancelChanges}>Hủy</button><button className="button button-primary" disabled={saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)} onClick={() => void save()}>{saving ? "Đang lưu…" : uploadingImages || uploadingCoverVideo || uploadingTechnicalVideo ? "Đang tải media…" : "Lưu thay đổi"}</button></div>
    </aside>}
  </div>;
}


