import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
    prisma.product.findMany({
      where: { kind: "OTHER" },
      select: {
        id: true, sku: true, name: true, status: true, price: true, stock: true, stockKg: true, sphereQuality: true,
        categoryId: true,
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { sortOrder: "asc" } },
        sphereItems: { select: { id: true, label: true, weightKg: true, price: true, imageUrls: true, status: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ sku: "asc" }],
    }),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const isVatPham = (product) => {
    let node = categoryById.get(product.categoryId);
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      if (node.name === "Vật Phẩm") return true;
      seen.add(node.id);
      node = node.parentId ? categoryById.get(node.parentId) : null;
    }
    return false;
  };
  const weighted = products.filter((product) => isVatPham(product) && product.sphereItems.length > 0).map((product) => {
    const available = product.sphereItems.filter((item) => item.status === "AVAILABLE");
    const missingPrice = available.filter((item) => Number(item.price) <= 0);
    const missingImage = available.filter((item) => !(item.imageUrls || []).length);
    const ready = available.length > 0 && Number(product.stock) === available.length && Number(product.stockKg) > 0
      && Math.abs(Number(product.stockKg) - available.reduce((sum, item) => sum + Number(item.weightKg), 0)) < 0.0005
      && missingPrice.length === 0 && missingImage.length === 0;
    const prices = available.map((item) => Number(item.price)).filter((price) => price > 0);
    return {
      id: product.id, sku: product.sku, name: product.name, category: product.category?.name || "", quality: product.sphereQuality || "",
      status: product.status, productPrice: Number(product.price) || 0, stock: Number(product.stock) || 0, stockKg: Number(product.stockKg) || 0,
      productGalleryImages: product.images.length,
      itemCount: product.sphereItems.length, availableItems: available.length, pricedAvailableItems: available.length - missingPrice.length,
      imagedAvailableItems: available.length - missingImage.length, minItemPrice: prices.length ? Math.min(...prices) : 0,
      missingPriceItems: missingPrice.map((item) => ({ id: item.id, label: item.label, kg: Number(item.weightKg) })),
      missingImageItems: missingImage.map((item) => ({ id: item.id, label: item.label, kg: Number(item.weightKg) })), ready,
    };
  });
  const report = {
    auditedAt: new Date().toISOString(),
    summary: {
      weightedVatPhamGroups: weighted.length,
      active: weighted.filter((row) => row.status === "ACTIVE").length,
      draft: weighted.filter((row) => row.status === "DRAFT").length,
      hidden: weighted.filter((row) => row.status === "HIDDEN").length,
      readyButNotActive: weighted.filter((row) => row.ready && row.status !== "ACTIVE").length,
      notReady: weighted.filter((row) => !row.ready).length,
      totalReadyAvailableItems: weighted.filter((row) => row.ready).reduce((sum, row) => sum + row.availableItems, 0),
    },
    groups: weighted,
  };
  const output = path.join("import-data", "weighted-vat-pham-publish-readiness-20261115.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report.summary, output, readyButNotActive: weighted.filter((row) => row.ready && row.status !== "ACTIVE").map(({ sku, name, category, quality, status, availableItems, minItemPrice }) => ({ sku, name, category, quality, status, availableItems, minItemPrice })), incomplete: weighted.filter((row) => !row.ready).map(({ sku, category, status, availableItems, missingPriceItems, missingImageItems }) => ({ sku, category, status, availableItems, missingPrices: missingPriceItems.length, missingImages: missingImageItems.length })) }));
} finally {
  await prisma.$disconnect();
}
