"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { apiBaseUrl } from "../lib/api";
import { compressProductImage } from "./product-images";

type Banner = {
  id: string;
  name: string;
  position: string;
  imageUrl: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  season: string;
  startAt: string;
  endAt: string;
  href: string;
  status: "ACTIVE" | "SCHEDULED" | "HIDDEN";
  devices: string[];
};
type FooterLink = { label: string; href: string };
type FooterContent = {
  brandDescription: string;
  address: string;
  phone: string;
  email: string;
  openingHours: string;
  aboutLinks: FooterLink[];
  supportLinks: FooterLink[];
  socialLinks: FooterLink[];
  paymentMethods: string[];
  logoImageUrl: string;
  backgroundImageUrl: string;
  copyright: string;
};
type CatalogEditorialPromo = {
  id: "green-edit" | "geme-on-you" | "stone-to-jewelry";
  kind: "image" | "video";
  enabled: boolean;
  sortOrder: number;
  placement: "after-4" | "after-12" | "after-18";
  title: string;
  description: string;
  ctaLabel: string;
  imageUrl: string;
  posterUrl: string;
  videoUrl: string;
  altText: string;
  href: string;
  focusX: number;
  focusY: number;
};
type NewArrivalsMedia = {
  editorialImageUrl: string;
  editorialAltText: string;
  editorialCtaLabel: string;
  editorialHref: string;
  videoUrl: string;
  videoPosterUrl: string;
  videoAltText: string;
};
type SiteContent = { banners?: unknown; footerContent?: unknown; catalogEditorialPromos?: unknown; newArrivalsMedia?: unknown };
type CategoryBanner = { id: string; name: string; slug?: string; bannerUrl?: string | null };

const defaultNewArrivalsMedia: NewArrivalsMedia = {
  editorialImageUrl: "",
  editorialAltText: "",
  editorialCtaLabel: "Khám phá →",
  editorialHref: "/san-pham#san-pham",
  videoUrl: "",
  videoPosterUrl: "",
  videoAltText: "",
};

function normalizeNewArrivalsMedia(value: unknown): NewArrivalsMedia {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(defaultNewArrivalsMedia).map((key) => [
    key,
    typeof item[key] === "string" ? item[key] : defaultNewArrivalsMedia[key as keyof NewArrivalsMedia],
  ])) as NewArrivalsMedia;
}

const defaultCatalogEditorialPromos: CatalogEditorialPromo[] = [
  { id: "green-edit", kind: "image", enabled: true, sortOrder: 1, placement: "after-4", title: "THE GREEN EDIT", description: "Một sắc xanh. Nhiều cách thể hiện.", ctaLabel: "Khám phá →", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
  { id: "geme-on-you", kind: "video", enabled: true, sortOrder: 2, placement: "after-12", title: "GEME TRÊN BẠN", description: "Những chi tiết làm nên dấu ấn.", ctaLabel: "Xem câu chuyện →", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
  { id: "stone-to-jewelry", kind: "video", enabled: true, sortOrder: 3, placement: "after-18", title: "TỪ ĐÁ ĐẾN TRANG SỨC", description: "Vẻ đẹp qua từng chi tiết.", ctaLabel: "", imageUrl: "", posterUrl: "", videoUrl: "", altText: "", href: "", focusX: 50, focusY: 50 },
];

function normalizeCatalogEditorialPromos(value: unknown): CatalogEditorialPromo[] {
  const saved = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  return defaultCatalogEditorialPromos.map((defaults) => {
    const item = saved.find((candidate) => candidate.id === defaults.id);
    if (!item) return { ...defaults };
    const text = (field: keyof CatalogEditorialPromo) => typeof item[field] === "string" ? String(item[field]) : defaults[field] as string;
    const numeric = (field: "sortOrder" | "focusX" | "focusY") => Number.isFinite(Number(item[field])) ? Number(item[field]) : defaults[field];
    return {
      ...defaults,
      kind: (item.kind === "video" ? "video" : "image") as CatalogEditorialPromo["kind"],
      enabled: item.enabled !== false,
      sortOrder: numeric("sortOrder"),
      placement: item.placement === "after-4" || item.placement === "after-12" || item.placement === "after-18" ? item.placement : defaults.placement,
      title: text("title"), description: text("description"), ctaLabel: text("ctaLabel"),
      imageUrl: text("imageUrl"), posterUrl: text("posterUrl"), videoUrl: text("videoUrl"), altText: text("altText"), href: text("href"),
      focusX: Math.max(0, Math.min(100, numeric("focusX"))), focusY: Math.max(0, Math.min(100, numeric("focusY"))),
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

function canonicalBannerPosition(position: unknown) {
  const normalized = String(position || "Trang chủ - Hero").normalize("NFC").trim().replace(/[·–—]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "ô trang sức": "Trang chủ - Ô Trang sức",
    "ô mặt đá quý": "Trang chủ - Ô Mặt đá quý",
    "ô new arrivals": "Trang chủ - Ô New Arrivals",
    "mặt đá quý": "Mặt đá quý - Banner",
    blog: "Blog - Banner",
    "new arrivals": "New Arrivals - Hero",
    "liên hệ - cta": "Liên hệ - Banner tư vấn",
    "về geme - cuối trang": "Về GEME - Banner cuối",
    "new arrivals - cuối trang": "New Arrivals - Banner cuối",
  };
  return aliases[normalized.toLocaleLowerCase("vi")] || normalized;
}

const carouselCopy = [
  { eyebrow: "COLLECTION / GEME", title: "Vẻ đẹp tự nhiên, dấu ấn riêng", description: "Mỗi thiết kế lưu giữ nét tinh tế của bạc và vẻ đẹp độc đáo từ đá quý thiên nhiên.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { eyebrow: "COLLECTION / GEME", title: "Tất cả sản phẩm", description: "Trang sức bạc tinh tế kết hợp đá quý thiên nhiên, lưu giữ vẻ đẹp riêng trong từng khoảnh khắc.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { eyebrow: "GEME / NATURAL GEMSTONES", title: "Sắc xanh đầy cuốn hút", description: "Những viên đá quý được chọn lọc để tôn lên vẻ đẹp riêng trong từng thiết kế.", ctaLabel: "Xem bộ sưu tập", href: "#san-pham" },
  { eyebrow: "GEME / FINE JEWELRY", title: "Sắc màu của riêng bạn", description: "Chọn sắc đá yêu thích và tìm thiết kế đồng hành cùng phong cách của bạn.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { eyebrow: "COLLECTION / GEME", title: "Tinh tế trong từng chi tiết", description: "Dấu ấn thủ công và vẻ đẹp thiên nhiên gặp nhau trong những món trang sức GEME.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
];

const retiredHomePositions = new Set([
  "Trang chủ - Dải đá quý",
  "Trang chủ - Ô New Arrivals",
  "Trang chủ - Viên đá",
]);

const currentHomePositions = [
  "Trang chủ - Hero",
  "Trang chủ - Ô Trang sức",
  "Trang chủ - Ô Mặt đá quý",
  "Trang chủ - THE GREEN EDIT - Vân đá",
  "Trang chủ - THE GREEN EDIT - Vòng tay",
  "Trang chủ - Câu chuyện",
  "Trang chủ - GEME trên bạn - Dây chuyền",
  "Trang chủ - GEME trên bạn - Vòng tay",
  "Trang chủ - GEME trên bạn - Nhẫn",
  "Trang chủ - GEME trên bạn - Khuyên tai",
];

const fallbackBanners: Banner[] = [
  ["Trang chủ · Hero", "Trang chủ - Hero", "/images/home/geme/01-hero-opal.webp"],
  ["Trang chủ - Ô Trang sức", "Trang sức bạc", "/images/home/geme/02-category-silver.webp"],
  ["Trang chủ - Ô Mặt đá quý", "Đá quý tự nhiên", "/images/home/geme/03-category-gems.webp"],
  ["Trang chủ - THE GREEN EDIT - Vân đá", "THE GREEN EDIT · Vân đá", "/images/home/geme/04-green-edit-texture.webp"],
  ["Trang chủ - THE GREEN EDIT - Vòng tay", "THE GREEN EDIT · Vòng tay", "/images/home/geme/05-green-edit-wrist.webp"],
  ["Trang chủ · Câu chuyện", "Trang chủ - Câu chuyện", "/images/home/geme/06-brand-craft.webp"],
  ["Trang chủ - GEME trên bạn - Dây chuyền", "GEME trên bạn · Dây chuyền", "/images/home/geme/07-lifestyle-necklace.webp"],
  ["Trang chủ - GEME trên bạn - Vòng tay", "GEME trên bạn · Vòng tay", "/images/home/geme/08-lifestyle-bangle.webp"],
  ["Trang chủ - GEME trên bạn - Nhẫn", "GEME trên bạn · Nhẫn", "/images/home/geme/09-lifestyle-ring.webp"],
  ["Trang chủ - GEME trên bạn - Khuyên tai", "GEME trên bạn · Khuyên tai", "/images/home/geme/10-lifestyle-earring.webp"],
  ["Trang sức · Carousel 1", "Trang sức - Banner 1", "/assets/collection-jewelry-banner-1.png"],
  ["Trang sức · Carousel 2", "Trang sức - Banner 2", "/assets/collection-jewelry-banner-2.png"],
  ["Trang sức · Carousel 3", "Trang sức - Banner 3", "/assets/collection-jewelry-banner-3.png"],
  ["Trang sức · Carousel 4", "Trang sức - Banner 4", "/assets/collection-jewelry-banner-4.png"],
  ["Trang sức · Carousel 5", "Trang sức - Banner 5", "/assets/collection-jewelry-banner-5.png"],
  ["Mặt đá quý", "Mặt đá quý - Banner", "/assets/gemstone-banner-crisp.jpg"],
  ["Blog", "Blog - Banner", "/assets/blog-banner.png"],
  ["Về GEME · Hero", "Về GEME - Hero", "/assets/about-geme-hero.png"],
  ["Về GEME · Câu chuyện", "Về GEME - Câu chuyện", "/assets/about-geme-intro.png"],
  ["Về GEME · Sứ mệnh", "Về GEME - Sứ mệnh", "/assets/about-geme-opal.png"],
  ["Về GEME · Cuối trang", "Về GEME - Banner cuối", "/assets/about-geme-footer.png"],
  ["Liên hệ · Hero", "Liên hệ - Hero", "/assets/collection-jewelry-banner-4.png"],
  ["Liên hệ · CTA", "Liên hệ - Banner tư vấn", "/assets/collection-jewelry-banner-1.png"],
  ["New Arrivals", "New Arrivals - Hero", "/assets/collection-jewelry-banner-1.png"],
  ["New Arrivals · cuối trang", "New Arrivals - Banner cuối", "/assets/blog-card-gemstones.png"],
].map(([position, name, imageUrl], index) => {
  const canonicalPosition = canonicalBannerPosition(position);
  const carouselIndex = Number(canonicalPosition.match(/^Trang sức - Carousel ([1-5])$/)?.[1] || 0) - 1;
  return { id: `seed-${index + 1}`, name, position: canonicalPosition, imageUrl, season: "", startAt: "", endAt: "", href: "", status: "ACTIVE", devices: ["desktop", "tablet", "mobile"], ...(carouselIndex >= 0 ? carouselCopy[carouselIndex] : {}) } as Banner;
});

const defaultFooter: FooterContent = {
  brandDescription: "Natural Gemstones · Fine Jewelry · For You",
  address: "",
  phone: "",
  email: "support@geme.vn",
  openingHours: "08:00 - 22:00 (Tất cả các ngày)",
  aboutLinks: [{ label: "Câu chuyện thương hiệu", href: "/ve-geme" }, { label: "Cẩm nang đá quý", href: "/cam-nang-da-quy" }, { label: "Chính sách bảo mật", href: "/ve-geme" }, { label: "Điều khoản sử dụng", href: "/ve-geme" }, { label: "Liên hệ", href: "/lien-he" }],
  supportLinks: [{ label: "Hướng dẫn mua hàng", href: "/san-pham" }, { label: "Chính sách đổi trả", href: "/san-pham" }, { label: "Bảo hành & chăm sóc", href: "/san-pham" }, { label: "Câu hỏi thường gặp", href: "/san-pham" }],
  socialLinks: [{ label: "Facebook", href: "" }, { label: "Instagram", href: "" }, { label: "TikTok", href: "" }, { label: "YouTube", href: "" }],
  paymentMethods: ["VISA", "Mastercard", "MoMo", "ZaloPay"],
  logoImageUrl: "",
  backgroundImageUrl: "",
  copyright: "© 2025 GEME. All rights reserved.",
};

function normalizeBanners(value: unknown): Banner[] {
  if (!Array.isArray(value)) return fallbackBanners;
  const defaultsByPosition = new Map(fallbackBanners.map((item) => [item.position, item]));
  const normalized: Banner[] = value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item, index) => {
    const position = canonicalBannerPosition(item.position);
    const defaultBanner = defaultsByPosition.get(position);
    const isSeededDefault = String(item.id || "").startsWith("seed-") && Boolean(defaultBanner);
    return {
      id: String(item.id || `banner-${index + 1}`), name: isSeededDefault ? defaultBanner!.name : String(item.name || "Banner mới"), position,
      imageUrl: isSeededDefault ? defaultBanner!.imageUrl : String(item.imageUrl || ""), eyebrow: String(item.eyebrow || ""), title: String(item.title || ""), description: String(item.description || ""), ctaLabel: String(item.ctaLabel || ""), season: String(item.season || ""), startAt: String(item.startAt || ""), endAt: String(item.endAt || ""), href: String(item.href || ""), status: item.status === "HIDDEN" || item.status === "SCHEDULED" ? item.status : "ACTIVE", devices: Array.isArray(item.devices) ? item.devices.map(String) : ["desktop", "tablet", "mobile"],
    };
  });
  const requiredHomeBanners = fallbackBanners.filter((item) => currentHomePositions.includes(item.position));
  return [...normalized, ...requiredHomeBanners.filter((item) => !normalized.some((saved) => saved.position === item.position))];
}

function normalizeFooter(value: unknown): FooterContent {
  const record = value && typeof value === "object" ? value as Partial<FooterContent> : {};
  return { ...defaultFooter, ...record, aboutLinks: Array.isArray(record.aboutLinks) ? record.aboutLinks : defaultFooter.aboutLinks, supportLinks: Array.isArray(record.supportLinks) ? record.supportLinks : defaultFooter.supportLinks, socialLinks: Array.isArray(record.socialLinks) ? record.socialLinks : defaultFooter.socialLinks, paymentMethods: Array.isArray(record.paymentMethods) ? record.paymentMethods : defaultFooter.paymentMethods };
}

function apiImageUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;
  // Static storefront assets are not uploaded to the API media library. Give
  // them a dedicated same-origin route so the admin can preview them reliably.
  if (url.startsWith("/assets/")) return `/geme-assets${url.slice("/assets".length)}`;
  if (url.startsWith("/images/")) return `/geme-images${url.slice("/images".length)}`;
  if (url.startsWith("/media/")) return url;
  return `${apiBaseUrl}/${url.replace(/^\//, "")}`;
}

function imageDownloadName(name: string, url: string, mimeType?: string) {
  const path = url.split(/[?#]/, 1)[0];
  const mimeExtensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/avif": "avif" };
  const extension = path.match(/\.([a-z0-9]{2,5})$/i)?.[1] || mimeExtensions[mimeType || ""] || "webp";
  const base = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").slice(0, 120) || "geme-image";
  return base.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? base : `${base}.${extension}`;
}

async function downloadImage(url: string, name: string) {
  const response = await fetch(apiImageUrl(url), { cache: "no-store" });
  if (!response.ok) throw new Error("Không tải được ảnh. Vui lòng thử lại.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = imageDownloadName(name, url, blob.type);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function emptyBanner(): Banner { return { id: crypto.randomUUID(), name: "", position: "Trang chủ - Hero", imageUrl: "", eyebrow: "", title: "", description: "", ctaLabel: "", season: "", startAt: "", endAt: "", href: "", status: "ACTIVE", devices: ["desktop", "tablet", "mobile"] }; }

async function saveSettings(settings: Record<string, unknown>) {
  const response = await fetch(`${apiBaseUrl}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
  if (!response.ok) throw new Error(`Không lưu được vào database (${response.status}).`);
  return response.json();
}

async function uploadImage(file: File, alt: string) {
  const dataUrl = await compressProductImage(file);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const response = await fetch(`${apiBaseUrl}/media`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: "image/webp", base64, alt }) });
  if (!response.ok) {
    let message = "Không thể lưu ảnh vào database.";
    try { const detail = await response.json(); message = detail.message || message; } catch { /* keep default */ }
    throw new Error(Array.isArray(message) ? message.join(" ") : message);
  }
  const asset = await response.json();
  return String(asset.url || `/media/${asset.id}`);
}

async function uploadVideo(file: File, alt: string) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const reportedMime = file.type.toLowerCase().split(";", 1)[0];
  const mimeType = reportedMime === "video/mp4" || reportedMime === "video/webm"
    ? reportedMime
    : reportedMime === "" || reportedMime === "application/octet-stream"
      ? extension === "webm" ? "video/webm" : extension === "mp4" ? "video/mp4" : ""
      : reportedMime;
  if (mimeType !== "video/mp4" && mimeType !== "video/webm") throw new Error("Chỉ nhận tệp video MP4 hoặc WebM.");
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Video phải có dung lượng tối đa 8 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không đọc được video."));
    reader.onerror = () => reject(new Error("Không đọc được video."));
    reader.readAsDataURL(file);
  });
  const response = await fetch(`${apiBaseUrl}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), alt }),
  });
  if (!response.ok) {
    let message = "Không thể lưu video vào thư viện GEME.";
    try { const detail = await response.json(); message = detail.message || message; } catch { /* keep default */ }
    throw new Error(Array.isArray(message) ? message.join(" ") : message);
  }
  const asset = await response.json();
  return String(asset.url || `/media/${asset.id}`);
}

export default function BannerFooterWorkspace({ onNotify }: { onNotify: (message: string) => void }) {
  const [tab, setTab] = useState<"banners" | "footer" | "catalog" | "library">("banners");
  const [libraryKind, setLibraryKind] = useState<"banner" | "footer">("banner");
  const [zoomImage, setZoomImage] = useState<{ url: string; name: string } | null>(null);
  const [banners, setBanners] = useState<Banner[]>(fallbackBanners);
  const [categoryBanners, setCategoryBanners] = useState<CategoryBanner[]>([]);
  const [selectedId, setSelectedId] = useState(fallbackBanners[0].id);
  const [draft, setDraft] = useState<Banner>(fallbackBanners[0]);
  const [footer, setFooter] = useState<FooterContent>(defaultFooter);
  const [catalogPromos, setCatalogPromos] = useState<CatalogEditorialPromo[]>(defaultCatalogEditorialPromos);
  const [newArrivalsMedia, setNewArrivalsMedia] = useState<NewArrivalsMedia>(defaultNewArrivalsMedia);
  const [filterPosition, setFilterPosition] = useState("Tất cả vị trí");
  const [filterSeason, setFilterSeason] = useState("Tất cả mùa");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [bannerConfigSaved, setBannerConfigSaved] = useState(false);
  const notifyRef = useRef(onNotify);
  useEffect(() => { notifyRef.current = onNotify; }, [onNotify]);
  useEffect(() => {
    if (!zoomImage) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomImage(null); };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [zoomImage]);
  const selected = useMemo(() => banners.find((item) => item.id === selectedId), [banners, selectedId]);
  const managedBanners = useMemo(() => banners.filter((item) => !retiredHomePositions.has(item.position)), [banners]);
  const positions = useMemo(() => [...new Set(managedBanners.map((item) => item.position))], [managedBanners]);
  const seasons = useMemo(() => [...new Set(["Mùa xuân", "Mùa hạ", "Mùa thu", "Mùa đông", "Tết", "Giáng Sinh", "Hè", ...banners.map((item) => item.season)].filter(Boolean))], [banners]);
  const visibleBanners = useMemo(() => managedBanners.filter((item) => (filterPosition === "Tất cả vị trí" || item.position === filterPosition) && (filterSeason === "Tất cả mùa" || item.season === filterSeason)), [managedBanners, filterPosition, filterSeason]);
  const bannerImages = useMemo(() => [
    ...managedBanners.filter((item) => item.imageUrl).map((item) => ({ url: item.imageUrl, name: item.name, detail: item.position, season: item.season })),
    ...categoryBanners.filter((item) => item.bannerUrl).map((item) => ({ url: String(item.bannerUrl), name: `Danh mục ${item.name}`, detail: `Trang danh mục · ${item.slug || ""}`, season: "" })),
    ...catalogPromos.flatMap((item) => [item.imageUrl && { url: item.imageUrl, name: `${item.title || item.id} · Ảnh`, detail: "Trang sản phẩm · Nội dung biên tập", season: "" }, item.posterUrl && { url: item.posterUrl, name: `${item.title || item.id} · Poster video`, detail: "Trang sản phẩm · Poster video", season: "" }].filter((asset): asset is { url: string; name: string; detail: string; season: string } => Boolean(asset))),
    newArrivalsMedia.editorialImageUrl && { url: newArrivalsMedia.editorialImageUrl, name: "New Arrivals · Ảnh biên tập", detail: "New Arrivals · Ảnh", season: "" },
    newArrivalsMedia.videoPosterUrl && { url: newArrivalsMedia.videoPosterUrl, name: "New Arrivals · Poster video", detail: "New Arrivals · Poster video", season: "" },
  ].filter((asset): asset is { url: string; name: string; detail: string; season: string } => Boolean(asset)), [managedBanners, categoryBanners, catalogPromos, newArrivalsMedia]);
  const footerImages = useMemo(() => [footer.logoImageUrl && { url: footer.logoImageUrl, name: "Logo footer", detail: "Thương hiệu", season: "" }, footer.backgroundImageUrl && { url: footer.backgroundImageUrl, name: "Ảnh nền footer", detail: "Ảnh chân trang", season: "" }].filter((item): item is { url: string; name: string; detail: string; season: string } => Boolean(item)), [footer.logoImageUrl, footer.backgroundImageUrl]);
  const galleryImages = libraryKind === "banner" ? bannerImages : footerImages;
  const filteredGallery = libraryKind === "banner" && filterSeason !== "Tất cả mùa" ? galleryImages.filter((item) => item.season === filterSeason) : galleryImages;

  useEffect(() => {
    let alive = true;
    void fetch(`${apiBaseUrl}/settings`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((settings: SiteContent) => {
      if (!alive) return;
      const nextBanners = normalizeBanners(settings.banners);
      const firstManagedBanner = nextBanners.find((item) => !retiredHomePositions.has(item.position));
      const savedHomePositions = new Set(Array.isArray(settings.banners) ? settings.banners.flatMap((item: unknown) => {
        if (!item || typeof item !== "object" || !("position" in item)) return [];
        const position = canonicalBannerPosition(item.position);
        return currentHomePositions.includes(position) ? [position] : [];
      }) : []);
      const hasSavedAllHomeSlots = currentHomePositions.every((position) => savedHomePositions.has(position));
      setBanners(nextBanners); setSelectedId(firstManagedBanner?.id || ""); setDraft(firstManagedBanner || emptyBanner()); setFooter(normalizeFooter(settings.footerContent)); setCatalogPromos(normalizeCatalogEditorialPromos(settings.catalogEditorialPromos)); setNewArrivalsMedia(normalizeNewArrivalsMedia(settings.newArrivalsMedia)); setBannerConfigSaved(hasSavedAllHomeSlots); setLoaded(true);
    }).catch(() => { if (alive) { setLoaded(true); notifyRef.current("Không tải được cấu hình nội dung từ database."); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch(`${apiBaseUrl}/categories`, { cache: "no-store" }).then((response) => response.ok ? response.json() : []).then((records: CategoryBanner[]) => { if (alive && Array.isArray(records)) setCategoryBanners(records); }).catch(() => { /* category banners are an optional gallery group */ });
    return () => { alive = false; };
  }, []);

  const beginCreate = () => { const next = emptyBanner(); setSelectedId(next.id); setDraft(next); };
  const selectBanner = (banner: Banner) => { setSelectedId(banner.id); setDraft({ ...banner }); };
  const editBanner = (banner: Banner) => {
    selectBanner(banner);
    setTab("banners");
    window.requestAnimationFrame(() => document.querySelector(".bf-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const toggleDevice = (device: string) => setDraft((old) => ({ ...old, devices: old.devices.includes(device) ? old.devices.filter((value) => value !== device) : [...old.devices, device] }));

  const saveBanner = async () => {
    if (!draft.name.trim() || !draft.imageUrl) { onNotify("Vui lòng nhập tên và chọn ảnh banner."); return; }
    setSaving(true);
    const savedDraft = { ...draft, name: draft.name.trim(), position: canonicalBannerPosition(draft.position) };
    // Put the last edited record first so it wins when multiple active banners share a position.
    const next = [savedDraft, ...banners.filter((item) => item.id !== draft.id)];
    try { await saveSettings({ banners: next }); setBanners(next); setSelectedId(draft.id); setDraft(savedDraft); setBannerConfigSaved(true); onNotify("Banner đã lưu vào database."); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu banner."); }
    finally { setSaving(false); }
  };

  const pickBannerImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setUploading(true);
    try { const imageUrl = await uploadImage(file, draft.name || "Banner GEME"); setDraft((old) => ({ ...old, imageUrl })); onNotify("Ảnh đã được nén và lưu trong database."); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh."); }
    finally { setUploading(false); }
  };

  const saveFooter = async () => {
    setSaving(true);
    try { await saveSettings({ footerContent: footer }); onNotify("Footer đã lưu vào database và sẽ cập nhật trên website."); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu footer."); }
    finally { setSaving(false); }
  };

  const uploadFooterImage = async (field: "logoImageUrl" | "backgroundImageUrl", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setUploading(true);
    try { const imageUrl = await uploadImage(file, field === "logoImageUrl" ? "Logo footer GEME" : "Ảnh nền footer GEME"); setFooter((old) => ({ ...old, [field]: imageUrl })); onNotify("Ảnh footer đã được lưu trong database. Bấm Lưu footer để áp dụng."); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh footer."); }
    finally { setUploading(false); }
  };

  const uploadCatalogPromoImage = async (promoId: CatalogEditorialPromo["id"], field: "imageUrl" | "posterUrl", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const promo = catalogPromos.find((item) => item.id === promoId);
    setUploading(true);
    try {
      const imageUrl = await uploadImage(file, `${promo?.title || "Nội dung trang sản phẩm"}${field === "posterUrl" ? " poster" : ""}`);
      setCatalogPromos((items) => items.map((item) => item.id === promoId ? { ...item, [field]: imageUrl } : item));
      onNotify("Ảnh đã được nén và lưu. Bấm Lưu ảnh & video để áp dụng.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh."); }
    finally { setUploading(false); }
  };

  const uploadCatalogPromoVideo = async (promoId: CatalogEditorialPromo["id"], event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const promo = catalogPromos.find((item) => item.id === promoId);
    setUploading(true);
    try {
      const videoUrl = await uploadVideo(file, `${promo?.title || "Video trang sản phẩm"} GEME`);
      setCatalogPromos((items) => items.map((item) => item.id === promoId ? { ...item, videoUrl } : item));
      onNotify("Video đã lưu trong thư viện GEME. Bấm Lưu ảnh & video để áp dụng.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu video."); }
    finally { setUploading(false); }
  };

  const uploadNewArrivalsImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setUploading(true);
    try {
      const editorialImageUrl = await uploadImage(file, newArrivalsMedia.editorialAltText || "Ảnh biên tập New Arrivals GEME");
      setNewArrivalsMedia((old) => ({ ...old, editorialImageUrl }));
      onNotify("Ảnh New Arrivals đã lưu trong thư viện GEME. Bấm Lưu ảnh & video để áp dụng.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh."); }
    finally { setUploading(false); }
  };

  const uploadNewArrivalsPoster = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setUploading(true);
    try {
      const videoPosterUrl = await uploadImage(file, newArrivalsMedia.videoAltText || "Poster video New Arrivals GEME");
      setNewArrivalsMedia((old) => ({ ...old, videoPosterUrl }));
      onNotify("Poster video New Arrivals đã lưu trong thư viện GEME. Bấm Lưu ảnh & video để áp dụng.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu poster."); }
    finally { setUploading(false); }
  };

  const uploadNewArrivalsVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setUploading(true);
    try {
      const videoUrl = await uploadVideo(file, newArrivalsMedia.videoAltText || "Video New Arrivals GEME");
      setNewArrivalsMedia((old) => ({ ...old, videoUrl }));
      onNotify("Video New Arrivals đã lưu trong thư viện GEME. Bấm Lưu ảnh & video để áp dụng.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu video."); }
    finally { setUploading(false); }
  };

  const saveCatalogPromos = async () => {
    setSaving(true);
    try {
      const next = [...catalogPromos].sort((a, b) => a.sortOrder - b.sortOrder);
      await saveSettings({ catalogEditorialPromos: next });
      setCatalogPromos(next);
      onNotify("Ảnh/video biên tập Trang sức đã lưu vào database.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh/video Trang sức."); }
    finally { setSaving(false); }
  };

  const saveNewArrivalsMedia = async () => {
    setSaving(true);
    try {
      await saveSettings({ newArrivalsMedia });
      onNotify("Ảnh/video New Arrivals đã lưu vào database.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu ảnh/video New Arrivals."); }
    finally { setSaving(false); }
  };

  const updateCatalogPromo = <K extends keyof CatalogEditorialPromo>(promoId: CatalogEditorialPromo["id"], field: K, value: CatalogEditorialPromo[K]) => {
    setCatalogPromos((items) => items.map((item) => item.id === promoId ? { ...item, [field]: value } : item));
  };

  const updateLinks = (key: "aboutLinks" | "supportLinks" | "socialLinks", index: number, field: keyof FooterLink, value: string) => setFooter((old) => ({ ...old, [key]: old[key].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const addFooterLink = (key: "aboutLinks" | "supportLinks" | "socialLinks") => setFooter((old) => ({ ...old, [key]: [...old[key], { label: "", href: "" }] }));
  const removeFooterLink = (key: "aboutLinks" | "supportLinks" | "socialLinks", index: number) => setFooter((old) => ({ ...old, [key]: old[key].filter((_, itemIndex) => itemIndex !== index) }));
  const isJewelryCarousel = /^Trang sức - Carousel [1-5]$/.test(draft.position);

  return <section className="bf-workspace">
    <div className="page-heading bf-heading"><div><h1>Quản lý Banner &amp; Footer</h1><p>Cập nhật banner và nội dung chân trang; ảnh được lưu bền vững trong database.</p></div>{tab === "banners" && <button className="button button-primary" onClick={beginCreate}>＋ Thêm banner mới</button>}</div>
    <div className="bf-tabs"><button className={tab === "banners" ? "active" : ""} onClick={() => setTab("banners")}>▧ &nbsp; Banner</button><button className={tab === "footer" ? "active" : ""} onClick={() => setTab("footer")}>▤ &nbsp; Footer</button><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>▧ &nbsp; Ảnh &amp; video Trang sức / New Arrivals</button><button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>▦ &nbsp; Thư viện ảnh</button></div>

    {tab === "banners" ? <div className="bf-banner-layout">
      <section className="bf-list-panel"><div className="bf-list-heading"><div><h2>Danh sách banner</h2><p>Quản lý ảnh banner theo vị trí hiển thị trên website.</p></div><label><span className="sr-only">Lọc vị trí</span><select value={filterPosition} onChange={(event) => setFilterPosition(event.target.value)}><option>Tất cả vị trí</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label><span className="sr-only">Lọc mùa</span><select value={filterSeason} onChange={(event) => setFilterSeason(event.target.value)}><option>Tất cả mùa</option>{seasons.map((season) => <option key={season}>{season}</option>)}</select></label></div>
        <div className="bf-banner-rows">{visibleBanners.map((banner) => <div className={`bf-banner-row${selectedId === banner.id ? " selected" : ""}`} key={banner.id} onClick={() => selectBanner(banner)} role="group"><input type="checkbox" aria-label={`Chọn ${banner.name}`} checked={banner.status === "ACTIVE"} readOnly onClick={(event) => event.stopPropagation()}/><button type="button" className="bf-banner-thumb" aria-label={`Phóng to ảnh ${banner.name}`} onClick={(event) => { event.stopPropagation(); setZoomImage({ url: apiImageUrl(banner.imageUrl), name: banner.name }); }}><img src={apiImageUrl(banner.imageUrl)} alt=""/></button><span className="bf-banner-row-copy"><strong>{banner.name}</strong><small>Vị trí: {banner.position}</small><small>{banner.season || "Không theo mùa"} · {banner.startAt || "Không giới hạn"}{banner.endAt ? ` - ${banner.endAt}` : ""}</small></span><span className={`bf-status ${banner.status.toLowerCase()}`}>{banner.status === "ACTIVE" ? "Đang hiển thị" : banner.status === "SCHEDULED" ? "Đang lên lịch" : "Đang ẩn"}</span><button type="button" className="bf-row-edit" onClick={(event) => { event.stopPropagation(); editBanner(banner); }}>✎ Sửa</button></div>)}{!visibleBanners.length && <p className="bf-empty">Chưa có banner ở vị trí này.</p>}</div>
        <div className="bf-list-foot">Hiển thị {visibleBanners.length} / {managedBanners.length} banner <span>{!loaded ? "Đang tải dữ liệu…" : bannerConfigSaved ? "Đã lưu database" : "Ảnh mặc định · chưa lưu database"}</span></div>
      </section>

      <aside className="bf-editor-panel"><h2>{banners.some((item) => item.id === draft.id) ? "Chỉnh sửa banner" : "Thêm banner"}</h2><p>Thay đổi hiển thị ở các trang dùng vị trí tương ứng.</p>
        <label className="bf-field"><span>Tên banner</span><input value={draft.name} onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} placeholder="Ví dụ: Banner trang chủ mùa xuân"/></label>
        <label className="bf-field"><span>Vị trí hiển thị</span><select value={draft.position} onChange={(event) => setDraft((old) => ({ ...old, position: event.target.value }))}>{[...new Set([...currentHomePositions, "Trang sức - Carousel 1", "Trang sức - Carousel 2", "Trang sức - Carousel 3", "Trang sức - Carousel 4", "Trang sức - Carousel 5", "Mặt đá quý - Banner", "Blog - Banner", "Về GEME - Hero", "Về GEME - Câu chuyện", "Về GEME - Sứ mệnh", "Về GEME - Banner cuối", "Liên hệ - Hero", "Liên hệ - Banner tư vấn", "New Arrivals - Hero", "New Arrivals - Banner cuối", ...positions])].filter((position) => !retiredHomePositions.has(position)).map((position) => <option key={position}>{position}</option>)}</select></label>
        <label className="bf-field"><span>Ảnh banner</span><span className="bf-image-picker">{draft.imageUrl ? <img src={apiImageUrl(draft.imageUrl)} alt="Xem trước banner"/> : <span className="bf-image-empty">Chọn ảnh banner</span>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void pickBannerImage(event)} disabled={uploading}/></span>{draft.imageUrl && <button type="button" className="bf-preview-zoom" onClick={() => setZoomImage({ url: apiImageUrl(draft.imageUrl), name: draft.name || "Banner GEME" })}>Phóng to ảnh đang chọn</button>}</label>
        {isJewelryCarousel && <div className="bf-banner-copy-fields"><p>Nội dung hiển thị trên slide (để trống sẽ dùng nội dung mặc định của GEME).</p><div className="bf-two-fields"><label className="bf-field"><span>Nhãn nhỏ</span><input value={draft.eyebrow || ""} onChange={(event) => setDraft((old) => ({ ...old, eyebrow: event.target.value }))} placeholder="COLLECTION / GEME"/></label><label className="bf-field"><span>Tiêu đề</span><input value={draft.title || ""} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="Tất cả sản phẩm"/></label></div><label className="bf-field"><span>Mô tả</span><textarea rows={3} value={draft.description || ""} onChange={(event) => setDraft((old) => ({ ...old, description: event.target.value }))} placeholder="Trang sức bạc tinh tế kết hợp đá quý thiên nhiên…"/></label><label className="bf-field"><span>Nhãn liên kết</span><input value={draft.ctaLabel || ""} onChange={(event) => setDraft((old) => ({ ...old, ctaLabel: event.target.value }))} placeholder="Khám phá trang sức"/></label></div>}
        <div className="bf-two-fields"><label className="bf-field"><span>Mùa áp dụng</span><select value={draft.season} onChange={(event) => setDraft((old) => ({ ...old, season: event.target.value }))}><option value="">Không theo mùa</option>{[...new Set([...seasons, draft.season].filter(Boolean))].map((season) => <option key={season} value={season}>{season}</option>)}</select></label><label className="bf-field"><span>Liên kết khi bấm</span><input value={draft.href} onChange={(event) => setDraft((old) => ({ ...old, href: event.target.value }))} placeholder="/san-pham"/></label></div>
        <div className="bf-two-fields"><label className="bf-field"><span>Bắt đầu</span><input type="date" value={draft.startAt} onChange={(event) => setDraft((old) => ({ ...old, startAt: event.target.value }))}/></label><label className="bf-field"><span>Kết thúc</span><input type="date" value={draft.endAt} onChange={(event) => setDraft((old) => ({ ...old, endAt: event.target.value }))}/></label></div>
        <label className="bf-field"><span>Trạng thái</span><select value={draft.status} onChange={(event) => setDraft((old) => ({ ...old, status: event.target.value as Banner["status"] }))}><option value="ACTIVE">Đang hiển thị</option><option value="SCHEDULED">Đang lên lịch</option><option value="HIDDEN">Đang ẩn</option></select></label>
        <div className="bf-device-options"><span>Hiển thị trên thiết bị</span>{[["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile", "Mobile"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.devices.includes(value)} onChange={() => toggleDevice(value)}/>{label}</label>)}</div>
        <div className="bf-editor-actions"><button className="button button-quiet" onClick={() => selectBanner(selected || banners[0])} disabled={!selected}>Hủy</button><button className="button button-primary" onClick={() => void saveBanner()} disabled={saving || uploading}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button></div>
      </aside>
    </div> : tab === "footer" ? <div className="bf-footer-editor">
      <div className="bf-footer-grid">
        <section className="bf-footer-card"><div className="bf-footer-card-heading"><div><h2>Thông tin liên hệ</h2><p>Hiển thị dưới chân tất cả trang.</p></div></div>
          {([["Địa chỉ", "address"], ["Hotline", "phone"], ["Email", "email"], ["Thời gian làm việc", "openingHours"]] as const).map(([label, key]) => <label className="bf-field" key={key}><span>{label}</span><input value={footer[key]} onChange={(event) => setFooter((old) => ({ ...old, [key]: event.target.value }))}/></label>)}
          <label className="bf-field"><span>Mô tả thương hiệu</span><input value={footer.brandDescription} onChange={(event) => setFooter((old) => ({ ...old, brandDescription: event.target.value }))}/></label>
          <label className="bf-field"><span>Bản quyền</span><input value={footer.copyright} onChange={(event) => setFooter((old) => ({ ...old, copyright: event.target.value }))}/></label>
        </section>
        <section className="bf-footer-card"><div className="bf-footer-card-heading"><div><h2>Menu footer</h2><p>Liên kết hiển thị ở cuối trang.</p></div></div>
          {([["Về GEME", "aboutLinks"], ["Hỗ trợ khách hàng", "supportLinks"]] as const).map(([title, key]) => <div className="bf-link-group" key={key}><h3>{title}</h3>{footer[key].map((link, index) => <div className="bf-link-row" key={`${key}-${index}`}><input aria-label={`Tên liên kết ${title}`} value={link.label} onChange={(event) => updateLinks(key, index, "label", event.target.value)} placeholder="Tên liên kết"/><input aria-label={`Đường dẫn ${title}`} value={link.href} onChange={(event) => updateLinks(key, index, "href", event.target.value)} placeholder="/duong-dan"/><button onClick={() => removeFooterLink(key, index)} aria-label="Bỏ liên kết">×</button></div>)}<button className="bf-add-link" onClick={() => addFooterLink(key)}>＋ Thêm mục</button></div>)}
        </section>
        <section className="bf-footer-card"><div className="bf-footer-card-heading"><div><h2>Mạng xã hội &amp; thanh toán</h2><p>Đường dẫn và nhãn phương thức thanh toán.</p></div></div>
          <div className="bf-link-group">{footer.socialLinks.map((link, index) => <div className="bf-link-row" key={`social-${index}`}><input aria-label="Tên mạng xã hội" value={link.label} onChange={(event) => updateLinks("socialLinks", index, "label", event.target.value)} placeholder="Facebook"/><input aria-label="Liên kết mạng xã hội" value={link.href} onChange={(event) => updateLinks("socialLinks", index, "href", event.target.value)} placeholder="https://"/><button onClick={() => removeFooterLink("socialLinks", index)} aria-label="Bỏ mạng xã hội">×</button></div>)}<button className="bf-add-link" onClick={() => addFooterLink("socialLinks")}>＋ Thêm mạng xã hội</button></div>
          <label className="bf-field"><span>Phương thức thanh toán (phân cách bằng dấu phẩy)</span><input value={footer.paymentMethods.join(", ")} onChange={(event) => setFooter((old) => ({ ...old, paymentMethods: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}/></label>
          <div className="bf-footer-images"><label><span>Logo footer</span>{footer.logoImageUrl && <img src={apiImageUrl(footer.logoImageUrl)} alt="Logo footer"/>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadFooterImage("logoImageUrl", event)} disabled={uploading}/></label><label><span>Ảnh nền footer (không bắt buộc)</span>{footer.backgroundImageUrl && <img src={apiImageUrl(footer.backgroundImageUrl)} alt="Nền footer"/>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadFooterImage("backgroundImageUrl", event)} disabled={uploading}/></label></div>
        </section>
      </div>
      <div className="bf-footer-save"><span>Mọi nội dung và ảnh footer được lưu vào PostgreSQL.</span><button className="button button-primary" onClick={() => void saveFooter()} disabled={saving || uploading}>{saving ? "Đang lưu…" : "Lưu footer"}</button></div>
    </div> : tab === "catalog" ? <div className="bf-catalog-editor">
      <div className="bf-catalog-intro"><div><h2>Ảnh &amp; video Trang sức và New Arrivals</h2><p>Chỉnh các nội dung THE GREEN EDIT, GEME TRÊN BẠN, TỪ ĐÁ ĐẾN TRANG SỨC và ảnh/video riêng trên trang New Arrivals.</p></div><span>Được lưu cùng cấu hình website trong PostgreSQL.</span></div>
      <p className="bf-catalog-video-note">Chọn trực tiếp video MP4/WebM tối đa 8 MB hoặc dán URL video công khai. Ảnh và poster được tải vào thư viện GEME.</p>
      <div className="bf-catalog-promo-grid">{catalogPromos.map((promo) => <section className="bf-catalog-promo-card" key={promo.id}>
        <header><div><h3>{promo.title || promo.id}</h3><small>Chèn sau {promo.placement.replace("after-", "")} sản phẩm</small></div><label className="bf-catalog-enable"><input type="checkbox" checked={promo.enabled} onChange={(event) => updateCatalogPromo(promo.id, "enabled", event.target.checked)}/> Bật</label></header>
        <div className="bf-two-fields"><label className="bf-field"><span>Loại nội dung</span><select value={promo.kind} onChange={(event) => updateCatalogPromo(promo.id, "kind", event.target.value as CatalogEditorialPromo["kind"])}><option value="image">Ảnh</option><option value="video">Video</option></select></label><label className="bf-field"><span>Vị trí chèn</span><select value={promo.placement} onChange={(event) => updateCatalogPromo(promo.id, "placement", event.target.value as CatalogEditorialPromo["placement"])}><option value="after-4">Sau 4 sản phẩm</option><option value="after-12">Sau 12 sản phẩm</option><option value="after-18">Sau 18 sản phẩm</option></select></label></div>
        <label className="bf-field"><span>Tiêu đề</span><input value={promo.title} onChange={(event) => updateCatalogPromo(promo.id, "title", event.target.value)}/></label>
        <label className="bf-field"><span>Mô tả</span><textarea rows={2} value={promo.description} onChange={(event) => updateCatalogPromo(promo.id, "description", event.target.value)}/></label>
        <div className="bf-two-fields"><label className="bf-field"><span>Nhãn liên kết</span><input value={promo.ctaLabel} onChange={(event) => updateCatalogPromo(promo.id, "ctaLabel", event.target.value)} placeholder="Khám phá →"/></label><label className="bf-field"><span>Liên kết đích</span><input value={promo.href} onChange={(event) => updateCatalogPromo(promo.id, "href", event.target.value)} placeholder="/san-pham hoặc https://…"/></label></div>
        {promo.kind === "image" ? <div className="bf-catalog-media-fields"><label className="bf-field"><span>Ảnh nội dung</span><input value={promo.imageUrl} onChange={(event) => updateCatalogPromo(promo.id, "imageUrl", event.target.value)} placeholder="URL ảnh hoặc tải ảnh bên dưới"/></label><label className="bf-catalog-upload"><span>{promo.imageUrl ? <img src={apiImageUrl(promo.imageUrl)} alt="Xem trước ảnh nội dung"/> : "Chưa chọn ảnh"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadCatalogPromoImage(promo.id, "imageUrl", event)} disabled={uploading}/></label></div>
          : <div className="bf-catalog-media-fields"><label className="bf-field"><span>URL video (MP4/WebM, nếu video đã có trên mạng)</span><input value={promo.videoUrl} onChange={(event) => updateCatalogPromo(promo.id, "videoUrl", event.target.value)} placeholder="https://…/video.mp4 hoặc /media/…"/></label><label className="bf-catalog-upload bf-video-upload"><span>{promo.videoUrl ? "Video đã chọn · bấm để thay video" : "Chọn video MP4/WebM · tối đa 8 MB"}</span><input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={(event) => void uploadCatalogPromoVideo(promo.id, event)} disabled={uploading}/></label>{promo.videoUrl && <video className="bf-catalog-video-preview" src={apiImageUrl(promo.videoUrl)} poster={promo.posterUrl ? apiImageUrl(promo.posterUrl) : undefined} controls playsInline preload="metadata" aria-label={`Xem trước video ${promo.title}`}/>}<label className="bf-field"><span>URL poster (tuỳ chọn)</span><input value={promo.posterUrl} onChange={(event) => updateCatalogPromo(promo.id, "posterUrl", event.target.value)} placeholder="Tải poster bên dưới hoặc nhập URL"/></label><label className="bf-catalog-upload"><span>{promo.posterUrl ? <img src={apiImageUrl(promo.posterUrl)} alt="Xem trước poster video"/> : "Chưa chọn poster"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadCatalogPromoImage(promo.id, "posterUrl", event)} disabled={uploading}/></label></div>}
        <label className="bf-field"><span>Văn bản thay thế ảnh</span><input value={promo.altText} onChange={(event) => updateCatalogPromo(promo.id, "altText", event.target.value)} placeholder="Mô tả ngắn nội dung hình ảnh"/></label>
        <div className="bf-two-fields"><label className="bf-field"><span>Điểm canh ngang (%)</span><input type="number" min="0" max="100" value={promo.focusX} onChange={(event) => updateCatalogPromo(promo.id, "focusX", Math.max(0, Math.min(100, Number(event.target.value) || 0)))}/></label><label className="bf-field"><span>Điểm canh dọc (%)</span><input type="number" min="0" max="100" value={promo.focusY} onChange={(event) => updateCatalogPromo(promo.id, "focusY", Math.max(0, Math.min(100, Number(event.target.value) || 0)))}/></label></div>
      </section>)}</div>
      <div className="bf-footer-save"><span>Lưu nội dung riêng của trang Trang sức.</span><button className="button button-primary" onClick={() => void saveCatalogPromos()} disabled={saving || uploading}>{saving ? "Đang lưu…" : "Lưu ảnh & video Trang sức"}</button></div>
      <section className="bf-new-arrivals-media">
        <header><div><h2>Trang New Arrivals</h2><p>Thay ảnh biên tập và video cận cảnh chế tác trên trang New Arrivals.</p></div></header>
        <div className="bf-new-arrivals-media-grid">
          <article className="bf-catalog-promo-card">
            <h3>Ảnh nội dung “Vừa đến GEME”</h3>
            <label className="bf-field"><span>URL ảnh (tuỳ chọn)</span><input value={newArrivalsMedia.editorialImageUrl} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, editorialImageUrl: event.target.value }))} placeholder="Dán URL hoặc chọn ảnh bên dưới"/></label>
            <label className="bf-catalog-upload"><span>{newArrivalsMedia.editorialImageUrl ? <img src={apiImageUrl(newArrivalsMedia.editorialImageUrl)} alt="Xem trước ảnh New Arrivals"/> : "Chọn ảnh New Arrivals"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadNewArrivalsImage(event)} disabled={uploading}/></label>
            <label className="bf-field"><span>Văn bản thay thế ảnh</span><input value={newArrivalsMedia.editorialAltText} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, editorialAltText: event.target.value }))} placeholder="Mô tả ngắn hình ảnh"/></label>
            <label className="bf-field"><span>Nhãn liên kết</span><input value={newArrivalsMedia.editorialCtaLabel} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, editorialCtaLabel: event.target.value }))} placeholder="Khám phá →"/></label>
            <label className="bf-field"><span>Liên kết đích</span><input value={newArrivalsMedia.editorialHref} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, editorialHref: event.target.value }))} placeholder="/san-pham#san-pham"/></label>
          </article>
          <article className="bf-catalog-promo-card">
            <h3>Video cận cảnh chế tác</h3>
            <label className="bf-field"><span>URL video (tuỳ chọn)</span><input value={newArrivalsMedia.videoUrl} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, videoUrl: event.target.value }))} placeholder="Dán URL hoặc chọn video bên dưới"/></label>
            <label className="bf-catalog-upload bf-video-upload"><span>{newArrivalsMedia.videoUrl ? "Video đã chọn · bấm để thay video" : "Chọn video MP4/WebM · tối đa 8 MB"}</span><input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={(event) => void uploadNewArrivalsVideo(event)} disabled={uploading}/></label>
            {newArrivalsMedia.videoUrl && <video className="bf-catalog-video-preview" src={apiImageUrl(newArrivalsMedia.videoUrl)} poster={newArrivalsMedia.videoPosterUrl ? apiImageUrl(newArrivalsMedia.videoPosterUrl) : undefined} controls playsInline preload="metadata" aria-label="Xem trước video New Arrivals"/>}
            <label className="bf-field"><span>URL poster (tuỳ chọn)</span><input value={newArrivalsMedia.videoPosterUrl} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, videoPosterUrl: event.target.value }))} placeholder="Dán URL hoặc chọn ảnh poster bên dưới"/></label>
            <label className="bf-catalog-upload"><span>{newArrivalsMedia.videoPosterUrl ? <img src={apiImageUrl(newArrivalsMedia.videoPosterUrl)} alt="Xem trước poster video New Arrivals"/> : "Chọn ảnh poster"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadNewArrivalsPoster(event)} disabled={uploading}/></label>
            <label className="bf-field"><span>Văn bản thay thế</span><input value={newArrivalsMedia.videoAltText} onChange={(event) => setNewArrivalsMedia((old) => ({ ...old, videoAltText: event.target.value }))} placeholder="Mô tả ảnh/video"/></label>
          </article>
        </div>
        <div className="bf-footer-save"><span>Lưu riêng ảnh biên tập và video của New Arrivals.</span><button className="button button-primary" onClick={() => void saveNewArrivalsMedia()} disabled={saving || uploading}>{saving ? "Đang lưu…" : "Lưu ảnh & video New Arrivals"}</button></div>
      </section>
    </div> : <div className="bf-library-panel">
      <div className="bf-library-heading"><div><h2>Thư viện ảnh Banner &amp; Footer</h2><p>Ảnh được lưu trên PostgreSQL, phân nhóm theo mục đang sử dụng.</p></div><div className="bf-library-filters"><button className={libraryKind === "banner" ? "active" : ""} onClick={() => setLibraryKind("banner")}>Tất cả ảnh banner <span>{bannerImages.length}</span></button><button className={libraryKind === "footer" ? "active" : ""} onClick={() => setLibraryKind("footer")}>Tất cả ảnh footer <span>{footerImages.length}</span></button>{libraryKind === "banner" && <select aria-label="Lọc ảnh theo mùa" value={filterSeason} onChange={(event) => setFilterSeason(event.target.value)}><option>Tất cả mùa</option>{seasons.map((season) => <option key={season}>{season}</option>)}</select>}</div></div>
      {filteredGallery.length ? <div className="bf-gallery-grid">{filteredGallery.map((item, index) => <article className="bf-gallery-card" key={`${item.url}-${index}`}><button type="button" className="bf-gallery-open" aria-label={`Phóng to ảnh ${item.name}`} onClick={() => setZoomImage({ url: apiImageUrl(item.url), name: item.name })}><span className="bf-gallery-photo"><img src={apiImageUrl(item.url)} alt={item.name}/><span>⌕</span></span></button><strong>{item.name}</strong><small>{item.detail}</small>{libraryKind === "banner" && <em>{item.season || "Không theo mùa"}</em>}<button type="button" className="bf-download-button" onClick={() => void downloadImage(item.url, item.name).catch((error) => onNotify(error instanceof Error ? error.message : "Không tải được ảnh."))}>↓ Tải ảnh</button></article>)}</div> : <p className="bf-empty">{libraryKind === "footer" ? "Chưa có ảnh footer được chọn." : "Không có ảnh banner thuộc mùa này."}</p>}
      <p className="bf-library-foot">Chọn ảnh để phóng to. Thay ảnh banner hoặc footer ở các thẻ tương ứng.</p>
    </div>}
    {zoomImage && <div className="bf-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomImage(null); }}><section className="bf-lightbox-content" role="dialog" aria-modal="true" aria-label={`Xem ảnh ${zoomImage.name}`} tabIndex={-1} autoFocus onKeyDown={(event) => { if (event.key === "Escape") setZoomImage(null); }}><button type="button" className="bf-lightbox-download" onClick={() => void downloadImage(zoomImage.url, zoomImage.name).catch((error) => onNotify(error instanceof Error ? error.message : "Không tải được ảnh."))}>↓ Tải ảnh</button><button type="button" className="bf-lightbox-close" aria-label="Đóng ảnh" onClick={() => setZoomImage(null)}>×</button><img src={zoomImage.url} alt={zoomImage.name}/></section></div>}

  </section>;
}
