import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

type PublishAudit = { entityId: string | null; createdAt: Date; before: unknown; after: unknown };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Thiếu DATABASE_URL; script dừng mà không sửa dữ liệu.");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
let dedicatedLocalTestDatabase = false;
try {
  const parsedUrl = new URL(connectionString);
  dedicatedLocalTestDatabase = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
    && /(test|integration|ci)/i.test(decodeURIComponent(parsedUrl.pathname));
} catch { /* invalid connection strings are rejected before --apply */ }
const productionLike = process.env.NODE_ENV === "production" || /geme\.vn|prod(?:uction)?|live/i.test(connectionString);
if (apply && (productionLike || !dedicatedLocalTestDatabase || !args.has("--confirm-nonproduction"))) {
  throw new Error("Chỉ cho phép --apply --confirm-nonproduction trên database cục bộ riêng có tên test/integration/ci; production, staging và URL chưa xác minh đều bị chặn.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4 }) });

function auditPublishedAt(event: PublishAudit) {
  const before = event.before && typeof event.before === "object" && !Array.isArray(event.before) ? event.before as Record<string, unknown> : {};
  const after = event.after && typeof event.after === "object" && !Array.isArray(event.after) ? event.after as Record<string, unknown> : {};
  if (String(after.status || "").toUpperCase() !== "ACTIVE" || String(before.status || "").toUpperCase() === "ACTIVE") return null;
  const value = after.firstPublishedAt;
  if (typeof value === "string" || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return { date, explicit: true };
  }
  return { date: event.createdAt, explicit: false };
}

try {
  const events: PublishAudit[] = await prisma.auditLog.findMany({
    where: { entityType: "PRODUCT", action: "PRODUCT_PUBLISHED", entityId: { not: null } },
    select: { entityId: true, createdAt: true, before: true, after: true },
    orderBy: [{ entityId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const datesByProduct = new Map<string, { dates: Date[]; explicitDates: Date[] }>();
  for (const event of events) {
    if (!event.entityId) continue;
    const evidence = auditPublishedAt(event);
    if (!evidence) continue;
    const dates = datesByProduct.get(event.entityId) || { dates: [], explicitDates: [] };
    dates.dates.push(evidence.date);
    if (evidence.explicit) dates.explicitDates.push(evidence.date);
    datesByProduct.set(event.entityId, dates);
  }

  const evidence = [...datesByProduct.entries()].map(([productId, dates]) => {
    const distinctExplicit = [...new Set(dates.explicitDates.map((date) => date.toISOString()))].sort();
    const distinctObserved = [...new Set(dates.dates.map((date) => date.toISOString()))].sort();
    const earliestObservation = distinctObserved[0];
    const earliestExplicit = distinctExplicit[0];
    const conflictingEvidence = distinctExplicit.length > 1 || Boolean(earliestObservation && earliestExplicit && earliestObservation < earliestExplicit);
    const firstKnown = earliestExplicit || earliestObservation;
    return { productId, firstPublishedAt: new Date(firstKnown), conflictingEvidence };
  });
  const productIds = evidence.map((item) => item.productId);
  const products = productIds.length ? await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, firstPublishedAt: true, publicationHistoryKnown: true },
  }) : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const eligible = evidence.filter((item) => byId.get(item.productId)?.publicationHistoryKnown && !byId.get(item.productId)?.firstPublishedAt && !item.conflictingEvidence);
  const alreadySet = evidence.filter((item) => Boolean(byId.get(item.productId)?.firstPublishedAt)).length;
  const conflicting = evidence.filter((item) => item.conflictingEvidence).length;
  const missingProduct = evidence.filter((item) => !byId.has(item.productId)).length;
  const productsWithoutPublishAuditEvidence = await prisma.product.count({ where: {
    firstPublishedAt: null,
    publicationHistoryKnown: true,
    ...(productIds.length ? { id: { notIn: productIds } } : {}),
  } });

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    productsWithoutPublishAuditEvidence,
    auditProductsWithPublishEvidence: evidence.length,
    eligibleForBackfill: eligible.length,
    alreadyHasFirstPublishedAt: alreadySet,
    conflictingAuditEvidence: conflicting,
    auditReferencesMissingProducts: missingProduct,
    wouldSet: eligible.slice(0, 25).map((item) => ({ sku: byId.get(item.productId)?.sku, firstPublishedAt: item.firstPublishedAt.toISOString() })),
  }, null, 2));

  if (apply) {
    let updated = 0;
    for (const item of eligible) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const current = await tx.product.findUnique({ where: { id: item.productId }, select: { sku: true, firstPublishedAt: true, publicationHistoryKnown: true } });
        if (!current || current.firstPublishedAt) return;
        const before = { firstPublishedAt: current.firstPublishedAt, publicationHistoryKnown: current.publicationHistoryKnown };
        await tx.product.update({ where: { id: item.productId }, data: { firstPublishedAt: item.firstPublishedAt, publicationHistoryKnown: true } });
        await tx.auditLog.create({ data: {
          action: "PRODUCT_FIRST_PUBLISHED_AT_BACKFILLED",
          entityType: "PRODUCT",
          entityId: item.productId,
          before,
          after: { firstPublishedAt: item.firstPublishedAt, evidence: "PRODUCT_PUBLISHED audit log" },
        } });
        updated += 1;
        console.log(`Backfilled ${current.sku}: ${item.firstPublishedAt.toISOString()}`);
      });
    }
    console.log(`Đã cập nhật ${updated}/${eligible.length} sản phẩm; chạy lại script không ghi đè ngày đã có.`);
  } else {
    console.log("Dry-run mặc định: không có bản ghi nào bị thay đổi. Chạy --apply --confirm-nonproduction chỉ trên database test cục bộ đã xác minh.");
  }
} finally {
  await prisma.$disconnect();
}
