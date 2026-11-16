import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';

const root = 'import-data/cay-tai-loc-20261114';
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
const download = JSON.parse(fs.readFileSync(path.join(root, 'ftp-download-result.json'), 'utf8'));
if (!['host.docker.internal', '127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local DB only');
if (plan.expectedCount !== 29 || plan.products.length !== 29 || download.downloaded !== 29 || download.failed.length) throw new Error('Import plan/image preflight failed');
process.env.POS365_ENABLED = 'false';
const db = new PrismaService();
const pos = new Pos365Service(db);
const storage = new MediaStorageService();
const media = new MediaAssetsService(db, storage);
const commerce = new CommerceService(db, pos, media, new LoyaltyService(db));
const validImage = bytes => bytes.length > 255 && ((bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'));

try {
  await db.$connect();
  if (!storage.usesR2) throw new Error('R2 provider unavailable');
  const rootCategory = await db.category.findUnique({ where: { slug: 'vat-pham' } });
  if (!rootCategory || rootCategory.kind !== 'OTHER' || rootCategory.level !== 1 || rootCategory.status !== 'ACTIVE') throw new Error('Vật Phẩm category missing');
  const skus = plan.products.map(x => x.sku);
  const existing = await db.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } });
  if (existing.length) throw new Error(`SKU conflict: ${existing.map(x => x.sku).join(', ')}`);
  let category = await db.category.findUnique({ where: { slug: 'cay-tai-loc' } });
  if (category && (category.kind !== 'OTHER' || category.parentId !== rootCategory.id || category.level !== 2 || category.status !== 'ACTIVE')) throw new Error('Conflicting Cây Tài Lộc category');
  if (!category) {
    const max = await db.category.aggregate({ where: { parentId: rootCategory.id }, _max: { sortOrder: true } });
    category = await db.category.create({ data: { name: 'Cây Tài Lộc', slug: 'cay-tai-loc', parentId: rootCategory.id, kind: 'OTHER', usage: 'PRODUCT_CATEGORY', level: 2, status: 'ACTIVE', pricingMode: 'FIXED', sortOrder: (max._max.sortOrder || 0) + 1, description: 'Cây tài lộc và cây đá phong thủy.' } });
  }
  const actor = await db.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!actor) throw new Error('No active admin actor');
  const created = await db.$transaction(async tx => {
    const result = [];
    for (const item of plan.products) result.push(await tx.product.create({ data: { sku: item.sku, name: item.name, slug: `${item.sku.toLowerCase()}-${item.legacyId}`, kind: 'OTHER', categoryId: category.id, status: 'DRAFT', publicationHistoryKnown: true, description: item.description || null, price: item.salePrice, pos365PriceSyncStatus: 'DISABLED', stock: 0, stockKg: 0 } }));
    return result;
  });
  let receipt;
  try {
    receipt = await commerce.createInventoryReceipt({ receivedAt: '2026-11-14T06:00:00.000Z', supplierName: 'Đối chiếu SQL cũ', receiver: 'Admin', warehouseName: 'Kho chính', paymentMethod: 'Không phát sinh', note: `${plan.batch}: 29 SKU duy nhất; tồn 1 cây mỗi SKU; giá bán theo SQL cũ; giá nhập = giá bán / 3, làm tròn đến đồng. SKU trùng và hồ sơ thiếu SKU được ghi NOTE, không nhập. Local only; POS disabled.`, items: plan.products.map(item => ({ productId: created.find(p => p.sku === item.sku).id, quantity: 1, unitCost: item.purchaseCost })) });
  } catch (error) {
    await db.product.deleteMany({ where: { id: { in: created.map(p => p.id) }, stock: 0, stockKg: 0 } });
    if (!(await db.product.count({ where: { categoryId: category.id } }))) await db.category.delete({ where: { id: category.id } });
    throw error;
  }
  const attachments = [];
  for (let i = 0; i < plan.products.length; i++) {
    const item = plan.products[i];
    const bytes = fs.readFileSync(path.join(root, 'images', item.image));
    if (!validImage(bytes)) throw new Error(`Invalid local image ${item.image}`);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const asset = await media.save({ filename: item.image, sourceKey: `legacy-cay-tai-loc/${item.legacyId}/${item.image}`, mimeType: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', bytes, alt: item.name });
    if (asset.storageProvider !== 'r2' || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verification failed ${item.sku}`);
    const saved = await commerce.updateProductFieldsBySku(item.sku, { gallery: [asset.url] }, { id: actor.id });
    if (!saved.images.some(image => image.url === asset.url)) throw new Error(`Gallery verification failed ${item.sku}`);
    attachments.push({ sku: item.sku, objectKey: asset.objectKey });
    console.log(`R2 ${i + 1}/${plan.products.length}`);
  }
  const ids = created.map(p => p.id);
  await db.product.updateMany({ where: { id: { in: ids }, status: 'DRAFT' }, data: { status: 'ACTIVE' } });
  const verified = await db.product.findMany({ where: { id: { in: ids } }, include: { images: true } });
  if (verified.length !== 29 || verified.some(p => p.stock !== 1 || p.status !== 'ACTIVE' || !p.images.length || Number(p.price) !== plan.products.find(x => x.sku === p.sku).salePrice)) throw new Error('Post-import verification failed');
  const result = { receiptNo: receipt.receiptNo, importedProducts: 29, stock: 29, activeProducts: 29, imagesInR2: attachments.length, salePriceTotal: plan.products.reduce((n,x) => n + x.salePrice, 0), purchaseCostTotal: plan.products.reduce((n,x) => n + x.purchaseCost, 0), noteRows: 12, localOnly: true, posWrites: false };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(root, 'r2-attachments.json'), JSON.stringify(attachments, null, 2));
  console.log('CAY_TAI_LOC_RESULT ' + JSON.stringify(result));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await db.$disconnect();
}
