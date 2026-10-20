import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StructuredData } from "../../components/structured-data";
import { StoreProductDetail } from "../../components/store-product-detail";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getStoreFacets, getStoreProduct, getStorePromotions, getStoreRelatedProducts } from "../../lib/store-api";
import { absolutePublicImageUrl, absoluteSiteUrl, plainText } from "../../lib/seo";

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

function productStructuredData(product: Awaited<ReturnType<typeof getStoreProduct>>["product"]) {
  if (!product) return null;
  const url = absoluteSiteUrl(`/san-pham/${encodeURIComponent(product.slug)}`);
  const images = product.images.map((image) => absolutePublicImageUrl(image.url)).filter((image): image is string => Boolean(image));
  const offerFor = (price: number, stock: number, name?: string, sku?: string | null) => ({
    "@type": "Offer",
    url,
    priceCurrency: "VND",
    price: Math.round(price),
    availability: stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@id": `${absoluteSiteUrl("/")}#organization` },
    ...(name ? { name } : {}),
    ...(sku ? { itemOffered: { "@type": "Product", name: `${product.name} — ${name || sku}`, sku } } : {}),
  });
  const caratPricing = product.kind === "GEMSTONE" && ["GEMSTONE_CARAT", "GEMSTONE_CARAT_AND_QUALITY"].includes(product.category?.pricingMode || "");
  const variantOffers = product.variants
    .map((variant) => {
      const price = variant.price * (caratPricing ? Number(variant.carat || 0) : 1);
      const name = [variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality].filter(Boolean).join(" · ");
      return price > 0 ? offerFor(price, variant.stock, name || undefined, variant.sku) : null;
    })
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null);
  const pricedOffers = variantOffers.length ? variantOffers : product.price > 0 ? [offerFor(product.price, product.stock)] : [];
  const prices = pricedOffers.map((offer) => Number(offer.price));
  const offers = pricedOffers.length > 1
    ? { "@type": "AggregateOffer", priceCurrency: "VND", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: pricedOffers.length, offers: pricedOffers }
    : pricedOffers[0];
  const variants = product.variants.filter((variant) => variant.price > 0).map((variant) => {
    const name = [variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality].filter(Boolean).join(" · ");
    const price = variant.price * (caratPricing ? Number(variant.carat || 0) : 1);
    const variantImages = variant.imageUrls.map(absolutePublicImageUrl).filter((image): image is string => Boolean(image));
    return { "@type": "Product", name: name ? `${product.name} — ${name}` : product.name, sku: variant.sku || undefined, ...(variantImages.length ? { image: variantImages } : {}), offers: offerFor(price, variant.stock, name || undefined) };
  });

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    url,
    ...(images.length ? { image: images } : {}),
    ...(plainText(product.description || product.fullDescription, 1000) ? { description: plainText(product.description || product.fullDescription, 1000) } : {}),
    brand: { "@type": "Brand", name: "GEME" },
    ...(product.category?.name ? { category: product.category.name } : {}),
    ...(product.materialOption?.kind === "MATERIAL" ? { material: product.materialOption.name } : {}),
    ...(product.gemstoneType?.name ? { additionalProperty: { "@type": "PropertyValue", name: "Loại đá", value: product.gemstoneType.name } } : {}),
    ...(offers ? { offers } : {}),
    ...(variants.length ? { hasVariant: variants } : {}),
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
  const productSchema = productStructuredData(product);
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
