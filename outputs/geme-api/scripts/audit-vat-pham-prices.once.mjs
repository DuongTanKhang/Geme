import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const sourceRows = JSON.parse(fs.readFileSync(path.join("import-data", "vat-pham-legacy-price-sources-20261115.json"), "utf8"));
const weightRows = JSON.parse(fs.readFileSync(path.join("import-data", "weight-managed-item-source-audit-20261115.json"), "utf8"));
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const [categories, allProducts] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } }),
    prisma.product.findMany({
      where: { kind: "OTHER" },
      select: {
        id: true, sku: true, name: true, status: true, price: true, stock: true, stockKg: true, categoryId: true,
        category: { select: { id: true, name: true, slug: true, parentId: true } },
        variants: { select: { id: true, sku: true, quality: true, price: true, stock: true } },
        sphereItems: { select: { id: true, price: true, weightKg: true, status: true } },
      },
      orderBy: { sku: "asc" },
    }),
  ]);
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const categoryPath = (categoryId) => {
    const parts = [];
    let cursor = categoryById.get(categoryId);
    const visited = new Set();
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      parts.unshift(cursor);
      cursor = cursor.parentId ? categoryById.get(cursor.parentId) : null;
    }
    return parts;
  };
  const products = allProducts.filter((product) => categoryPath(product.categoryId).some((node) => node.slug === "vat-pham" || node.name === "Vật Phẩm"));
  const sourcesBySku = new Map();
  for (const row of sourceRows) {
    if (row.disposition !== "IN_GEME" || !row.gemeSku) continue;
    const current = sourcesBySku.get(row.gemeSku) || [];
    current.push(row);
    sourcesBySku.set(row.gemeSku, current);
  }
  const productPriceCandidates = [];
  const productPriceConflicts = [];
  const productsWithoutPositiveSource = [];
  const weighted = [];
  const productVariants = [];
  for (const product of products) {
    const source = sourcesBySku.get(product.sku) || [];
    const sourcePrices = [...new Set(source.map((row) => Number(row.price) || 0))].sort((a, b) => a - b);
    const currentPrice = Number(product.price) || 0;
    const hasWeightInventory = product.sphereItems.length > 0 || Number(product.stockKg) > 0;
    const detail = {
      productId: product.id, sku: product.sku, name: product.name, status: product.status,
      categoryPath: categoryPath(product.categoryId).map((node) => node.name),
      currentPrice, stock: product.stock, stockKg: Number(product.stockKg),
      sourceRows: source.map((row) => ({ legacyId: row.legacyId, name: row.name, legacySku: row.legacySku, price: Number(row.price) || 0, matchMethod: row.matchMethod, image: row.image })),
    };
    if (hasWeightInventory) {
      weighted.push({ ...detail, sphereItems: product.sphereItems.map((item) => ({ id: item.id, price: Number(item.price) || 0, weightKg: Number(item.weightKg), status: item.status })) });
    } else if (currentPrice <= 0) {
      if (source.length && source.every((row) => Number(row.price) > 0) && sourcePrices.length === 1) productPriceCandidates.push({ ...detail, proposedPrice: sourcePrices[0] });
      else if (source.length) productPriceConflicts.push({ ...detail, sourcePrices });
      else productsWithoutPositiveSource.push(detail);
    }
    for (const variant of product.variants) {
      const variantSource = sourceRows.filter((row) => row.disposition === "IN_GEME" && (row.gemeSku === variant.sku || row.legacySku === variant.sku));
      if (Number(variant.price) <= 0) productVariants.push({ productSku: product.sku, productName: product.name, variantId: variant.id, variantSku: variant.sku, quality: variant.quality, currentPrice: Number(variant.price) || 0, sourceRows: variantSource.map((row) => ({ legacyId: row.legacyId, name: row.name, price: Number(row.price) || 0, matchMethod: row.matchMethod })) });
    }
  }
  const weightPricesMissing = [];
  const weightedItemPriceMismatches = [];
  const weightedItemSummaries = new Map();
  for (const row of weightRows) {
    const sourcePrice = Number(row.legacySalePrice) || 0;
    const item = await prisma.productSphereItem.findUnique({ where: { id: row.itemId }, select: { id: true, price: true, weightKg: true, product: { select: { sku: true, name: true } } } });
    if (!item) continue;
    const currentPrice = Number(item.price) || 0;
    const skuSummary = weightedItemSummaries.get(item.product.sku) || { sku: item.product.sku, name: item.product.name, sourceRows: 0, sqlPricePositive: 0, priceMatched: 0, priceMissing: 0, priceDifferent: 0, productPrice: Number(products.find((product) => product.sku === item.product.sku)?.price) || 0 };
    skuSummary.sourceRows += 1;
    if (sourcePrice > 0) skuSummary.sqlPricePositive += 1;
    if (currentPrice > 0 && currentPrice === sourcePrice) skuSummary.priceMatched += 1;
    if (sourcePrice > 0 && currentPrice <= 0) skuSummary.priceMissing += 1;
    if (sourcePrice > 0 && currentPrice > 0 && currentPrice !== sourcePrice) skuSummary.priceDifferent += 1;
    weightedItemSummaries.set(item.product.sku, skuSummary);
    if (sourcePrice > 0 && currentPrice <= 0) weightPricesMissing.push({ itemId: item.id, sku: item.product.sku, name: item.product.name, legacyId: row.legacyId, legacyName: row.legacyName, weightKg: Number(item.weightKg), currentPrice, legacyPrice: sourcePrice });
    if (sourcePrice > 0 && currentPrice > 0 && currentPrice !== sourcePrice) weightedItemPriceMismatches.push({ itemId: item.id, sku: item.product.sku, name: item.product.name, legacyId: row.legacyId, legacyName: row.legacyName, weightKg: Number(item.weightKg), currentPrice, legacyPrice: sourcePrice });
  }
  const result = {
    auditedAt: new Date().toISOString(),
    summary: {
      legacyVatPhamRows: sourceRows.length,
      currentVatPhamProducts: products.length,
      productPricesMissingWithUniqueExactPrice: productPriceCandidates.length,
      productPricesMissingButSqlPricesConflict: productPriceConflicts.length,
      productPricesMissingWithoutMappedPositiveSqlPrice: productsWithoutPositiveSource.length,
      weightedInventoryProducts: weighted.length,
      weightedItemPricesMissingDespitePositiveSqlPrice: weightPricesMissing.length,
      weightedItemPricesDifferentFromSql: weightedItemPriceMismatches.length,
      variantPricesMissing: productVariants.length,
    },
    productPriceCandidates,
    productPriceConflicts,
    productsWithoutPositiveSource,
    weightedProducts: weighted,
    weightedItemPriceSummaryBySku: [...weightedItemSummaries.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    weightPricesMissing,
    weightedItemPriceMismatches,
    variantPricesMissing: productVariants,
  };
  fs.writeFileSync(path.join("import-data", "vat-pham-price-audit-20261115.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result.summary, productPriceCandidates: productPriceCandidates.map((row) => ({ sku: row.sku, name: row.name, currentPrice: row.currentPrice, proposedPrice: row.proposedPrice, sourceRows: row.sourceRows.length })), productPriceConflicts: productPriceConflicts.map((row) => ({ sku: row.sku, name: row.name, sourcePrices: row.sourcePrices })), weightPricesMissing: weightPricesMissing.map((row) => ({ sku: row.sku, legacyId: row.legacyId, weightKg: row.weightKg, legacyPrice: row.legacyPrice })) }));
} finally {
  await prisma.$disconnect();
}
