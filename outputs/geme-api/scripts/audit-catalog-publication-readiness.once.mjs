import fs from "node:fs";
import path from "node:path";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const db = new PrismaService();
try {
  await db.$connect();
  const [categories, products] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, parentId: true, status: true, kind: true, level: true } }),
    db.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: {
        id: true, sku: true, name: true, kind: true, status: true, categoryId: true, gemstoneTypeId: true,
        materialOptionId: true, isPremiumGemstone: true, price: true, stock: true, stockKg: true, sphereQuality: true,
        category: { select: { name: true, slug: true, status: true } },
        materialOption: { select: { active: true } },
        images: { select: { url: true }, orderBy: { sortOrder: "asc" } },
        variants: { select: { sku: true, quality: true, price: true, stock: true, imageUrls: true, shape: true, beadSize: true } },
        sphereItems: { select: { label: true, weightKg: true, price: true, imageUrls: true, status: true } },
      },
      orderBy: [{ kind: "asc" }, { sku: "asc" }],
    }),
  ]);
  const byId = new Map(categories.map((row) => [row.id, row]));
  const pathFor = (id) => {
    const path = [];
    const seen = new Set();
    let row = byId.get(id);
    while (row && !seen.has(row.id)) {
      path.push(row);
      seen.add(row.id);
      row = row.parentId ? byId.get(row.parentId) : null;
    }
    return path;
  };
  const reportRows = products.map((product) => {
    const issues = [];
    const categoryPaths = [product.categoryId, product.gemstoneTypeId].filter(Boolean).map(pathFor);
    const categoryPath = [...new Map(categoryPaths.flat().map((row) => [row.id, row])).values()];
    if (categoryPath.some((row) => row.status !== "ACTIVE")) issues.push("Danh mục hoặc danh mục cha đang ẩn");
    if (product.materialOptionId && !product.materialOption?.active) issues.push("Loại đá/chất liệu đang ẩn");
    const availableSphere = product.sphereItems.filter((item) => item.status === "AVAILABLE");
    const usesSphereItems = availableSphere.length > 0 || product.sphereItems.length > 0;
    const imageCount = product.images.filter((row) => typeof row.url === "string" && row.url.trim()).length;
    if (usesSphereItems) {
      const kgSum = Math.round(availableSphere.reduce((sum, item) => sum + Number(item.weightKg || 0), 0) * 1000) / 1000;
      if (!availableSphere.length) issues.push("Không có món còn hàng");
      if (Number(product.stock) !== availableSphere.length || Math.abs(Number(product.stockKg || 0) - kgSum) >= 0.0005) issues.push("Tồn số lượng và kg không khớp từng món");
      if (availableSphere.some((item) => !(Number(item.weightKg) > 0))) issues.push("Có món chưa có kg hợp lệ");
      if (availableSphere.some((item) => !(Number(item.price) > 0))) issues.push("Có món chưa có giá");
      if (availableSphere.some((item) => !Array.isArray(item.imageUrls) || !item.imageUrls.some((url) => typeof url === "string" && url.trim()))) issues.push("Có món chưa có ảnh riêng");
    } else if (product.variants.length) {
      if (!product.variants.some((variant) => Number(variant.stock) > 0)) issues.push("Không có biến thể còn hàng");
      if (!product.isPremiumGemstone && product.variants.some((variant) => !(Number(variant.price) > 0))) issues.push("Có biến thể chưa có giá");
      if (!imageCount) issues.push("Chưa có ảnh sản phẩm để hiện ở danh sách web");
      if (product.category?.slug === "vong-kieng") {
        const qualities = new Set(product.variants.filter((variant) => Number(variant.stock) > 0).map((variant) => `${variant.shape || ""}::${variant.quality}`));
        for (const quality of qualities) {
          const grouped = product.variants.filter((variant) => `${variant.shape || ""}::${variant.quality}` === quality && Number(variant.stock) > 0);
          if (grouped.some((variant) => !Array.isArray(variant.imageUrls) || variant.imageUrls.length === 0) && !imageCount) issues.push("Có nhóm Kiềng chưa có ảnh");
        }
      }
    } else {
      if (!(Number(product.stock) > 0)) issues.push("Tồn kho bằng 0");
      if (!product.isPremiumGemstone && !(Number(product.price) > 0)) issues.push("Chưa có giá bán");
      if (!imageCount) issues.push("Chưa có ảnh sản phẩm");
    }
    return {
      id: product.id, sku: product.sku, name: product.name, kind: product.kind, status: product.status,
      category: product.category?.name || "", price: Number(product.price) || 0,
      variantCount: product.variants.length, pricedVariants: product.variants.filter((variant) => Number(variant.price) > 0).length,
      availableVariants: product.variants.filter((variant) => Number(variant.stock) > 0).length,
      sphereItemCount: availableSphere.length, itemCountWithPrice: availableSphere.filter((item) => Number(item.price) > 0).length,
      parentImages: imageCount, ready: issues.length === 0, issues,
    };
  });
  const statuses = Object.fromEntries(["ACTIVE", "DRAFT", "HIDDEN", "ARCHIVED"].map((status) => [status, products.filter((product) => product.status === status).length]));
  const kinds = Object.fromEntries(["JEWELRY", "GEMSTONE", "OTHER"].map((kind) => [kind, Object.fromEntries(["ACTIVE", "DRAFT", "HIDDEN"].map((status) => [status, products.filter((product) => product.kind === kind && product.status === status).length]))]));
  const summary = {
    auditedAt: new Date().toISOString(),
    totalProducts: products.length,
    statuses,
    kinds,
    readyDraft: reportRows.filter((row) => row.status === "DRAFT" && row.ready).length,
    notReadyDraft: reportRows.filter((row) => row.status === "DRAFT" && !row.ready).length,
    hiddenReady: reportRows.filter((row) => row.status === "HIDDEN" && row.ready).length,
    missingDraft: Object.fromEntries([...new Set(reportRows.flatMap((row) => row.issues))].map((issue) => [issue, reportRows.filter((row) => row.status === "DRAFT" && row.issues.includes(issue)).length])),
  };
  const output = path.join("import-data", "catalog-publication-readiness-20261115.json");
  fs.writeFileSync(output, JSON.stringify({ summary, products: reportRows }, null, 2));
  console.log(JSON.stringify({ ...summary, output, readyDraftProducts: reportRows.filter((row) => row.status === "DRAFT" && row.ready).map(({ sku, name, kind, category, price, variantCount, availableVariants, sphereItemCount }) => ({ sku, name, kind, category, price, variantCount, availableVariants, sphereItemCount })), notReadyDraftProducts: reportRows.filter((row) => row.status === "DRAFT" && !row.ready).map(({ sku, name, kind, category, issues }) => ({ sku, name, kind, category, issues })) }, null, 2));
} finally {
  await db.$disconnect();
}
