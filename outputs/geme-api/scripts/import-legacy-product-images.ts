import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Queue } from "bullmq";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client.js";
import { AI_QUEUE_DEFAULT_JOB_OPTIONS, AI_STUDIO_QUEUE, redisConnectionOptions } from "../src/ai-studio/ai-studio.queue.js";
import { MediaStorageService } from "../src/media/media-storage.service.js";

type ImagePlanRow = {
  productId: string;
  sku: string;
  productName: string;
  legacyProductName: string;
  status: "DRAFT";
  category: string | null;
  gemstone: string | null;
  legacyProductId: string;
  sourceFilename: string;
  sourceObjectKey: string;
  filename: string;
  role: string;
  isPrimary: boolean;
  objectKey: string;
  size: number;
  sortOrder: number;
};

type ProductImagePlan = { images: ImagePlanRow[] };
const planPath = process.argv.find((value) => value.endsWith(".json")) || "/tmp/legacy-product-image-plan.json";
const apply = process.argv.includes("--apply");
const attachOnly = process.argv.includes("--attach-only");
const MAX_HEADS = 12;
const PUBLIC_SOURCE_PREFIX = "legacy-sql/product-image/";
const PRIVATE_SOURCE_PREFIX = "legacy-sql/product-agent-input/";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const mediaStorage = new MediaStorageService();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const mimeTypeFor = (filename: string) => {
  const ext = filename.toLocaleLowerCase("en").split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpeg" || ext === "jpg") return "image/jpeg";
  throw new Error(`Unsupported image extension: ${ext || "none"}`);
};

function validatePlan(value: unknown): ImagePlanRow[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as ProductImagePlan).images)) throw new Error("Invalid legacy image plan.");
  const images = (value as ProductImagePlan).images;
  if (images.length > 20_000) throw new Error("Legacy image plan is too large.");
  const keys = new Set<string>();
  for (const image of images) {
    if (!image || typeof image !== "object") throw new Error("Invalid image row.");
    if (!/^[0-9a-f-]{36}$/i.test(image.productId) || !image.sku || image.sku.length > 64 || image.status !== "DRAFT") throw new Error("Invalid product match.");
    if (!image.sourceFilename || image.sourceFilename !== image.sourceFilename.split(/[\\/]/).at(-1) || image.sourceFilename.length > 240) throw new Error("Unsafe legacy filename.");
    if (!/^[A-Za-z0-9._-]{1,100}-[1-9][0-9]{0,3}\.(?:jpe?g|png|webp)$/i.test(image.filename)) throw new Error("Image display filename must be SKU-sequence based.");
    const safeSku = image.sku.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
    if (image.sourceObjectKey !== `legacy-product-images/${image.sourceFilename}` || image.objectKey !== `product-images/${safeSku}/${image.filename}`) throw new Error("Unexpected SKU image object key.");
    if (!Number.isSafeInteger(image.size) || image.size < 1 || image.size > 2_147_483_647) throw new Error("Invalid object size.");
    if (typeof image.isPrimary !== "boolean" || !Number.isInteger(image.sortOrder) || image.sortOrder < 0) throw new Error("Invalid image order.");
    const unique = `${image.productId}\n${image.filename}`;
    if (keys.has(unique)) throw new Error("Duplicate product image in import plan.");
    keys.add(unique);
  }
  return images;
}

async function verifyObjects(images: ImagePlanRow[]) {
  const unique = [...new Map(images.map((row) => [row.objectKey, row])).values()];
  for (let offset = 0; offset < unique.length; offset += MAX_HEADS) {
    const group = unique.slice(offset, offset + MAX_HEADS);
    const results = await Promise.all(group.map(async (row) => {
      const response = await mediaStorage.headPublicObject(row.objectKey);
      if (!response.ok) throw new Error(`R2 object is unavailable: ${row.filename} (HTTP ${response.status}).`);
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length !== row.size) throw new Error(`R2 size mismatch for ${row.filename}.`);
      return row.filename;
    }));
    if (!results.length) throw new Error("No R2 objects were verified.");
  }
  return unique.length;
}

function privateSourceKey(sku: string, filename: string) {
  return `${PRIVATE_SOURCE_PREFIX}${encodeURIComponent(sku)}/${filename}`.slice(0, 500);
}

async function main() {
  const rows = validatePlan(JSON.parse(await readFile(planPath, "utf8")));
  if (!rows.length) throw new Error("No matching product images in plan.");
  const productSkus = [...new Set(rows.map(({ sku }) => sku))];
  const products = await prisma.product.findMany({
    where: { sku: { in: productSkus } },
    select: { id: true, sku: true, name: true, status: true, _count: { select: { images: true } } },
  });
  const productBySku = new Map(products.map((product) => [product.sku.toLocaleUpperCase("en"), product]));
  for (const row of rows) {
    const product = productBySku.get(row.sku.toLocaleUpperCase("en"));
    if (!product || product.id !== row.productId || product.name !== row.productName || product.status !== "DRAFT") {
      throw new Error(`Exact SKU/database verification failed for ${row.sku}; no rows were changed.`);
    }
  }

  const verifiedObjects = await verifyObjects(rows);
  const grouped = new Map<string, ImagePlanRow[]>();
  for (const row of rows) grouped.set(row.productId, [...(grouped.get(row.productId) || []), row]);
  const descriptionRows = [...grouped.values()].flatMap((group) => {
    const eligible = group.filter(({ size }) => size <= 8 * 1024 * 1024);
    const selected = eligible.find(({ isPrimary }) => isPrimary) || eligible[0];
    return selected ? [selected] : [];
  });
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", attachOnly, exactSkuMatches: grouped.size, productImageRows: rows.length, r2ObjectsVerified: verifiedObjects, productDraftsToGenerate: attachOnly ? 0 : descriptionRows.length, skippedAgentImagesOver8MiB: attachOnly ? 0 : grouped.size - descriptionRows.length }));
    return;
  }

  const admin = await prisma.adminUser.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!admin) throw new Error("No active Admin identity is available to own the AI drafts.");

  const publicSourceKeys = [...new Set(rows.map(({ productId, filename }) => `${PUBLIC_SOURCE_PREFIX}${productId}/${filename}`))];
  const publicAssetsBefore = await prisma.mediaAsset.findMany({ where: { sourceKey: { in: publicSourceKeys } }, select: { id: true, filename: true, sourceKey: true, storageProvider: true, objectKey: true, isPrivate: true } });
  const expectedPublicObjectBySource = new Map(rows.map((row) => [`${PUBLIC_SOURCE_PREFIX}${row.productId}/${row.filename}`, row.objectKey]));
  for (const asset of publicAssetsBefore) {
    if (asset.storageProvider !== "r2" || asset.objectKey !== expectedPublicObjectBySource.get(asset.sourceKey!) || asset.isPrivate) throw new Error(`Existing public media mapping conflicts for ${asset.filename}.`);
  }
  const assetIdByFilename = new Map(publicAssetsBefore.map((asset) => [asset.sourceKey!.slice(PUBLIC_SOURCE_PREFIX.length), asset.id]));

  const existingProductImages = await prisma.productImage.findMany({
    where: { productId: { in: [...grouped.keys()] } },
    select: { id: true, productId: true, url: true, sortOrder: true, isPrimary: true },
  });
  const productImageKeys = new Set(existingProductImages.map((image) => `${image.productId}\n${image.url}`));
  const nextSortOrder = new Map<string, number>();
  const hasPrimary = new Map<string, boolean>();
  for (const productId of grouped.keys()) {
    const existing = existingProductImages.filter((image) => image.productId === productId);
    nextSortOrder.set(productId, Math.max(-1, ...existing.map(({ sortOrder }) => sortOrder)) + 1);
    hasPrimary.set(productId, existing.some(({ isPrimary }) => isPrimary));
  }

  const summary = await prisma.$transaction(async (transaction) => {
    const publicAssetIdByFilename = new Map(assetIdByFilename);
    for (const row of rows) {
      const assetKey = `${row.productId}/${row.filename}`;
      if (publicAssetIdByFilename.has(assetKey)) continue;
      const asset = await transaction.mediaAsset.create({
        data: {
          filename: row.filename.slice(0, 240), sourceKey: `${PUBLIC_SOURCE_PREFIX}${assetKey}`,
          mimeType: mimeTypeFor(row.filename), isPrivate: false, storageProvider: "r2",
          objectKey: row.objectKey, data: null, size: row.size, alt: row.productName.slice(0, 240),
        },
        select: { id: true },
      });
      publicAssetIdByFilename.set(assetKey, asset.id);
    }

    let attached = 0;
    const primaryImageByProduct = new Map<string, { row: ImagePlanRow; assetId: string }>();
    for (const row of rows) {
      const assetId = publicAssetIdByFilename.get(`${row.productId}/${row.filename}`)!;
      const url = `/media/${assetId}`;
      if (!productImageKeys.has(`${row.productId}\n${url}`)) {
        const isPrimary = row.isPrimary && !hasPrimary.get(row.productId);
        await transaction.productImage.create({
          data: {
            productId: row.productId,
            url,
            alt: row.productName.slice(0, 240),
            sortOrder: nextSortOrder.get(row.productId)!,
            isPrimary,
          },
        });
        productImageKeys.add(`${row.productId}\n${url}`);
        nextSortOrder.set(row.productId, nextSortOrder.get(row.productId)! + 1);
        if (isPrimary) hasPrimary.set(row.productId, true);
        attached++;
      }
      const previous = primaryImageByProduct.get(row.productId);
      const withinAgentLimit = row.size <= 8 * 1024 * 1024;
      if (withinAgentLimit && (!previous || row.isPrimary)) primaryImageByProduct.set(row.productId, { row, assetId });
    }

    if (attachOnly) {
      if (attached) {
        await transaction.auditLog.create({
          data: {
            adminId: admin.id,
            action: "LEGACY_PRODUCT_IMAGE_IMPORT",
            entityType: "product_image_migration",
            entityId: [...grouped.keys()][0],
            after: { products: grouped.size, productImages: attached, matching: "EXACT_SKU", status: "DRAFT_ONLY", aiDraftsQueued: 0 },
          },
        });
      }
      return { attached, newAiImageItems: 0, taskRows: [] as { id: string; draftId: string; itemId: string }[] };
    }

    const importItemRows: { row: ImagePlanRow; publicAssetId: string; privateAssetId: string }[] = [];
    for (const [productId, selected] of primaryImageByProduct) {
      const { row } = selected;
      const sourceKey = privateSourceKey(row.sku, row.filename);
      const existingAsset = await transaction.mediaAsset.findUnique({ where: { sourceKey }, select: { id: true, storageProvider: true, objectKey: true, isPrivate: true } });
      if (existingAsset && (existingAsset.storageProvider !== "r2" || existingAsset.objectKey !== row.objectKey || !existingAsset.isPrivate)) {
        throw new Error(`Existing private Product Agent media mapping conflicts for ${row.sku}.`);
      }
      const privateAsset = existingAsset || await transaction.mediaAsset.create({
        data: {
          filename: row.filename.slice(0, 240), sourceKey, mimeType: mimeTypeFor(row.filename),
          isPrivate: true, storageProvider: "r2", objectKey: row.objectKey, data: null,
          size: row.size, alt: row.productName.slice(0, 240),
        },
        select: { id: true, storageProvider: true, objectKey: true, isPrivate: true },
      });
      importItemRows.push({ row, publicAssetId: selected.assetId, privateAssetId: privateAsset.id });
    }

    const existingItems = await transaction.aiImageItem.findMany({
      where: { originalAssetId: { in: importItemRows.map(({ privateAssetId }) => privateAssetId) } },
      select: { id: true, originalAssetId: true, outputAssetId: true, status: true, qcReport: true },
    });
    for (const item of existingItems) {
      if (!item.outputAssetId || item.status !== "APPROVED") throw new Error("Existing Product Agent image is not in an approved state.");
    }
    const itemByAsset = new Map(existingItems.map((item) => [item.originalAssetId!, item]));
    const newItems = importItemRows.filter(({ privateAssetId }) => !itemByAsset.has(privateAssetId));
    let imageBatchId: string | null = null;
    if (newItems.length) {
      imageBatchId = randomUUID();
      const imageManifestHash = hash(newItems.map(({ privateAssetId }) => privateAssetId).sort().join("\\n"));
      await transaction.aiImageBatch.create({
        data: {
          id: imageBatchId,
          idempotencyKey: `legacy-image-import:v1:${imageManifestHash.slice(0, 48)}`,
          manifestHash: imageManifestHash,
          name: "SQL cũ · Ảnh sản phẩm khớp SKU",
          preset: "STONE_GREY",
          purpose: "PRODUCT_PHOTO",
          status: "COMPLETE",
          totalBytes: BigInt(newItems.reduce((sum, { row }) => sum + row.size, 0)),
          createdByAdminId: admin.id,
        },
      });
      for (const { row, privateAssetId } of newItems) {
        const qcReport: Prisma.InputJsonObject = {
          source: "LEGACY_SQL",
          verifiedSku: row.sku,
          verifiedProductId: row.productId,
          legacyProductId: row.legacyProductId,
          legacyProductName: row.legacyProductName.slice(0, 240),
          objectKey: row.objectKey,
          originalFilename: row.filename,
          sourceFilename: row.sourceFilename,
          sourceObjectKey: row.sourceObjectKey,
          note: "Ảnh gốc; chưa qua Visual Agent. SKU và hồ sơ được đối chiếu chính xác trong database mới.",
        };
        const item = await transaction.aiImageItem.create({
          data: {
            batchId: imageBatchId,
            originalAssetId: privateAssetId,
            outputAssetId: privateAssetId,
            originalFilename: row.filename.slice(0, 240),
            mimeType: mimeTypeFor(row.filename),
            expectedSize: row.size,
            classificationHint: `${row.category || "Trang sức"} · ${row.sku}`.slice(0, 120),
            classification: { source: "LEGACY_SQL", matchedBy: "EXACT_SKU", sku: row.sku, category: row.category, gemstone: row.gemstone } as Prisma.InputJsonObject,
            status: "APPROVED",
            qcStatus: "REVIEW",
            qcFlags: ["LEGACY_ORIGINAL_NOT_VISUAL_PROCESSED"],
            qcReport,
          },
          select: { id: true, originalAssetId: true, outputAssetId: true, status: true, qcReport: true },
        });
        itemByAsset.set(privateAssetId, item);
      }
    }

    const draftsToCreate = importItemRows.flatMap(({ row, privateAssetId }) => {
      const item = itemByAsset.get(privateAssetId);
      return item ? [{ row, itemId: item.id }] : [];
    });
    const existingDrafts = await transaction.aiProductDraft.findMany({
      where: { sourceImageItemId: { in: draftsToCreate.map(({ itemId }) => itemId) } },
      select: { sourceImageItemId: true },
    });
    const existingDraftItemIds = new Set(existingDrafts.map(({ sourceImageItemId }) => sourceImageItemId));
    const unseenDrafts = draftsToCreate.filter(({ itemId }) => !existingDraftItemIds.has(itemId));
    const taskRows: { id: string; draftId: string; itemId: string }[] = [];
    const batches: { id: string; idempotencyKey: string; manifestHash: string; rows: typeof unseenDrafts }[] = [];
    for (let offset = 0; offset < unseenDrafts.length; offset += 5) {
      const batchRows = unseenDrafts.slice(offset, offset + 5);
      const manifest = batchRows.map(({ row }) => row.sku).sort().join("\n");
      const digest = hash(manifest).slice(0, 48);
      const idempotencyKey = `legacy-product-drafts:v1:${digest}`;
      const manifestHash = hash(batchRows.map(({ itemId }) => itemId).sort().join("\n"));
      let batch = await transaction.aiProductDraftBatch.findUnique({ where: { idempotencyKey }, select: { id: true, manifestHash: true } });
      if (batch && batch.manifestHash !== manifestHash) throw new Error("Legacy Product Agent batch idempotency conflict.");
      if (!batch) batch = await transaction.aiProductDraftBatch.create({
        data: { idempotencyKey, manifestHash, createdByAdminId: admin.id }, select: { id: true, manifestHash: true },
      });
      batches.push({ id: batch.id, idempotencyKey, manifestHash, rows: batchRows });
    }
    for (const batch of batches) {
      for (const { row, itemId } of batch.rows) {
        const draftId = randomUUID();
        const taskId = randomUUID();
        const task = await transaction.aiTask.create({
          data: {
            id: taskId,
            idempotencyKey: `product-draft:legacy:${hash(row.sku).slice(0, 48)}`,
            requestedByAdminId: admin.id,
            type: "PRODUCT_DRAFT_GENERATION",
            title: `Product Agent · ${row.sku} · ${row.filename}`.slice(0, 120),
            input: { imageItemId: itemId, productDraftId: draftId, verifiedProductSku: row.sku, verifiedProductId: row.productId },
          },
          select: { id: true },
        });
        await transaction.aiProductDraft.create({ data: { id: draftId, batchId: batch.id, taskId: task.id, sourceImageItemId: itemId } });
        taskRows.push({ id: task.id, draftId, itemId });
      }
    }

    if (taskRows.length) {
      await transaction.auditLog.create({
        data: {
          adminId: admin.id,
          action: "LEGACY_PRODUCT_IMAGE_IMPORT",
          entityType: "product_image_migration",
          entityId: taskRows[0].itemId,
          after: { products: grouped.size, productImages: rows.length, aiDescriptionDrafts: taskRows.length, matching: "EXACT_SKU", status: "DRAFT_ONLY" },
        },
      });
    }
    return { attached, newAiImageItems: newItems.length, taskRows };
  }, { timeout: 120_000, maxWait: 20_000 });

  if (summary.taskRows.length) {
    const queue = new Queue(AI_STUDIO_QUEUE, { connection: redisConnectionOptions(), defaultJobOptions: AI_QUEUE_DEFAULT_JOB_OPTIONS });
    try {
      await queue.addBulk(summary.taskRows.map(({ id }) => ({ name: "process-task", data: { taskId: id }, opts: { jobId: id } })));
    } finally {
      await queue.close();
    }
  }
  console.log(JSON.stringify({ mode: "applied", attachOnly, exactSkuMatches: grouped.size, productImageRowsAdded: summary.attached, r2ObjectsVerified: verifiedObjects, aiImageItemsAdded: summary.newAiImageItems, productDescriptionDraftsQueued: summary.taskRows.length, skippedAgentImagesOver8MiB: attachOnly ? 0 : grouped.size - descriptionRows.length, publishedProductsChanged: 0, priceOrStockChanged: 0 }));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
