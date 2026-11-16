import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const root = "import-data";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "missing-catalog-image-manifest-20261115.json"), "utf8"));
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const productIds = manifest.products.map((row) => row.productId);
  const variantProductIds = [...new Set(manifest.variantGaps.map((row) => row.productId))];
  const [assets, variants, productLinks] = await Promise.all([
    prisma.mediaAsset.findMany({
      select: { id: true, filename: true, sourceKey: true, objectKey: true, storageProvider: true, isPrivate: true, alt: true },
    }),
    prisma.productPriceVariant.findMany({
      where: { productId: { in: variantProductIds } },
      select: { id: true, productId: true, sku: true, quality: true, shape: true, beadSize: true, imageUrls: true },
      orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.productMediaAsset.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, mediaAssetId: true, tag: true, approvedAt: true, mediaAsset: { select: { filename: true, sourceKey: true, objectKey: true, storageProvider: true, isPrivate: true, alt: true } } },
    }),
  ]);

  const exactSqlNames = new Set(manifest.products.flatMap((row) => row.sqlMatches.map((source) => source.image).filter(Boolean)));
  const candidates = [];
  for (const product of manifest.products) {
    const sku = product.sku.toLowerCase();
    const legacyIds = new Set(product.sqlMatches.map((row) => String(row.legacyId)));
    for (const asset of assets) {
      const fields = [asset.filename, asset.sourceKey, asset.alt].filter(Boolean).join(" ").toLowerCase();
      if (exactSqlNames.has(asset.filename) || fields.includes(sku) || [...legacyIds].some((id) => fields.includes(id))) {
        candidates.push({ sku: product.sku, asset });
      }
    }
  }
  const report = {
    mediaAssetCount: assets.length,
    exactSqlFilenameAssets: assets.filter((asset) => exactSqlNames.has(asset.filename)).map((asset) => ({ filename: asset.filename, id: asset.id, sourceKey: asset.sourceKey, objectKey: asset.objectKey, storageProvider: asset.storageProvider })),
    productSkuOrLegacyIdCandidates: candidates,
    productMediaAssetLinks: manifest.products.map((product) => ({ sku: product.sku, links: productLinks.filter((link) => link.productId === product.productId) })).filter((row) => row.links.length),
    variantDetails: manifest.variantGaps.map((gap) => ({ ...gap, variants: variants.filter((variant) => variant.productId === gap.productId && variant.sku === gap.variantSku) })),
    mediaAssetNameCandidates: manifest.products.map((product) => ({
      sku: product.sku,
      productName: product.name,
      candidates: assets.filter((asset) => asset.alt?.toLocaleLowerCase("vi").includes(product.name.toLocaleLowerCase("vi"))).map((asset) => ({ filename: asset.filename, id: asset.id, sourceKey: asset.sourceKey, alt: asset.alt })).slice(0, 12),
    })).filter((row) => row.candidates.length > 0),
  };
  fs.writeFileSync(path.join(root, "missing-catalog-media-source-audit-20261115.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mediaAssetCount: report.mediaAssetCount, exactSqlFilenameAssets: report.exactSqlFilenameAssets.length, skuOrIdCandidates: report.productSkuOrLegacyIdCandidates.length, variantGroups: report.variantDetails.length, groupsWithNameCandidates: report.mediaAssetNameCandidates.length }));
} finally {
  await prisma.$disconnect();
}
