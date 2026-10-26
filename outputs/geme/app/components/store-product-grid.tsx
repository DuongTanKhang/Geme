"use client";

import { useState } from "react";
import Image from "next/image";
import type { StoreProduct } from "../lib/store-api";
import type { StorePromotion } from "../lib/store-api";
import { formatStorePrice } from "../lib/store-format";
import { formatStorePromotionPeriod, getStoreProductPrice } from "../lib/store-promotion";
import { useWishlist } from "./wishlist-provider";
import ViewportVideo from "./viewport-video";
import { isStoreMediaProxyUrl, storeMediaDeliveryUrl } from "../lib/store-media";

export function StoreProductCard({ product, promotions, compact = false, priority = false }: { product: StoreProduct; promotions: StorePromotion[]; compact?: boolean; priority?: boolean }) {
  const { favoriteIds, toggleFavorite } = useWishlist();
  const [favoriteError, setFavoriteError] = useState("");
  const isFavorite = favoriteIds.has(product.id);
  const image = product.images[0]?.url || "/assets/category-jewelry.jpg";
  const imageSrc = storeMediaDeliveryUrl(image) || image;
  const className = compact ? "product-card" : "catalog-product-card";
  const photoClass = compact ? "product-photo" : "catalog-product-photo";
  const nameClass = compact ? "product-name" : "catalog-product-name";
  const soldOut = product.stock <= 0;
  const { salePrice, originalPrice, discountPercent, promotion } = getStoreProductPrice(product, promotions);
  const activePromotion = promotion;
  const hasDiscount = originalPrice > salePrice && discountPercent > 0;
  const promotionPeriod = activePromotion ? formatStorePromotionPeriod(activePromotion) : "";
  const secondaryImage = product.coverVideoUrl ? undefined : product.images[1];
  const secondaryImageSrc = storeMediaDeliveryUrl(secondaryImage?.url);
  return <article className={className} key={product.id}>
    <button className={`product-favorite-button${isFavorite ? " is-favorite" : ""}`} type="button" aria-label={isFavorite ? `Bỏ ${product.name} khỏi yêu thích` : `Lưu ${product.name} vào yêu thích`} aria-pressed={isFavorite} onClick={async (event) => {
      event.preventDefault();
      event.stopPropagation();
      setFavoriteError("");
      try { await toggleFavorite(product); }
      catch (error) { setFavoriteError(error instanceof Error ? error.message : "Không cập nhật được yêu thích."); }
    }}>
      <svg viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} aria-hidden="true"><path d="M20.8 8.8c0 5-8.8 10.3-8.8 10.3S3.2 13.8 3.2 8.8A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.8 2.3Z" /></svg>
    </button>
    {favoriteError && <span className="product-favorite-feedback" role="status">{favoriteError}</span>}
    <a className={`${photoClass}${secondaryImage ? " has-secondary-image" : ""}`} href={`/san-pham/${encodeURIComponent(product.slug)}`} aria-label={`Xem ${product.name}${product.isPremiumGemstone ? " — Hàng cao cấp, liên hệ GEME" : soldOut ? " — Hết hàng" : ""}`}>
      {product.coverVideoUrl
        ? <ViewportVideo className="product-card-image product-cover-video" src={product.coverVideoUrl} poster={image} ariaLabel={`${product.name} · video bìa`} />
        : <Image className="product-card-image product-card-image-primary" src={imageSrc} alt={product.images[0]?.alt || product.name} fill sizes={compact ? "(max-width: 640px) 48vw, (max-width: 900px) 31vw, (max-width: 1440px) 24vw, 360px" : "(max-width: 640px) 48vw, (max-width: 1024px) 33vw, 25vw"} quality={80} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} unoptimized={isStoreMediaProxyUrl(imageSrc)} />}
      {secondaryImage && secondaryImageSrc && <Image className="product-card-image product-card-image-secondary" src={secondaryImageSrc} alt={secondaryImage.alt || `${product.name} — ảnh thứ hai`} fill sizes={compact ? "(max-width: 640px) 48vw, (max-width: 900px) 31vw, (max-width: 1440px) 24vw, 360px" : "(max-width: 640px) 48vw, (max-width: 1024px) 33vw, 25vw"} quality={75} loading="lazy" unoptimized={isStoreMediaProxyUrl(secondaryImageSrc)} />}
      {product.kind === "GEMSTONE" && product.isPremiumGemstone ? <span className="catalog-badge catalog-badge-premium">Hàng cao cấp</span> : soldOut ? <span className="catalog-badge catalog-badge-sold-out">Hết hàng</span> : (product.newLabelActive ?? product.isNew) && <span className="catalog-badge">Mới</span>}
    </a>
    <div className={compact ? "product-meta" : "catalog-product-meta"}>
      <div>
        <a href={`/san-pham/${encodeURIComponent(product.slug)}`} className={nameClass}>{product.name}</a>
        <div className={`store-product-prices${hasDiscount ? " has-promotion" : ""}`}>
          {hasDiscount && <span className="store-product-discount">−{new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(discountPercent)}%</span>}
          <strong className={compact ? "product-price" : undefined}>{salePrice ? formatStorePrice(salePrice) : "Liên hệ"}</strong>
          {hasDiscount && <del>{formatStorePrice(originalPrice)}</del>}
          {promotionPeriod && <small className="store-product-promotion-period">{promotionPeriod}</small>}
        </div>
      </div>
    </div>
  </article>;
}

export function StoreProductGrid({ products, promotions = [], connected = true, compact = false, emptyMessage }: {
  products: StoreProduct[];
  promotions?: StorePromotion[];
  connected?: boolean;
  compact?: boolean;
  emptyMessage?: string;
}) {
  if (!products.length) {
    return <div className={compact ? "product-empty-state" : "catalog-empty"} role="status">
      <p>{connected ? emptyMessage || "Chưa có sản phẩm đang bán." : "Chưa kết nối được cửa hàng. Vui lòng thử lại sau."}</p>
    </div>;
  }
  return <div className={compact ? "product-grid" : "catalog-product-grid"}>
    {products.map((product, index) => <StoreProductCard key={product.id} product={product} promotions={promotions} compact={compact} priority={index < 2} />)}
  </div>;
}
