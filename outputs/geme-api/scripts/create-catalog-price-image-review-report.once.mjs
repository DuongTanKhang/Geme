import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const dataDir = path.join("import-data");
const priceSourceRows = JSON.parse(fs.readFileSync(path.join(dataDir, "vat-pham-legacy-price-sources-20261115.json"), "utf8"));
const weightRows = JSON.parse(fs.readFileSync(path.join(dataDir, "weight-managed-item-source-audit-20261115.json"), "utf8"));
const reconciliationText = fs.readFileSync(path.join(dataDir, "product-source-reconciliation-20261115", "all-legacy-products-reconciled.csv"), "utf8").replace(/^\uFEFF/, "");
const prisma = new PrismaService();

const n = (value) => Number(value) || 0;
const money = (value) => Math.round(n(value));
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
};
const sourceByLegacyId = new Map(priceSourceRows.map((row) => [String(row.legacyId), row]));
const currentReconciliationRows = parseCsv(reconciliationText).filter((row) => row.legacyCategory === "Vật Phẩm");
const legacyRows = currentReconciliationRows.map((row) => {
  const priceSource = sourceByLegacyId.get(String(row.legacyId)) || {};
  return { ...priceSource, ...row, price: priceSource.price ?? 0, image: priceSource.image || "" };
});

try {
  await prisma.$connect();
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } }),
    prisma.product.findMany({
      select: {
        id: true, sku: true, name: true, slug: true, kind: true, status: true, price: true, stock: true, stockKg: true, categoryId: true,
        images: { select: { url: true, isPrimary: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
        variants: { select: { id: true, sku: true, quality: true, shape: true, beadSize: true, price: true, imageUrls: true } },
        sphereItems: { select: { id: true, label: true, weightKg: true, price: true, status: true, imageUrls: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ sku: "asc" }],
    }),
  ]);

  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const pathFor = (categoryId) => {
    const result = [];
    const seen = new Set();
    let current = categoryById.get(categoryId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      result.unshift(current.name);
      current = current.parentId ? categoryById.get(current.parentId) : null;
    }
    return result;
  };
  const categoryPaths = new Map(products.map((product) => [product.id, pathFor(product.categoryId)]));
  const isVatPham = (product) => categoryPaths.get(product.id)?.some((name) => name === "Vật Phẩm") || false;
  const vatPhamProducts = products.filter(isVatPham);

  const legacyBySku = new Map();
  const legacyByLegacySku = new Map();
  for (const row of legacyRows) {
    if (row.disposition !== "IN_GEME" || !row.gemeSku) continue;
    const list = legacyBySku.get(row.gemeSku) || [];
    list.push(row);
    legacyBySku.set(row.gemeSku, list);
    const legacySkuList = legacyByLegacySku.get(row.legacySku) || [];
    legacySkuList.push(row);
    legacyByLegacySku.set(row.legacySku, legacySkuList);
  }
  const legacyByItem = new Map(weightRows.map((row) => [row.itemId, row]));
  const weightByLegacyId = new Map(weightRows.map((row) => [String(row.legacyId), row]));
  const vatPhamSkuSet = new Set(vatPhamProducts.map((product) => product.sku));
  const vatPhamVariantSkuSet = new Set(vatPhamProducts.flatMap((product) => product.variants.map((variant) => variant.sku).filter(Boolean)));

  const missingImages = [];
  const missingPrices = [];
  const allMissingPriceRows = [];
  const priceDataGaps = [];
  const priceReconciliation = { exactItemComparisons: 0, itemPriceMatches: 0, itemPriceMismatches: [], positiveLegacyItemPricesMissingInGeme: [], legacyItemsWithoutPrice: [], productPriceExactMatches: 0, productPriceMismatches: [], productPriceCandidates: [], ambiguousProductPrices: [] };
  const itemPriceChecks = new Map();
  const productSummary = [];

  for (const product of products) {
    const categoryPath = categoryPaths.get(product.id) || [];
    const allImages = [
      ...product.images.map((row) => row.url),
      ...product.variants.flatMap((row) => row.imageUrls || []),
      ...product.sphereItems.flatMap((row) => row.imageUrls || []),
    ].filter(Boolean);
    const missingVariantImages = product.variants.filter((row) => !(row.imageUrls || []).length).map((row) => ({ sku: row.sku, quality: row.quality, shape: row.shape, size: row.beadSize }));
    const missingItemImages = product.sphereItems.filter((row) => !(row.imageUrls || []).length).map((row) => ({ itemId: row.id, label: row.label, weightKg: n(row.weightKg) }));
    if (!allImages.length || missingVariantImages.length || missingItemImages.length) {
      missingImages.push({ productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, hasProductGallery: product.images.length > 0, missingVariantImages, missingWeightedItems: missingItemImages });
    }

    const legacyForProduct = isVatPham(product) ? (legacyBySku.get(product.sku) || []) : [];
    let hasEffectivePrice = false;
    const missingRowsForProduct = [];
    if (product.sphereItems.length) {
      for (const item of product.sphereItems) {
        const currentPrice = money(item.price);
        if (currentPrice > 0) hasEffectivePrice = true;
        const source = legacyByItem.get(item.id);
        if (source) {
          const oldPrice = money(source.legacySalePrice);
          itemPriceChecks.set(item.id, { currentPrice, oldPrice });
          priceReconciliation.exactItemComparisons += 1;
          if (oldPrice > 0 && currentPrice === oldPrice) priceReconciliation.itemPriceMatches += 1;
          else if (oldPrice > 0 && currentPrice <= 0) priceReconciliation.positiveLegacyItemPricesMissingInGeme.push({ productSku: product.sku, productName: product.name, itemId: item.id, legacyId: source.legacyId, legacyName: source.legacyName, weightKg: n(item.weightKg), legacyPrice: oldPrice, currentPrice });
          else if (oldPrice > 0 && currentPrice !== oldPrice) priceReconciliation.itemPriceMismatches.push({ productSku: product.sku, productName: product.name, itemId: item.id, legacyId: source.legacyId, legacyName: source.legacyName, weightKg: n(item.weightKg), legacyPrice: oldPrice, currentPrice });
          else if (oldPrice <= 0 && currentPrice <= 0) priceReconciliation.legacyItemsWithoutPrice.push({ productSku: product.sku, productName: product.name, itemId: item.id, legacyId: source.legacyId, legacyName: source.legacyName, weightKg: n(item.weightKg), currentPrice });
        }
        if (currentPrice <= 0) {
          const row = { productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, unitType: "weighted-item", itemId: item.id, itemLabel: item.label || "", weightKg: n(item.weightKg), stockStatus: item.status, currentPrice, sqlLegacyId: source?.legacyId || "", sqlName: source?.legacyName || "", sqlPrice: source ? money(source.legacySalePrice) : null };
          missingRowsForProduct.push(row);
          allMissingPriceRows.push(row);
          if (isVatPham(product)) missingPrices.push(row);
        }
      }
    } else if (product.variants.length) {
      for (const variant of product.variants) {
        const currentPrice = money(variant.price);
        if (currentPrice > 0) hasEffectivePrice = true;
        const candidates = isVatPham(product) ? [...new Map([...(legacyBySku.get(variant.sku) || []), ...(legacyByLegacySku.get(variant.sku) || [])].map((row) => [row.legacyId, row])).values()] : [];
        const candidatePrices = [...new Set(candidates.map((row) => money(row.price)).filter((price) => price > 0))];
        if (isVatPham(product) && candidatePrices.length === 1 && currentPrice > 0) {
          if (currentPrice === candidatePrices[0]) priceReconciliation.productPriceExactMatches += 1;
          else priceReconciliation.productPriceMismatches.push({ productSku: product.sku, productName: product.name, variantSku: variant.sku || "", quality: variant.quality || "", currentPrice, legacyPrice: candidatePrices[0], legacyIds: candidates.map((row) => row.legacyId) });
        }
        if (currentPrice <= 0) {
          const row = { productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, unitType: "variant", variantId: variant.id, variantSku: variant.sku || "", quality: variant.quality || "", size: variant.beadSize || "", currentPrice, sqlLegacyIds: candidates.map((candidate) => candidate.legacyId), sqlPrices: candidatePrices };
          missingRowsForProduct.push(row);
          allMissingPriceRows.push(row);
          if (isVatPham(product)) missingPrices.push(row);
          if (isVatPham(product) && candidatePrices.length === 1) priceReconciliation.productPriceCandidates.push({ ...row, proposedPrice: candidatePrices[0] });
          if (isVatPham(product) && candidatePrices.length > 1) priceReconciliation.ambiguousProductPrices.push(row);
        }
      }
    } else {
      const currentPrice = money(product.price);
      hasEffectivePrice = currentPrice > 0;
      const candidatePrices = [...new Set(legacyForProduct.map((row) => money(row.price)).filter((price) => price > 0))];
      if (isVatPham(product) && candidatePrices.length === 1 && currentPrice > 0) {
        if (currentPrice === candidatePrices[0]) priceReconciliation.productPriceExactMatches += 1;
        else priceReconciliation.productPriceMismatches.push({ productSku: product.sku, productName: product.name, currentPrice, legacyPrice: candidatePrices[0], legacyIds: legacyForProduct.map((row) => row.legacyId) });
      }
      if (currentPrice <= 0) {
        const row = { productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, unitType: "product", currentPrice, sqlLegacyIds: legacyForProduct.map((candidate) => candidate.legacyId), sqlPrices: candidatePrices };
        missingRowsForProduct.push(row);
        allMissingPriceRows.push(row);
        if (isVatPham(product)) missingPrices.push(row);
        if (isVatPham(product) && candidatePrices.length === 1) priceReconciliation.productPriceCandidates.push({ ...row, proposedPrice: candidatePrices[0] });
        if (isVatPham(product) && candidatePrices.length > 1) priceReconciliation.ambiguousProductPrices.push(row);
      }
    }

    if (!hasEffectivePrice) {
      const row = { productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, priceField: product.sphereItems.length ? "sphere item" : product.variants.length ? "variant" : "product", currentProductPrice: money(product.price), missingPriceRows: missingRowsForProduct };
      priceDataGaps.push(row);
    }
    productSummary.push({ productId: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status, categoryPath, productPrice: money(product.price), variants: product.variants.length, weightedItems: product.sphereItems.length, hasEffectivePrice, hasAnyImage: allImages.length > 0 });
  }

  for (const source of weightRows) {
    if (money(source.legacySalePrice) <= 0) continue;
    if (!legacyByItem.has(source.itemId)) continue;
  }

  const inGemeRows = legacyRows.filter((row) => row.disposition === "IN_GEME");
  const legacyRowsWithPrice = inGemeRows.filter((row) => money(row.price) > 0).length;
  const legacyRowsWithoutPrice = inGemeRows.filter((row) => money(row.price) <= 0).map((row) => ({ legacyId: row.legacyId, name: row.name, legacySku: row.legacySku, gemeSku: row.gemeSku, matchMethod: row.matchMethod }));
  const legacyDispositionSummary = ["IN_GEME", "NOTE", "UNACCOUNTED"].map((disposition) => {
    const rows = legacyRows.filter((row) => row.disposition === disposition);
    return { disposition, rows: rows.length, rowsWithPositivePrice: rows.filter((row) => money(row.price) > 0).length, rowsWithoutPositivePrice: rows.filter((row) => money(row.price) <= 0).length };
  });
  const legacyRowsWithoutCurrentTarget = legacyRows.filter((row) => {
    const itemSource = weightByLegacyId.get(String(row.legacyId));
    if (itemSource && itemPriceChecks.has(itemSource.itemId)) return false;
    if (row.disposition === "IN_GEME" && ((row.gemeSku && vatPhamSkuSet.has(row.gemeSku)) || (row.gemeSku && vatPhamVariantSkuSet.has(row.gemeSku)))) return false;
    return true;
  }).map((row) => ({ legacyId: row.legacyId, name: row.name, legacySku: row.legacySku, disposition: row.disposition, matchMethod: row.matchMethod, gemeSku: row.gemeSku, sqlPrice: money(row.price), image: row.image }));
  const positivePriceRowsWithoutCurrentTarget = legacyRowsWithoutCurrentTarget.filter((row) => row.sqlPrice > 0);
  const rowsMarkedOutsideGemeButFoundByExactLiveItem = legacyRows.filter((row) => row.disposition !== "IN_GEME" && (() => {
    const itemSource = weightByLegacyId.get(String(row.legacyId));
    return Boolean(itemSource && itemPriceChecks.has(itemSource.itemId));
  })()).map((row) => ({ legacyId: row.legacyId, name: row.name, disposition: row.disposition, gemeSku: weightByLegacyId.get(String(row.legacyId))?.sku || "", sqlPrice: money(row.price), itemId: weightByLegacyId.get(String(row.legacyId))?.itemId || "" }));
  const weightedItemPriceSummaryByCategory = Object.entries(weightRows.reduce((groups, source) => {
    const category = source.category || "Chưa phân loại";
    const group = groups[category] || { category, items: 0, positiveSqlPrices: 0, exactMatches: 0, positiveSqlMissingInGeme: 0, mismatches: 0, missingInBoth: 0 };
    group.items += 1;
    const check = itemPriceChecks.get(source.itemId);
    const oldPrice = money(source.legacySalePrice);
    if (oldPrice > 0) group.positiveSqlPrices += 1;
    if (!check) {
      if (oldPrice > 0) group.positiveSqlMissingInGeme += 1;
      groups[category] = group;
      return groups;
    }
    if (oldPrice > 0 && check.currentPrice === oldPrice) group.exactMatches += 1;
    else if (oldPrice > 0 && check.currentPrice <= 0) group.positiveSqlMissingInGeme += 1;
    else if (oldPrice > 0 && check.currentPrice !== oldPrice) group.mismatches += 1;
    else if (oldPrice <= 0 && check.currentPrice <= 0) group.missingInBoth += 1;
    groups[category] = group;
    return groups;
  }, {})).map(([, value]) => value).sort((a, b) => a.category.localeCompare(b.category, "vi"));
  const summary = {
    currentCatalogProducts: products.length,
    currentVatPhamProducts: vatPhamProducts.length,
    productsMissingAllImages: missingImages.filter((row) => !row.hasProductGallery && !row.missingVariantImages.length && !row.missingWeightedItems.length).length,
    missingVariantImages: missingImages.reduce((sum, row) => sum + row.missingVariantImages.length, 0),
    missingWeightedItemImages: missingImages.reduce((sum, row) => sum + row.missingWeightedItems.length, 0),
    vatPhamProductsMissingAnyImage: missingImages.filter((row) => row.kind === "OTHER" || row.categoryPath.includes("Vật Phẩm")).length,
    productsWithoutAnyEffectivePrice: priceDataGaps.length,
    vatPhamMissingPriceRows: missingPrices.length,
    legacyVatPhamRows: legacyRows.length,
    legacyVatPhamInGemeRows: inGemeRows.length,
    legacyVatPhamInGemeRowsWithPositivePrice: legacyRowsWithPrice,
    legacyVatPhamInGemeRowsWithoutPrice: legacyRowsWithoutPrice.length,
    legacyRowsWithoutCurrentTarget: legacyRowsWithoutCurrentTarget.length,
    positiveLegacyPriceRowsWithoutCurrentTarget: positivePriceRowsWithoutCurrentTarget.length,
    rowsMarkedOutsideGemeButFoundByExactLiveItem: rowsMarkedOutsideGemeButFoundByExactLiveItem.length,
    weightedItemPriceComparisons: priceReconciliation.exactItemComparisons,
    weightedItemPriceExactMatches: priceReconciliation.itemPriceMatches,
    positiveLegacyWeightedPricesMissingInGeme: priceReconciliation.positiveLegacyItemPricesMissingInGeme.length,
    weightedItemPriceMismatches: priceReconciliation.itemPriceMismatches.length,
    weightedItemsWithoutPriceInSqlAndGeme: priceReconciliation.legacyItemsWithoutPrice.length,
    productPriceCandidatesToFill: priceReconciliation.productPriceCandidates.length,
    productPriceExactMatches: priceReconciliation.productPriceExactMatches,
    productPriceMismatches: priceReconciliation.productPriceMismatches.length,
    ambiguousProductPriceGaps: priceReconciliation.ambiguousProductPrices.length,
  };

  const report = {
    auditedAt: new Date().toISOString(),
    scope: "Live local GEME catalog; legacy SQL price source for Vật Phẩm; product images include product gallery, variant images, and weighted-item images.",
    summary,
    legacyVatPhamPriceAudit: { rows: legacyRows.length, currentReconciliation: legacyDispositionSummary, inGemeRows: inGemeRows.length, rowsWithPositivePrice: legacyRowsWithPrice, rowsWithoutPrice: legacyRowsWithoutPrice, rowsWithoutCurrentTarget: legacyRowsWithoutCurrentTarget, positivePriceRowsWithoutCurrentTarget, rowsMarkedOutsideGemeButFoundByExactLiveItem },
    weightedItemPriceReconciliation: priceReconciliation,
    weightedItemPriceSummaryByCategory,
    missingImages,
    allMissingPriceRows,
    missingPriceRows: missingPrices,
    productsWithoutAnyEffectivePrice: priceDataGaps,
    catalog: productSummary,
  };
  const reportPath = path.join(dataDir, "catalog-price-image-manual-review-20261115.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const csvRows = [];
  for (const row of missingImages) csvRows.push({ issue: "MISSING_IMAGE", sku: row.sku, name: row.name, kind: row.kind, status: row.status, category: row.categoryPath.join(" / "), unit: "product", weightKg: "", currentPrice: "", sqlPrice: "", sourceId: "", note: row.hasProductGallery ? "Variant/item image gap" : "No image in product, variant, or weighted-item records" });
  for (const row of allMissingPriceRows) {
    const isVatPhamRow = isVatPham(products.find((product) => product.id === row.productId));
    const issue = isVatPhamRow && row.sqlPrice === 0 ? "SQL_AND_GEME_PRICE_MISSING" : isVatPhamRow ? "MISSING_PRICE_VAT_PHAM" : "MISSING_PRICE";
    csvRows.push({ issue, sku: row.sku, name: row.name, kind: row.kind, status: row.status, category: row.categoryPath.join(" / "), unit: row.unitType, weightKg: row.weightKg ?? "", currentPrice: row.currentPrice, sqlPrice: row.sqlPrice ?? row.sqlPrices?.join(" | ") ?? "", sourceId: row.sqlLegacyId ?? row.sqlLegacyIds?.join(" | ") ?? "", note: row.itemId ? `Item ${row.itemId}; ${row.sqlName || ""}` : row.quality || "" });
  }
  const headers = ["issue", "sku", "name", "kind", "status", "category", "unit", "weightKg", "currentPrice", "sqlPrice", "sourceId", "note"];
  const esc = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers.join(","), ...csvRows.map((row) => headers.map((key) => esc(row[key])).join(","))].join("\r\n");
  const csvPath = path.join(dataDir, "catalog-price-image-manual-review-20261115.csv");
  fs.writeFileSync(csvPath, `\uFEFF${csv}`);
  const legacyAuditPath = path.join(dataDir, "vat-pham-legacy-unmatched-price-rows-20261115.csv");
  const legacyHeaders = ["legacyId", "name", "legacySku", "disposition", "matchMethod", "gemeSku", "sqlPrice", "image"];
  const legacyCsv = [legacyHeaders.join(","), ...positivePriceRowsWithoutCurrentTarget.map((row) => legacyHeaders.map((key) => esc(row[key])).join(","))].join("\r\n");
  fs.writeFileSync(legacyAuditPath, `\uFEFF${legacyCsv}`);
  console.log(JSON.stringify({ ...summary, reportPath, csvPath, legacyAuditPath, legacyDispositionSummary, positivePriceRowsWithoutCurrentTarget: positivePriceRowsWithoutCurrentTarget.length, missingImageSkus: missingImages.filter((row) => !row.hasProductGallery && !row.missingVariantImages.length && !row.missingWeightedItems.length).map((row) => row.sku), missingPriceRows: missingPrices, noPriceBothSqlAndGeme: priceReconciliation.legacyItemsWithoutPrice }));
} finally {
  await prisma.$disconnect();
}
