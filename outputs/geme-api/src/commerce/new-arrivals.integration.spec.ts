import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { NewArrivalsService } from "./new-arrivals.service.js";

function isDedicatedLocalTestDatabase(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      && /(test|integration|ci)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "1" && isDedicatedLocalTestDatabase(process.env.DATABASE_URL);
let prisma: PrismaService | null = null;
let previousRecentDays: any = null;
let hadRecentDays = false;
const productIds: string[] = [];
const categoryIds: string[] = [];
const materialIds: string[] = [];
const groupIds: string[] = [];
const key = `new-arrivals-ci-${randomUUID()}`;

before(async () => {
  if (!enabled) return;
  prisma = new PrismaService();
  await prisma.$connect();
  const prior = await prisma.siteSetting.findUnique({ where: { key: "newArrivalsRecentDays" } });
  hadRecentDays = Boolean(prior);
  previousRecentDays = prior?.value;
  await prisma.siteSetting.upsert({ where: { key: "newArrivalsRecentDays" }, create: { key: "newArrivalsRecentDays", value: 30 }, update: { value: 30 } });
});

after(async () => {
  if (!prisma) return;
  const db = prisma;
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.materialOption.deleteMany({ where: { id: { in: materialIds } } });
  await db.category.deleteMany({ where: { id: { in: categoryIds } } });
  await db.jewelryStoneGroup.deleteMany({ where: { id: { in: groupIds } } });
  if (hadRecentDays) await db.siteSetting.update({ where: { key: "newArrivalsRecentDays" }, data: { value: previousRecentDays } });
  else await db.siteSetting.deleteMany({ where: { key: "newArrivalsRecentDays" } });
  await db.$disconnect();
});

test("New Arrivals catalog filters, resolves one canonical group, sorts, and paginates on PostgreSQL", { skip: !enabled }, async () => {
  if (!prisma) throw new Error("PostgreSQL integration service did not initialize.");
  const service = new NewArrivalsService(prisma);
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const daysAhead = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const suffix = randomUUID();
  const group = async (name: string, pinnedOrder: number | null, sortOrder: number) => {
    const created = await prisma!.jewelryStoneGroup.create({ data: { slug: `${name.toLowerCase()}-${suffix.slice(0, 8)}`, name, pinnedOrder, sortOrder } });
    groupIds.push(created.id);
    return created;
  };
  const emerald = await group("CI Emerald", 0, 80);
  const aquamarine = await group("CI Aquamarine", null, 1);
  await group("CI Sapphire Empty", null, 0);
  const jewelryRoot = await prisma.category.create({ data: { name: `CI Jewelry ${suffix}`, slug: `ci-jewelry-${suffix}`, kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 1, status: "ACTIVE" } });
  categoryIds.push(jewelryRoot.id);
  const gemstoneRoot = await prisma.category.create({ data: { name: `CI Gemstone ${suffix}`, slug: `ci-gemstone-${suffix}`, kind: "GEMSTONE", usage: "PRODUCT_CATEGORY", level: 1, status: "ACTIVE" } });
  categoryIds.push(gemstoneRoot.id);
  const emeraldType = await prisma.category.create({ data: { name: `CI Emerald Type ${suffix}`, slug: `ci-emerald-${suffix}`, kind: "GEMSTONE", usage: "GEMSTONE_TYPE", level: 2, parentId: gemstoneRoot.id, jewelryStoneGroupId: emerald.id, status: "ACTIVE" } });
  categoryIds.push(emeraldType.id);
  const aquamarineType = await prisma.category.create({ data: { name: `CI Aquamarine Type ${suffix}`, slug: `ci-aquamarine-${suffix}`, kind: "GEMSTONE", usage: "GEMSTONE_TYPE", level: 2, parentId: gemstoneRoot.id, jewelryStoneGroupId: aquamarine.id, status: "ACTIVE" } });
  categoryIds.push(aquamarineType.id);
  const hiddenCategory = await prisma.category.create({ data: { name: `CI Hidden ${suffix}`, slug: `ci-hidden-${suffix}`, kind: "JEWELRY", usage: "PRODUCT_CATEGORY", level: 2, parentId: jewelryRoot.id, status: "INACTIVE" } });
  categoryIds.push(hiddenCategory.id);
  const material = await prisma.materialOption.create({ data: { name: `CI Emerald Stone ${suffix}`, slug: `ci-emerald-material-${suffix}`, scope: "JEWELRY", kind: "STONE", jewelryStoneGroupId: emerald.id } });
  materialIds.push(material.id);

  const createProduct = async (label: string, options: {
    status?: "ACTIVE" | "HIDDEN" | "DRAFT";
    isNew?: boolean;
    newUntil?: Date | null;
    firstPublishedAt?: Date | null;
    categoryId?: string;
    gemstoneTypeId?: string;
    materialOptionId?: string;
    jewelryStoneGroupId?: string | null;
    price?: number;
    stock?: number;
  } = {}) => {
    const id = randomUUID();
    const product = await prisma!.product.create({ data: {
      id, sku: `NACI${id.replaceAll("-", "").slice(0, 12)}`, name: `${label} ${suffix.slice(0, 6)}`,
      slug: `na-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}`,
      kind: "JEWELRY", status: options.status || "ACTIVE", isNew: options.isNew || false,
      newUntil: options.newUntil, firstPublishedAt: options.firstPublishedAt,
      publicationHistoryKnown: true, categoryId: options.categoryId ?? jewelryRoot.id,
      gemstoneTypeId: options.gemstoneTypeId ?? emeraldType.id, materialOptionId: options.materialOptionId ?? material.id,
      jewelryStoneGroupId: options.jewelryStoneGroupId ?? null, price: options.price ?? 100_000,
      stock: options.stock ?? 1,
    } });
    productIds.push(product.id);
    return product;
  };

  const historicalIds = [];
  for (let index = 0; index < 41; index += 1) {
    const product = await createProduct(`Historic ${String(index).padStart(2, "0")}`, {
      isNew: true, firstPublishedAt: daysAgo(45 + index), price: 50_000 + index * 1_000,
      stock: index === 0 ? 0 : 1,
    });
    historicalIds.push(product.id);
  }
  await createProduct("Recent tag", { isNew: true, firstPublishedAt: daysAgo(2), price: 200_000 });
  await createProduct("Expired tag recent", { isNew: true, newUntil: daysAgo(1), firstPublishedAt: daysAgo(1), price: 210_000 });
  await createProduct("Recent published", { isNew: false, firstPublishedAt: daysAgo(1), gemstoneTypeId: aquamarineType.id, materialOptionId: null, price: 250_000 });
  await createProduct("Direct group override", { isNew: false, firstPublishedAt: daysAgo(1 / 24), gemstoneTypeId: emeraldType.id, materialOptionId: material.id, jewelryStoneGroupId: aquamarine.id, price: 300_000 });
  await createProduct("Mapping conflict", { isNew: false, firstPublishedAt: daysAgo(3), gemstoneTypeId: aquamarineType.id, materialOptionId: material.id, price: 350_000 });
  await createProduct("Future publish", { isNew: false, firstPublishedAt: daysAhead(2), price: 360_000 });
  await createProduct("Hidden recent", { status: "HIDDEN", isNew: true, firstPublishedAt: daysAgo(1) });
  await createProduct("Draft recent", { status: "DRAFT", isNew: true, firstPublishedAt: daysAgo(1) });
  await createProduct("Inactive category recent", { isNew: true, firstPublishedAt: daysAgo(1), categoryId: hiddenCategory.id });

  const all = await service.list({ mode: "all" });
  assert.equal(all.totalProducts, 42, "New Arrivals includes only products with a current New tag");
  assert.deepEqual(all.groups.map((item) => item.name), ["CI Emerald"]);
  assert.equal(all.groups[0].total, 42);
  assert.equal(all.groups[0].products.length, 8);
  assert.equal(all.groups[0].hasMore, true);
  assert.ok(all.groups[0].products[0].stock > 0, "buyable products sort before sold-out products");
  assert.equal(all.groups.find((item) => item.name === "CI Aquamarine")?.total, undefined, "recently published products without a New tag are excluded");
  assert.equal(all.groups.at(-1)?.name, "CI Emerald", "only explicitly tagged products appear, grouped by their mapped stone");
  assert.ok(!all.groups.some((item) => item.name === "CI Sapphire Empty"), "empty groups are omitted");

  const tagged = await service.list({ mode: "tagged" });
  assert.equal(tagged.totalProducts, 42, "the expired badge is excluded from tagged mode");
  const published = await service.list({ mode: "published" });
  assert.equal(published.totalProducts, 42, "legacy published mode cannot include products without a current New tag");
  const publishedProduct = published.groups.flatMap((item) => item.products).find((item: any) => String(item.name).startsWith("Recent published"));
  assert.equal(publishedProduct?.newLabelActive, false, "recent publication does not invent the New badge");

  const firstPage = await service.groupProducts(emerald.slug, { mode: "all", sort: "price_asc", page: 1 });
  const secondPage = await service.groupProducts(emerald.slug, { mode: "all", sort: "price_asc", page: 2 });
  assert.equal(firstPage.total, 42);
  assert.equal(firstPage.products.length, 40);
  assert.equal(secondPage.products.length, 2);
  const pagedIds = [...firstPage.products, ...secondPage.products].map((product: any) => product.id);
  assert.equal(new Set(pagedIds).size, 42, "stable page boundaries neither repeat nor omit the group products");
  const ascPrices = [...firstPage.products, ...secondPage.products].map((product: any) => Number(product.price));
  assert.deepEqual(ascPrices, [...ascPrices].sort((a, b) => a - b));

  const filtered = await service.list({ mode: "all", categoryId: jewelryRoot.id, stoneGroupId: emerald.id, search: "Historic 00", minPrice: 1, maxPrice: 100_000 });
  assert.equal(filtered.totalProducts, 1, "category descendant, canonical group, search, and listed-price filters compose");
  assert.equal(filtered.groups[0].products[0].id, historicalIds[0]);
});
