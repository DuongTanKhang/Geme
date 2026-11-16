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
const outputPath = path.join(root, 'r2-attachments.json');
const reportPath = path.join(root, 'image-attachment-result.json');
const allowedDbHosts = new Set(['localhost', '127.0.0.1', 'host.docker.internal', 'sqlserver']);
if (!allowedDbHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only local database is authorized');
if (plan.expectedRows !== 135 || plan.expectedGroups !== 113) throw new Error('Unexpected import plan totals');

process.env.POS365_ENABLED = 'false';
const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
const imageBytesOk = bytes => bytes.length > 255 && (
  (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
  || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
);
const slugify = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 170);

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error('R2 is not configured');
  const skus = plan.products.map(item => item.sku);
  const products = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true } });
  if (products.length !== plan.expectedGroups) throw new Error(`Expected ${plan.expectedGroups} products, found ${products.length}`);
  const actor = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!actor) throw new Error('No active admin actor');
  const productBySku = new Map(products.map(product => [product.sku, product]));
  const attachments = [];
  const failed = [];
  const completeBySku = new Map();

  for (const item of plan.products) {
    const product = productBySku.get(item.sku);
    if (!product) throw new Error(`Missing product ${item.sku}`);
    const gallery = product.images.map(image => image.url);
    let rowFailures = 0;
    for (const row of item.rows) {
      const localPath = path.join(root, 'import-images', row.image);
      if (!fs.existsSync(localPath)) {
        failed.push({ sku: item.sku, legacyId: row.legacyId, image: row.image, reason: 'Missing local FTP file' });
        rowFailures++;
        continue;
      }
      const bytes = fs.readFileSync(localPath);
      if (!imageBytesOk(bytes)) {
        failed.push({ sku: item.sku, legacyId: row.legacyId, image: row.image, reason: 'Invalid image bytes' });
        rowFailures++;
        continue;
      }
      const mimeType = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'image/png'
          : 'image/webp';
      const asset = await media.save({
        filename: row.image,
        sourceKey: `legacy-vat-pham/${slugify(item.category)}/${row.legacyId}/${row.image}`,
        mimeType,
        bytes,
        alt: `${row.name} · SQL #${row.legacyId}`,
      });
      if (asset.storageProvider !== 'r2' || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) {
        throw new Error(`R2 verification failed for ${item.sku}, SQL #${row.legacyId}`);
      }
      gallery.push(asset.url);
      attachments.push({ sku: item.sku, legacyId: row.legacyId, image: row.image, objectKey: asset.objectKey, url: asset.url });
    }
    const uniqueGallery = [...new Set(gallery)];
    if (uniqueGallery.length !== product.images.length) {
      const saved = await commerce.updateProductFieldsBySku(item.sku, { gallery: uniqueGallery }, { id: actor.id });
      if (saved.images.length !== uniqueGallery.length) throw new Error(`Gallery verification failed for ${item.sku}`);
    }
    completeBySku.set(item.sku, rowFailures === 0 && item.rows.length > 0);
  }

  const ready = plan.products.filter(item => item.salePrice != null && Number(item.salePrice) > 0 && completeBySku.get(item.sku));
  const stockReadySkus = ready.filter(item => {
    const product = productBySku.get(item.sku);
    return item.unit === 'KG' ? Number(product.stockKg || 0) > 0 : Number(product.stock || 0) > 0;
  }).map(item => item.sku);
  if (stockReadySkus.length) {
    await prisma.product.updateMany({ where: { sku: { in: stockReadySkus }, status: 'DRAFT', price: { gt: 0 } }, data: { status: 'ACTIVE' } });
  }

  const verified = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true } });
  const mismatch = [];
  for (const item of plan.products) {
    const product = verified.find(row => row.sku === item.sku);
    if (!product || product.price == null && item.salePrice != null || product?.price != null && Number(product.price) !== Number(item.salePrice)) mismatch.push(`price/product ${item.sku}`);
    if ((product?.images.length || 0) < item.rows.length) mismatch.push(`gallery ${item.sku}`);
    const expected = stockReadySkus.includes(item.sku) ? 'ACTIVE' : 'DRAFT';
    if (product?.status !== expected) mismatch.push(`publication ${item.sku}`);
  }
  if (mismatch.length) throw new Error(`Post-attachment verification failed: ${mismatch.slice(0, 12).join('; ')}`);

  const report = {
    products: verified.length,
    sourceRows: plan.expectedRows,
    r2Attachments: attachments.length,
    productsActive: verified.filter(product => product.status === 'ACTIVE').length,
    productsDraft: verified.filter(product => product.status === 'DRAFT').length,
    failures: failed.length,
    localOnly: true,
    posWrites: false,
    details: failed,
  };
  fs.writeFileSync(outputPath, JSON.stringify(attachments, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'missing-images.json'), JSON.stringify(failed, null, 2));
  console.log('CLEAR_REMAINDER_IMAGE_ATTACHMENT_RESULT ' + JSON.stringify({ ...report, details: undefined }));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
