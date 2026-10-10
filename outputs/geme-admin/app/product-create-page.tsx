"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminProduct, ProductPriceVariant } from "./products-workspace";
import type { AdminCategory } from "./categories-workspace";
import type { MaterialOption } from "./materials-workspace";
import { uploadProductImage, uploadProductVideo, MAX_PRODUCT_IMAGES, MAX_VARIANT_MEDIA_ITEMS } from "./product-images";
import { TechnicalImagePicker } from "./technical-image-picker";
import { apiBaseUrl } from "../lib/api";

type Props = {
  products: AdminProduct[];
  categories: AdminCategory[];
  materials: MaterialOption[];
  initialCategory?: AdminCategory;
  onBack: () => void;
  onSave: (product: AdminProduct, publish: boolean) => Promise<AdminProduct | void> | AdminProduct | void;
  onNotify: (message: string) => void;
};

type TabKey = "basic" | "images" | "variants" | "seo" | "other";

type PricingMode = "FIXED" | "QUALITY" | "QUALITY_AND_BEAD_SIZE";
type InventorySkuRule = { categoryId: string; materialOptionIds?: string[]; materialPrefixes?: { materialOptionId: string }[] };
const qualityPricing = (mode?: PricingMode) => mode === "QUALITY" || mode === "QUALITY_AND_BEAD_SIZE";

const tabs: { key: TabKey; label: string }[] = [
  { key: "basic", label: "Thông tin cơ bản" },
  { key: "images", label: "Hình ảnh & Video" },
  { key: "variants", label: "Thông số & Biến thể" },
  { key: "seo", label: "SEO" },
  { key: "other", label: "Khác" },
];

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value || 0)} ₫`;

function fromInventoryProduct(value: Record<string, any>): AdminProduct {
  const variants = Array.isArray(value.variants) ? value.variants.map((variant: Record<string, any>) => ({
    id: String(variant.id || ""), sku: variant.sku || null, quality: String(variant.quality || "Standard"), beadSize: variant.beadSize || undefined,
    price: Number(variant.price) || 0, originalPrice: Number(variant.originalPrice) || undefined, stock: Number(variant.stock) || 0,
    imageUrls: Array.isArray(variant.imageUrls) ? variant.imageUrls.filter((url: unknown) => typeof url === "string") : [], videoUrl: variant.videoUrl || null,
  })) : [];
  const gallery = Array.isArray(value.images) ? value.images.map((image: Record<string, any>) => String(image.url || "")).filter(Boolean) : [];
  const category = value.category as Record<string, any> | null;
  const material = value.materialOption as Record<string, any> | null;
  const gemstoneType = value.gemstoneType as Record<string, any> | null;
  return {
    id: String(value.sku || ""), apiId: String(value.id || ""), name: String(value.name || ""),
    price: Number(value.price) || variants.reduce((min, row) => min ? Math.min(min, row.price) : row.price, 0),
    originalPrice: Number(value.originalPrice) || 0,
    stock: Number(value.stock) || variants.reduce((sum, row) => sum + row.stock, 0),
    sold: Number(value.soldThisMonth) || 0, revenue: 0,
    status: value.status === "ACTIVE" ? "Đang hoạt động" : value.status === "HIDDEN" ? "Tạm ẩn" : "Bản nháp",
    isNew: Boolean(value.isNew), productType: value.kind === "GEMSTONE" ? "Đá quý" : "Trang sức",
    category: String(category?.name || ""), categoryId: String(value.categoryId || ""), materialOptionId: value.materialOptionId || undefined, gemstoneTypeId: value.gemstoneTypeId || undefined,
    subcategory: String(material?.name || gemstoneType?.name || ""), categoryPricingMode: category?.pricingMode,
    description: String(value.description || ""), fullDescription: String(value.fullDescription || ""),
    image: gallery[0] || "", gallery, coverVideoUrl: String(value.coverVideoUrl || ""), technicalImage: String(value.technicalImageUrl || ""), technicalVideo: String(value.technicalVideoUrl || ""),
    weightGrams: value.weightGrams == null ? undefined : Number(value.weightGrams),
    lengthCm: value.lengthCm == null ? undefined : Number(value.lengthCm), widthCm: value.widthCm == null ? undefined : Number(value.widthCm), heightCm: value.heightCm == null ? undefined : Number(value.heightCm),
    qualityGrades: [...new Set(variants.map((row) => row.quality))],
    beadSizes: [...new Set(variants.map((row) => row.beadSize).filter(Boolean))] as string[],
    priceVariants: variants, seoTitle: String(value.seoTitle || ""), seoDescription: String(value.seoDescription || ""),
    pos365PriceSyncStatus: value.pos365PriceSyncStatus || null,
    pos365PriceSyncError: value.pos365PriceSyncError || null,
    pos365PriceSyncedAt: value.pos365PriceSyncedAt || null,
  };
}

function getVariantRows(product: AdminProduct): ProductPriceVariant[] {
  return product.priceVariants ?? [];
}

export default function ProductCreatePage({ products, categories: categoryRecords, materials, initialCategory, onBack, onSave, onNotify }: Props) {
  const initialType: "Trang sức" | "Đá quý" = initialCategory?.kind === "Đá quý" ? "Đá quý" : "Trang sức";
  const initialProductCategory = initialCategory?.usage === "stone"
    ? categoryRecords.find((item) => item.kind === "Đá quý" && item.usage === "product" && item.level === 2)
    : initialCategory && (initialCategory.level ?? 1) > 1 ? initialCategory : undefined;
  const initialMaterial = initialCategory?.usage === "stone" ? materials.find((item) => item.scope === "Trang sức" && item.kind === "STONE" && item.name === initialCategory.name) : undefined;
  const initialGemstoneTypeId = initialCategory?.kind === "Đá quý" && initialCategory.level === 3 ? initialCategory.parentId : initialCategory?.kind === "Đá quý" && initialCategory.level === 2 ? initialCategory.id : undefined;
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [product, setProduct] = useState<AdminProduct>({
    id: `SP${String(Date.now()).slice(-6)}`,
    name: "",
    price: 0,
    sold: 0,
    revenue: 0,
    stock: 0,
    status: "Bản nháp",
    isNew: true,
    productType: initialType,
    category: initialProductCategory?.parentId ? initialProductCategory.name : "",
    categoryId: initialProductCategory?.id,
    materialOptionId: initialMaterial?.id,
    gemstoneTypeId: initialGemstoneTypeId,
    categoryPricingMode: initialProductCategory?.pricingMode ?? (initialType === "Đá quý" ? "QUALITY" : "FIXED"),
    subcategory: initialMaterial?.name ?? "",
    description: "",
    fullDescription: "",
    originalPrice: 0,
    image: "",
    gallery: [],
    coverVideoUrl: "",
    technicalImage: "",
    technicalVideo: "",
    weightGrams: 0,
    qualityGrades: [],
    beadSizes: [],
    seoTitle: "",
    seoDescription: "",
  });
  const [imagePreview, setImagePreview] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingCoverVideo, setUploadingCoverVideo] = useState(false);
  const [uploadingVariantMedia, setUploadingVariantMedia] = useState<Record<string, boolean>>({});
  const [uploadingTechnicalImage, setUploadingTechnicalImage] = useState(false);
  const [uploadingTechnicalVideo, setUploadingTechnicalVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inventoryProducts, setInventoryProducts] = useState<AdminProduct[]>(products);
  const [inventorySkuRules, setInventorySkuRules] = useState<InventorySkuRule[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [selectedInventoryId, setSelectedInventoryId] = useState("");

  const reloadInventory = async () => {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      const [response, rulesResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/inventory`, { cache: "no-store" }),
        fetch(`${apiBaseUrl}/inventory/sku-rules`, { cache: "no-store" }).catch(() => null),
      ]);
      if (!response.ok) throw new Error("Không tải được danh sách tồn kho.");
      const data = await response.json() as { products?: Array<Record<string, any>> };
      setInventoryProducts((data.products || []).map(fromInventoryProduct));
      const ruleData = rulesResponse?.ok ? await rulesResponse.json() as { rules?: InventorySkuRule[] } : { rules: [] };
      setInventorySkuRules(ruleData.rules || []);
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : "Không tải được danh sách tồn kho.");
      setInventoryProducts(products);
    } finally { setInventoryLoading(false); }
  };

  useEffect(() => { void reloadInventory(); }, []);

  const isGemstone = product.productType === "Đá quý";
  const usesQualityPricing = qualityPricing(product.categoryPricingMode);
  const productRoot = categoryRecords.find((item) => !item.parentId && item.kind === product.productType);
  const matchingInventoryProducts = inventoryProducts.filter((item) => item.productType === product.productType);
  const availableCategoryRecords = categoryRecords.filter((item) => item.kind === product.productType && item.parentId && item.status === "Hoạt động" && item.usage !== "stone" && (item.level ?? 2) > 1);
  const gemstoneTypeOptions = categoryRecords.filter((item) => item.kind === "Đá quý" && item.level === 2 && item.status === "Hoạt động");
  const selectedProductCategory = categoryRecords.find((item) => item.id === product.categoryId) ?? availableCategoryRecords.find((item) => item.name === product.category);
  const categoryLabel = (item: AdminCategory) => {
    const path = [item.name];
    let parent = categoryRecords.find((candidate) => candidate.id === item.parentId);
    while (parent?.parentId) {
      const parentId = parent.parentId;
      path.unshift(parent.name);
      parent = categoryRecords.find((candidate) => candidate.id === parentId);
    }
    return path.join(" / ");
  };
  const categoryInventoryProducts = matchingInventoryProducts.filter((item) => isGemstone
    ? item.gemstoneTypeId === product.gemstoneTypeId || item.categoryId === (product.categoryId || selectedProductCategory?.id)
    : item.categoryId === (product.categoryId || selectedProductCategory?.id) || (!item.categoryId && item.category === product.category));
  const availableInventoryMaterialIds = new Set(categoryInventoryProducts.map((item) => item.materialOptionId).filter(Boolean));
  const availableInventoryStoneNames = new Set(categoryInventoryProducts.map((item) => item.subcategory).filter(Boolean));
  const selectedCategoryId = product.categoryId || selectedProductCategory?.id;
  const selectedSkuRule = inventorySkuRules.find((rule) => rule.categoryId === selectedCategoryId);
  const skuRuleMaterialIds = new Set([...(selectedSkuRule?.materialOptionIds || []), ...(selectedSkuRule?.materialPrefixes?.map((item) => item.materialOptionId) || [])]);
  const availableStoneOptions = materials.filter((item) => {
    if (item.scope !== (isGemstone ? "Đá quý" : "Trang sức") || !item.active || item.kind !== "STONE") return false;
    if (Array.isArray(item.appliedCategoryIds)) return Boolean(selectedCategoryId && item.appliedCategoryIds.includes(selectedCategoryId));
    return availableInventoryMaterialIds.has(item.id) || availableInventoryStoneNames.has(item.name) || skuRuleMaterialIds.has(item.id);
  });
  const availableJewelryMaterials = availableStoneOptions;
  const categories = isGemstone ? gemstoneTypeOptions : availableCategoryRecords;
  const availableInventoryProducts = categoryInventoryProducts.filter((item) => {
    const hasStock = item.priceVariants?.length
      ? item.priceVariants.some((variant) => variant.stock > 0)
      : item.stock > 0;
    return hasStock && item.status !== "Đang hoạt động" && (isGemstone ? !product.gemstoneTypeId || item.gemstoneTypeId === product.gemstoneTypeId : !product.materialOptionId || item.materialOptionId === product.materialOptionId || item.subcategory === product.subcategory);
  });
  const selectedInventoryProduct = inventoryProducts.find((item) => item.apiId === selectedInventoryId);
  const variantRows = useMemo(() => getVariantRows(product), [product]);
  const hasInventoryVariants = Boolean(selectedInventoryProduct?.priceVariants?.length);
  const hasVariantPrices = variantRows.length > 0;
  const sizeOnlyVariants = hasVariantPrices && variantRows.every((variant) => variant.quality === "Kích thước");
  const hasVariantSizes = variantRows.some((variant) => Boolean(variant.beadSize));
  const variantPrices = variantRows.map((item) => item.price).filter((price) => price > 0);
  const previewPrice = hasVariantPrices ? (variantPrices.length ? Math.min(...variantPrices) : 0) : product.price;
  const previewImage = imagePreview || product.image || "";

  const update = <K extends keyof AdminProduct>(key: K, value: AdminProduct[K]) => {
    setProduct((current) => ({ ...current, [key]: value }));
  };

  const clearInventorySelection = () => {
    setSelectedInventoryId("");
    setProduct((current) => ({
      ...current, id: `SP${String(Date.now()).slice(-6)}`, apiId: undefined, name: "", price: 0, originalPrice: 0,
      stock: 0, sold: 0, revenue: 0, status: "Bản nháp", isNew: true, description: "", fullDescription: "",
      image: "", gallery: [], coverVideoUrl: "", technicalImage: "", technicalVideo: "", weightGrams: 0, lengthCm: undefined, widthCm: undefined, heightCm: undefined, qualityGrades: [], beadSizes: [], priceVariants: [], seoTitle: "", seoDescription: "",
    }));
  };

  const selectInventoryProduct = (apiId: string) => {
    if (!apiId) { clearInventorySelection(); return; }
    const source = availableInventoryProducts.find((item) => item.apiId === apiId);
    if (!source) return;
    setSelectedInventoryId(apiId);
    setProduct({ ...source, image: source.gallery?.[0] ?? source.image ?? "", gallery: source.gallery ?? (source.image ? [source.image] : []) });
  };

  const changeProductType = (value: "Trang sức" | "Đá quý") => {
    setSelectedInventoryId("");
    setProduct((current) => ({
      ...current,
      id: `SP${String(Date.now()).slice(-6)}`,
      apiId: undefined,
      name: "",
      productType: value,
      category: "",
      categoryId: undefined,
      materialOptionId: undefined,
      gemstoneTypeId: undefined,
      categoryPricingMode: value === "Đá quý" ? "QUALITY" : "FIXED",
      subcategory: "",
      qualityGrades: value === "Đá quý" ? ["A", "AA", "AAA"] : [],
      beadSizes: [],
      priceVariants: [],
      price: 0,
      stock: 0,
    }));
  };

  const changeCategory = (categoryId: string) => {
    setSelectedInventoryId("");
    const record = availableCategoryRecords.find((item) => item.id === categoryId) ?? categories.find((item) => item.id === categoryId);
    const mode = record?.pricingMode ?? (product.productType === "Đá quý" ? "QUALITY" : "FIXED");
    const gemstoneType = isGemstone ? record : undefined;
    setProduct((current) => ({
      ...current,
      id: `SP${String(Date.now()).slice(-6)}`,
      apiId: undefined,
      name: "",
      category: record?.name ?? "",
      categoryId: record?.id,
      materialOptionId: undefined,
      gemstoneTypeId: gemstoneType?.id ?? (isGemstone ? current.gemstoneTypeId : undefined),
      subcategory: "",
      categoryPricingMode: mode,
      qualityGrades: qualityPricing(mode) ? (current.qualityGrades?.length ? current.qualityGrades : ["A", "AA", "AAA"]) : [],
      beadSizes: mode === "QUALITY_AND_BEAD_SIZE" ? (current.beadSizes?.length ? current.beadSizes : ["6mm", "8mm", "10mm"]) : [],
      priceVariants: [],
    }));
  };

  const updateVariant = (variant: ProductPriceVariant, patch: Partial<ProductPriceVariant>) => {
    const keyOf = (item: ProductPriceVariant) => `${item.quality}::${item.beadSize ?? ""}`;
    update("priceVariants", variantRows.map((item) => (variant.id && item.id === variant.id) || (variant.sku && item.sku === variant.sku) || keyOf(item) === keyOf(variant) ? { ...item, ...patch } : item));
  };

  const handleVariantImages = async (variant: ProductPriceVariant, fileList?: FileList | File[]) => {
    if (!fileList?.length) return;
    const existing = variant.imageUrls || [];
    const mediaCount = existing.length + (variant.videoUrl ? 1 : 0);
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_VARIANT_MEDIA_ITEMS - mediaCount));
    if (!files.length) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; }
    const key = variant.sku || `${variant.quality}-${variant.beadSize || ""}`;
    setUploadingVariantMedia((current) => ({ ...current, [key]: true }));
    try {
      const added: string[] = [];
      for (const file of files) added.push(await uploadProductImage(file, `variant-${product.id}-${key}-${existing.length + added.length + 1}.webp`, `${product.name} · ${variant.quality}`));
      updateVariant(variant, { imageUrls: [...existing, ...added].slice(0, 8) });
      onNotify(`Đã tải ${added.length} ảnh lên cho SKU ${variant.sku || "biến thể"}. Lưu sản phẩm để hoàn tất.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không xử lý được ảnh biến thể."); }
    finally { setUploadingVariantMedia((current) => ({ ...current, [key]: false })); }
  };

  const handleVariantVideo = async (variant: ProductPriceVariant, file?: File) => {
    if (!file) return;
    if (!variant.videoUrl && (variant.imageUrls?.length || 0) >= MAX_VARIANT_MEDIA_ITEMS) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "webm" && extension !== "mp4") { onNotify("Chỉ nhận video MP4 hoặc WebM."); return; }
    const key = variant.sku || `${variant.quality}-${variant.beadSize || ""}`;
    setUploadingVariantMedia((current) => ({ ...current, [key]: true }));
    try {
      const url = await uploadProductVideo(file, `variant-${product.id}-${key}.${extension}`, `${product.name} · ${variant.quality}`);
      updateVariant(variant, { videoUrl: url });
      onNotify(`Đã tải video cho SKU ${variant.sku || "biến thể"}.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không tải được video biến thể."); }
    finally { setUploadingVariantMedia((current) => ({ ...current, [key]: false })); }
  };

  const handleImages = async (fileList?: FileList | File[]) => {
    if (!fileList?.length) return;
    const existing = product.gallery ?? (product.image ? [product.image] : []);
    const capacity = MAX_PRODUCT_IMAGES - existing.length;
    if (capacity <= 0) {
      onNotify(`Sản phẩm đã đủ ${MAX_PRODUCT_IMAGES} ảnh.`);
      return;
    }
    const files = Array.from(fileList).slice(0, capacity);
    setUploadingImages(true);
    const added: string[] = [];
    let failure = "";
    try {
      for (const file of files) {
        try { added.push(await uploadProductImage(file, `product-${product.id}-${existing.length + added.length + 1}.webp`, product.name)); }
        catch (error) { failure = error instanceof Error ? error.message : "Không thể xử lý ảnh."; }
      }
      if (added.length) {
        const next = [...existing, ...added].slice(0, MAX_PRODUCT_IMAGES);
        setProduct((current) => ({ ...current, gallery: next, image: next[0] ?? "" }));
        setImagePreview(next[0] ?? "");
        onNotify(`Đã tải ${added.length} ảnh lên. Ảnh đầu tiên là ảnh bìa; lưu sản phẩm để hoàn tất.`);
      }
      if (files.length < fileList.length) onNotify(`Mỗi sản phẩm tối đa ${MAX_PRODUCT_IMAGES} ảnh; các ảnh vượt giới hạn chưa được thêm.`);
      else if (failure) onNotify(failure);
    } finally {
      setUploadingImages(false);
    }
  };

  const handleCoverVideo = async (file?: File) => {
    if (!file) return;
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

  const removeImage = (index: number) => {
    const next = (product.gallery ?? []).filter((_, imageIndex) => imageIndex !== index);
    update("gallery", next);
    update("image", next[0] ?? "");
    setImagePreview(next[0] ?? "");
  };

  const handleTechnicalImage = async (file: File) => {
    setUploadingTechnicalImage(true);
    try {
      update("technicalImage", await uploadProductImage(file, `product-${product.id}-technical.webp`, `${product.name} · ảnh kỹ thuật`));
      update("technicalVideo", "");
      onNotify("Đã tải ảnh kỹ thuật lên. Lưu sản phẩm để ghi vào database.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể xử lý ảnh kỹ thuật.");
    } finally {
      setUploadingTechnicalImage(false);
    }
  };
  const handleTechnicalVideo = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "mp4" && extension !== "webm") { onNotify("Chỉ nhận video MP4 hoặc WebM."); return; }
    setUploadingTechnicalVideo(true);
    try {
      update("technicalVideo", await uploadProductVideo(file, `product-${product.id}-technical.${extension}`, `${product.name} · video kỹ thuật`));
      update("technicalImage", "");
      onNotify("Đã tải video kỹ thuật lên. Lưu sản phẩm để hoàn tất.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể tải video kỹ thuật."); }
    finally { setUploadingTechnicalVideo(false); }
  };

  const save = async (publish: boolean) => {
    if (saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)) return;
    if (!selectedInventoryProduct) {
      onNotify("Chọn một SKU đã có trong kho trước khi lưu bài đăng. Muốn tạo SKU mới, hãy dùng mục Nhập hàng.");
      setActiveTab("basic");
      return;
    }
    if (publish && (!selectedInventoryProduct || selectedInventoryProduct.stock <= 0 || selectedInventoryProduct.status === "Đang hoạt động")) {
      onNotify("Chọn một mã SKU đang còn hàng trong kho và chưa đăng bán để tiếp tục.");
      setActiveTab("basic");
      return;
    }
    if (!product.name.trim() || !product.category) {
      onNotify("Nhập tên sản phẩm và chọn danh mục cấp 2 trước khi lưu.");
      setActiveTab("basic");
      return;
    }
    const selectedGemstoneType = categoryRecords.find((item) => item.id === product.gemstoneTypeId);
    if (isGemstone && (!selectedGemstoneType || selectedGemstoneType.kind !== "Đá quý" || selectedGemstoneType.level !== 2)) {
      onNotify("Chọn đúng loại đá cấp 2 cho sản phẩm đá quý.");
      setActiveTab("basic");
      return;
    }
    let saved: AdminProduct = { ...product, image: product.gallery?.[0] ?? product.image ?? "", status: publish ? "Đang hoạt động" : "Bản nháp" };
    if (hasInventoryVariants) {
      saved.priceVariants = selectedInventoryProduct!.priceVariants!.map((profileVariant) => {
        const editedVariant = variantRows.find((item) => item.sku === profileVariant.sku);
        return { ...profileVariant, imageUrls: editedVariant?.imageUrls ?? profileVariant.imageUrls, videoUrl: editedVariant?.videoUrl ?? profileVariant.videoUrl };
      });
    }
    saved.price = selectedInventoryProduct!.price;
    saved.originalPrice = selectedInventoryProduct!.originalPrice;
    if (publish && (hasInventoryVariants ? saved.priceVariants!.some((item) => item.price <= 0) : saved.price <= 0)) {
      onNotify("SKU chưa có giá trong Hồ sơ sản phẩm. Hãy cập nhật giá theo SKU trước khi đăng.");
      setActiveTab(hasInventoryVariants ? "variants" : "basic");
      return;
    }
    setSaving(true);
    try {
      await onSave(saved, publish);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Không thể lưu sản phẩm vào database.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="product-create-page">
    <div className="product-create-heading">
      <div className="product-create-heading-copy">
        <button className="product-back-button" onClick={onBack} aria-label="Quay lại danh sách sản phẩm"><span>←</span></button>
        <div><h1>Tạo bài đăng</h1><p>Chọn một SKU đã có trong kho để đưa lên website GEME.</p></div>
      </div>
      <div className="product-create-actions">
        <button className="button button-quiet" disabled={saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)} onClick={() => void save(false)}>{saving ? "Đang lưu…" : "Lưu nháp"}</button>
        <button className="button button-primary" disabled={saving || uploadingImages || uploadingCoverVideo || uploadingTechnicalImage || uploadingTechnicalVideo || Object.values(uploadingVariantMedia).some(Boolean)} onClick={() => void save(true)}><span>↗</span>{saving ? "Đang lưu…" : uploadingImages || uploadingCoverVideo || uploadingTechnicalVideo ? "Đang tải media…" : "Lưu và đăng"}</button>
      </div>
    </div>

    <div className="product-create-layout">
      <main className="product-create-main">
        <nav className="product-create-tabs" aria-label="Các phần của biểu mẫu" role="tablist">
          {tabs.map((tab) => <button key={tab.key} className={activeTab === tab.key ? "active" : ""} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
        </nav>

        {activeTab === "basic" && <div className="product-create-columns">
          <div className="product-create-left-column">
            <section className="create-card">
              <h2>Thông tin cơ bản</h2>
              <label className="create-field"><span>Tên sản phẩm <b>*</b></span><input value={product.name} onChange={(event) => update("name", event.target.value)} placeholder="Nhập tên sản phẩm..."/></label>
              <div className="create-field-row">
                <label className="create-field"><span>Nhóm sản phẩm <b>*</b></span><select disabled={Boolean(selectedInventoryId)} value={product.productType} onChange={(event) => changeProductType(event.target.value as "Trang sức" | "Đá quý")}><option>Trang sức</option><option>Đá quý</option></select></label>
                {isGemstone ? <label className="create-field"><span>Loại đá / danh mục cấp 2 <b>*</b></span><select disabled={Boolean(selectedInventoryId)} value={product.gemstoneTypeId ?? product.categoryId ?? ""} onChange={(event) => changeCategory(event.target.value)}><option value="">Chọn loại đá</option>{gemstoneTypeOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select><small>Dạng cắt và size được quản lý theo từng SKU biến thể trong kho.</small></label> : <>
                  <label className="create-field"><span>Danh mục sản phẩm <b>*</b></span><select disabled={Boolean(selectedInventoryId)} value={product.categoryId ?? selectedProductCategory?.id ?? ""} onChange={(event) => changeCategory(event.target.value)}><option value="">{categories.length ? "Chọn danh mục sản phẩm" : "Chưa có danh mục"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category as AdminCategory)}</option>)}</select></label>
                  <label className="create-field"><span>Đá gắn có trong kho</span><select disabled={Boolean(selectedInventoryId)} value={product.materialOptionId ?? ""} onChange={(event) => { const option = materials.find((item) => item.id === event.target.value); update("materialOptionId", option?.id); update("subcategory", option?.name ?? ""); }}><option value="">{availableJewelryMaterials.length ? "Tất cả loại đá" : "Chưa có loại đá trong kho"}</option>{availableJewelryMaterials.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
                </>}
              </div>
              <div className="create-inventory-picker"><div><label className="create-field"><span>Chọn mã SKU còn hàng để đăng bán</span><select value={selectedInventoryId} disabled={inventoryLoading || !availableInventoryProducts.length} onChange={(event) => selectInventoryProduct(event.target.value)}><option value="">{inventoryLoading ? "Đang tải tồn kho…" : availableInventoryProducts.length ? "Chọn mã sản phẩm trong kho" : "Không có mã phù hợp đang còn hàng"}</option>{availableInventoryProducts.map((item) => <option key={item.apiId} value={item.apiId}>{item.id} · {item.name} — còn {item.stock}</option>)}</select></label><small>{selectedInventoryProduct ? `Mã ${selectedInventoryProduct.id} còn ${selectedInventoryProduct.stock} sản phẩm trong kho. Số lượng trên website sẽ đồng bộ từ tồn kho.` : "Chỉ hiển thị mã chưa đăng bán và còn hàng. Chọn mã này sẽ dùng chính bản ghi tồn kho, không tạo SKU trùng."}</small>{inventoryError && <small className="create-inventory-error">{inventoryError}</small>}</div><button type="button" className="button button-quiet" onClick={() => void reloadInventory()} disabled={inventoryLoading}>{inventoryLoading ? "Đang tải…" : "↻ Làm mới kho"}</button></div>
              <div className="create-field-row create-brand-row">
                <label className="create-field"><span>Thương hiệu</span><select defaultValue=""><option value="">GEME</option></select></label>
              </div>
              <label className="create-field"><span>Mô tả ngắn</span><textarea rows={3} maxLength={200} value={product.description ?? ""} onChange={(event) => update("description", event.target.value)} placeholder="Nhập mô tả ngắn hiển thị ở trang danh sách..."/><small className="create-counter">{(product.description ?? "").length}/200</small></label>
              <label className="create-field"><span>Mô tả chi tiết</span><div className="create-rich-tools"><button type="button"><b>B</b></button><button type="button"><i>I</i></button><button type="button"><u>U</u></button><button type="button">☷</button><button type="button">☰</button><button type="button">↗</button><button type="button">▧</button></div><textarea className="create-rich-text" rows={5} maxLength={2000} value={product.fullDescription ?? ""} onChange={(event) => update("fullDescription", event.target.value)} placeholder="Nhập mô tả chi tiết sản phẩm..."/><small className="create-counter">{(product.fullDescription ?? "").length}/2000</small></label>
            </section>

            <section className="create-card create-images-card">
              <div className="create-card-title"><h2>Hình ảnh sản phẩm</h2><span>Tối thiểu 1 ảnh, tối đa 10 ảnh</span></div>
              <div className="create-cover-video-field"><div><strong>Video bìa (không bắt buộc)</strong><small>MP4/WebM tối đa 8 MB. Nếu có video, web sẽ ưu tiên hiển thị video thay ảnh bìa.</small></div>{product.coverVideoUrl && <video src={product.coverVideoUrl} muted autoPlay loop playsInline preload="metadata" aria-label={`${product.name} · video bìa`}/>}<label><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={uploadingCoverVideo} onChange={(event) => { void handleCoverVideo(event.target.files?.[0]); event.currentTarget.value = ""; }}/><span>{uploadingCoverVideo ? "Đang tải video…" : product.coverVideoUrl ? "Đổi video bìa" : "Chọn video bìa"}</span></label>{product.coverVideoUrl && <button type="button" onClick={() => update("coverVideoUrl", "")}>Gỡ video</button>}<label className="create-cover-video-url"><span>Hoặc dán đường dẫn video</span><input type="url" value={product.coverVideoUrl || ""} onChange={(event) => update("coverVideoUrl", event.target.value)} placeholder="https://… hoặc /media/…"/></label></div>
              <div className="create-upload-row">
                <label className="create-upload-tile"><input type="file" accept="image/*" multiple disabled={uploadingImages || (product.gallery?.length ?? 0) >= MAX_PRODUCT_IMAGES} onChange={(event) => { void handleImages(event.target.files ?? undefined); event.currentTarget.value = ""; }}/><span className="upload-cloud">⇧</span><strong>Thêm nhiều ảnh</strong><small>Chọn cùng lúc nhiều tệp</small><small>(Tối đa {MAX_PRODUCT_IMAGES} ảnh)</small></label>
                {(product.gallery ?? []).map((src, index) => <div className="create-image-thumb" key={`${src}-${index}`}><img src={src} alt={`Ảnh sản phẩm ${index + 1}`}/><small>{index === 0 ? "Ảnh bìa" : `Ảnh ${index + 1}`}</small><button type="button" aria-label={`Xóa ảnh ${index + 1}`} onClick={() => removeImage(index)}>×</button></div>)}
                <label className="create-upload-more"><input type="file" accept="image/*" multiple disabled={uploadingImages || (product.gallery?.length ?? 0) >= MAX_PRODUCT_IMAGES} onChange={(event) => { void handleImages(event.target.files ?? undefined); event.currentTarget.value = ""; }}/><strong>＋</strong><span>{uploadingImages ? "Đang tải ảnh" : "Thêm ảnh"}</span></label>
              </div>
              <TechnicalImagePicker image={product.technicalImage} video={product.technicalVideo} uploading={uploadingTechnicalImage} uploadingVideo={uploadingTechnicalVideo} onSelect={(file) => void handleTechnicalImage(file)} onSelectVideo={(file) => void handleTechnicalVideo(file)} onRemove={() => update("technicalImage", "")} onRemoveVideo={() => update("technicalVideo", "")}/>
            </section>
          </div>

          <div className="product-create-side-column">
            <section className="create-card">
              <h2>Giá bán</h2>
              <div className="create-price-note"><strong>Giá lấy từ Hồ sơ sản phẩm theo SKU</strong><span>{selectedInventoryProduct ? `SKU ${selectedInventoryProduct.id} · ${hasVariantPrices ? `${variantRows.length} biến thể` : money(selectedInventoryProduct.price)}` : "Chọn SKU trong kho để xem giá đã khai báo trong hồ sơ sản phẩm."}</span>{hasVariantPrices && <button type="button" onClick={() => setActiveTab("variants")}>Xem giá từng SKU con →</button>}</div>
              {selectedInventoryProduct && !hasVariantPrices && (selectedInventoryProduct.originalPrice ?? 0) > selectedInventoryProduct.price && <small className="create-price-profile-source">Giá gốc: {money(selectedInventoryProduct.originalPrice ?? 0)}</small>}
              <div className="create-price-profile-source">Muốn đổi giá, hãy cập nhật SKU trong Hồ sơ sản phẩm. Giá trên bài đăng luôn theo hồ sơ này.</div>
              <small className="inventory-management-hint">Số lượng tồn kho được quản lý riêng trong mục Quản lý tồn kho.</small>
              <div className="create-switch-row"><div><strong>Trạng thái hiển thị</strong><small>Cho phép khách xem sản phẩm</small></div><label className="create-switch"><input type="checkbox" checked={product.status === "Đang hoạt động"} onChange={(event) => update("status", event.target.checked ? "Đang hoạt động" : "Tạm ẩn")}/><span/><small>{product.status === "Đang hoạt động" ? "Hiển thị" : "Đang ẩn"}</small></label></div>
              <div className="create-switch-row create-new-switch"><div><strong>Sản phẩm mới</strong><small>Gắn nhãn “Mới” độc lập với trạng thái</small></div><label className="create-switch"><input type="checkbox" checked={Boolean(product.isNew)} onChange={(event) => update("isNew", event.target.checked)}/><span/><small>{product.isNew ? "Có" : "Không"}</small></label></div>
            </section>

            <section className="create-card">
              <h2>Vận chuyển</h2>
              <div className="create-field-row"><label className="create-field"><span>Khối lượng (gram)</span><div className="create-unit-field"><input aria-label="Khối lượng (gram)" type="number" min="0" step="0.01" value={product.weightGrams ?? ""} onChange={(event) => update("weightGrams", event.target.value === "" ? undefined : Number(event.target.value))}/><i>g</i></div></label><div className="create-field"><span>Kích thước (dài × rộng × cao, cm)</span><div className="create-dimensions"><input aria-label="Dài (cm)" type="number" min="0" step="0.01" placeholder="D" value={product.lengthCm ?? ""} onChange={(event) => update("lengthCm", event.target.value === "" ? undefined : Number(event.target.value))}/><b>×</b><input aria-label="Rộng (cm)" type="number" min="0" step="0.01" placeholder="R" value={product.widthCm ?? ""} onChange={(event) => update("widthCm", event.target.value === "" ? undefined : Number(event.target.value))}/><b>×</b><input aria-label="Cao (cm)" type="number" min="0" step="0.01" placeholder="C" value={product.heightCm ?? ""} onChange={(event) => update("heightCm", event.target.value === "" ? undefined : Number(event.target.value))}/></div></div></div>
            </section>

            <section className="create-card">
              <h2>Thông tin khác</h2>
              <label className="create-field"><span>Mã sản phẩm (SKU)</span><input value={product.id} readOnly/></label>
              <label className="create-field"><span>Xuất xứ</span><input placeholder="Nhập xuất xứ..."/></label>
              <label className="create-field"><span>Chất liệu</span><input placeholder="Nhập chất liệu..."/></label>
              <label className="create-field"><span>Tags (từ khóa)</span><input placeholder="Nhập tag, cách nhau bằng dấu phẩy"/></label>
            </section>
          </div>
        </div>}

        {activeTab === "images" && <section className="create-card create-tab-card"><div className="create-card-title"><div><h2>Hình ảnh &amp; Video</h2><p>Video bìa tự chạy khi khách nhìn thấy sản phẩm, tắt tiếng và lặp liên tục.</p></div><span>{product.gallery?.length ?? 0}/{MAX_PRODUCT_IMAGES} ảnh</span></div><div className="create-cover-video-field"><div><strong>Video bìa (không bắt buộc)</strong><small>MP4/WebM tối đa 8 MB. Khi có video, website ưu tiên phát video thay ảnh bìa.</small></div>{product.coverVideoUrl && <video src={product.coverVideoUrl} muted autoPlay loop playsInline preload="metadata" aria-label={`${product.name} · video bìa`}/>}<label><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={uploadingCoverVideo} onChange={(event) => { void handleCoverVideo(event.target.files?.[0]); event.currentTarget.value = ""; }}/><span>{uploadingCoverVideo ? "Đang tải video…" : product.coverVideoUrl ? "Đổi video bìa" : "Chọn video bìa"}</span></label>{product.coverVideoUrl && <button type="button" onClick={() => update("coverVideoUrl", "")}>Gỡ video</button>}<label className="create-cover-video-url"><span>Hoặc dán đường dẫn video</span><input type="url" value={product.coverVideoUrl || ""} onChange={(event) => update("coverVideoUrl", event.target.value)} placeholder="https://… hoặc /media/…"/></label></div><label className="create-upload-wide"><input type="file" accept="image/*" multiple disabled={uploadingImages || (product.gallery?.length ?? 0) >= MAX_PRODUCT_IMAGES} onChange={(event) => { void handleImages(event.target.files ?? undefined); event.currentTarget.value = ""; }}/><span className="upload-cloud">⇧</span><strong>{uploadingImages ? "Đang tải ảnh lên…" : "Chọn một hoặc nhiều ảnh"}</strong><small>Ảnh được tối ưu và tải lên ngay khi chọn.</small><button type="button" className="button button-quiet">Chọn hình ảnh</button></label><div className="create-image-gallery">{(product.gallery ?? []).map((src, index) => <div className="create-image-thumb large" key={`${src}-${index}`}><img src={src} alt={`Ảnh sản phẩm ${index + 1}`}/><span>{index === 0 && !product.coverVideoUrl ? "Ảnh bìa dự phòng" : `Ảnh ${index + 1}`}</span><button type="button" aria-label={`Xóa ảnh ${index + 1}`} onClick={() => removeImage(index)}>×</button></div>)}</div><TechnicalImagePicker image={product.technicalImage} video={product.technicalVideo} uploading={uploadingTechnicalImage} uploadingVideo={uploadingTechnicalVideo} onSelect={(file) => void handleTechnicalImage(file)} onSelectVideo={(file) => void handleTechnicalVideo(file)} onRemove={() => update("technicalImage", "")} onRemoveVideo={() => update("technicalVideo", "")}/><div className="create-image-info"><strong>Mẹo chụp ảnh sản phẩm</strong><span>Dùng ánh sáng tự nhiên, nền đơn giản và chụp sản phẩm từ nhiều góc để khách dễ quan sát chất liệu.</span></div></section>}

        {activeTab === "variants" && <section className="create-card create-tab-card">
          <div className="create-card-title"><div><h2>Thông số &amp; Biến thể</h2><p>Biến thể, tồn và giá bán lấy theo SKU từ Hồ sơ sản phẩm; tại đây chỉ cập nhật ảnh và video.</p></div></div>
          {variantRows.length > 0 ? <div className="create-variant-table-wrap"><table className="create-variant-table"><thead><tr><th>{sizeOnlyVariants ? "Kích thước vòng" : "Chất lượng"}</th>{hasVariantSizes && !sizeOnlyVariants && <th>Kích thước hạt</th>}<th>SKU con</th><th>Tồn kho</th><th>Giá theo hồ sơ SKU</th><th>Ảnh / video biến thể</th></tr></thead><tbody>{variantRows.map((variant) => { const uploadKey = variant.sku || `${variant.quality}-${variant.beadSize || ""}`; const mediaCount = (variant.imageUrls?.length || 0) + (variant.videoUrl ? 1 : 0); return <tr key={`${variant.sku || variant.quality}-${variant.beadSize ?? "standard"}`}><td><strong>{sizeOnlyVariants ? (variant.beadSize || variant.quality) : variant.quality}</strong></td>{hasVariantSizes && !sizeOnlyVariants && <td>{variant.beadSize || "—"}</td>}<td><code>{variant.sku || "—"}</code></td><td>{Number(variant.stock) || 0}</td><td>{money(variant.price)}</td><td><div className="create-variant-media"><div className="create-variant-media-images">{(variant.imageUrls || []).map((url, index) => <span key={`${url.slice(0, 40)}-${index}`}><img src={url} alt={`Ảnh ${variant.sku} ${index + 1}`}/><button type="button" aria-label={`Xóa ảnh biến thể ${index + 1}`} onClick={() => updateVariant(variant, { imageUrls: (variant.imageUrls || []).filter((_, imageIndex) => imageIndex !== index) })}>×</button></span>)}</div><div className="create-variant-media-actions"><label className="create-variant-media-picker"><input type="file" accept="image/*" multiple disabled={Boolean(uploadingVariantMedia[uploadKey]) || mediaCount >= MAX_VARIANT_MEDIA_ITEMS} onChange={(event) => { void handleVariantImages(variant, event.target.files ?? undefined); event.currentTarget.value = ""; }}/><span>{uploadingVariantMedia[uploadKey] ? "Đang xử lý ảnh…" : "＋ Thêm ảnh"}</span></label><label className="create-variant-media-picker"><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={Boolean(uploadingVariantMedia[uploadKey]) || (!variant.videoUrl && mediaCount >= MAX_VARIANT_MEDIA_ITEMS)} onChange={(event) => { void handleVariantVideo(variant, event.target.files?.[0]); event.currentTarget.value = ""; }}/><span>{uploadingVariantMedia[uploadKey] ? "Đang tải video…" : variant.videoUrl ? "＋ Đổi video" : "＋ Tải video"}</span></label></div><small className="create-variant-media-limit">{mediaCount}/{MAX_VARIANT_MEDIA_ITEMS} tệp · tính cả video</small><label className="create-variant-media-url"><span>Đường dẫn video</span><input type="url" value={variant.videoUrl || ""} onChange={(event) => { const value = event.target.value || null; if (value && !variant.videoUrl && (variant.imageUrls?.length || 0) >= MAX_VARIANT_MEDIA_ITEMS) { onNotify(`Mỗi biến thể tối đa ${MAX_VARIANT_MEDIA_ITEMS} tệp, tính cả video.`); return; } updateVariant(variant, { videoUrl: value }); }} placeholder="https://… hoặc /media/…"/></label>{variant.videoUrl && <video className="create-variant-video-preview" src={variant.videoUrl} controls playsInline preload="metadata" aria-label={`Video ${variant.sku || variant.quality}`}/>}</div></td></tr>; })}</tbody></table><small className="create-inventory-variant-help">Biến thể, SKU và tồn chỉ lấy từ kho. Mỗi SKU con lưu tối đa 5 ảnh/video cộng lại; giá luôn lấy từ Hồ sơ sản phẩm theo SKU.</small></div> : <div className="create-empty-variants"><span>◇</span><strong>{usesQualityPricing ? "Chưa có biến thể trong kho" : "Sản phẩm dùng một giá chung"}</strong><p>{usesQualityPricing ? "Hãy tạo chất lượng, size và số lượng biến thể trong phiếu nhập kho trước. Giá sẽ lấy từ Hồ sơ sản phẩm." : "Giá bán lấy từ hồ sơ sản phẩm; tồn kho được quản lý riêng trong Quản lý tồn kho."}</p></div>}
        </section>}

        {activeTab === "seo" && <section className="create-card create-tab-card"><div className="create-card-title"><div><h2>Tối ưu tìm kiếm (SEO)</h2><p>Thông tin này giúp sản phẩm hiển thị rõ trên công cụ tìm kiếm.</p></div></div><label className="create-field"><span>Tiêu đề SEO</span><input maxLength={70} value={product.seoTitle ?? ""} onChange={(event) => update("seoTitle", event.target.value)} placeholder={product.name || "Tên sản phẩm | GEME"}/><small className="create-counter">{(product.seoTitle ?? "").length}/70</small></label><label className="create-field"><span>Mô tả SEO</span><textarea rows={4} maxLength={160} value={product.seoDescription ?? ""} onChange={(event) => update("seoDescription", event.target.value)} placeholder="Mô tả ngắn gọn về sản phẩm..."/><small className="create-counter">{(product.seoDescription ?? "").length}/160</small></label><div className="create-seo-preview"><small>geme.vn › san-pham › {product.name.toLocaleLowerCase("vi").trim().replaceAll(" ", "-") || "ten-san-pham"}</small><strong>{product.seoTitle || product.name || "Tên sản phẩm | GEME"}</strong><span>{product.seoDescription || product.description || "Mô tả sản phẩm hiển thị trong kết quả tìm kiếm."}</span></div></section>}

        {activeTab === "other" && <section className="create-card create-tab-card"><div className="create-card-title"><div><h2>Thiết lập khác</h2><p>Kiểm soát thời gian và nhãn hiển thị cho sản phẩm.</p></div></div><div className="create-setting-row"><div><strong>Đánh dấu sản phẩm mới</strong><small>Nhãn “Mới” độc lập với trạng thái hiển thị.</small></div><label className="create-switch"><input type="checkbox" checked={Boolean(product.isNew)} onChange={(event) => update("isNew", event.target.checked)}/><span/><small>{product.isNew ? "Đang bật" : "Đang tắt"}</small></label></div><div className="create-setting-row"><div><strong>Cho phép hiển thị trên website</strong><small>Tắt để ẩn sản phẩm khỏi cửa hàng.</small></div><label className="create-switch"><input type="checkbox" checked={product.status === "Đang hoạt động"} onChange={(event) => update("status", event.target.checked ? "Đang hoạt động" : "Tạm ẩn")}/><span/><small>{product.status === "Đang hoạt động" ? "Đang bật" : "Đang tắt"}</small></label></div><div className="create-field-row"><label className="create-field"><span>Ngày bắt đầu bán</span><input type="date"/></label><label className="create-field"><span>Ngày kết thúc bán</span><input type="date"/></label></div><div className="create-info-callout">Lịch bán tự động sẽ được đồng bộ khi kết nối backend.</div></section>}
      </main>

      <aside className="create-live-preview">
        <div className="create-preview-heading"><h2>Xem trước sản phẩm</h2><button onClick={() => onNotify("Trang sản phẩm sẽ xem được sau khi kết nối website GEME.")}>◉ <span>Xem trang sản phẩm</span></button></div>
        {product.coverVideoUrl ? <video className="create-preview-image" src={product.coverVideoUrl} muted autoPlay loop playsInline preload="metadata" aria-label={`${product.name} · video bìa`}/> : previewImage ? <img className="create-preview-image" src={previewImage} alt={product.name || "Ảnh xem trước sản phẩm"}/> : <div className="create-preview-image create-preview-placeholder">Ảnh sản phẩm sẽ hiển thị tại đây</div>}
        <h3>{product.name || "Tên sản phẩm"}</h3>
        <p>GEME　|　Mã: {product.id}</p>
        <div className="create-preview-price"><strong>{money(previewPrice)}</strong>{(product.originalPrice ?? 0) > previewPrice && <del>{money(product.originalPrice ?? 0)}</del>}{product.isNew && <span>Mới</span>}</div>
        <span className={`create-stock-pill ${product.status === "Đang hoạt động" ? "available" : "hidden"}`}>{product.status === "Đang hoạt động" ? "✓ Còn hàng" : "Sản phẩm đang ẩn"}</span>
        <div className="create-preview-rating"><span>★★★★★</span> (0 đánh giá)</div>
        <div className="create-preview-features"><strong>Thông tin nổi bật</strong><ul>{[product.subcategory, product.description].filter(Boolean).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}{!product.subcategory && !product.description && <li>Chưa có thông tin nổi bật.</li>}</ul></div>
        <button className="create-preview-cart" onClick={() => onNotify("Nút mua hàng chỉ minh họa giao diện xem trước.")}>♧　Thêm vào giỏ hàng</button><button className="create-preview-buy" onClick={() => onNotify("Nút mua hàng chỉ minh họa giao diện xem trước.")}>Mua ngay</button>
        <div className="create-preview-share">Chia sẻ sản phẩm　　f　◎　↗</div>
        {hasVariantPrices && <div className="create-preview-variant-hint">Giá theo phân loại: {variantRows.length} lựa chọn</div>}
      </aside>
    </div>
  </section>;
}
