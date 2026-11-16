import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/app.module.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const db = app.get(PrismaService);
const commerce = app.get(CommerceService);
try {
  const [categories, actor, products] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, parentId: true, kind: true, level: true, status: true } }),
    db.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    db.product.findMany({
      where: { kind: "OTHER", sphereItems: { some: { status: "AVAILABLE" } } },
      include: { category: { select: { id: true } }, sphereItems: { select: { label: true, weightKg: true, price: true, imageUrls: true, status: true } } },
      orderBy: { sku: "asc" },
    }),
  ]);
  if (!actor) throw new Error("No active admin actor for audit log.");
  const root = categories.find((category) => category.name === "Vật Phẩm" && category.kind === "OTHER" && category.level === 1);
  if (!root) throw new Error("Vật Phẩm root category not found.");
  const byId = new Map(categories.map((category) => [category.id, category]));
  const categoryPath = (categoryId) => {
    const path = [];
    const seen = new Set();
    let category = byId.get(categoryId);
    while (category && !seen.has(category.id)) {
      path.push(category);
      seen.add(category.id);
      if (!category.parentId) break;
      category = byId.get(category.parentId);
    }
    return path;
  };
  const inVatPham = (product) => categoryPath(product.categoryId).some((category) => category.id === root.id);
  const categoryPathIsActive = (product) => categoryPath(product.categoryId).every((category) => category.status === "ACTIVE");
  const weighted = products.filter((product) => inVatPham(product));
  const ready = weighted.filter((product) => {
    const items = product.sphereItems.filter((item) => item.status === "AVAILABLE");
    const totalKg = Math.round(items.reduce((sum, item) => sum + Number(item.weightKg || 0), 0) * 1000) / 1000;
    return categoryPathIsActive(product)
      && items.length > 0
      && Number(product.stock) === items.length
      && Math.abs(Number(product.stockKg || 0) - totalKg) < 0.0005
      && items.every((item) => Number(item.weightKg) > 0 && Number(item.price) > 0 && Array.isArray(item.imageUrls) && item.imageUrls.length > 0);
  });
  const drafts = ready.filter((product) => product.status === "DRAFT");
  const correlationId = `weighted-vat-pham-publish-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const activated = [];
  for (const product of drafts) {
    const saved = await commerce.updateProductPublication(product.id, "ACTIVE", { id: actor.id, correlationId }, "Đăng bán: đã xác nhận ảnh, giá từng món và tồn kg khớp.");
    activated.push({ sku: product.sku, name: product.name, availableItems: product.sphereItems.filter((item) => item.status === "AVAILABLE").length, status: saved.status });
  }
  console.log(JSON.stringify({ localOnly: true, weightedVatPhamGroups: weighted.length, readyGroups: ready.length, activated: activated.length, skippedNotReadyOrInactiveCategory: weighted.length - ready.length, products: activated }, null, 2));
} finally {
  await app.close();
}
