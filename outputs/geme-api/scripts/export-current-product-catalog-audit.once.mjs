import fs from 'node:fs';
import { PrismaService } from '../dist/prisma/prisma.service.js';

const allowed = new Set(['localhost', '127.0.0.1', 'host.docker.internal', 'sqlserver']);
if (!allowed.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only local DB is allowed');
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const rows = await prisma.product.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, sku: true, name: true, slug: true, kind: true, status: true,
      price: true, stock: true, stockKg: true, categoryId: true,
      description: true, createdAt: true, soldOutAt: true,
      category: { select: { name: true, slug: true } },
    },
  });
  const receiptItems = await prisma.inventoryReceiptItem.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, productId: true, productSku: true, productName: true, categoryName: true,
      createdAt: true, receipt: { select: { receiptNo: true, note: true, receivedAt: true } },
    },
  });
  fs.writeFileSync('import-data/current-products-source-reconciliation-20261115.json', JSON.stringify(rows, null, 2));
  fs.writeFileSync('import-data/current-receipt-items-source-reconciliation-20261115.json', JSON.stringify(receiptItems, null, 2));
  console.log(JSON.stringify({ localOnly: true, products: rows.length, receiptLines: receiptItems.length, output: 'import-data/current-products-source-reconciliation-20261115.json' }));
} finally {
  await prisma.$disconnect();
}
