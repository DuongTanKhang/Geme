import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { MediaAssetsService } from "./media-assets.service.js";

function dedicatedTestDatabase(value: string | undefined) {
  if (!value) return false;
  try { const url = new URL(value); return ["localhost", "127.0.0.1", "::1", "postgres"].includes(url.hostname) && /(test|integration|ci)/i.test(decodeURIComponent(url.pathname)); }
  catch { return false; }
}
const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "1" && dedicatedTestDatabase(process.env.DATABASE_URL);
let prisma: PrismaService | null = null;
let actorId = "";
const productIds: string[] = [];
const postIds: string[] = [];
const assetIds: string[] = [];
const sourcePrefix = `media-cleanup-ci/${randomUUID()}/`;

class FakeR2Storage {
  readonly usesR2 = true;
  readonly usesPrivateR2 = false;
  readonly objects = new Set<string>();
  readonly deleted: string[] = [];
  failDeleteCount = 0;
  pauseDelete: (() => Promise<void>) | null = null;
  bucketName() { return "ci-media-bucket"; }
  publicUrl(key: string) { return `https://cdn.example.invalid/${key}`; }
  async putPublicObject(key: string) { this.objects.add(key); }
  async putPrivateObject(key: string) { this.objects.add(key); }
  async deletePublicObject(key: string) {
    if (this.pauseDelete) await this.pauseDelete();
    this.deleted.push(key);
    if (this.failDeleteCount > 0) { this.failDeleteCount--; throw new Error("fake storage timeout"); }
    this.objects.delete(key);
  }
  async deletePrivateObject(key: string) { await this.deletePublicObject(key); }
  async getPublicObject(key: string) { return Buffer.from(key); }
  async getPrivateObject(key: string) { return Buffer.from(key); }
}
const storage = new FakeR2Storage();
let media: MediaAssetsService;

before(async () => {
  if (!enabled) return;
  prisma = new PrismaService();
  await prisma.$connect();
  const admin = await prisma.adminUser.create({ data: { email: `media-ci-${randomUUID()}@example.invalid`, passwordHash: "test-only", displayName: "Media cleanup CI" } });
  actorId = admin.id;
  media = new MediaAssetsService(prisma, storage as never);
});

after(async () => {
  if (!prisma) return;
  const db = prisma;
  if (postIds.length) await db.socialPost.deleteMany({ where: { id: { in: postIds } } });
  if (productIds.length) await db.product.deleteMany({ where: { id: { in: productIds } } });
  if (assetIds.length) await db.mediaAsset.deleteMany({ where: { id: { in: assetIds } } });
  await db.mediaObjectCleanup.deleteMany({ where: { bucketName: "ci-media-bucket", objectKey: { startsWith: "media/" } } });
  if (actorId) await db.adminUser.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

async function saveAsset(sourceKey = sourcePrefix + randomUUID(), bytes = new Uint8Array([1, 2, 3, 4])) {
  const asset = await media.save({ filename: "ci.webp", sourceKey, mimeType: "image/webp", bytes });
  assetIds.push(asset.id);
  return asset;
}
async function makeProduct() {
  const id = randomUUID();
  const product = await prisma!.product.create({ data: { id, sku: `MCI${id.replaceAll("-", "").slice(0, 12)}`, name: "Media cleanup CI", slug: `media-cleanup-${id}`, kind: "JEWELRY", status: "HIDDEN", stock: 0 } });
  productIds.push(product.id);
  return product;
}


test("R2 cleanup protects shared objects, Social and legacy product URLs, retries failures, serializes re-attach, and is idempotent", { skip: !enabled }, async (t) => {
  if (!prisma) throw new Error("Dedicated PostgreSQL test database is not connected.");

  await t.test("two MediaAsset rows with identical bytes share object ownership", async () => {
    const first = await saveAsset();
    const second = await saveAsset();
    assert.equal(first.objectKey, second.objectKey);
    assert.equal(storage.objects.has(first.objectKey!), true);
    assert.equal(await media.removeUnreferencedAsset(first.id), true);
    assert.equal(storage.objects.has(first.objectKey!), true);
    assert.equal(await prisma!.mediaAsset.count({ where: { objectKey: first.objectKey } }), 1);
    assert.equal(await media.removeUnreferencedAsset(second.id), true);
    assert.equal(storage.objects.has(first.objectKey!), false);
    assert.equal(await prisma!.mediaObjectCleanup.count({ where: { objectKey: first.objectKey } }), 0);
  });

  await t.test("Social FK reference prevents both row and object deletion", async () => {
    const asset = await saveAsset();
    const post = await prisma!.socialPost.create({ data: { title: "Media cleanup social", createdByAdminId: actorId } });
    postIds.push(post.id);
    await prisma!.socialPostTarget.create({ data: { postId: post.id, platform: "FACEBOOK_PAGE", caption: "CI media ref", mediaAssetId: asset.id } });
    assert.equal(await media.removeUnreferencedAsset(asset.id), false);
    assert.equal(await prisma!.mediaAsset.count({ where: { id: asset.id } }), 1);
    assert.equal(storage.objects.has(asset.objectKey!), true);
  });

  await t.test("legacy product gallery URL prevents object deletion", async () => {
    const asset = await saveAsset();
    const product = await makeProduct();
    await prisma!.productImage.create({ data: { productId: product.id, url: asset.url, isPrimary: true } });
    assert.equal(await media.removeUnreferencedAsset(asset.id), false);
    assert.equal(await prisma!.mediaAsset.count({ where: { id: asset.id } }), 1);
    assert.equal(storage.objects.has(asset.objectKey!), true);
  });

  await t.test("failed database attach queues and removes only the newly uploaded unreferenced object", async () => {
    const bytes = Buffer.from(randomUUID());
    const objectKey = `media/${createHash("sha256").update(bytes).digest("hex")}.webp`;
    await assert.rejects(media.save({ filename: "x".repeat(241), sourceKey: sourcePrefix + "failed-attach-" + randomUUID(), mimeType: "image/webp", bytes }));
    assert.equal(storage.objects.has(objectKey), true);
    const cleanup = await prisma!.mediaObjectCleanup.findFirstOrThrow({ where: { bucketName: "ci-media-bucket", objectKey } });
    await prisma!.mediaObjectCleanup.update({ where: { id: cleanup.id }, data: { nextAttemptAt: new Date(0) } });
    await media.processPendingObjectCleanups();
    assert.equal(await prisma!.mediaAsset.count({ where: { objectKey } }), 0);
    assert.equal(storage.objects.has(objectKey), false);
  });

  await t.test("storage delete timeout leaves a retryable cleanup and repeated cleanup is safe", async () => {
    const asset = await saveAsset();
    storage.failDeleteCount = 1;
    assert.equal(await media.removeUnreferencedAsset(asset.id), true);
    const pending = await prisma!.mediaObjectCleanup.findFirstOrThrow({ where: { objectKey: asset.objectKey } });
    assert.equal(pending.attemptCount, 1);
    assert.equal(storage.objects.has(asset.objectKey!), true);
    await prisma!.mediaObjectCleanup.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date(0) } });
    await media.processPendingObjectCleanups();
    assert.equal(storage.objects.has(asset.objectKey!), false);
    assert.equal(await prisma!.mediaObjectCleanup.count({ where: { id: pending.id } }), 0);
    assert.equal(await media.removeUnreferencedAsset(asset.id), true);
  });

  await t.test("save and final cleanup serialize by object key so a new owner never points to a deleted object", async () => {
    const oldAsset = await saveAsset();
    let enteredDelete!: () => void;
    const deleteEntered = new Promise<void>((resolve) => { enteredDelete = resolve; });
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    storage.pauseDelete = async () => { storage.pauseDelete = null; enteredDelete(); await deleteGate; };
    const removing = media.removeUnreferencedAsset(oldAsset.id);
    await deleteEntered;
    let saveFinished = false;
    const reattached = media.save({ filename: "reattached.webp", sourceKey: sourcePrefix + "reattached-" + randomUUID(), mimeType: "image/webp", bytes: new Uint8Array([1, 2, 3, 4]) }).then((asset) => { assetIds.push(asset.id); saveFinished = true; return asset; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(saveFinished, false, "new asset write must wait while R2 cleanup holds the object lock");
    releaseDelete();
    await removing;
    const newAsset = await reattached;
    assert.equal(newAsset.objectKey, oldAsset.objectKey);
    assert.equal(storage.objects.has(oldAsset.objectKey!), true);
    assert.equal(await prisma!.mediaAsset.count({ where: { objectKey: oldAsset.objectKey } }), 1);
  });
});
