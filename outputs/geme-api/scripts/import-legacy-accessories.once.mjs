import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CommerceService } from "../src/commerce/commerce.service.ts";
import { LoyaltyService } from "../src/loyalty/loyalty.service.ts";
import { MediaAssetsService } from "../src/media/media-assets.service.ts";
import { MediaStorageService } from "../src/media/media-storage.service.ts";
import { MaterialsService } from "../src/materials/materials.service.ts";
import { Pos365Service } from "../src/pos365/pos365.service.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";

const root = "/tmp/accessory-staging";
const categoryId = "985c2cac-2eb5-4385-a6b1-ac9ee5cfd9c6";
const adminId = "b0f4c244-6029-4124-9c58-381d77816751";
const text = await readFile(join(root, "manifest.csv"), "utf8");
function parseCsv(source) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(value); value = ""; }
    else if (ch === "\n") { row.push(value); rows.push(row); row = []; value = ""; }
    else if (ch !== "\r") value += ch;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.length === headers.length).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
const rows = parseCsv(text);
if (rows.length !== 135) throw new Error("Manifest phải có đúng 135 dòng, hiện có " + rows.length);
if (new Set(rows.map((r) => r.sku)).size !== 135) throw new Error("Manifest có SKU trùng.");
const codeToStone = new Map();
for (const row of rows) {
  const prior = codeToStone.get(row.stoneCode);
  if (prior && prior !== row.stoneNameFromSql) throw new Error("Mã đá " + row.stoneCode + " bị gán cho hai loại đá.");
  codeToStone.set(row.stoneCode, row.stoneNameFromSql);
  if (Number(row.quantity) !== 2 || Number(row.buyPrice) !== 0) throw new Error("Số lượng/giá nhập không đúng yêu cầu ở SKU " + row.sku);
  const bytes = await readFile(join(root, row.imageFilename));
  if (bytes.length !== Number(row.imageBytes) || createHash("sha256").update(bytes).digest("hex") !== row.imageSha256) throw new Error("Ảnh không khớp manifest: " + row.imageFilename);
}
// Construct only the services needed for this one-time import. Bootstrapping
// AppModule also starts background integrations (POS365, email, etc.) and is
// unnecessary for the import; direct constructors preserve their business logic.
const prisma = new PrismaService();
const pos365 = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const loyalty = new LoyaltyService(prisma);
const commerce = new CommerceService(prisma, pos365, media, loyalty);
const materialsService = new MaterialsService(prisma);
await prisma.$connect();
let result = {};
try {
  if (!storage?.usesR2 || !storage?.publicUrl("media/check.jpg")) throw new Error("API local chưa cấu hình R2 và URL media công khai; dừng trước khi nhập.");
  // Validate credentials with a read-only HEAD before touching inventory or
  // retrying 135 uploads. A missing object is expected (404); auth errors are not.
  const r2Probe = await storage.headPublicObject("media/geme-accessory-import-preflight-not-found");
  if (![200, 404].includes(r2Probe.status)) throw new Error(`R2 preflight thất bại HTTP ${r2Probe.status}; kiểm tra lại Access Key ID/Secret Access Key và quyền Object Read/Write của bucket. Chưa tiếp tục tải ảnh.`);
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, slug: true, status: true, kind: true, usage: true, level: true, parentId: true } });
  if (!category || category.status !== "ACTIVE" || category.name !== "Charm đá" || category.usage !== "PRODUCT_CATEGORY" || category.kind !== "JEWELRY") throw new Error("Danh mục Charm đá không hợp lệ.");
  const parent = await prisma.category.findUnique({ where: { id: category.parentId }, select: { name: true, slug: true, parentId: true } });
  if (!parent || parent.name !== "Charm") throw new Error("Charm đá không nằm dưới danh mục Charm.");
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true, isActive: true, role: true } });
  if (!admin?.isActive) throw new Error("Không tìm được tài khoản quản trị đang hoạt động để ghi audit.");

  const existingRows = await prisma.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } }, select: { id: true, sku: true, categoryId: true, materialOptionId: true, price: true, stock: true, status: true } });
  const bySku = new Map(existingRows.map((p) => [p.sku, p]));
  for (const product of existingRows) if (product.categoryId !== categoryId) throw new Error("SKU đã tồn tại ngoài Charm đá: " + product.sku);

  const materialList = await materialsService.list("JEWELRY");
  const idByName = new Map(materialList.filter((m) => m.kind === "STONE").map((m) => [String(m.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), m]));
  const materialIdByStone = new Map();
  let createdMaterials = 0, updatedMaterials = 0;
  for (const stone of new Set(rows.map((r) => r.stoneNameFromSql))) {
    const key = String(stone).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let material = idByName.get(key);
    if (!material) {
      material = await materialsService.create({ name: stone, scope: "JEWELRY", kind: "STONE", active: true, sortOrder: 100, appliedCategoryIds: [categoryId] });
      idByName.set(key, material);
      createdMaterials++;
    } else {
      const applied = Array.isArray(material.appliedCategoryIds) ? material.appliedCategoryIds : [];
      const nextApplied = [...new Set([...applied, categoryId])];
      if (!material.active || JSON.stringify(applied) !== JSON.stringify(nextApplied)) {
        material = await materialsService.update(material.id, { active: true, appliedCategoryIds: nextApplied });
        updatedMaterials++;
      }
    }
    materialIdByStone.set(stone, material.id);
  }
  const materialPrefixes = [...codeToStone.entries()].map(([code, stone]) => ({ prefix: code, materialOptionId: materialIdByStone.get(stone) }));
  if (materialPrefixes.some((entry) => !entry.materialOptionId)) throw new Error("Thiếu ánh xạ mã đá sang loại đá.");
  if (new Set(materialPrefixes.map((entry) => entry.prefix)).size !== materialPrefixes.length) throw new Error("Mã loại đá bị trùng.");
  const setting = await prisma.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
  const priorRules = Array.isArray(setting?.value) ? setting.value : [];
  const rules = priorRules.filter((r) => r.categoryId !== categoryId);
  rules.push({ categoryId, prefix: "NSSC", skuFormat: "SEQUENTIAL", materialOptionIds: [...new Set(materialPrefixes.map((m) => m.materialOptionId))], materialPrefixes });
  await commerce.saveInventorySkuRules({ rules });

  const missing = rows.filter((r) => !bySku.has(r.sku));
  let receiptNo = null;
  if (missing.length) {
    const receipt = await commerce.createInventoryReceipt({
      receivedAt: new Date().toISOString(),
      supplierName: "Đối chiếu danh mục SQL cũ",
      receiver: "Admin",
      warehouseName: "Kho chính",
      paymentMethod: "Không phát sinh",
      note: "Nhập 135 Charm đá đối chiếu SQL cũ; tồn 2 mỗi SKU; giá nhập 0; ảnh lưu R2.",
      items: missing.map((r) => ({
        quantity: 2,
        unitCost: 0,
        newProduct: {
          name: r.name,
          kind: "JEWELRY",
          categoryId,
          materialOptionId: materialIdByStone.get(r.stoneNameFromSql),
          sku: r.sku,
          legacySku: r.sku,
          allowLegacySku: true,
          price: Number(r.salePrice) > 0 ? Number(r.salePrice) : null,
        },
      })),
    });
    receiptNo = receipt.receiptNo;
  }

  let uploaded = 0, activated = 0, leftDraft = 0;
  const failures = [];
  const eligibleRows = rows;
  for (let offset = 0; offset < eligibleRows.length; offset += 4) {
    const batch = eligibleRows.slice(offset, offset + 4);
    const outcomes = await Promise.all(batch.map(async (r) => {
      try {
        const bytes = await readFile(join(root, r.imageFilename));
        const asset = await media.save({
          filename: r.imageFilename,
          sourceKey: "legacy-accessories/20261106/" + r.imageFilename,
          mimeType: "image/jpeg",
          bytes,
          alt: r.name,
          updateExisting: true,
        });
        const saved = await commerce.updateProductFieldsBySku(r.sku, { gallery: [asset.url] }, { id: adminId });
        if (!saved?.images?.some((image) => image.url === asset.url)) throw new Error("Ảnh chưa gắn được vào sản phẩm.");
        uploaded++;
        if (Number(r.salePrice) > 0) {
          await commerce.updateProductPublication(saved.id, "ACTIVE", { id: adminId });
          activated++;
        } else {
          leftDraft++;
        }
        return null;
      } catch (error) {
        failures.push({ sku: r.sku, message: String(error?.message || error).slice(0, 500) });
        return r.sku;
      }
    }));
    const done = Math.min(offset + batch.length, eligibleRows.length);
    if (done % 20 === 0 || done === eligibleRows.length) console.log("Đã xử lý ảnh " + done + "/135; R2 OK " + uploaded + "; hoạt động " + activated + "; lỗi " + failures.length);
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: rows.map((r) => r.sku) } },
    select: { id: true, sku: true, status: true, price: true, stock: true, categoryId: true, materialOptionId: true, images: { select: { url: true, isPrimary: true } } },
  });
  const counts = products.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; acc.stock += p.stock; if (p.images.length) acc.withImage++; if (Number(p.price || 0) > 0) acc.withPrice++; if (p.stock !== 2) acc.stockMismatch.push({ sku: p.sku, stock: p.stock }); return acc; }, { stock: 0, withImage: 0, withPrice: 0, DRAFT: 0, ACTIVE: 0, HIDDEN: 0, stockMismatch: [] });
  const noImage = products.filter((p) => !p.images.length).map((p) => p.sku);
  const wrongCategory = products.filter((p) => p.categoryId !== categoryId).map((p) => p.sku);
  const summary = { receiptNo, importedNow: missing.length, total: products.length, materialTypes: materialIdByStone.size, createdMaterials, updatedMaterials, stockTotal: counts.stock, withImage: counts.withImage, withSalePrice: counts.withPrice, active: counts.ACTIVE || 0, draft: counts.DRAFT || 0, hidden: counts.HIDDEN || 0, stockMismatch: counts.stockMismatch, noImage, wrongCategory, failures };
  console.log("IMPORT_SUMMARY " + JSON.stringify(summary));
  result = summary;
  if (products.length !== 135 || counts.stock !== 270 || noImage.length || wrongCategory.length || failures.length) process.exitCode = 2;
} finally {
  media.onModuleDestroy();
  pos365.onModuleDestroy();
  await prisma.$disconnect();
}
