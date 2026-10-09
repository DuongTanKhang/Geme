"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StoreProduct } from "../lib/store-api";

const PENDING_FAVORITE_KEY = "geme-pending-favorite-v1";

type WishlistContextValue = {
  favorites: StoreProduct[];
  favoriteIds: ReadonlySet<string>;
  ready: boolean;
  toggleFavorite: (product: StoreProduct) => Promise<void>;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

function mapFavoriteProduct(value: Record<string, any>): StoreProduct {
  return {
    ...value,
    id: String(value.id || ""),
    sku: String(value.sku || ""),
    name: String(value.name || ""),
    slug: String(value.slug || ""),
    kind: value.kind === "GEMSTONE" ? "GEMSTONE" : "JEWELRY",
    price: Number(value.price) || 0,
    originalPrice: value.originalPrice == null ? null : Number(value.originalPrice),
    stock: Number(value.stock) || 0,
    isNew: Boolean(value.isNew),
    isFeatured: Boolean(value.isFeatured),
    images: Array.isArray(value.images) ? value.images.map((image: Record<string, any>) => ({
      url: String(image.url || ""), alt: image.alt ?? null,
      sortOrder: Number(image.sortOrder) || 0, isPrimary: Boolean(image.isPrimary),
    })).filter((image: { url: string }) => image.url) : [],
    variants: Array.isArray(value.variants) ? value.variants.map((variant: Record<string, any>, index: number) => ({
      id: variant.id ? String(variant.id) : undefined,
      sku: variant.sku ?? null,
      quality: String(variant.quality || "Tiêu chuẩn"),
      beadSize: variant.beadSize ?? null,
      price: Number(variant.price) || 0,
      originalPrice: variant.originalPrice == null ? null : Number(variant.originalPrice),
      stock: Number(variant.stock) || 0,
      sortOrder: Number(variant.sortOrder ?? index) || 0,
      imageUrls: Array.isArray(variant.imageUrls) ? variant.imageUrls : [],
      videoUrl: variant.videoUrl ?? null,
    })) : [],
  } as StoreProduct;
}

async function readFavorites() {
  let response: Response;
  try {
    response = await fetch("/api/account/favorites", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  } catch {
    // A single delayed retry smooths over a brief dropped connection without
    // creating a request loop when the API is actually unavailable.
    await new Promise((resolve) => setTimeout(resolve, 300));
    response = await fetch("/api/account/favorites", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  }
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Không tải được sản phẩm yêu thích.");
  const values = await response.json();
  return Array.isArray(values) ? values.map((item) => mapFavoriteProduct(item as Record<string, any>)) : [];
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<StoreProduct[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const current = await readFavorites();
        if (!alive) return;
        if (current === null) return;
        setFavorites(current);

        let pending: { productId?: string } | null = null;
        try { pending = JSON.parse(sessionStorage.getItem(PENDING_FAVORITE_KEY) || "null"); } catch { /* ignore malformed pending action */ }
        const productId = typeof pending?.productId === "string" ? pending.productId : "";
        if (productId && !current.some((product) => product.id === productId)) {
          const response = await fetch("/api/account/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId }),
          });
          if (response.status === 401) return;
          if (!response.ok) throw new Error("Không lưu được sản phẩm yêu thích sau khi đăng nhập.");
          const updated = await readFavorites();
          if (!alive) return;
          if (updated) setFavorites(updated);
        }
        if (productId) sessionStorage.removeItem(PENDING_FAVORITE_KEY);
      } catch {
        // Keep the page usable if the wishlist API is temporarily unavailable.
      } finally {
        if (alive) setReady(true);
      }
    };
    void load();
    return () => { alive = false; };
  }, []);

  const toggleFavorite = useCallback(async (product: StoreProduct) => {
    const saved = favorites.some((item) => item.id === product.id);
    const method = saved ? "DELETE" : "POST";
    const response = await fetch("/api/account/favorites", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id }),
    });
    if (response.status === 401) {
      sessionStorage.setItem(PENDING_FAVORITE_KEY, JSON.stringify({ productId: product.id }));
      const currentPage = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/dang-nhap?next=${encodeURIComponent(currentPage)}`);
      return;
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || "Không cập nhật được danh sách yêu thích.");
    }
    setFavorites((current) => saved
      ? current.filter((item) => item.id !== product.id)
      : current.some((item) => item.id === product.id) ? current : [product, ...current]);
  }, [favorites]);

  const favoriteIds = useMemo(() => new Set(favorites.map((product) => product.id)), [favorites]);
  const value = useMemo(() => ({ favorites, favoriteIds, ready, toggleFavorite }), [favorites, favoriteIds, ready, toggleFavorite]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const value = useContext(WishlistContext);
  if (!value) throw new Error("useWishlist phải nằm trong WishlistProvider.");
  return value;
}
