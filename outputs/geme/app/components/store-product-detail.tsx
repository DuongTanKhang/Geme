"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { StoreCategory, StoreProduct, StorePromotion } from "../lib/store-api";
import { isStoreMediaProxyUrl, storeMediaDeliveryUrl } from "../lib/store-media";
import { formatStorePrice } from "../lib/store-format";
import { formatStorePromotionPeriod, getStoreProductPrice } from "../lib/store-promotion";
import { useWishlist } from "./wishlist-provider";

type DetailTab = "description" | "reviews";

const variantKey = (variant: NonNullable<StoreProduct["variants"]>[number]) => `${variant.shape ?? ""}::${variant.quality}::${variant.beadSize ?? ""}::${variant.carat ?? ""}::${variant.gemstoneQuality ?? ""}`;
const bangleShapeName = (shape?: string | null) => ({ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" } as Record<string, string>)[String(shape || "").toUpperCase()] || "";

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true"><path d="M20.8 8.8c0 5-8.8 10.3-8.8 10.3S3.2 13.8 3.2 8.8A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.8 2.3Z" /></svg>;
}

function DetailAssuranceIcon({ name }: { name: "product" | "variants" | "consulting" | "support" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "product" && <><path d="m12 3 9 9-9 9-9-9 9-9Z" /><circle cx="12" cy="12" r="1.5" /></>}
    {name === "variants" && <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>}
    {name === "consulting" && <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.5A7.5 7.5 0 0 1 10.5 8h2A7.5 7.5 0 0 1 20 15.5Z" /><path d="M8 13h8M8 16h5" /></>}
    {name === "support" && <><path d="M12 3 19 6v5c0 4.4-2.8 8.2-7 10-4.2-1.8-7-5.6-7-10V6l7-3Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>}
  </svg>;
}

function ProductPhoto({ url, alt, className = "", loading = "lazy", sizes = "(max-width: 760px) 100vw, 50vw" }: { url?: string; alt: string; className?: string; loading?: "eager" | "lazy"; sizes?: string }) {
  const imageUrl = storeMediaDeliveryUrl(url);
  return url
    ? <Image className={className} src={imageUrl || url} alt={alt} width={1200} height={1200} sizes={sizes} quality={80} loading={loading} fetchPriority={loading === "eager" ? "high" : undefined} unoptimized={isStoreMediaProxyUrl(imageUrl || url)} />
    : <div className={`${className} detail-photo-empty`} role="img" aria-label={`${alt} — chưa có ảnh`}>Chưa có ảnh</div>;
}

function RelatedProductCard({ product }: { product: StoreProduct }) {
  const image = product.images[0];
  return <article>
    <a className="detail-related-photo" href={`/san-pham/${encodeURIComponent(product.slug)}`} aria-label={`Xem ${product.name}`}>
      <ProductPhoto url={image?.url} alt={image?.alt || product.name} sizes="(max-width: 640px) 42vw, 200px" />
      {product.isNew && <span className="detail-related-new">Mới</span>}
    </a>
    <a className="detail-related-name" href={`/san-pham/${encodeURIComponent(product.slug)}`}>{product.name}</a>
    <strong>{product.kind === "GEMSTONE" && product.isPremiumGemstone ? "Liên hệ" : product.price ? formatStorePrice(product.price) : "Liên hệ"}</strong>
    {product.materialOption?.name && <small>{product.materialOption.name}</small>}
  </article>;
}

export function StoreProductDetail({
  product,
  categoryTrail = [],
  relatedProducts = [],
  promotions = [],
}: {
  product: StoreProduct;
  categoryTrail?: StoreCategory[];
  relatedProducts?: StoreProduct[];
  promotions?: StorePromotion[];
}) {
  const images = product.images;
  const productVariants = useMemo(
    () => product.variants.slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [product.variants],
  );
  const availableVariants = useMemo(
    () => productVariants.filter((variant) => variant.stock > 0),
    [productVariants],
  );
  const [activeImage, setActiveImage] = useState(0);
  const [activeTab, setActiveTab] = useState<DetailTab>("description");
  const [selectedVariantKey, setSelectedVariantKey] = useState(() => {
    const first = availableVariants[0];
    return first ? variantKey(first) : "";
  });
  const [quantity, setQuantity] = useState(1);
  const { favoriteIds, toggleFavorite } = useWishlist();
  const isSaved = favoriteIds.has(product.id);
  const [wishlistNotice, setWishlistNotice] = useState("");
  const [wishlistPending, setWishlistPending] = useState(false);
  const [cartNotice, setCartNotice] = useState("");

  const handleFavorite = async () => {
    if (wishlistPending) return;
    setWishlistNotice("");
    setWishlistPending(true);
    try {
      await toggleFavorite(product);
      setWishlistNotice(isSaved ? "Đã bỏ khỏi danh sách yêu thích." : "Đã thêm vào danh sách yêu thích.");
    }
    catch (error) { setWishlistNotice(error instanceof Error ? error.message : "Không cập nhật được danh sách yêu thích."); }
    finally { setWishlistPending(false); }
  };

  const selectedVariant = availableVariants.find(
    (variant) => variantKey(variant) === selectedVariantKey,
  ) ?? availableVariants[0];
  const normalizedCategoryPath = [...categoryTrail.map((category) => category.name), product.category?.name || ""].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
  const normalizedProductName = product.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi");
  const bangleProduct = normalizedCategoryPath.includes("vong kieng") || normalizedProductName.includes("kieng");
  const bangleVariants = bangleProduct && productVariants.some((variant) => Boolean(variant.shape));
  const bangleShapes = [...new Set(availableVariants.map((variant) => variant.shape).filter((shape): shape is string => Boolean(shape)))];
  const selectedShape = selectedVariant?.shape || bangleShapes[0] || "";
  const gemstonePricingMode = product.category?.pricingMode || "GEMSTONE_SIZE";
  const gemstoneCaratPricing = product.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(gemstonePricingMode);
  const gemstoneCaratQualityPricing = product.kind === "GEMSTONE" && gemstonePricingMode === "GEMSTONE_CARAT_AND_QUALITY";
  const variantsForShape = bangleVariants ? availableVariants.filter((variant) => variant.shape === selectedShape) : availableVariants;
  const qualities = [...new Set(variantsForShape.map((variant) => variant.quality))];
  const selectedQuality = selectedVariant?.quality ?? qualities[0];
  const gemstoneQualities = [...new Set(availableVariants.map((variant) => variant.gemstoneQuality).filter((quality): quality is string => Boolean(quality)))];
  const selectedGemstoneQuality = selectedVariant?.gemstoneQuality || gemstoneQualities[0];
  const sizesForQuality = variantsForShape.filter((variant) => variant.quality === selectedQuality && variant.beadSize);
  const caratsForSelection = availableVariants.filter((variant) => variant.quality === selectedQuality && (!gemstoneCaratQualityPricing || variant.gemstoneQuality === selectedGemstoneQuality) && variant.carat != null);
  const priceDetails = getStoreProductPrice(product, promotions, selectedVariant);
  const { salePrice: price, originalPrice, promotion: activePromotion } = priceDetails;
  const promotionPeriod = activePromotion ? formatStorePromotionPeriod(activePromotion) : "";
  const stock = selectedVariant ? selectedVariant.stock : product.stock;
  const material = product.materialOption?.name || product.gemstoneType?.name;
  const variantImages = (selectedVariant?.imageUrls || []).map((url, index) => ({ url, alt: [product.name, bangleShapeName(selectedVariant?.shape), selectedVariant?.quality, selectedVariant?.beadSize].filter(Boolean).join(" · "), sortOrder: index, isPrimary: index === 0 }));
  const fallbackImages = bangleProduct ? images.slice(0, 1) : images;
  const displayImages = (variantImages.length ? variantImages : fallbackImages).slice(0, bangleProduct ? 1 : 10);
  const galleryMedia = [
    ...displayImages.map((image) => ({ kind: "image" as const, image })),
    ...(selectedVariant?.videoUrl ? [{ kind: "variant-video" as const, url: selectedVariant.videoUrl }] : []),
  ];
  const activeImageIndex = Math.min(activeImage, Math.max(galleryMedia.length - 1, 0));
  const activeMedia = galleryMedia[activeImageIndex];
  const reviewCount = product.reviews?.length ?? 0;
  const averageRating = reviewCount
    ? (product.reviews!.reduce((total, review) => total + review.rating, 0) / reviewCount).toFixed(1)
    : null;
  const detailDescription = product.fullDescription || product.description;
  const technicalImage = product.technicalImageUrl || images[1]?.url;
  const technicalVideo = product.technicalVideoUrl;
  const hasTechnicalMedia = Boolean(technicalVideo || technicalImage);
  const beadSizes = [...new Set(productVariants.map((variant) => variant.beadSize).filter((size): size is string => Boolean(size)))];
  const qualityNames = [...new Set(productVariants.map((variant) => variant.quality))];
  const sizeOnlyVariants = normalizedCategoryPath.includes("vong tay") || normalizedCategoryPath.includes("lac tay")
    ? productVariants.length > 0 && productVariants.every((variant) => variant.quality === "Kích thước")
    : false;
  const minVariantPrice = productVariants.length ? Math.min(...productVariants.map((variant) => Math.round(variant.price * (gemstoneCaratPricing ? Number(variant.carat || 0) : 1)))) : 0;
  const maxVariantPrice = productVariants.length ? Math.max(...productVariants.map((variant) => Math.round(variant.price * (gemstoneCaratPricing ? Number(variant.carat || 0) : 1)))) : 0;
  const dimensions = [product.lengthCm, product.widthCm, product.heightCm];
  const hasDimensions = dimensions.some((dimension) => dimension != null);
  const formattedDimensions = dimensions.map((dimension) => dimension == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(dimension)).join(" × ");
  const formattedWeight = product.weightGrams == null ? null : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(product.weightGrams);

  const setQuality = (quality: string) => {
    const next = availableVariants.find((variant) => (!bangleVariants || variant.shape === selectedShape) && variant.quality === quality);
    if (next) {
      setSelectedVariantKey(variantKey(next));
      setQuantity(1);
      setActiveImage(0);
    }
  };
  const setSize = (beadSize: string) => {
    const next = availableVariants.find((variant) => (!bangleVariants || variant.shape === selectedShape) && variant.quality === selectedQuality && variant.beadSize === beadSize);
    if (next) {
      setSelectedVariantKey(variantKey(next));
      setQuantity(1);
      setActiveImage(0);
    }
  };
  const setBangleShape = (shape: string) => {
    const next = availableVariants.find((variant) => variant.shape === shape);
    if (next) { setSelectedVariantKey(variantKey(next)); setQuantity(1); setActiveImage(0); }
  };
  const setGemstoneQuality = (quality: string) => {
    const next = availableVariants.find((variant) => variant.quality === selectedQuality && variant.gemstoneQuality === quality && (!gemstoneCaratPricing || variant.carat === selectedVariant?.carat))
      ?? availableVariants.find((variant) => variant.quality === selectedQuality && variant.gemstoneQuality === quality);
    if (next) { setSelectedVariantKey(variantKey(next)); setQuantity(1); setActiveImage(0); }
  };
  const setCarat = (carat: number) => {
    const next = caratsForSelection.find((variant) => Number(variant.carat) === carat);
    if (next) { setSelectedVariantKey(variantKey(next)); setQuantity(1); setActiveImage(0); }
  };

  const categoryName = categoryTrail[categoryTrail.length - 1]?.name || product.category?.name;

  const makeCartLine = () => ({
      key: `${product.id}:${selectedVariant?.id || selectedVariantKey}`,
      productId: product.id,
      variantId: selectedVariant?.id || null,
      slug: product.slug,
      name: product.name,
      sku: selectedVariant?.sku || product.sku,
      price,
      shape: selectedVariant?.shape || null,
      quality: sizeOnlyVariants ? null : selectedVariant?.quality || null,
      beadSize: selectedVariant?.beadSize || null,
      carat: selectedVariant?.carat ?? null,
      gemstoneQuality: selectedVariant?.gemstoneQuality || null,
      quantity,
      stock,
    });

  const addToCart = () => {
    if (stock <= 0) return;
    const key = "geme-cart-v1";
    const cartLine = makeCartLine();
    let cart: typeof cartLine[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "[]");
      if (Array.isArray(saved)) cart = saved;
    } catch { /* Start with an empty in-session cart if stored data is invalid. */ }
    const existing = cart.find((item) => item.key === cartLine.key);
    if (existing) existing.quantity = Math.min(stock, Number(existing.quantity) + quantity);
    else cart.push(cartLine);
    sessionStorage.setItem(key, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("geme:cart-updated", { detail: { count: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) } }));
    setCartNotice(`${product.name} đã được thêm vào giỏ hàng.`);
  };

  const buyNow = () => {
    if (stock <= 0) return;
    sessionStorage.setItem("geme-checkout-v1", JSON.stringify([makeCartLine()]));
    window.location.assign("/thanh-toan?mua-ngay=1");
  };

  return <>
    <nav className="detail-breadcrumb" aria-label="Đường dẫn">
      <a href="/">Trang chủ</a><span>/</span>
      {categoryTrail.map((category) => <span className="detail-breadcrumb-part" key={category.id}>
        <a href={`/san-pham?danh-muc=${encodeURIComponent(category.slug)}`}>{category.name}</a><span>/</span>
      </span>)}
      <span>{product.name}</span>
    </nav>

    <main className="product-detail-page">
      <section className="detail-top">
        <div className={"detail-gallery" + (galleryMedia.length > 1 ? " has-thumbnails" : "")}>
          {galleryMedia.length > 1 && <div className="detail-thumbnails" aria-label="Ảnh và video sản phẩm">
            {galleryMedia.map((media, index) => <button type="button" key={media.kind + index} className={activeImageIndex === index ? "is-active" : ""} onClick={() => setActiveImage(index)} aria-label={media.kind === "variant-video" ? "Xem video biến thể" : "Xem ảnh " + (index + 1)}>
              {media.kind === "image" ? <ProductPhoto url={media.image.url} alt={media.image.alt || product.name} loading="lazy" sizes="66px" /> : <span className="detail-video-thumbnail" aria-hidden="true">▶</span>}
            </button>)}
          </div>}
          <div className="detail-main-image">
            {activeMedia?.kind === "variant-video"
              ? <video className="detail-variant-video" src={activeMedia.url} controls playsInline preload="metadata" aria-label={"Video " + (selectedVariant?.sku || product.name)} />
              : <ProductPhoto url={activeMedia?.kind === "image" ? activeMedia.image.url : undefined} alt={activeMedia?.kind === "image" ? activeMedia.image.alt || product.name : product.name} loading="eager" />}
            <button className={`detail-image-heart${isSaved ? " is-saved" : ""}`} type="button" aria-label={isSaved ? "Bỏ khỏi danh sách yêu thích" : "Thêm vào danh sách yêu thích"} aria-pressed={isSaved} aria-busy={wishlistPending} disabled={wishlistPending} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void handleFavorite(); }}><HeartIcon filled={isSaved} /></button>
            {galleryMedia.length > 1 && <>
              <button className="detail-image-arrow is-prev" type="button" onClick={() => setActiveImage((activeImageIndex + galleryMedia.length - 1) % galleryMedia.length)} aria-label="Ảnh trước">‹</button>
              <button className="detail-image-arrow is-next" type="button" onClick={() => setActiveImage((activeImageIndex + 1) % galleryMedia.length)} aria-label="Ảnh tiếp theo">›</button>
              <span className="detail-image-count">{activeImageIndex + 1}/{galleryMedia.length}</span>
            </>}
          </div>
        </div>

        <div className="detail-info">
          <span className="eyebrow">{product.kind === "GEMSTONE" ? "ĐÁ QUÝ" : categoryName?.toLocaleUpperCase("vi") || "TRANG SỨC"}</span>
          <h1>{product.name}</h1>
          <div className="detail-price-line">
            {activePromotion && <span className="detail-promo-badge">−{activePromotion.value}%</span>}
            <strong>{price ? formatStorePrice(price) : "Liên hệ"}</strong>
            {originalPrice > price && <del>{formatStorePrice(originalPrice)}</del>}
          </div>
          {promotionPeriod && <small className="detail-promo-period">{promotionPeriod}</small>}
          {(material || product.isNew || product.isPremiumGemstone) && <div className="detail-meta-chip-list">
            {material && <span className="detail-material-chip">{product.kind === "GEMSTONE" ? "Loại đá" : "Chất liệu / đá"}: <strong>{material}</strong></span>}
            {product.isNew && <span className="detail-new-chip">Sản phẩm mới</span>}
            {product.isPremiumGemstone && <span className="detail-premium-chip">Hàng cao cấp</span>}
          </div>}
          <p className="detail-summary">{product.description || product.fullDescription || "Sản phẩm được tuyển chọn và giới thiệu bởi GEME."}</p>

          <div className="detail-guarantees">
            <div><span aria-hidden="true">◇</span><strong>Thông tin sản phẩm</strong><small>Mã {selectedVariant?.sku || product.sku}</small></div>
            <div><span aria-hidden="true">◉</span><strong>Giá theo phiên bản</strong><small>Cập nhật từ dữ liệu sản phẩm</small></div>
            <div><span aria-hidden="true">⌕</span><strong>Tư vấn lựa chọn</strong><small>Hỗ trợ chọn biến thể phù hợp</small></div>
            <div><span aria-hidden="true">♡</span><strong>Hỗ trợ khách hàng</strong><small>Liên hệ GEME khi cần</small></div>
          </div>

          {bangleVariants && bangleShapes.length > 0 && <fieldset className="detail-size-picker">
            <legend>Dáng kiềng: <strong>{bangleShapeName(selectedShape)}</strong></legend>
            <div className="store-detail-quality-list">{bangleShapes.map((shape) => <button type="button" key={shape} className={selectedShape === shape ? "is-selected" : ""} onClick={() => setBangleShape(shape)}>{bangleShapeName(shape)}</button>)}</div>
          </fieldset>}
          {qualities.length > 0 && <fieldset className="detail-size-picker">
            <legend>{bangleVariants ? "Chất lượng kiềng" : product.kind === "GEMSTONE" ? "Dạng cắt" : "Chất lượng"}: <strong>{selectedQuality}</strong></legend>
            <div className="store-detail-quality-list">{qualities.map((quality) => <button type="button" key={quality} className={selectedQuality === quality ? "is-selected" : ""} onClick={() => setQuality(quality)}>{quality}</button>)}</div>
          </fieldset>}
          {gemstoneQualities.length > 0 && <fieldset className="detail-size-picker">
            <legend>Chất lượng đá: <strong>{selectedGemstoneQuality}</strong></legend>
            <div className="store-detail-quality-list">{gemstoneQualities.map((quality) => <button type="button" key={quality} className={selectedGemstoneQuality === quality ? "is-selected" : ""} onClick={() => setGemstoneQuality(quality)}>{quality}</button>)}</div>
          </fieldset>}
          {gemstoneCaratPricing && caratsForSelection.length > 0 && <fieldset className="detail-size-picker">
            <legend>Trọng lượng: <strong>{selectedVariant?.carat} ct</strong></legend>
            <div className="store-detail-quality-list">{caratsForSelection.map((variant) => <button type="button" key={variantKey(variant)} className={Number(selectedVariant?.carat) === Number(variant.carat) ? "is-selected" : ""} onClick={() => setCarat(Number(variant.carat))}>{variant.carat} ct</button>)}</div>
          </fieldset>}
          {sizesForQuality.length > 0 && <fieldset className="detail-size-picker">
            <legend>{bangleVariants ? "Size kiềng" : sizeOnlyVariants ? "Kích thước vòng" : product.kind === "GEMSTONE" ? "Size mặt đá" : "Kích thước hạt"}: <strong>{selectedVariant?.beadSize}</strong></legend>
            <div>{sizesForQuality.map((variant) => <button type="button" key={variant.beadSize} className={selectedVariant?.beadSize === variant.beadSize ? "is-selected" : ""} onClick={() => setSize(variant.beadSize || "")} title={`${variant.stock} sản phẩm còn hàng`}>
              {variant.beadSize}
            </button>)}</div>
          </fieldset>}

          <div className="detail-stock-status" role="status">{product.isPremiumGemstone ? "Liên hệ để được tư vấn và kiểm tra tình trạng hàng" : stock > 0 ? "Còn hàng" : "Tạm hết hàng"}</div>
          {product.isPremiumGemstone
            ? <div className="detail-contact-only"><a href="/lien-he">LIÊN HỆ GEME ĐỂ ĐƯỢC TƯ VẤN</a></div>
            : <div className="detail-buy-row">
            <div className="detail-quantity" aria-label="Số lượng">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Giảm số lượng">−</button>
              <span>{quantity}</span>
              <button type="button" onClick={() => setQuantity((value) => Math.min(Math.max(stock, 1), value + 1))} aria-label="Tăng số lượng" disabled={stock === 0 || quantity >= stock}>+</button>
            </div>
            <button className="detail-buy-now" type="button" onClick={buyNow} disabled={stock === 0}>MUA NGAY</button>
            <button className="detail-add-cart" type="button" onClick={addToCart} disabled={stock === 0}>{stock > 0 ? "BỎ VÀO GIỎ HÀNG" : "TẠM HẾT HÀNG"}</button>
          </div>}
          {cartNotice && <p className="detail-cart-notice" role="status">{cartNotice}</p>}
          <button className={`detail-wishlist${isSaved ? " is-saved" : ""}`} type="button" aria-label={isSaved ? "Bỏ khỏi danh sách yêu thích" : "Thêm vào danh sách yêu thích"} aria-pressed={isSaved} aria-busy={wishlistPending} disabled={wishlistPending} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void handleFavorite(); }}><HeartIcon filled={isSaved} />{isSaved ? "Đã lưu yêu thích" : "Thêm vào danh sách yêu thích"}</button>
          {wishlistNotice && <p className="detail-cart-notice" role="status">{wishlistNotice}</p>}
          <div className="detail-share"><span>Chia sẻ:</span><button type="button" onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`, "_blank", "noopener,noreferrer")} aria-label="Chia sẻ Facebook">f</button><button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href)} aria-label="Sao chép liên kết">↗</button></div>
        </div>
      </section>

      <section className="detail-assurance-strip" aria-label="Thông tin dịch vụ">
        <div><DetailAssuranceIcon name="product" /><span><strong>Dữ liệu sản phẩm rõ ràng</strong><small>Thông tin lấy từ GEME</small></span></div>
        <div><DetailAssuranceIcon name="variants" /><span><strong>Biến thể theo sản phẩm</strong><small>Giá và tồn kho theo lựa chọn</small></span></div>
        <div><DetailAssuranceIcon name="consulting" /><span><strong>Tư vấn riêng</strong><small>Hỗ trợ trước khi đặt hàng</small></span></div>
        <div><DetailAssuranceIcon name="support" /><span><strong>Hỗ trợ sau mua</strong><small>Liên hệ đội ngũ GEME</small></span></div>
      </section>

      <section className="detail-content">
        <div className="detail-tabs" role="tablist" aria-label="Thông tin chi tiết">
          <button type="button" role="tab" aria-selected={activeTab === "description"} className={activeTab === "description" ? "is-active" : ""} onClick={() => setActiveTab("description")}>MÔ TẢ SẢN PHẨM</button>
          <button type="button" role="tab" aria-selected={activeTab === "reviews"} className={activeTab === "reviews" ? "is-active" : ""} onClick={() => setActiveTab("reviews")}>ĐÁNH GIÁ ({reviewCount})</button>
        </div>

        {activeTab === "description" && <div className={`detail-description-grid${hasTechnicalMedia ? "" : " detail-description-grid--no-image"}`} role="tabpanel">
          <div className="detail-description-copy">
            <h2>{product.name}</h2>
            {detailDescription ? <p className="detail-full-description">{detailDescription}</p> : <p>Chưa có mô tả chi tiết cho sản phẩm này.</p>}
          </div>
          {technicalVideo ? <video className="detail-story-image detail-story-video" src={technicalVideo} controls playsInline preload="metadata" aria-label={`${product.name} — video kỹ thuật`} /> : technicalImage && <ProductPhoto className="detail-story-image" url={technicalImage} alt={`${product.name} — ảnh kỹ thuật`} sizes="(max-width: 760px) 90vw, 35vw" />}
          <div className="detail-specs">
            <h3>THÔNG SỐ KỸ THUẬT</h3>
            <table><tbody>
              <tr><th>Tên sản phẩm</th><td>{product.name}</td></tr>
              <tr><th>Mã sản phẩm</th><td>{selectedVariant?.sku || product.sku}</td></tr>
              {material && <tr><th>{product.kind === "GEMSTONE" ? "Loại đá" : "Chất liệu / đá"}</th><td>{material}</td></tr>}
              {categoryName && <tr><th>Danh mục</th><td>{categoryTrail.map((category) => category.name).join(" / ") || categoryName}</td></tr>}
              {formattedWeight !== null && <tr><th>Khối lượng</th><td>{formattedWeight} g</td></tr>}
              {hasDimensions && <tr><th>Kích thước (dài × rộng × cao)</th><td>{formattedDimensions} cm</td></tr>}
              {bangleProduct && <tr><th>Dáng kiềng</th><td>{bangleShapeName(selectedVariant?.shape) || "Chưa cập nhật"}</td></tr>}
              {bangleProduct && <tr><th>Chất lượng</th><td>{selectedVariant?.quality || "Chưa cập nhật"}</td></tr>}
              {bangleProduct && <tr><th>Size</th><td>{selectedVariant?.beadSize || "Chưa cập nhật"}</td></tr>}
              {qualityNames.length > 0 && !sizeOnlyVariants && !bangleVariants && <tr><th>{product.kind === "GEMSTONE" ? "Dạng cắt" : "Chất lượng"}</th><td>{qualityNames.join(", ")}</td></tr>}
              {gemstoneQualities.length > 0 && <tr><th>Chất lượng đá</th><td>{gemstoneQualities.join(", ")}</td></tr>}
              {beadSizes.length > 0 && !bangleVariants && <tr><th>{sizeOnlyVariants ? "Kích thước vòng" : product.kind === "GEMSTONE" ? "Size mặt đá" : "Kích thước hạt"}</th><td>{beadSizes.join(" / ")}</td></tr>}
              {gemstoneCaratPricing && <tr><th>Carat</th><td>{[...new Set(productVariants.map((variant) => variant.carat).filter((carat): carat is number => carat != null))].join(" / ")} ct</td></tr>}
              {minVariantPrice > 0 && <tr><th>Khoảng giá phiên bản</th><td>{minVariantPrice === maxVariantPrice ? formatStorePrice(minVariantPrice) : `${formatStorePrice(minVariantPrice)} – ${formatStorePrice(maxVariantPrice)}`}</td></tr>}
            </tbody></table>
          </div>
        </div>}

        {activeTab === "reviews" && <div className="detail-review-panel" role="tabpanel">
          <div className="detail-review-summary"><strong>{averageRating || "—"}</strong><span>{reviewCount ? `★ ${reviewCount} đánh giá đã duyệt` : "Chưa có đánh giá"}</span></div>
          {reviewCount > 0 ? <div className="detail-review-list">{product.reviews!.map((review, index) => <article key={`${review.createdAt}-${index}`}>
            <div><strong>{review.customerName || "Khách hàng GEME"}</strong><span>{"★".repeat(Math.max(0, Math.min(5, review.rating)))}</span></div>
            {review.title && <h3>{review.title}</h3>}{review.content && <p>{review.content}</p>}
          </article>)}</div> : <p className="detail-review-empty">Đánh giá đã được duyệt sẽ hiển thị tại đây.</p>}
        </div>}
      </section>

      {relatedProducts.length > 0 && <section className="detail-related">
        <div className="detail-related-heading"><h2>SẢN PHẨM CÙNG LOẠI</h2><a href={`/san-pham?danh-muc=${encodeURIComponent(product.category?.slug || "")}`}>Xem tất cả <span>→</span></a></div>
        <div className="detail-related-grid">{relatedProducts.map((related) => <RelatedProductCard key={related.id} product={related} />)}</div>
      </section>}
    </main>
  </>;
}
