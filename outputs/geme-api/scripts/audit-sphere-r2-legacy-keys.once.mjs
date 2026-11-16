import { PrismaService } from "../dist/prisma/prisma.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";

const prisma = new PrismaService();
const storage = new MediaStorageService();
try {
  await prisma.$connect();
  const products = await prisma.product.findMany({
    where: { sku: { in: ["CAU-TAT5", "CAU-TAT4", "CAU-TAT3", "CAU-TAT1", "CAU-TATB"] } },
    select: { sku: true, images: { orderBy: { sortOrder: "asc" }, select: { url: true } } },
    orderBy: { sku: "asc" },
  });
  const rows = [];
  for (const product of products) for (const image of product.images) {
    let key = "";
    try { key = new URL(image.url).pathname.slice(1); } catch { /* report malformed URL */ }
    let r2Status = "NO_KEY";
    if (key) r2Status = (await storage.headPublicObject(key)).status;
    rows.push({ sku: product.sku, key, r2Status, url: image.url });
  }
  console.log(JSON.stringify({ rows }, null, 2));
} finally {
  await prisma.$disconnect();
}
