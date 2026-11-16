import { PrismaService } from "../dist/prisma/prisma.service.js";

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const products = await prisma.product.findMany({
    where: { kind: "OTHER", category: { slug: "qua-cau" } },
    select: { sku: true, name: true, status: true, stockKg: true, sphereItems: { where: { status: "AVAILABLE" }, select: { id: true, weightKg: true } }, sphereStoneType: { select: { name: true, group: { select: { name: true } } } }, images: { orderBy: { sortOrder: "asc" }, select: { url: true } } },
    orderBy: { sku: "asc" },
  });
  const rows = [];
  for (const product of products) {
    if (!product.images.length) rows.push({ sku: product.sku, state: "NO_IMAGE" });
    for (const image of product.images) {
      try {
        const response = await fetch(image.url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
        rows.push({ sku: product.sku, state: response.ok ? "OK" : `HTTP_${response.status}`, type: response.headers.get("content-type"), url: image.url });
      } catch (error) {
        rows.push({ sku: product.sku, state: error?.cause?.code || error?.name || "FETCH_ERROR", type: "", url: image.url });
      }
    }
  }
  console.log(JSON.stringify({ productsChecked: products.length, imagesChecked: rows.length, broken: rows.filter((row) => row.state !== "OK"), products: products.map(({ sku, name, status, stockKg, sphereItems, sphereStoneType, images }) => ({ sku, name, status, stockKg, availableBalls: sphereItems.length, availableBallKg: Number(sphereItems.reduce((sum, item) => sum + Number(item.weightKg), 0).toFixed(3)), stoneGroup: sphereStoneType?.group.name, stoneType: sphereStoneType?.name, imageCount: images.length })) }, null, 2));
} finally {
  await prisma.$disconnect();
}
