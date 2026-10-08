import { notFound } from "next/navigation";
import { StoreProductDetail } from "../../components/store-product-detail";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getStoreFacets, getStoreProduct, getStorePromotions, getStoreRelatedProducts } from "../../lib/store-api";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { product } = await getStoreProduct(slug);
  if (!product) notFound();
  const [{ products: relatedProducts }, { categories }, { promotions }] = await Promise.all([
    getStoreRelatedProducts(slug),
    getStoreFacets(),
    getStorePromotions(),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryTrail = [];
  let currentCategory = product.categoryId ? categoryById.get(product.categoryId) : undefined;
  while (currentCategory) {
    categoryTrail.unshift(currentCategory);
    currentCategory = currentCategory.parentId ? categoryById.get(currentCategory.parentId) : undefined;
  }
  return <>
    <SiteHeader />
    <StoreProductDetail product={product} categoryTrail={categoryTrail} relatedProducts={relatedProducts} promotions={promotions} />
    <SiteFooter />
  </>;
}
