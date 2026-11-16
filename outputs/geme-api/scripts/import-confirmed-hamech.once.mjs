/** Local only. Imports SQL-confirmed Hàm Ếch Thạch Anh Tím 5A inventory and images. */
import fs from "node:fs";
import { PrismaService } from "../dist/prisma/prisma.service.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { Pos365Service } from "../dist/pos365/pos365.service.js";
import { MediaAssetsService } from "../dist/media/media-assets.service.js";
import { MediaStorageService } from "../dist/media/media-storage.service.js";
import { LoyaltyService } from "../dist/loyalty/loyalty.service.js";
import { usesPhysicalItemInventory } from "../dist/commerce/physical-item-inventory.js";

const root = "import-data/ham-ech-tat5-20261114";
const plan = JSON.parse(fs.readFileSync(`${root}/plan.json`, "utf8"));
const sku = "CAU-HC-TAT05";
const localHosts = new Set(["host.docker.internal", "127.0.0.1", "localhost"]);
if (!localHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Only the local database is authorized");
process.env.POS365_ENABLED = "false";

const weightUnits = (rows) => rows.reduce((sum, row) => sum + Math.round(Number(row.weightKg) * 1000), 0);
if (plan.sku !== "HC-TAT05" || plan.quality !== "5A" || plan.stoneGroup !== "Thạch Anh" || plan.stoneType !== "Thạch Anh Hàm Ếch Tím") throw new Error("Plan mapping is unexpected");
if (plan.rows.length !== 33 || new Set(plan.rows.map((row) => row.legacyId)).size !== 33 || new Set(plan.rows.map((row) => row.image)).size !== 33 || weightUnits(plan.rows) !== 84705) throw new Error("Expected 33 unique rows and 84.705 kg");
for (const row of plan.rows) {
  if (!/^[A-Za-z0-9._-]+\.jpe?g$/i.test(row.image) || !fs.existsSync(`${root}/images/${row.image}`)) throw new Error(`Missing/unsafe image for SQL #${row.legacyId}`);
  if (Math.round(Number(row.weightKg) * 1000) <= 0) throw new Error(`Invalid weight for SQL #${row.legacyId}`);
}

const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
const readProduct = () => prisma.product.findUnique({
  where: { sku },
  include: { category: true, sphereItems: true, images: true, sphereStoneType: { include: { group: true } } },
});

try {
  await prisma.$connect();
  if (!storage.usesR2 || !storage.publicUrl("media/probe.jpg")) throw new Error("R2 is not configured");
  const category = await prisma.category.findUnique({ where: { slug: "qua-cau" } });
  if (!category || category.kind !== "OTHER" || category.status !== "ACTIVE") throw new Error("Active Quả cầu category not found");
  const type = await prisma.sphereStoneType.findFirst({ where: { name: plan.stoneType, group: { name: plan.stoneGroup } }, include: { group: true } });
  if (!type) throw new Error("Existing Thạch Anh Hàm Ếch Tím stone type not found");
  if (!usesPhysicalItemInventory({ sku })) throw new Error("SKU is not configured for physical-item kg inventory");
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active admin audit actor found");

  let product = await readProduct();
  const priorReceipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, include: { items: true } });
  if (product || priorReceipt) {
    if (!product || !priorReceipt || priorReceipt.items.length !== 1 || priorReceipt.status !== "COMPLETED") throw new Error("Partial or conflicting prior import; refusing to re-add stock");
    const itemRows = product.sphereItems;
    if (product.categoryId !== category.id || product.sphereStoneTypeId !== type.id || product.sphereQuality !== "5A" || Math.round(Number(product.stockKg) * 1000) !== 84705 || itemRows.length !== 33 || weightUnits(itemRows) !== 84705) throw new Error("Existing SKU does not match the expected Hàm Ếch batch");
    for (const row of plan.rows) if (!itemRows.some((item) => item.label?.endsWith(`SQL #${row.legacyId}`) && Math.round(Number(item.weightKg) * 1000) === Math.round(row.weightKg * 1000))) throw new Error(`Existing batch missing SQL #${row.legacyId}`);
  } else {
    const receipt = await commerce.createInventoryReceipt({
      receivedAt: "2026-11-14T08:00:00.000Z",
      supplierName: "Đối chiếu SQL cũ",
      receiver: "Admin",
      warehouseName: "Kho chính",
      paymentMethod: "Không phát sinh",
      note: `${plan.batch}; SKU mới ${sku} (mã SQL HC-TAT05); 33 món có kg riêng, tổng 84.705 kg. Giá bán chưa chốt nên giữ nháp; không đồng bộ POS. Xanh và Dâu Tây để NOTE chờ kg từng quả.`,
      items: [{
        quantity: 0,
        quantityKg: plan.totalKg,
        unitCost: 0,
        sphereStoneGroupName: plan.stoneGroup,
        sphereStoneTypeName: plan.stoneType,
        sphereQuality: plan.quality,
        sphereItems: plan.rows.map((row, index) => ({ label: `Cầu Hàm Ếch ${index + 1} · ${row.weightKg.toFixed(3)} kg · SQL #${row.legacyId}`, weightKg: row.weightKg })),
        // Legacy SQL SKU (HC-TAT05) does not carry the configured CAU category prefix.
        // Keep the old code in the plan and receipt note; use the agreed CAU-prefixed SKU here.
        newProduct: { name: plan.name, kind: "OTHER", categoryId: category.id, sku, legacySku: sku, allowLegacySku: true, price: null },
      }],
    });
    fs.writeFileSync(`${root}/receipt.json`, JSON.stringify(receipt, null, 2));
  }

  product = await readProduct();
  if (!product || product.status !== "DRAFT" || product.price != null || product.categoryId !== category.id || product.sphereStoneTypeId !== type.id || product.sphereQuality !== "5A" || Math.round(Number(product.stockKg) * 1000) !== 84705 || product.sphereItems.length !== 33 || weightUnits(product.sphereItems) !== 84705) throw new Error("Post-import SKU verification failed");

  const attachments = [];
  for (const row of plan.rows) {
    const bytes = fs.readFileSync(`${root}/images/${row.image}`);
    if (bytes.length < 256 || !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw new Error(`Invalid JPEG for SQL #${row.legacyId}`);
    const asset = await media.save({ filename: row.image, sourceKey: `legacy-sql/sphere/${row.legacyId}/${row.image}`, mimeType: "image/jpeg", bytes, alt: row.name });
    if (asset.storageProvider !== "r2" || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verification failed for SQL #${row.legacyId}`);
    attachments.push({ legacyId: row.legacyId, image: row.image, url: asset.url, objectKey: asset.objectKey });
  }
  const gallery = [...new Set([...product.images.map((image) => image.url), ...attachments.map((image) => image.url)])];
  if (gallery.length > 100) throw new Error("Product gallery exceeds the supported image count");
  const saved = await commerce.updateProductFieldsBySku(sku, { gallery }, { id: actor.id });
  const verified = await readProduct();
  if (saved.images.length !== gallery.length || verified?.images.length !== gallery.length || verified?.status !== "DRAFT" || verified?.price != null) throw new Error("Final gallery or draft-price verification failed");
  const receipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, select: { receiptNo: true, status: true, pos365SyncStatus: true } });
  const summary = { localOnly: true, posWrites: false, receipt, sku, status: verified.status, price: verified.price, quality: verified.sphereQuality, items: verified.sphereItems.length, totalKg: Number(verified.stockKg), downloadedImages: plan.rows.length, uniqueGalleryImages: gallery.length, imagesMissing: 0, attachments, pendingNote: ["Cầu Thạch Anh Xanh", "Cầu Thạch Anh Dâu Tây"] };
  fs.writeFileSync(`${root}/result.json`, JSON.stringify(summary, null, 2));
  console.log("HAMECH_IMPORT_RESULT " + JSON.stringify({ ...summary, attachments: undefined }));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
