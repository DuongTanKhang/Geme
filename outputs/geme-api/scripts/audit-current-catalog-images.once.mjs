import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const products = await prisma.product.findMany({
    select: {
      id: true, sku: true, name: true, slug: true, kind: true, status: true, stock: true, stockKg: true, price: true,
      images: { select: { url: true, alt: true, sortOrder: true, isPrimary: true }, orderBy: { sortOrder: "asc" } },
      variants: { select: { sku: true, quality: true, shape: true, beadSize: true, imageUrls: true } },
      sphereItems: { select: { id: true, weightKg: true, imageUrls: true } },
    },
    orderBy: [{ sku: "asc" }],
  });
  const pinkSpheres = await prisma.product.findMany({
    where: { sku: { in: ["CAU-TAH1", "CAU-TAH3"] } },
    select: { sku: true, sphereItems: { select: { weightKg: true, imageUrls: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { sku: "asc" },
  });
  const audit = products.map((product) => {
    const variantsMissingImages = product.variants.filter((row) => !row.imageUrls?.length).map((row) => ({ sku: row.sku, quality: row.quality, shape: row.shape, beadSize: row.beadSize }));
    const sphereItemsMissingImages = product.sphereItems.filter((row) => !row.imageUrls?.length).map((row) => ({ id: row.id, weightKg: Number(row.weightKg) }));
    const anyImages = product.images.length > 0 || product.variants.some((row) => row.imageUrls?.length) || product.sphereItems.some((row) => row.imageUrls?.length);
    return {
      id: product.id, sku: product.sku, name: product.name, slug: product.slug, kind: product.kind, status: product.status,
      stock: product.stock, stockKg: Number(product.stockKg), price: Number(product.price || 0),
      productImages: product.images, variantCount: product.variants.length, variantsMissingImages,
      sphereItemsCount: product.sphereItems.length, sphereItemsMissingImages, anyImages,
    };
  });
  const missingAny = audit.filter((row) => !row.anyImages);
  const statusCounts = Object.fromEntries([...new Set(products.map((row) => row.status))].map((status) => [status, products.filter((row) => row.status === status).length]));
  const summary = {
    products: products.length,
    activeProducts: products.filter((row) => row.status === "ACTIVE").length,
    productsWithoutGallery: products.filter((row) => !row.images.length).length,
    variantsWithoutImages: audit.reduce((sum, row) => sum + row.variantsMissingImages.length, 0),
    sphereItemsWithoutImages: audit.reduce((sum, row) => sum + row.sphereItemsMissingImages.length, 0),
    productsWithoutAnyImages: missingAny.length,
    missingProductsByStatus: Object.fromEntries([...new Set(missingAny.map((row) => row.status))].map((status) => [status, missingAny.filter((row) => row.status === status).length])),
    productCountsByStatus: statusCounts,
  };
  const report = {
    auditedAt: new Date().toISOString(),
    summary,
    pinkQuartzSphereImages: pinkSpheres.map((product) => ({ sku: product.sku, itemCount: product.sphereItems.length, itemsWithImages: product.sphereItems.filter((item) => item.imageUrls.length > 0).length, items: product.sphereItems.map((item) => ({ weightKg: Number(item.weightKg), imageCount: item.imageUrls.length })) })),
    missing: audit.filter((row) => !row.anyImages || row.variantsMissingImages.length || row.sphereItemsMissingImages.length),
  };
  fs.writeFileSync(path.join("import-data", "current-catalog-image-audit-final-20261115.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...summary, pinkQuartzSphereImages: report.pinkQuartzSphereImages.map(({ sku, itemCount, itemsWithImages }) => ({ sku, itemCount, itemsWithImages })), unmatched: missingAny.map(({ sku, name, status }) => ({ sku, name, status })) }));
} finally {
  await prisma.$disconnect();
}
