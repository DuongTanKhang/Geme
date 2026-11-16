import { PrismaService } from "../dist/prisma/prisma.service.js";

if (process.env.NODE_ENV !== "development") throw new Error("This one-time data adjustment is restricted to the local development container.");
const db = new PrismaService();
try {
  await db.$connect();
  const [categories, actor] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, parentId: true, kind: true, level: true } }),
    db.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  const root = categories.find((category) => category.name === "Vật Phẩm" && category.kind === "OTHER" && category.level === 1);
  if (!root) throw new Error("Vật Phẩm root category not found.");
  if (!actor) throw new Error("No active admin actor for audit log.");
  const byId = new Map(categories.map((category) => [category.id, category]));
  const belongsToVatPham = (categoryId) => {
    const seen = new Set();
    let category = byId.get(categoryId);
    while (category && !seen.has(category.id)) {
      if (category.id === root.id) return true;
      seen.add(category.id);
      category = category.parentId ? byId.get(category.parentId) : null;
    }
    return false;
  };
  const products = await db.product.findMany({
    where: { kind: "OTHER", sphereItems: { some: {} } },
    select: { id: true, sku: true, name: true, categoryId: true, price: true, sphereItems: { select: { id: true, status: true, price: true } } },
    orderBy: { sku: "asc" },
  });
  const weighted = products.filter((product) => belongsToVatPham(product.categoryId));
  const changes = weighted.filter((product) => Number(product.price) !== 0);
  const correlationId = `weighted-parent-price-zero-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  await db.$transaction(async (tx) => {
    for (const product of changes) {
      await tx.product.update({ where: { id: product.id }, data: { price: 0 } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        correlationId,
        action: "WEIGHT_ITEM_PARENT_PRICE_ZEROED",
        entityType: "PRODUCT",
        entityId: product.id,
        before: { sku: product.sku, price: Number(product.price) },
        after: { sku: product.sku, price: 0, itemPriceCount: product.sphereItems.filter((item) => Number(item.price) > 0).length },
      } });
    }
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
  const verify = await db.product.findMany({ where: { id: { in: weighted.map((product) => product.id) } }, select: { sku: true, price: true } });
  const nonZero = verify.filter((product) => Number(product.price) !== 0);
  if (nonZero.length) throw new Error(`Parent prices remain non-zero: ${nonZero.map((product) => product.sku).join(", ")}`);
  console.log(JSON.stringify({ localOnly: true, weightedVatPhamGroups: weighted.length, changedParentPrices: changes.length, alreadyZero: weighted.length - changes.length, remainingNonZero: nonZero.length, itemLevelPricesPreserved: true, posUpdated: false }));
} finally {
  await db.$disconnect();
}
