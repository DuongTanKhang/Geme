import type { StoreProduct, StorePromotion } from "./store-api.ts";
import { absolutePublicImageUrl, absoluteSiteUrl, plainText } from "./seo.ts";
import { getStoreProductPrice } from "./store-promotion.ts";

export function createProductStructuredData(product: StoreProduct | null | undefined, promotions: StorePromotion[] = []) {
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
  const variantOffers = product.variants
    .map((variant) => {
      const price = getStoreProductPrice(product, promotions, variant).salePrice;
      const name = [variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality].filter(Boolean).join(" · ");
      return price > 0 ? offerFor(price, variant.stock, name || undefined, variant.sku) : null;
    })
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null);
  const productPrice = getStoreProductPrice(product, promotions).salePrice;
  const pricedOffers = variantOffers.length ? variantOffers : productPrice > 0 ? [offerFor(productPrice, product.stock)] : [];
  const prices = pricedOffers.map((offer) => Number(offer.price));
  const offers = pricedOffers.length > 1
    ? { "@type": "AggregateOffer", priceCurrency: "VND", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: pricedOffers.length, offers: pricedOffers }
    : pricedOffers[0];
  const variants = product.variants.filter((variant) => variant.price > 0).map((variant) => {
    const name = [variant.quality, variant.beadSize, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality].filter(Boolean).join(" · ");
    const price = getStoreProductPrice(product, promotions, variant).salePrice;
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
