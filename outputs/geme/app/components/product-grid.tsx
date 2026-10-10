import { StoreProductGrid } from "./store-product-grid";
import type { StoreProduct, StorePromotion } from "../lib/store-api";

export function ProductGrid({ products, promotions, connected }: { products: StoreProduct[]; promotions?: StorePromotion[]; connected: boolean }) {
  return <StoreProductGrid products={products} promotions={promotions} connected={connected} emptyMessage="Chưa có sản phẩm mới." />;
}
