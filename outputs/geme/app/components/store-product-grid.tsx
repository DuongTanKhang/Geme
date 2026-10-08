import type { StoreProduct } from "../lib/store-api";
import type { StorePromotion } from "../lib/store-api";
import { formatStorePrice } from "../lib/store-format";
import { formatStorePromotionPeriod, getStoreProductPromotion } from "../lib/store-promotion";
import Image from "next/image";

export function StoreProductCard({ product, promotions, compact = false }: { product: StoreProduct; promotions: StorePromotion[]; compact?: boolean }) {
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
  const secondaryImage = product.images[1];
  const imageSizes = compact ? "(max-width: 760px) 48vw, (max-width: 1200px) 24vw, 22vw" : "(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 25vw";
  return <article className={className} key={product.id}>
    <a className={`${photoClass}${secondaryImage ? " has-secondary-image" : ""}`} href={`/san-pham/${encodeURIComponent(product.slug)}`} aria-label={`Xem ${product.name}${soldOut ? " — Hết hàng" : ""}`}>
      <Image className="product-card-image product-card-image-primary" src={image} alt={product.images[0]?.alt || product.name} fill sizes={imageSizes} />
      {secondaryImage && <Image className="product-card-image product-card-image-secondary" src={secondaryImage.url} alt={secondaryImage.alt || `${product.name} — ảnh thứ hai`} fill sizes={imageSizes} />}
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
