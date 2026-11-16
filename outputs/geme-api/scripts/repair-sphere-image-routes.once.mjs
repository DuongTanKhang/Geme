/** Repairs broken public URLs for the legacy white-quartz sphere galleries. */
import fs from "node:fs";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { Pos365Service } from "../dist/pos365/pos365.service.js";
import { MediaAssetsService } from "../dist/media/media-assets.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";
import { LoyaltyService } from "../dist/loyalty/loyalty.service.js";

const allowedHosts = new Set(["127.0.0.1", "localhost", "host.docker.internal"]);
if (!allowedHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Only the local database is authorized");
process.env.POS365_ENABLED = "false";
const skus = ["CAU-TAT1", "CAU-TAT3", "CAU-TAT4", "CAU-TAT5", "CAU-TATB"];
const root = "import-data/ham-ech-tat5-20261114";
const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
try {
  await prisma.$connect();
  if (!storage.usesR2 || !storage.publicUrl("media/probe.jpg")) throw new Error("R2 is not configured");
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active admin audit actor found");
  const repaired = [];
  for (const sku of skus) {
    const product = await prisma.product.findUnique({ where: { sku }, include: { images: { orderBy: { sortOrder: "asc" } } } });
    if (!product) throw new Error(`Missing expected sphere SKU ${sku}`);
    const gallery = [];
    const mappings = [];
    for (const image of product.images) {
      const url = new URL(image.url);
      if (!url.pathname.startsWith("/legacy-product-images/")) {
        gallery.push(image.url);
        continue;
      }
      const filename = decodeURIComponent(url.pathname.split("/").at(-1) || "");
      if (!/^[A-Za-z0-9._-]+\.jpe?g$/i.test(filename)) throw new Error(`Unsafe legacy image name for ${sku}`);
      const objectKey = url.pathname.slice(1);
      const sourceCheck = await storage.headPublicObject(objectKey);
      if (sourceCheck.status !== 200) throw new Error(`Legacy R2 object missing for ${sku}: ${filename}`);
      const bytes = await storage.getPublicObject(objectKey);
      if (bytes.length < 256 || !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new Error(`Invalid JPEG in R2 for ${sku}: ${filename}`);
      const asset = await media.save({ filename, sourceKey: `legacy-sphere-gallery/${sku}/${filename}`, mimeType: "image/jpeg", bytes, alt: image.alt || product.name });
      if (asset.storageProvider !== "r2" || !asset.objectKey) throw new Error(`Image not saved to R2 for ${sku}: ${filename}`);
      const newUrl = asset.url;
      const publicCheck = await fetch(newUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      if (!publicCheck.ok || !publicCheck.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error(`New public image URL failed for ${sku}: ${filename} (${publicCheck.status})`);
      gallery.push(newUrl);
      mappings.push({ filename, from: image.url, to: newUrl });
    }
    if (mappings.length) await commerce.updateProductFieldsBySku(sku, { gallery }, { id: actor.id });
    repaired.push({ sku, totalImages: product.images.length, repairedImages: mappings.length, mappings });
  }

  const verified = [];
  for (const sku of skus) {
    const product = await prisma.product.findUnique({ where: { sku }, include: { images: { orderBy: { sortOrder: "asc" } } } });
    const checks = await Promise.all(product.images.map(async (image) => {
      const response = await fetch(image.url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      return response.ok && response.headers.get("content-type")?.startsWith("image/");
    }));
    if (!product.images.length || checks.some((ok) => !ok)) throw new Error(`Final image verification failed for ${sku}`);
    verified.push({ sku, images: product.images.length, validPublicImages: checks.filter(Boolean).length, status: product.status, price: product.price });
  }
  const report = { localOnly: true, stockChanged: false, priceChanged: false, posWrites: false, repaired, verified };
  fs.writeFileSync(`${root}/image-repair-report.json`, JSON.stringify(report, null, 2));
  console.log("SPHERE_IMAGE_REPAIR_RESULT " + JSON.stringify(report));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
