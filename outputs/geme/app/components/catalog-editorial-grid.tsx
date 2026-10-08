"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StoreProductCard, StoreProductGrid } from "./store-product-grid";
import type { StoreCatalogEditorialPromo, StoreProduct, StorePromotion } from "../lib/store-api";
import { planCatalogEditorialLayout } from "./catalog-editorial-layout";
import { useViewportAutoplayVideo } from "./use-viewport-video";
import type { CSSProperties } from "react";

function isPublicMediaUrl(value: string) {
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function canRenderPromo(promo: StoreCatalogEditorialPromo | undefined) {
  if (!promo || !promo.enabled) return false;
  return promo.kind === "image"
    ? isPublicMediaUrl(promo.imageUrl)
    : isPublicMediaUrl(promo.videoUrl) || isPublicMediaUrl(promo.posterUrl);
}

function validDestination(href: string) {
  const url = href.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (!/^https:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()) ? "" : url;
  } catch {
    return "";
  }
}

function CatalogPromoCard({ promo }: { promo: StoreCatalogEditorialPromo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const mediaUrl = promo.kind === "image" ? promo.imageUrl : promo.posterUrl;
  const videoUrl = promo.kind === "video" && isPublicMediaUrl(promo.videoUrl) ? promo.videoUrl : "";
  const posterUrl = isPublicMediaUrl(mediaUrl) ? mediaUrl : "";
  const focus = `${promo.focusX}% ${promo.focusY}%`;
  const destination = validDestination(promo.href);

  useEffect(() => {
    setVideoFailed(false);
  }, [videoUrl]);

  const showVideo = Boolean(videoUrl) && !videoFailed;
  useViewportAutoplayVideo(videoRef, showVideo);
  return <article className={`catalog-editorial-promo${promo.kind === "video" ? " is-video" : " is-image"}`}>
    <div className="catalog-editorial-promo-media" style={{ "--catalog-promo-focus": focus } as CSSProperties}>
      {showVideo ? <video ref={videoRef} src={videoUrl} poster={posterUrl || undefined} preload="none" playsInline muted loop controls aria-label={promo.title || "Video GEME"} onError={() => setVideoFailed(true)} />
        : posterUrl ? <img src={posterUrl} alt={promo.altText || promo.title || "Nội dung hình ảnh GEME"} loading="lazy" />
          : <div className="catalog-editorial-promo-placeholder" aria-label="Chưa có ảnh hoặc video" />}
    </div>
    <div className="catalog-editorial-promo-copy">
      {promo.title && <h3>{promo.title}</h3>}
      {promo.description && <p>{promo.description}</p>}
      {destination && promo.ctaLabel && <a href={destination}>{promo.ctaLabel}</a>}
    </div>
  </article>;
}

export function CatalogEditorialGrid({ products, promotions = [], connected, editorialPromos, activeFilters, catalogProductCount = products.length }: {
  products: StoreProduct[];
  promotions?: StorePromotion[];
  connected: boolean;
  editorialPromos: StoreCatalogEditorialPromo[];
  activeFilters: boolean;
  catalogProductCount?: number;
}) {
  const promoByPlacement = useMemo(() => {
    const byPlacement = new Map<string, StoreCatalogEditorialPromo>();
    editorialPromos.filter(canRenderPromo).sort((a, b) => a.sortOrder - b.sortOrder).forEach((promo) => {
      if (!byPlacement.has(promo.placement)) byPlacement.set(promo.placement, promo);
    });
    return byPlacement;
  }, [editorialPromos]);
  const segments = useMemo(() => activeFilters ? [] : planCatalogEditorialLayout(products.length, new Set(promoByPlacement.keys())), [products.length, promoByPlacement, activeFilters]);
  if (activeFilters) {
    return <StoreProductGrid
      products={products}
      promotions={promotions}
      connected={connected}
      emptyMessage={catalogProductCount === 0 ? "Hiện chưa có sản phẩm đang bán." : "Chưa có sản phẩm phù hợp với bộ lọc."}
    />;
  }
  if (!products.length) {
    const availablePromos = Array.from(promoByPlacement.values());
    return <div className="catalog-editorial-empty">
      <StoreProductGrid products={[]} promotions={promotions} connected={connected} emptyMessage="Hiện chưa có sản phẩm đang bán." />
      {availablePromos.length > 0 && <div className="catalog-editorial-empty-grid" aria-label="Nội dung biên tập Trang sức">
        {availablePromos.map((promo) => <CatalogPromoCard key={promo.id} promo={promo} />)}
      </div>}
    </div>;
  }

  const orderedPromos = Array.from(promoByPlacement.values());
  if (products.length < 8) {
    return <div className="catalog-editorial-sequence">
      <StoreProductGrid products={products} promotions={promotions} connected={connected} />
      {orderedPromos.length > 0 && <div className="catalog-editorial-empty-grid" aria-label="Nội dung biên tập Trang sức">
        {orderedPromos.map((promo) => <CatalogPromoCard key={promo.id} promo={promo} />)}
      </div>}
    </div>;
  }

  return <div className="catalog-editorial-sequence">
    {segments.map((segment, index) => segment.kind === "products"
      ? <div className="catalog-product-grid" key={`products-${segment.start}-${segment.end}`}>{products.slice(segment.start, segment.end).map((product) => <StoreProductCard key={product.id} product={product} promotions={promotions} />)}</div>
      : <div className={`catalog-editorial-pair${segment.final ? " is-final-pair" : ""}`} key={`promo-${segment.placement}-${index}`}>
          {products.slice(segment.start, segment.end).map((product, productIndex) => <div className="catalog-editorial-product" key={product.id} style={{ gridColumn: `${productIndex % 2 + 1}`, gridRow: `${Math.floor(productIndex / 2) + 1}` }}>
            <StoreProductCard product={product} promotions={promotions} />
          </div>)}
          <CatalogPromoCard promo={promoByPlacement.get(segment.placement)!} />
        </div>)}
  </div>;
}
