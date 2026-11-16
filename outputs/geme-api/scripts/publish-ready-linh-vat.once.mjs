import { PrismaService } from '../dist/prisma/prisma.service.js';
const db = new PrismaService();
if (!['host.docker.internal','127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local DB only');
try {
  await db.$connect();
  const category = await db.category.findUnique({ where: { slug: 'linh-vat' } });
  if (!category || category.parentId == null) throw new Error('Linh Vật category is missing');
  const products = await db.product.findMany({ where: { categoryId: category.id }, include: { images: true } });
  if (products.length !== 47) throw new Error(`Expected 47 products, got ${products.length}`);
  if (products.some(p => p.stock !== 1 || Number(p.price) <= 0)) throw new Error('Stock/price precondition failed');
  const ready = products.filter(p => p.images.length > 0);
  const pending = products.filter(p => p.images.length === 0);
  if (ready.length !== 37 || pending.length !== 10) throw new Error(`Image precondition failed: ready=${ready.length}, pending=${pending.length}`);
  const updated = await db.product.updateMany({ where: { id: { in: ready.map(p => p.id) }, status: 'DRAFT' }, data: { status: 'ACTIVE' } });
  const verified = await db.product.findMany({ where: { categoryId: category.id }, select: { sku: true, status: true, price: true, stock: true, images: { select: { id: true } } } });
  const invalid = verified.filter(p => p.images.length ? p.status !== 'ACTIVE' : p.status !== 'DRAFT');
  if (invalid.length) throw new Error(`Publish verification failed for ${invalid.map(p => p.sku).join(',')}`);
  console.log(JSON.stringify({ products: verified.length, activated: updated.count, activeWithImage: verified.filter(p => p.status === 'ACTIVE').length, draftMissingImage: verified.filter(p => p.status === 'DRAFT').length, posWrites: false, localOnly: true }));
} finally { await db.$disconnect(); }
