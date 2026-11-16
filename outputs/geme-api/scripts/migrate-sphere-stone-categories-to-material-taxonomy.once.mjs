/**
 * Moves the former sphere-stone navigation categories into the dedicated
 * Vật phẩm stone taxonomy.  It is intentionally guarded because Categories
 * describe storefront navigation, while SphereStoneGroup/SphereStoneType
 * describe SKU and inventory hierarchy.
 *
 * Default: preflight only (no writes).
 * Execute: pnpm exec tsx scripts/migrate-sphere-stone-categories-to-material-taxonomy.once.mjs --execute
 */
import "dotenv/config";
import { PrismaService } from "../src/prisma/prisma.service.ts";

const execute = process.argv.includes("--execute");
const prisma = new PrismaService();

const asSlug = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/đ/g, "d")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 140);

try {
  await prisma.$connect();

  const sphereRoot = await prisma.category.findFirst({
    where: { kind: "OTHER", name: "Quả cầu" },
    select: { id: true, name: true },
  });
  if (!sphereRoot) throw new Error("Không tìm thấy danh mục Vật phẩm → Quả cầu.");

  const legacyGroups = await prisma.category.findMany({
    where: { parentId: sphereRoot.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, slug: true, sortOrder: true,
      children: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, sortOrder: true, _count: { select: { products: true, gemstoneProducts: true, promotionTargets: true } } } },
      _count: { select: { products: true, gemstoneProducts: true, promotionTargets: true } },
    },
  });
  // The migration may be checked again after a successful run.  In that case
  // there are no legacy navigation rows left under Quả cầu, while the new
  // material taxonomy already exists.  Treat that as an idempotent success
  // instead of reporting a misleading migration failure.
  if (!legacyGroups.length) {
    const migratedGroups = await prisma.sphereStoneGroup.count();
    if (migratedGroups > 0) {
      console.log("SPHERE_STONE_CATEGORY_MIGRATION_ALREADY_COMPLETE " + JSON.stringify({ migratedGroups, remainingLegacyRows: 0 }));
      process.exit(0);
    }
    throw new Error("Quả cầu chưa có danh mục đá cũ để chuyển.");
  }

  const legacyRows = legacyGroups.flatMap((group) => [group, ...group.children]);
  const blockers = legacyRows.filter((row) => row._count && (row._count.products || row._count.gemstoneProducts || row._count.promotionTargets));
  if (blockers.length) {
    throw new Error(`Dừng chuyển: ${blockers.map((row) => `${row.name} (sản phẩm/đá gắn/khuyến mãi: ${row._count.products}/${row._count.gemstoneProducts}/${row._count.promotionTargets})`).join(", ")}`);
  }

  const plan = legacyGroups.map((group) => ({
    group: group.name,
    children: group.children.map((child) => child.name),
  }));
  console.log("SPHERE_STONE_CATEGORY_MIGRATION_PLAN " + JSON.stringify({ execute, sourceGroups: plan, deleteLegacyCategoryRows: legacyRows.length }));
  if (!execute) process.exit(0);

  await prisma.$transaction(async (tx) => {
    for (const legacyGroup of legacyGroups) {
      const group = await tx.sphereStoneGroup.upsert({
        where: { slug: asSlug(legacyGroup.name) },
        create: { name: legacyGroup.name, slug: asSlug(legacyGroup.name), sortOrder: legacyGroup.sortOrder, isActive: true },
        update: { name: legacyGroup.name, sortOrder: legacyGroup.sortOrder, isActive: true },
      });
      for (const legacyType of legacyGroup.children) {
        await tx.sphereStoneType.upsert({
          where: { groupId_slug: { groupId: group.id, slug: asSlug(legacyType.name) } },
          create: { groupId: group.id, name: legacyType.name, slug: asSlug(legacyType.name), sortOrder: legacyType.sortOrder, isActive: true },
          update: { name: legacyType.name, sortOrder: legacyType.sortOrder, isActive: true },
        });
      }
    }
    // The leaf rows are deleted before their parents.  The preflight above
    // guarantees they do not own products, gemstone mappings or promotions.
    for (const legacyGroup of legacyGroups) {
      if (legacyGroup.children.length) {
        await tx.category.deleteMany({ where: { id: { in: legacyGroup.children.map((row) => row.id) } } });
      }
    }
    await tx.category.deleteMany({ where: { id: { in: legacyGroups.map((row) => row.id) } } });
  });

  const groups = await prisma.sphereStoneGroup.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, stoneTypes: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } } },
  });
  const remainingLegacyRows = await prisma.category.count({ where: { parentId: sphereRoot.id } });
  console.log("SPHERE_STONE_CATEGORY_MIGRATION_COMPLETE " + JSON.stringify({ groups, remainingLegacyRows }));
} finally {
  await prisma.$disconnect();
}
