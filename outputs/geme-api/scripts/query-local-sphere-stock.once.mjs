import { PrismaService } from "../dist/prisma/prisma.service.js";
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const products = await prisma.product.findMany({
    where: { kind: "OTHER" },
    select: { sku: true, name: true, status: true, stockKg: true, category: { select: { name: true, slug: true } }, sphereStoneType: { select: { name: true, group: { select: { name: true } } } }, sphereQuality: true, sphereItems: { select: { label: true, weightKg: true, status: true } } },
    orderBy: { sku: "asc" },
  });
  const spheres = products.filter((product) => product.sphereItems.length || product.sphereStoneType || product.sphereQuality);
  console.log(JSON.stringify(spheres.map((product) => ({ sku: product.sku, name: product.name, category: product.category?.name, status: product.status, stockKg: product.stockKg, count: product.sphereItems.length, stoneGroup: product.sphereStoneType?.group.name, stoneType: product.sphereStoneType?.name, quality: product.sphereQuality, sqlIds: product.sphereItems.map((item) => item.label?.match(/SQL #(\d+)/)?.[1]).filter(Boolean), itemsWithoutSqlId: product.sphereItems.filter((item) => !item.label?.match(/SQL #(\d+)/)).length })), null, 2));
} finally { await prisma.$disconnect(); }
