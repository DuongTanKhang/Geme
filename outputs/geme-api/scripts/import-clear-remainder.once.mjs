import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';

const root = 'import-data/remaining-clear-items-20261115';
const plan = JSON.parse(fs.readFileSync(path.join(root, 'import-plan.json'), 'utf8'));
const execute = process.argv.includes('--execute');
const allowedDbHosts = new Set(['localhost', '127.0.0.1', 'host.docker.internal', 'sqlserver']);
if (!allowedDbHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only local database is authorized');
if (plan.expectedRows !== 135 || plan.expectedGroups !== 113 || plan.expectedKg !== 288.715) throw new Error('Plan totals changed; stop before importing');
if (plan.products.some(x => !x.sku || !x.category || !Number.isSafeInteger(x.unitCost) || x.unitCost < 0)) throw new Error('Invalid product or cost in plan');
for (const item of plan.products.filter(x => x.unit === 'KG')) {
  if (!item.groupName || !item.typeName || !item.quality || item.quality.length > 60 || !item.rows.length) throw new Error(`Incomplete stone hierarchy for ${item.sku}`);
  const kg = Math.round(item.rows.reduce((sum, row) => sum + Math.round(Number(row.weightKg) * 1000), 0));
  if (kg !== Math.round(Number(item.totalKg) * 1000)) throw new Error(`Per-item kg mismatch for ${item.sku}`);
}

process.env.POS365_ENABLED = 'false';
const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
const createdCategories = [];
const slugify = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 170);
const imageBytesOk = bytes => bytes.length > 255 && (
  (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
  || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
);
const normalizeHierarchy = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error('R2 is not configured');
  const rootCategory = await prisma.category.findUnique({ where: { slug: 'vat-pham' } });
  if (!rootCategory || rootCategory.kind !== 'OTHER' || rootCategory.level !== 1 || rootCategory.status !== 'ACTIVE') throw new Error('Vật Phẩm root category missing');
  const skus = plan.products.map(item => item.sku);
  const priorReceipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, include: { items: true } });
  const priorProducts = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } });
  if (priorReceipt || priorProducts.length) throw new Error(`Existing SKU/receipt conflict; receipt=${priorReceipt?.receiptNo || 'none'}, products=${priorProducts.length}`);

  const categories = new Map();
  for (const item of plan.products) {
    if (categories.has(item.categorySlug)) continue;
    let category = await prisma.category.findUnique({ where: { slug: item.categorySlug } });
    if (category && (category.kind !== 'OTHER' || category.parentId !== rootCategory.id || category.level !== 2 || category.status !== 'ACTIVE')) throw new Error(`Conflicting Vật Phẩm category ${item.category}`);
    if (!category) {
      const max = await prisma.category.aggregate({ where: { parentId: rootCategory.id }, _max: { sortOrder: true } });
      category = await prisma.category.create({ data: { name: item.category, slug: item.categorySlug, parentId: rootCategory.id, kind: 'OTHER', usage: 'PRODUCT_CATEGORY', level: 2, status: 'ACTIVE', pricingMode: 'FIXED', sortOrder: (max._max.sortOrder || 0) + 1 } });
      createdCategories.push(category.id);
    }
    categories.set(item.categorySlug, category);
  }

  const imageNames = [...new Set(plan.products.flatMap(item => item.rows.map(row => row.image)))];
  const assets = await prisma.mediaAsset.findMany({ where: { filename: { in: imageNames }, storageProvider: 'r2', isPrivate: false }, select: { filename: true, objectKey: true } });
  const assetByFilename = new Map(assets.map(asset => [asset.filename, asset.objectKey]));
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!actor) throw new Error('No active admin actor');

  console.log('CLEAR_REMAINDER_PREFLIGHT ' + JSON.stringify({ mode: execute ? 'EXECUTE' : 'DRY_RUN', rows: plan.expectedRows, products: plan.expectedGroups, kg: plan.expectedKg, categories: [...categories.keys()], skuConflicts: 0, existingR2Assets: assets.length, posWrites: false, localOnly: true }));
  if (!execute) process.exit(0);

  const created = await prisma.$transaction(async tx => {
    const output = [];
    for (const item of plan.products) {
      output.push(await tx.product.create({ data: {
        sku: item.sku,
        name: item.name,
        slug: `${slugify(item.name)}-${item.sku.toLowerCase()}`,
        kind: 'OTHER',
        categoryId: categories.get(item.categorySlug).id,
        status: 'DRAFT',
        publicationHistoryKnown: true,
        description: item.rows[0]?.name || null,
        price: item.salePrice,
        pos365PriceSyncStatus: 'DISABLED',
        stock: 0,
        stockKg: 0,
      } }));
    }
    return output;
  });
  const receiptItems = plan.products.map(item => {
    const productId = created.find(product => product.sku === item.sku).id;
    const category = categories.get(item.categorySlug);
    if (item.unit === 'KG') {
      return {
        productId,
        quantity: 0,
        quantityKg: item.totalKg,
        unitCost: item.unitCost,
        sphereHierarchy: { groupName: item.groupName, typeName: item.typeName, quality: item.quality },
        sphereStoneGroupName: item.groupName,
        sphereStoneTypeName: item.typeName,
        sphereQuality: item.quality,
        sphereItems: item.rows.map(row => ({ label: `${row.name} · ${row.weightKg} kg · SQL #${row.legacyId}`, weightKg: row.weightKg })),
      };
    }
    return {
      productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
    };
  });
  let receipt;
  try {
    receipt = await commerce.createInventoryReceipt({
    receivedAt: '2026-11-15T06:00:00.000Z',
    supplierName: 'Đối chiếu SQL cũ',
    receiver: 'Admin',
    warehouseName: 'Kho chính',
    paymentMethod: 'Không phát sinh',
    note: `${plan.batch}: 135 dòng nguồn, 113 SKU; Vật Phẩm kg ${plan.expectedKg} kg, Thuyền Buồm và Lăn Massage theo cái. Giá bán theo cột Gia SQL; giá nhập = giá bán / 3; SKU có nhiều mức giá giữ nháp; thiếu ảnh giữ nháp. 63 dòng không rõ/thiếu dữ liệu được đưa NOTE. Local only, POS disabled.`,
      items: receiptItems,
    });
  } catch (error) {
    await prisma.product.deleteMany({ where: { id: { in: created.map(product => product.id) }, stock: 0, stockKg: 0 } });
    throw error;
  }
  fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));

  const products = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true, sphereItems: true, sphereStoneType: { include: { group: true } } } });
  if (products.length !== plan.expectedGroups) throw new Error(`Expected ${plan.expectedGroups} products, found ${products.length}`);
  const missingImages = [];
  const attachments = [];
  const imagesBySku = new Map();
  for (const item of plan.products) {
    const current = products.find(product => product.sku === item.sku);
    const gallery = [...new Set(current.images.map(image => image.url))];
    const itemMissing = [];
    for (const row of item.rows) {
      let bytes = null;
      const localPath = path.join(root, 'import-images', row.image);
      if (fs.existsSync(localPath)) bytes = fs.readFileSync(localPath);
      else {
        const objectKey = assetByFilename.get(row.image) || `legacy-product-images/${row.image}`;
        if ((await storage.headPublicObject(objectKey)).status === 200) bytes = await storage.getPublicObject(objectKey);
      }
      if (!bytes) { itemMissing.push(row.image); missingImages.push({ sku: item.sku, legacyId: row.legacyId, image: row.image }); continue; }
      if (!imageBytesOk(bytes)) throw new Error(`Invalid image for ${item.sku}, SQL #${row.legacyId}`);
      const mimeType = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : 'image/webp';
      const asset = await media.save({ filename: row.image, sourceKey: `legacy-vat-pham/${slugify(item.category)}/${row.legacyId}/${row.image}`, mimeType, bytes, alt: `${row.name} · SQL #${row.legacyId}` });
      if (asset.storageProvider !== 'r2' || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verify failed for ${item.sku}, SQL #${row.legacyId}`);
      gallery.push(asset.url);
      attachments.push({ sku: item.sku, legacyId: row.legacyId, image: row.image, objectKey: asset.objectKey, url: asset.url });
    }
    const uniqueGallery = [...new Set(gallery)];
    imagesBySku.set(item.sku, { complete: itemMissing.length === 0 && item.rows.length > 0, gallery: uniqueGallery });
    if (uniqueGallery.length !== current.images.length) {
      const saved = await commerce.updateProductFieldsBySku(item.sku, { gallery: uniqueGallery }, { id: actor.id });
      if (saved.images.length !== uniqueGallery.length) throw new Error(`Gallery verification failed for ${item.sku}`);
    }
  }

  const ready = plan.products.filter(item => item.salePrice !== null && imagesBySku.get(item.sku)?.complete).map(item => item.sku);
  if (ready.length) await prisma.product.updateMany({ where: { sku: { in: ready }, status: 'DRAFT', price: { not: null } }, data: { status: 'ACTIVE' } });
  const verified = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true, sphereItems: true, sphereStoneType: { include: { group: true } } } });
  const mismatch = [];
  for (const item of plan.products) {
    const product = verified.find(value => value.sku === item.sku);
    const actualPrice = product?.price == null ? null : Number(product.price);
    if (!product || product.categoryId !== categories.get(item.categorySlug).id || actualPrice !== (item.salePrice === null ? null : Number(item.salePrice))) mismatch.push(`product/category/price ${item.sku}`);
    if (item.unit === 'KG') {
      if (Math.round(Number(product?.stockKg || 0) * 1000) !== Math.round(item.totalKg * 1000) || product?.sphereItems.length !== item.rows.length || Math.round(product.sphereItems.reduce((sum, row) => sum + Math.round(Number(row.weightKg) * 1000), 0)) !== Math.round(item.totalKg * 1000)) mismatch.push(`kg/item detail ${item.sku}`);
      if (normalizeHierarchy(product?.sphereQuality) !== normalizeHierarchy(item.quality) || normalizeHierarchy(product?.sphereStoneType?.name) !== normalizeHierarchy(item.typeName) || normalizeHierarchy(product?.sphereStoneType?.group.name) !== normalizeHierarchy(item.groupName)) mismatch.push(`stone hierarchy ${item.sku}`);
    } else if (product?.stock !== item.quantity || Number(product?.stockKg || 0) !== 0) mismatch.push(`piece stock ${item.sku}`);
    const expectedStatus = item.salePrice !== null && imagesBySku.get(item.sku)?.complete ? 'ACTIVE' : 'DRAFT';
    if (product?.status !== expectedStatus) mismatch.push(`publication status ${item.sku}`);
  }
  if (mismatch.length) throw new Error(`Post-import verification failed: ${mismatch.slice(0, 10).join('; ')}`);
  const savedReceipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, select: { receiptNo: true, status: true, pos365SyncStatus: true, totalQuantityKg: true, totalQuantity: true } });
  if (!savedReceipt || savedReceipt.status !== 'COMPLETED' || Number(savedReceipt.totalQuantityKg) !== plan.expectedKg) throw new Error('Receipt post-import verification failed');
  const result = { receipt: savedReceipt, products: verified.length, sourceRows: plan.expectedRows, weightedRows: plan.products.filter(item => item.unit === 'KG').reduce((sum, item) => sum + item.rows.length, 0), pieceRows: plan.products.filter(item => item.unit === 'PIECE').reduce((sum, item) => sum + item.quantity, 0), totalKg: plan.expectedKg, categories: [...categories.values()].map(category => `Vật Phẩm → ${category.name}`), imagesAttached: attachments.length, imagesMissing: missingImages.length, activeProducts: verified.filter(product => product.status === 'ACTIVE').length, draftProducts: verified.filter(product => product.status === 'DRAFT').length, noteRows: 63, localOnly: true, posWrites: false };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(root, 'r2-attachments.json'), JSON.stringify(attachments, null, 2));
  fs.writeFileSync(path.join(root, 'missing-images.json'), JSON.stringify(missingImages, null, 2));
  console.log('CLEAR_REMAINDER_IMPORT_RESULT ' + JSON.stringify(result));
} catch (error) {
  if (!fs.existsSync(path.join(root, 'receipt.json'))) {
    const productCount = await prisma.product.count({ where: { sku: { in: plan.products.map(item => item.sku) } } }).catch(() => 0);
    if (!productCount) await prisma.category.deleteMany({ where: { id: { in: createdCategories } } }).catch(() => {});
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
