import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { Pos365Service } from "../dist/pos365/pos365.service.js";
import { MediaAssetsService } from "../dist/media/media-assets.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";
import { LoyaltyService } from "../dist/loyalty/loyalty.service.js";

const root = "import-data";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "missing-catalog-image-manifest-20261115.json"), "utf8"));
const plan = manifest.exactSourcePlan;
const imageRoot = path.join(root, "missing-catalog-images-20261115");
if (plan.productImages.length !== 15 || plan.variantImages.length !== 6) throw new Error("Expected 15 exact product and 6 exact variant mappings.");
const allowedDbHosts = new Set(["localhost", "127.0.0.1", "host.docker.internal", "sqlserver"]);
if (!allowedDbHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Only the local GEME database is authorized.");
process.env.POS365_ENABLED = "false";

const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
const imageType = (bytes) => {
  if (bytes.length < 256) return null;
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
};

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error("R2 is not configured.");
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active local admin account found.");

  const productSkus = plan.productImages.map((row) => row.sku);
  const products = await prisma.product.findMany({ where: { sku: { in: productSkus } }, include: { images: true } });
  if (products.length !== productSkus.length) throw new Error(`Expected ${productSkus.length} products, found ${products.length}.`);
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const variantSkus = plan.variantImages.map((row) => row.variantSku);
  const variants = await prisma.productPriceVariant.findMany({ where: { sku: { in: variantSkus } } });
  if (variants.length !== variantSkus.length) throw new Error(`Expected ${variantSkus.length} variants, found ${variants.length}.`);
  const variantBySku = new Map(variants.map((variant) => [variant.sku, variant]));

  const details = [];
  for (const row of plan.productImages) {
    const product = productBySku.get(row.sku);
    const bytes = fs.readFileSync(path.join(imageRoot, row.image));
    const mimeType = imageType(bytes);
    if (!mimeType) throw new Error(`Invalid image bytes for ${row.image}.`);
    const asset = await media.save({
      filename: row.image,
      sourceKey: `legacy-sql/catalog/${row.legacyId}/${row.image}`,
      mimeType,
      bytes,
      alt: product.name,
    });
    if (asset.storageProvider !== "r2" || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verification failed for ${row.sku}.`);
    const gallery = [...new Set([...product.images.map((image) => image.url), asset.url])];
    if (gallery.length !== product.images.length) {
      const saved = await commerce.updateProductFieldsBySku(row.sku, { gallery }, { id: actor.id });
      if (!saved.images.some((image) => image.url === asset.url)) throw new Error(`Product gallery link verification failed for ${row.sku}.`);
    }
    details.push({ targetType: "PRODUCT", sku: row.sku, legacyId: row.legacyId, sourceName: row.name, image: row.image, assetId: asset.id, objectKey: asset.objectKey, url: asset.url, state: "ATTACHED" });
  }

  for (const row of plan.variantImages) {
    const variant = variantBySku.get(row.variantSku);
    if (variant.productId !== row.productId || variant.quality !== row.quality || variant.shape !== row.shape || Number(variant.beadSize) !== row.sizeMm) throw new Error(`Variant source metadata mismatch for ${row.variantSku}.`);
    const product = productBySku.get(row.productSku) || await prisma.product.findUniqueOrThrow({ where: { id: row.productId }, select: { name: true } });
    const bytes = fs.readFileSync(path.join(imageRoot, row.image));
    const mimeType = imageType(bytes);
    if (!mimeType) throw new Error(`Invalid image bytes for ${row.image}.`);
    const asset = await media.save({
      filename: row.image,
      sourceKey: `legacy-sql/variant/${row.legacyId}/${row.image}`,
      mimeType,
      bytes,
      alt: `${product.name} · ${row.quality} · ${row.shape === "OVAL" ? "Oval" : "Tròn"} · ${row.sizeMm} mm`,
    });
    if (asset.storageProvider !== "r2" || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verification failed for ${row.variantSku}.`);
    const imageUrls = [...new Set([...variant.imageUrls, asset.url])];
    if (imageUrls.length !== variant.imageUrls.length) {
      await prisma.productPriceVariant.update({ where: { id: variant.id }, data: { imageUrls } });
    }
    const verified = await prisma.productPriceVariant.findUniqueOrThrow({ where: { id: variant.id }, select: { sku: true, imageUrls: true } });
    if (!verified.imageUrls.includes(asset.url)) throw new Error(`Variant image link verification failed for ${row.variantSku}.`);
    details.push({ targetType: "VARIANT", sku: row.variantSku, productSku: row.productSku, legacyId: row.legacyId, sourceName: row.name, image: row.image, assetId: asset.id, objectKey: asset.objectKey, url: asset.url, state: "ATTACHED" });
  }

  const missingImages = [];
  for (const item of plan.productImages) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: item.sku }, include: { images: true } });
    if (!product.images.length) missingImages.push(item.sku);
  }
  for (const item of plan.variantImages) {
    const variant = await prisma.productPriceVariant.findUniqueOrThrow({ where: { sku: item.variantSku } });
    if (!variant.imageUrls.length) missingImages.push(item.variantSku);
  }
  const result = { products: plan.productImages.length, variants: plan.variantImages.length, attached: details.length, missingImages, details };
  fs.writeFileSync(path.join(root, "missing-catalog-image-attachment-result-20261115.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ products: result.products, variants: result.variants, attached: result.attached, missingImages: result.missingImages }));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
