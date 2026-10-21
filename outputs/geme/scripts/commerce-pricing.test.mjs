import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createProductStructuredData } from "../app/lib/product-schema.ts";
import { serializeJsonLd } from "../app/lib/seo.ts";
import { getStoreProductPrice } from "../app/lib/store-promotion.ts";

const oldSiteUrl = process.env.GEME_SITE_URL;
process.env.GEME_SITE_URL = "https://geme.vn";
after(() => {
  if (oldSiteUrl === undefined) delete process.env.GEME_SITE_URL;
  else process.env.GEME_SITE_URL = oldSiteUrl;
});

const product = {
  id: "product-1",
  sku: "NSSREM001",
  name: "Nhẫn Emerald",
  slug: "nhan-emerald",
  kind: "JEWELRY",
  categoryId: "rings",
  gemstoneTypeId: "emerald",
  status: "ACTIVE",
  isNew: false,
  isFeatured: false,
  price: 1_000_000,
  originalPrice: 1_200_000,
  stock: 2,
  images: [],
  variants: [],
  category: { id: "rings", name: "Nhẫn", pricingMode: "FIXED" },
};

const promotion = {
  id: "promo-1",
  value: 15,
  productIds: [product.id],
  categoryIds: [],
  excludedProductIds: [],
  excludedCategoryIds: [],
};

test("product display price and Product JSON-LD use the same active sale price", () => {
  const displayed = getStoreProductPrice(product, [promotion]);
  const schema = createProductStructuredData(product, [promotion]);
  const renderedJsonLd = JSON.parse(serializeJsonLd(schema));

  assert.equal(displayed.salePrice, 850_000);
  assert.equal(renderedJsonLd.offers.price, displayed.salePrice);
  assert.equal(displayed.originalPrice, 1_200_000);
});

test("carat-priced variant schema uses the same discounted price as product detail", () => {
  const gemstone = {
    ...product,
    id: "gem-1",
    sku: "GEM-1",
    slug: "opal-1-ct",
    kind: "GEMSTONE",
    categoryId: "opal-cut",
    gemstoneTypeId: "opal",
    price: 0,
    originalPrice: null,
    category: { id: "opal-cut", name: "Opal", pricingMode: "GEMSTONE_CARAT" },
    variants: [{ id: "v1", sku: "OPAL-125", quality: "Oval", carat: 1.25, price: 3_000_000, stock: 1, sortOrder: 0, imageUrls: [] }],
  };
  const stonePromotion = { ...promotion, productIds: [gemstone.id] };
  const displayed = getStoreProductPrice(gemstone, [stonePromotion], gemstone.variants[0]);
  const schema = createProductStructuredData(gemstone, [stonePromotion]);
  const aggregateOffer = schema.offers;
  const schemaOffer = aggregateOffer.price ? aggregateOffer : aggregateOffer.offers[0];

  assert.equal(displayed.salePrice, 3_187_500);
  assert.equal(schemaOffer.price, displayed.salePrice);
  assert.equal(schema.hasVariant[0].offers.price, displayed.salePrice);
});

test("sitemap includes current product and published article rows returned by the API", async () => {
  const oldApiUrl = process.env.GEME_API_BASE_URL;
  const oldFetch = globalThis.fetch;
  process.env.GEME_API_BASE_URL = "http://fixture.invalid/api/v1";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const rows = url.pathname.endsWith("/products")
      ? [{ slug: "nhan-emerald-moi", updatedAt: "2026-10-20T10:00:00.000Z" }]
      : [{ slug: "cach-chon-da-opal", publishedAt: "2026-10-19T10:00:00.000Z" }];
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const { default: buildSitemap } = await import("../app/sitemap.ts");
    const entries = await buildSitemap();
    const urls = entries.map((entry) => entry.url);
    assert.ok(urls.includes("https://geme.vn/san-pham/nhan-emerald-moi"));
    assert.ok(urls.includes("https://geme.vn/blog/cach-chon-da-opal"));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldApiUrl === undefined) delete process.env.GEME_API_BASE_URL;
    else process.env.GEME_API_BASE_URL = oldApiUrl;
  }
});
