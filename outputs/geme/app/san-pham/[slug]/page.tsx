import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StructuredData } from "../../components/structured-data";
import { StoreProductDetail } from "../../components/store-product-detail";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getStoreFacets, getStoreProduct, getStorePromotions, getStoreRelatedProducts } from "../../lib/store-api";
import { absolutePublicImageUrl, absoluteSiteUrl, plainText } from "../../lib/seo";
import { createProductStructuredData } from "../../lib/product-schema";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { product } = await getStoreProduct(slug);
  if (!product) notFound();

  const title = plainText(product.seoTitle, 180) || `${plainText(product.name, 140)} | GEME`;
  const description = plainText(product.seoDescription || product.description || product.fullDescription, 320) || `Khám phá ${plainText(product.name, 120)} tại GEME.`;
  const canonical = `/san-pham/${encodeURIComponent(product.slug)}`;
  const image = absolutePublicImageUrl(product.images[0]?.url);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: { type: "website", siteName: "GEME", title, description, url: canonical, ...(image ? { images: [{ url: image, alt: product.images[0]?.alt || product.name }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}

function breadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absoluteSiteUrl(item.url) })) };
}

export default async function ProductPage({ params }: Props) {
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
  const productSchema = createProductStructuredData(product, promotions);
  const breadcrumbs = breadcrumbStructuredData([
    { name: "Trang chủ", url: "/" },
    { name: "Sản phẩm", url: "/san-pham" },
    ...categoryTrail.map((category) => ({ name: category.name, url: "/san-pham?danh-muc=" + encodeURIComponent(category.slug) })),
    { name: product.name, url: `/san-pham/${encodeURIComponent(product.slug)}` },
  ]);
  return <>
    {productSchema && <StructuredData value={productSchema} />}
    <StructuredData value={breadcrumbs} />
    <SiteHeader />
    <StoreProductDetail product={product} categoryTrail={categoryTrail} relatedProducts={relatedProducts} promotions={promotions} />
    <SiteFooter />
  </>;
}
