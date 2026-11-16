import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { Pos365Service } from "../dist/pos365/pos365.service.js";
import { MediaAssetsService } from "../dist/media/media-assets.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";
import { LoyaltyService } from "../dist/loyalty/loyalty.service.js";

const allowedDbHosts = new Set(["localhost", "127.0.0.1", "host.docker.internal", "sqlserver"]);
if (!allowedDbHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Only the local GEME database is authorized.");
process.env.POS365_ENABLED = "false";
const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));

function objectKeyFromUrl(value) {
  if (!process.env.MEDIA_PUBLIC_BASE_URL) return null;
  const base = process.env.MEDIA_PUBLIC_BASE_URL.trim().replace(/\/+$/, "");
  if (!value.startsWith(`${base}/`)) return null;
  return value.slice(base.length + 1).split("/").map((part) => decodeURIComponent(part)).join("/");
}

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error("R2 is not configured.");
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active local admin account found.");
  const products = await prisma.product.findMany({
    where: { images: { none: {} }, sphereItems: { some: { status: "AVAILABLE", imageUrls: { isEmpty: false } } } },
    include: { images: true, sphereItems: { where: { status: "AVAILABLE", imageUrls: { isEmpty: false } }, orderBy: { sortOrder: "asc" }, select: { id: true, weightKg: true, imageUrls: true } } },
    orderBy: { sku: "asc" },
  });
  const result = [];
  for (const product of products) {
    const item = product.sphereItems[0];
    const imageUrl = item?.imageUrls?.[0];
    if (!imageUrl) throw new Error(`No source image for ${product.sku}.`);
    const objectKey = objectKeyFromUrl(imageUrl);
    if (!objectKey) throw new Error(`Sphere image is not a direct public R2 URL for ${product.sku}.`);
    const response = await storage.headPublicObject(objectKey);
    if (response.status !== 200) throw new Error(`R2 HEAD ${response.status} for ${product.sku}.`);
    const saved = await commerce.updateProductFieldsBySku(product.sku, { gallery: [imageUrl] }, { id: actor.id });
    if (!saved.images.some((image) => image.url === imageUrl)) throw new Error(`Product cover verification failed for ${product.sku}.`);
    result.push({ sku: product.sku, name: product.name, sourceSphereItemId: item.id, weightKg: Number(item.weightKg), imageUrl, objectKey, r2Status: response.status, state: "COVER_ATTACHED" });
  }
  const report = { products: result.length, attached: result.length, details: result };
  fs.writeFileSync(path.join("import-data", "weight-item-product-cover-images-20261115.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ products: report.products, attached: report.attached, skus: result.map((row) => row.sku) }));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
