import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';

const root = 'import-data/tui-tien-trung-kim-tu-thap-20261114';
const plan = JSON.parse(fs.readFileSync(path.join(root, 'import-plan.json'), 'utf8'));
const download = JSON.parse(fs.readFileSync(path.join(root, 'import-image-download.json'), 'utf8'));
if (!['localhost', '127.0.0.1', 'host.docker.internal'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only local database is authorized');
if (plan.expectedRows !== 60 || plan.expectedGroups !== 7 || plan.expectedKg !== 316.79 || download.downloaded < 1) throw new Error('Import preflight totals/images failed');
process.env.POS365_ENABLED = 'false';
const prisma = new PrismaService();
const pos = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const commerce = new CommerceService(prisma, pos, media, new LoyaltyService(prisma));
const scale = 1000;
const sumKg = rows => Math.round(rows.reduce((sum, row) => sum + Math.round(Number(row.weightKg) * scale), 0));
const salePriceList = item => [...new Set(item.rows.map(row => Number(row.salePrice)))];
const imageBytesOk = bytes => bytes.length > 255 && ((bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'));
const skuRules = { 'tui-tien': 'TT', trung: 'TRUNG', 'kim-tu-thap': 'KTT' };
const batchNote = `${plan.batch}: 60 món, 7 SKU, tổng 316.790 kg; tồn theo kg và lưu cân nặng riêng từng món. Giá nhập/kg được tính từ (giá bán SQL từng món / 3) cộng lại rồi chia tổng kg SKU. Các SKU có giá bán SQL khác nhau để giá sản phẩm null/bản nháp. KTT-LP02 có một món và một giá SQL nên dùng giá đó; các món thiếu cấp chất lượng/SKU được giữ NOTE. Chỉ local, không đồng bộ POS.`;

try {
  await prisma.$connect();
  if (!storage.usesR2) throw new Error('R2 is not configured');
  const rootCategory = await prisma.category.findUnique({ where: { slug: 'vat-pham' } });
  if (!rootCategory || rootCategory.kind !== 'OTHER' || rootCategory.level !== 1 || rootCategory.status !== 'ACTIVE') throw new Error('Vật Phẩm root category missing');
  const admin = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!admin) throw new Error('No active admin actor');
  const categoryBySlug = new Map();
  for (const item of plan.products) {
    let category = await prisma.category.findUnique({ where: { slug: item.categorySlug } });
    if (category && (category.kind !== 'OTHER' || category.parentId !== rootCategory.id || category.level !== 2 || category.status !== 'ACTIVE')) throw new Error(`Category conflict ${item.categorySlug}`);
    if (!category) {
      const max = await prisma.category.aggregate({ where: { parentId: rootCategory.id }, _max: { sortOrder: true } });
      category = await prisma.category.create({ data: { name: item.category, slug: item.categorySlug, parentId: rootCategory.id, kind: 'OTHER', usage: 'PRODUCT_CATEGORY', level: 2, status: 'ACTIVE', pricingMode: 'FIXED', sortOrder: (max._max.sortOrder || 0) + 1 } });
    }
    categoryBySlug.set(item.categorySlug, category);
  }
  const settingKey = 'inventory.skuRules';
  const setting = await prisma.siteSetting.findUnique({ where: { key: settingKey } });
  let rules = Array.isArray(setting?.value) ? setting.value : [];
  for (const [slug, prefix] of Object.entries(skuRules)) {
    const category = categoryBySlug.get(slug);
    const current = rules.find(rule => rule.categoryId === category.id);
    if (current && current.prefix !== prefix) throw new Error(`SKU rule conflict for ${category.name}: ${current.prefix}`);
    if (!current) rules = [...rules, { categoryId: category.id, prefix, skuFormat: 'SEQUENTIAL', materialOptionIds: [], materialPrefixes: [] }];
  }
  if (rules.length !== (Array.isArray(setting?.value) ? setting.value.length : 0)) await prisma.siteSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: rules }, update: { value: rules } });

  const skus = plan.products.map(item => item.sku);
  let products = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true, sphereItems: true, sphereStoneType: { include: { group: true } } } });
  let receipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, include: { items: true } });
  const verify = rows => {
    if (rows.length !== 7) throw new Error(`Expected 7 products; found ${rows.length}`);
    for (const item of plan.products) {
      const product = rows.find(row => row.sku === item.sku);
      if (!product || product.categoryId !== categoryBySlug.get(item.categorySlug).id || product.kind !== 'OTHER' || Math.round(Number(product.stockKg) * scale) !== Math.round(item.totalKg * scale) || product.sphereItems.length !== item.rows.length || sumKg(product.sphereItems) !== sumKg(item.rows) || product.sphereQuality !== item.quality || product.sphereStoneType?.name !== item.typeName || product.sphereStoneType?.group.name !== item.groupName) throw new Error(`Stock/taxonomy verification failed for ${item.sku}`);
      for (const row of item.rows) if (!product.sphereItems.some(saved => saved.label?.includes(`SQL #${row.legacyId}`) && Math.round(Number(saved.weightKg) * scale) === Math.round(row.weightKg * scale))) throw new Error(`Missing inventory item for ${item.sku}, SQL #${row.legacyId}`);
    }
  };
  if (products.length || receipt) {
    if (!receipt || receipt.status !== 'COMPLETED' || receipt.items.length !== 7) throw new Error('Partial/conflicting import exists; not adding stock again');
    verify(products);
  } else {
    for (const item of plan.products) {
      const groupSlug = item.groupName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const typeSlug = item.typeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await prisma.sphereStoneGroup.upsert({ where: { slug: groupSlug }, create: { name: item.groupName, slug: groupSlug }, update: {} });
      const group = await prisma.sphereStoneGroup.findUniqueOrThrow({ where: { slug: groupSlug } });
      await prisma.sphereStoneType.upsert({ where: { groupId_slug: { groupId: group.id, slug: typeSlug } }, create: { groupId: group.id, name: item.typeName, slug: typeSlug }, update: {} });
    }
    const receiptItems = plan.products.map(item => {
      const category = categoryBySlug.get(item.categorySlug);
      const prices = salePriceList(item);
      const productPrice = item.rows.length === 1 && prices.length === 1 ? prices[0] : null;
      return {
        quantity: 0,
        quantityKg: item.totalKg,
        unitCost: item.unitCostPerKg,
        sphereHierarchy: { groupName: item.groupName, typeName: item.typeName, quality: item.quality },
        sphereStoneGroupName: item.groupName,
        sphereStoneTypeName: item.typeName,
        sphereQuality: item.quality,
        sphereItems: item.rows.map(row => ({ label: `${row.name} · ${row.weightKg} kg · SQL #${row.legacyId}`, weightKg: row.weightKg })),
        newProduct: { name: item.name, kind: 'OTHER', categoryId: category.id, sku: item.sku, legacySku: item.sku, allowLegacySku: true, price: productPrice },
      };
    });
    receipt = await commerce.createInventoryReceipt({ receivedAt: '2026-11-15T06:00:00.000Z', supplierName: 'Đối chiếu SQL cũ', receiver: 'Admin', warehouseName: 'Kho chính', paymentMethod: 'Không phát sinh', note: batchNote, items: receiptItems });
    fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(`RECEIPT_CREATED ${receipt.receiptNo}`);
  }

  products = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true, sphereItems: true, sphereStoneType: { include: { group: true } } } });
  verify(products);
  const sourceAssets = await prisma.mediaAsset.findMany({ where: { filename: { in: plan.products.flatMap(item => item.rows.map(row => row.image)) }, storageProvider: 'r2', isPrivate: false }, select: { filename: true, objectKey: true } });
  const assetByFilename = new Map(sourceAssets.map(asset => [asset.filename, asset.objectKey]));
  const attachments = [];
  const missingImages = [];
  const urlsBySku = new Map();
  for (const item of plan.products) {
    const product = products.find(row => row.sku === item.sku);
    const gallery = [...new Set(product.images.map(image => image.url))];
    for (const row of item.rows) {
      let bytes = null;
      const localPath = path.join(root, 'import-images', row.image);
      if (fs.existsSync(localPath)) bytes = fs.readFileSync(localPath);
      else {
        const objectKey = assetByFilename.get(row.image) || `legacy-product-images/${row.image}`;
        if ((await storage.headPublicObject(objectKey)).status === 200) bytes = await storage.getPublicObject(objectKey);
      }
      if (!bytes) { missingImages.push({ sku: item.sku, legacyId: row.legacyId, image: row.image }); continue; }
      if (!imageBytesOk(bytes)) throw new Error(`Invalid image for ${item.sku}, SQL #${row.legacyId}`);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const asset = await media.save({ filename: row.image, sourceKey: `legacy-weighted-items/${item.categorySlug}/${row.legacyId}/${row.image}`, mimeType: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', bytes, alt: `${row.name} · ${row.weightKg} kg · SQL #${row.legacyId}` });
      if (asset.storageProvider !== 'r2' || !asset.objectKey || (await storage.headPublicObject(asset.objectKey)).status !== 200) throw new Error(`R2 verify failed for ${item.sku}, SQL #${row.legacyId}`);
      gallery.push(asset.url);
      attachments.push({ sku: item.sku, legacyId: row.legacyId, image: row.image, objectKey: asset.objectKey, url: asset.url });
    }
    const uniqueGallery = [...new Set(gallery)];
    urlsBySku.set(item.sku, new Set(uniqueGallery));
    if (uniqueGallery.length > 100) throw new Error(`Gallery exceeds 100 images for ${item.sku}`);
    if (uniqueGallery.length !== product.images.length) {
      const saved = await commerce.updateProductFieldsBySku(item.sku, { gallery: uniqueGallery }, { id: admin.id });
      if (saved.images.length !== uniqueGallery.length) throw new Error(`Gallery verify failed for ${item.sku}`);
    }
    console.log(`IMAGES ${attachments.length}/${plan.expectedRows}`);
  }
  const publishable = plan.products.filter(item => item.rows.length === 1 && new Set(item.rows.map(row => row.salePrice)).size === 1 && !missingImages.some(row => row.sku === item.sku) && urlsBySku.get(item.sku)?.size > 0).map(item => item.sku);
  if (publishable.length) await prisma.product.updateMany({ where: { sku: { in: publishable }, status: 'DRAFT', price: { not: null } }, data: { status: 'ACTIVE' } });
  const verified = await prisma.product.findMany({ where: { sku: { in: skus } }, include: { images: true, sphereItems: true, sphereStoneType: { include: { group: true } } } });
  verify(verified);
  for (const item of plan.products) {
    const product = verified.find(row => row.sku === item.sku);
    if (product.images.length !== urlsBySku.get(item.sku)?.size) throw new Error(`Image count mismatch for ${item.sku}`);
    const prices = salePriceList(item);
    const expectsPrice = item.rows.length === 1 && prices.length === 1;
    const shouldBeActive = expectsPrice && !missingImages.some(row => row.sku === item.sku) && urlsBySku.get(item.sku)?.size > 0;
    if (expectsPrice ? (Number(product.price) !== prices[0] || product.status !== (shouldBeActive ? 'ACTIVE' : 'DRAFT')) : (product.price !== null || product.status !== 'DRAFT')) throw new Error(`Publication/price verification failed for ${item.sku}`);
  }
  receipt = await prisma.inventoryReceipt.findFirst({ where: { note: { contains: plan.batch } }, select: { receiptNo: true, status: true, pos365SyncStatus: true, totalQuantityKg: true } });
  const result = { receipt, categories: ['Vật Phẩm → Túi Tiền', 'Vật Phẩm → Trứng', 'Vật Phẩm → Kim Tự Tháp'], products: 7, physicalItems: 60, totalKg: 316.79, imagesInR2: attachments.length, imagesMissing: missingImages.length, missingImageRows: missingImages, activeProducts: verified.filter(row => row.status === 'ACTIVE').length, draftProducts: verified.filter(row => row.status === 'DRAFT').length, purchaseCostBasis: 'per item legacy sale price / 3, divided by grouped total kg and rounded to integer VND/kg', localOnly: true, posWrites: false, noteRows: 37 };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(root, 'r2-attachments.json'), JSON.stringify(attachments, null, 2));
  console.log('WEIGHTED_ITEM_IMPORT_RESULT ' + JSON.stringify(result));
} finally {
  media.onModuleDestroy();
  pos.onModuleDestroy();
  await prisma.$disconnect();
}
