"use client";

import { useState } from "react";
import type { StoreProduct } from "../lib/store-api";
import type { StorePromotion } from "../lib/store-api";
import { formatStorePrice } from "../lib/store-format";
import { formatStorePromotionPeriod, getStoreProductPromotion } from "../lib/store-promotion";
import { useWishlist } from "./wishlist-provider";
import ViewportVideo from "./viewport-video";

export function StoreProductCard({ product, promotions, compact = false }: { product: StoreProduct; promotions: StorePromotion[]; compact?: boolean }) {
  const { favoriteIds, toggleFavorite } = useWishlist();
  const [favoriteError, setFavoriteError] = useState("");
  const isFavorite = favoriteIds.has(product.id);
  const image = product.images[0]?.url || "/assets/category-jewelry.jpg";
  const category = product.category?.name || (product.kind === "GEMSTONE" ? "Mặt đá quý" : "Trang sức");
  const material = product.materialOption?.name || product.gemstoneType?.name;
  const className = compact ? "product-card" : "catalog-product-card";
  const photoClass = compact ? "product-photo" : "catalog-product-photo";
  const nameClass = compact ? "product-name" : "catalog-product-name";
  const soldOut = product.stock <= 0;
  const activePromotion = getStoreProductPromotion(product, promotions);
  const listedPrice = Math.max(0, Number(product.price) || 0);
  const configuredOriginalPrice = Math.max(0, Number(product.originalPrice) || 0);
  const regularPrice = activePromotion ? Math.max(listedPrice, configuredOriginalPrice) : listedPrice;
  const salePrice = activePromotion
    ? Math.max(0, Math.round(regularPrice * (1 - Math.min(Number(activePromotion.value) || 0, 100) / 100)))
    : listedPrice;
  const originalPrice = activePromotion
    ? regularPrice
    : configuredOriginalPrice > salePrice ? configuredOriginalPrice : 0;
  const discountPercent = activePromotion
    ? Number(activePromotion.value) || 0
    : originalPrice > salePrice ? Math.round((1 - salePrice / originalPrice) * 100) : 0;
  const hasDiscount = originalPrice > salePrice && discountPercent > 0;
  const promotionPeriod = activePromotion ? formatStorePromotionPeriod(activePromotion) : "";
  const secondaryImage = product.coverVideoUrl ? undefined : product.images[1];
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
    <a className={`${photoClass}${secondaryImage ? " has-secondary-image" : ""}`} href={`/san-pham/${encodeURIComponent(product.slug)}`} aria-label={`Xem ${product.name}${soldOut ? " — Hết hàng" : ""}`}>
      {product.coverVideoUrl
        ? <ViewportVideo className="product-card-image product-cover-video" src={product.coverVideoUrl} poster={image} ariaLabel={`${product.name} · video bìa`} />
        : <img className="product-card-image product-card-image-primary" src={image} alt={product.images[0]?.alt || product.name} loading="lazy" decoding="async" />}
      {secondaryImage && <img className="product-card-image product-card-image-secondary" src={secondaryImage.url} alt={secondaryImage.alt || `${product.name} — ảnh thứ hai`} loading="lazy" decoding="async" />}
      {soldOut ? <span className="catalog-badge catalog-badge-sold-out">Hết hàng</span> : product.isNew && <span className="catalog-badge">Mới</span>}
    </a>
    <div className={compact ? "product-meta" : "catalog-product-meta"}>
      <div>
        <a href={`/san-pham/${encodeURIComponent(product.slug)}`} className={nameClass}>{product.name}</a>
        {!compact && <p>{category}{material ? ` · ${material}` : ""}</p>}
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
    {products.map((product) => <StoreProductCard key={product.id} product={product} promotions={promotions} compact={compact} />)}
  </div>;
}
