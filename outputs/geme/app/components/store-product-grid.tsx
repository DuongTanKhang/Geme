"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { StoreProduct } from "../lib/store-api";
import type { StorePromotion } from "../lib/store-api";
import { formatStorePrice } from "../lib/store-format";
import { formatStorePromotionPeriod, getStoreProductPrice } from "../lib/store-promotion";
import { useWishlist } from "./wishlist-provider";
import ViewportVideo from "./viewport-video";
import { isStoreMediaProxyUrl, storeMediaDeliveryUrl } from "../lib/store-media";

type StoreCartLine = {
  key: string;
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  sku: string;
  price: number;
  shape: string | null;
  quality: string | null;
  beadSize: string | null;
  carat: number | null;
  gemstoneQuality: string | null;
  quantity: number;
  stock: number;
};

const CART_STORAGE_KEY = "geme-cart-v1";

function bangleShapeName(shape?: string | null) {
  return ({ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" } as Record<string, string>)[String(shape || "").toUpperCase()] || shape || "";
}

function variantLabel(variant: StoreProduct["variants"][number]) {
  return [bangleShapeName(variant.shape), variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : "", variant.gemstoneQuality]
    .filter(Boolean)
    .join(" · ") || variant.sku || "Phiên bản sản phẩm";
}

export function StoreProductCard({ product, promotions, compact = false, priority = false }: { product: StoreProduct; promotions: StorePromotion[]; compact?: boolean; priority?: boolean }) {
  const { favoriteIds, toggleFavorite } = useWishlist();
  const [favoriteError, setFavoriteError] = useState("");
  const [cartPickerOpen, setCartPickerOpen] = useState(false);
  const [isInCart, setIsInCart] = useState(false);
  const isFavorite = favoriteIds.has(product.id);
  useEffect(() => {
    const refreshCartState = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || "[]");
        setIsInCart(Array.isArray(saved) && saved.some((item) => item?.productId === product.id));
      } catch {
        setIsInCart(false);
      }
    };
    refreshCartState();
    window.addEventListener("geme:cart-updated", refreshCartState);
    return () => window.removeEventListener("geme:cart-updated", refreshCartState);
  }, [product.id]);
  const image = product.images[0]?.url || "/assets/category-jewelry.jpg";
  const imageSrc = storeMediaDeliveryUrl(image) || image;
  const className = compact ? "product-card" : "catalog-product-card";
  const photoClass = compact ? "product-photo" : "catalog-product-photo";
  const nameClass = compact ? "product-name" : "catalog-product-name";
  const availableVariants = product.variants.filter((variant) => Number(variant.stock) > 0);
  const soldOut = product.variants.length ? availableVariants.length === 0 : product.stock <= 0;
  const { salePrice, originalPrice, discountPercent, promotion } = getStoreProductPrice(product, promotions);
  const activePromotion = promotion;
  const hasDiscount = originalPrice > salePrice && discountPercent > 0;
  const promotionPeriod = activePromotion ? formatStorePromotionPeriod(activePromotion) : "";
  const secondaryImage = product.coverVideoUrl ? undefined : product.images[1];
  const secondaryImageSrc = storeMediaDeliveryUrl(secondaryImage?.url);
  const addToCart = (variant?: StoreProduct["variants"][number]) => {
    const stock = Number(variant?.stock ?? product.stock) || 0;
    if (stock <= 0 || product.isPremiumGemstone) return;
    const line: StoreCartLine = {
      key: `${product.id}:${variant?.id || variant?.sku || "default"}`,
      productId: product.id,
      variantId: variant?.id || null,
      slug: product.slug,
      name: product.name,
      sku: variant?.sku || product.sku,
      price: getStoreProductPrice(product, promotions, variant).salePrice,
      shape: variant?.shape || null,
      quality: variant?.quality || null,
      beadSize: variant?.beadSize || null,
      carat: variant?.carat ?? null,
      gemstoneQuality: variant?.gemstoneQuality || null,
      quantity: 1,
      stock,
    };
    let cart: StoreCartLine[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) cart = saved;
    } catch { /* Start a clean cart if its current session value is invalid. */ }
    if (cart.some((item) => item.productId === product.id)) {
      setIsInCart(true);
      setCartPickerOpen(false);
      return;
    }
    cart.push(line);
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("geme:cart-updated", { detail: { count: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) } }));
    setIsInCart(true);
    setCartPickerOpen(false);
  };
  const removeFromCart = () => {
    let cart: StoreCartLine[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) cart = saved;
    } catch { /* Keep an empty cart if its current session value is invalid. */ }
    const nextCart = cart.filter((item) => item.productId !== product.id);
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
    window.dispatchEvent(new CustomEvent("geme:cart-updated", { detail: { count: nextCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0) } }));
    setIsInCart(false);
    setCartPickerOpen(false);
  };
  const openCartAction = () => {
    let alreadyInCart = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || "[]");
      alreadyInCart = Array.isArray(saved) && saved.some((item) => item?.productId === product.id);
    } catch { /* Treat an invalid cart as empty. */ }
    if (alreadyInCart) { removeFromCart(); return; }
    if (product.isPremiumGemstone || soldOut) return;
    if (!product.variants.length) { addToCart(); return; }
    if (availableVariants.length === 1) { addToCart(availableVariants[0]); return; }
    setCartPickerOpen((open) => !open);
  };
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
    <button className={`product-cart-button${isInCart ? " is-in-cart" : ""}`} type="button" aria-label={product.isPremiumGemstone ? `Liên hệ để mua ${product.name}` : soldOut ? `${product.name} hiện hết hàng` : isInCart ? `Bỏ ${product.name} khỏi giỏ hàng` : `Thêm ${product.name} vào giỏ hàng`} title={product.isPremiumGemstone ? "Liên hệ GEME để được tư vấn" : soldOut && !isInCart ? "Sản phẩm đang hết hàng" : isInCart ? "Bỏ khỏi giỏ hàng" : "Thêm vào giỏ hàng"} aria-pressed={isInCart} aria-expanded={cartPickerOpen} aria-haspopup={product.variants.length > 1 ? "listbox" : undefined} disabled={(soldOut && !isInCart) || product.isPremiumGemstone} onClick={(event) => { event.preventDefault(); event.stopPropagation(); openCartAction(); }}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 8h15l1 12h-17l1-12Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
    </button>
    {cartPickerOpen && <div className="product-card-cart-picker" role="group" aria-label={`Chọn phiên bản ${product.name}`}>
      <strong>Chọn phiên bản</strong>
      {availableVariants.map((variant) => <button type="button" aria-label={`${variantLabel(variant)} · SKU ${variant.sku || product.sku}`} key={variant.id || `${variant.sku}-${variant.quality}-${variant.beadSize}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); addToCart(variant); }}>
        <span><b>{variantLabel(variant)}</b><small>SKU: {variant.sku || product.sku} · Còn {variant.stock}</small></span>
        <strong>{formatStorePrice(getStoreProductPrice(product, promotions, variant).salePrice)}</strong>
      </button>)}
    </div>}
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
