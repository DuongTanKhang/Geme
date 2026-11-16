import fs from "node:fs";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { MediaAssetsService } from "../dist/media/media-assets.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";

const sourcePath = "import-data/weight-managed-item-source-audit-20261115.json";
const downloadedRoot = "import-data/weight-managed-item-missing-legacy-images";
const outputPath = "import-data/weight-managed-item-reconciliation-result-20261115.json";
const rows = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!["host.docker.internal", "localhost", "127.0.0.1", "geme-db"].includes(databaseUrl.hostname)) {
  throw new Error("Refusing to change a non-local database.");
}
if (!Array.isArray(rows) || rows.length !== 521 || new Set(rows.map((row) => row.itemId)).size !== rows.length) {
  throw new Error("Source audit must contain the 521 unique physical item rows.");
}
const prisma = new PrismaService();
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const roundKg = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const result = { sourceRows: rows.length, pricesApplied: 0, missingPrice: [], existingR2Images: 0, uploadedR2Images: 0, missingImages: [], productStockSynced: 0, products: 0 };

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error("Local API is not configured to store public media in R2.");

  const filenames = [...new Set(rows.map((row) => row.legacyImage).filter(Boolean))];
  const existingAssets = await prisma.mediaAsset.findMany({
    where: { filename: { in: filenames }, isPrivate: false },
    select: { id: true, filename: true, sourceKey: true, storageProvider: true, objectKey: true, bucketName: true },
  });
  const assetsByFilename = new Map();
  for (const asset of existingAssets) {
    if (asset.storageProvider !== "r2" || !asset.objectKey) continue;
    const list = assetsByFilename.get(asset.filename.toLowerCase()) || [];
    list.push(asset);
    assetsByFilename.set(asset.filename.toLowerCase(), list);
  }

  const assetBySourceRow = new Map();
  for (const row of rows) {
    const filename = String(row.legacyImage || "");
    if (!filename) continue;
    let asset = assetsByFilename.get(filename.toLowerCase())?.[0];
    if (!asset) {
      const filePath = downloadedRoot + "/" + filename;
      if (!fs.existsSync(filePath)) continue;
      const bytes = fs.readFileSync(filePath);
      if (bytes.length < 256 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new Error("Downloaded file is not a valid JPEG: " + filename);
      }
      const saved = await media.save({
        filename,
        sourceKey: "legacy-weight-items/" + row.legacyId + "/" + filename,
        mimeType: "image/jpeg",
        bytes,
        alt: row.legacyName || row.productName || row.sku,
      });
      if (saved.storageProvider !== "r2" || !saved.objectKey || (await storage.headPublicObject(saved.objectKey)).status !== 200) {
        throw new Error("R2 verification failed for legacy item " + row.legacyId + " (" + filename + ").");
      }
      asset = { id: saved.id, filename: saved.filename, sourceKey: saved.sourceKey, storageProvider: saved.storageProvider, objectKey: saved.objectKey, bucketName: saved.bucketName };
      assetsByFilename.set(filename.toLowerCase(), [asset]);
      result.uploadedR2Images += 1;
    } else result.existingR2Images += 1;
    const url = storage.publicUrl(asset.objectKey) || "/media/" + asset.id;
    assetBySourceRow.set(row.itemId, { url, filename, objectKey: asset.objectKey });
  }

  const productIds = [...new Set(rows.map((row) => row.productId))];
  const actualItems = await prisma.productSphereItem.findMany({
    where: { id: { in: rows.map((row) => row.itemId) } },
    select: { id: true, productId: true, weightKg: true, status: true },
  });
  const actualById = new Map(actualItems.map((item) => [item.id, item]));
  const mismatches = rows.filter((row) => {
    const item = actualById.get(row.itemId);
    return !item || item.productId !== row.productId || Math.abs(Number(item.weightKg) - Number(row.weightKg)) > 0.0005;
  });
  if (mismatches.length) throw new Error("Legacy ID / product / kg verification failed for " + mismatches.length + " rows.");

  result.products = productIds.length;
  result.missingImages = rows.filter((row) => !assetBySourceRow.has(row.itemId)).map((row) => ({ itemId: row.itemId, legacyId: row.legacyId, sku: row.sku, filename: row.legacyImage }));
  result.missingPrice = rows.filter((row) => {
    const price = row.legacySalePrice == null || row.legacySalePrice === "" ? null : Number(row.legacySalePrice);
    return price == null || !Number.isSafeInteger(price) || price <= 0;
  }).map((row) => ({ itemId: row.itemId, legacyId: row.legacyId, sku: row.sku, legacyName: row.legacyName, price: row.legacySalePrice ?? null }));

  await prisma.$transaction(async (tx) => {
    const locked = await tx.productSphereItem.findMany({
      where: { id: { in: rows.map((row) => row.itemId) } },
      select: { id: true, productId: true, weightKg: true, status: true },
    });
    const currentById = new Map(locked.map((item) => [item.id, item]));
    for (const row of rows) {
      const current = currentById.get(row.itemId);
      if (!current || current.productId !== row.productId || Math.abs(Number(current.weightKg) - Number(row.weightKg)) > 0.0005) {
        throw new Error("Stock changed before reconciliation for legacy item " + row.legacyId + ".");
      }
      const rawPrice = row.legacySalePrice == null || row.legacySalePrice === "" ? null : Number(row.legacySalePrice);
      const price = rawPrice != null && Number.isSafeInteger(rawPrice) && rawPrice > 0 ? rawPrice : null;
      const image = assetBySourceRow.get(row.itemId);
      await tx.productSphereItem.update({ where: { id: row.itemId }, data: { price, imageUrls: image ? [image.url] : [] } });
      if (price) result.pricesApplied += 1;
    }

    const currentProducts = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, stock: true, stockKg: true, soldOutAt: true },
    });
    for (const product of currentProducts) {
      const available = locked.filter((item) => item.productId === product.id && item.status === "AVAILABLE");
      const itemCount = available.length;
      const weightKg = roundKg(available.reduce((sum, item) => sum + Number(item.weightKg), 0));
      await tx.product.update({
        where: { id: product.id },
        data: { stock: itemCount, stockKg: weightKg, soldOutAt: itemCount > 0 && weightKg > 0 ? null : product.soldOutAt || new Date() },
      });
      result.productStockSynced += 1;
    }
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });

  const verifyProducts = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, stock: true, stockKg: true, sphereItems: { where: { status: "AVAILABLE" }, select: { weightKg: true } } },
  });
  result.stockMismatches = verifyProducts.filter((product) => product.stock !== product.sphereItems.length
    || Math.abs(Number(product.stockKg) - roundKg(product.sphereItems.reduce((sum, item) => sum + Number(item.weightKg), 0))) > 0.0005)
    .map((product) => ({ sku: product.sku, count: product.stock, availableItems: product.sphereItems.length, stockKg: Number(product.stockKg), itemKg: roundKg(product.sphereItems.reduce((sum, item) => sum + Number(item.weightKg), 0)) }));
  result.availableItems = verifyProducts.reduce((sum, product) => sum + product.sphereItems.length, 0);
  result.availableKg = roundKg(verifyProducts.reduce((sum, product) => sum + product.sphereItems.reduce((total, item) => total + Number(item.weightKg), 0), 0));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  media.onModuleDestroy();
  await prisma.$disconnect();
}
