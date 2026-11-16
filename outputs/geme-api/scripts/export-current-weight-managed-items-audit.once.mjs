import { PrismaService } from "../dist/prisma/prisma.service.js";
import { writeFile } from "node:fs/promises";

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const products = await prisma.product.findMany({
    where: { kind: "OTHER", sphereItems: { some: {} } },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }, { sku: "asc" }],
    select: {
      id: true, sku: true, name: true, status: true, price: true, stockKg: true,
      sphereQuality: true,
      category: { select: { id: true, name: true, slug: true } },
      sphereStoneType: { select: { name: true, group: { select: { name: true } } } },
      images: { orderBy: [{ sortOrder: "asc" }, { isPrimary: "desc" }], select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
      sphereItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, receiptId: true, label: true, weightKg: true, status: true, sortOrder: true } },
    },
  });
  const output = products.map((product) => ({
    ...product,
    price: product.price == null ? null : Number(product.price),
    stockKg: Number(product.stockKg),
    sphereItems: product.sphereItems.map((item) => ({ ...item, weightKg: Number(item.weightKg) })),
  }));
  const outPath = new URL("../import-data/current-weight-managed-items-audit-20261115.json", import.meta.url);
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
  const counts = output.reduce((acc, product) => {
    const key = product.category?.name || "(no category)";
    acc[key] ||= { products: 0, physicalItems: 0, itemsWithSourceId: 0, images: 0, kg: 0 };
    acc[key].products += 1;
    acc[key].physicalItems += product.sphereItems.length;
    acc[key].itemsWithSourceId += product.sphereItems.filter((item) => /SQL #\d+/.test(item.label || "")).length;
    acc[key].images += product.images.length;
    acc[key].kg += product.sphereItems.filter((item) => item.status === "AVAILABLE").reduce((sum, item) => sum + item.weightKg, 0);
    return acc;
  }, {});
  console.log(JSON.stringify({ productGroups: output.length, physicalItems: output.reduce((sum, product) => sum + product.sphereItems.length, 0), categories: counts, output: "import-data/current-weight-managed-items-audit-20261115.json" }, null, 2));
} finally {
  await prisma.$disconnect();
}
