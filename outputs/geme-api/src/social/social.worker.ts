import "dotenv/config";
import { Logger } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { MediaStorageService } from "../media/media-storage.service.js";
import { redisConnectionOptions } from "../ai-studio/ai-studio.queue.js";
import { approvedSnapshotHash, socialCommerceSnapshot, socialCommerceSnapshotHash, socialPayloadHash } from "./social.contract.js";
import { decryptMetaToken, MetaRequestError, SocialMetaClient, type MetaPublishResult } from "./social-meta.client.js";
import { SOCIAL_PUBLISH_QUEUE, type SocialPublishPayload } from "./social.queue.js";
import { loadActiveStorePromotions } from "../commerce/checkout-pricing.js";

const logger = new Logger("SocialPublishWorker");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the social publishing worker.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const media = new MediaStorageService();
const meta = new SocialMetaClient();
const queue = new Queue<SocialPublishPayload>(SOCIAL_PUBLISH_QUEUE, { connection: redisConnectionOptions(true), defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86_400, count: 3000 }, removeOnFail: { age: 604_800, count: 5000 } } });

function aggregate(statuses: string[]) {
  if (!statuses.length) return "DRAFT" as const;
  if (statuses.every((status) => status === "PUBLISHED")) return "PUBLISHED" as const;
  if (statuses.some((status) => status === "UNKNOWN")) return "UNKNOWN" as const;
  if (statuses.some((status) => status === "PUBLISHING")) return "PUBLISHING" as const;
  if (statuses.some((status) => status === "SCHEDULED")) return "SCHEDULED" as const;
  if (statuses.some((status) => status === "PUBLISHED")) return "PARTIAL" as const;
  if (statuses.every((status) => status === "CANCELLED")) return "CANCELLED" as const;
  if (statuses.some((status) => status === "FAILED")) return "FAILED" as const;
  if (statuses.every((status) => status === "APPROVED")) return "APPROVED" as const;
  return "DRAFT" as const;
}

async function refreshPost(tx: Prisma.TransactionClient, postId: string, errorCode?: string | null) {
  const targets = await tx.socialPostTarget.findMany({ where: { postId }, select: { status: true } });
  await tx.socialPost.update({ where: { id: postId }, data: { status: aggregate(targets.map((target) => target.status)), ...(errorCode !== undefined ? { lastErrorCode: errorCode } : {}) } });
}

async function publish(job: Job<SocialPublishPayload>) {
  const { targetId, revision } = job.data;
  const claim = await prisma.$transaction(async (tx) => {
    const targetRef = await tx.$queryRaw<Array<{ post_id: string }>>`SELECT post_id FROM "social_post_targets" WHERE id = ${targetId}::uuid`;
    if (!targetRef.length) return null;
    const postLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "social_posts" WHERE id = ${targetRef[0]!.post_id}::uuid FOR UPDATE SKIP LOCKED`;
    if (!postLock.length) return null;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "social_post_targets" WHERE id = ${targetId}::uuid FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return null;
    const target = await tx.socialPostTarget.findUnique({ where: { id: targetId }, include: { post: { include: { sourceProduct: { select: { id: true, status: true, stock: true, variants: { select: { id: true, stock: true } } } } } }, account: { include: { connection: true } }, mediaAsset: true } });
    const account = target?.account;
    if (!target || target.status !== "SCHEDULED" || !target.publishRequestedAt || !target.accountId || !account || target.approvedRevision !== revision || target.post.revision !== revision || target.post.approvedRevision !== revision) return null;
    if (target.nextAttemptAt && target.nextAttemptAt > new Date()) return null;
    const rejectTarget = async (code: string) => {
      await tx.socialPostTarget.update({ where: { id: targetId }, data: { status: "FAILED", lastErrorCode: code, publishRequestedAt: null, nextAttemptAt: null } });
      await refreshPost(tx, target.postId, code);
      return null;
    };
    const currentHash = socialPayloadHash({ accountId: target.accountId, platform: target.platform, caption: target.caption, linkUrl: target.linkUrl, linkSource: target.linkSource, mediaAssetId: target.mediaAssetId });
    const approvedTargets = await tx.socialPostTarget.findMany({ where: { postId: target.postId }, select: { accountId: true, platform: true, caption: true, linkUrl: true, mediaAssetId: true } });
    const snapshotHash = approvedSnapshotHash(approvedTargets.map((item) => ({ accountId: item.accountId || "", platform: item.platform, caption: item.caption, linkUrl: item.linkUrl, mediaAssetId: item.mediaAssetId })));
    if (!target.approvedPayloadHash || target.approvedPayloadHash !== currentHash || !target.post.approvedSnapshotHash || target.post.approvedSnapshotHash !== snapshotHash) return rejectTarget("APPROVAL_SNAPSHOT_STALE");
    if (!account.active || !account.selected || account.connection.status !== "ACTIVE" || account.accessTokenCiphertext === "DISCONNECTED") return rejectTarget("META_CONNECTION_INACTIVE");
    const requiredScopes = target.platform === "INSTAGRAM"
      ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"]
      : ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
    if (requiredScopes.some((scope) => !account.connection.scopes.includes(scope))) {
      return rejectTarget("META_PERMISSION_MISSING");
    }
    const approvedCommerce = target.post.approvedCommerceSnapshot && typeof target.post.approvedCommerceSnapshot === "object" ? target.post.approvedCommerceSnapshot as Record<string, unknown> : null;
    const approvedProductId = typeof approvedCommerce?.productId === "string" ? approvedCommerce.productId : null;
    if ((approvedProductId && approvedProductId !== target.post.sourceProductId) || (target.linkSource === "PRODUCT" && !target.post.sourceProductId)) return rejectTarget("SOCIAL_PRODUCT_UNAVAILABLE");
    if (target.post.sourceProductId) {
      if (!target.post.approvedCommerceSnapshot || !target.post.approvedCommerceSnapshotHash) return rejectTarget("SOCIAL_PRICE_REVIEW_REQUIRED");
      const selectedVariant = target.post.sourceProductVariantId ? target.post.sourceProduct?.variants.find((variant) => variant.id === target.post.sourceProductVariantId) : null;
      if (target.post.sourceProductVariantId && !selectedVariant) return rejectTarget("SOCIAL_PRODUCT_VARIANT_UNAVAILABLE");
      if (selectedVariant && selectedVariant.stock <= 0) return rejectTarget("SOCIAL_PRODUCT_VARIANT_UNAVAILABLE");
      if (!target.post.sourceProduct || target.post.sourceProduct.status !== "ACTIVE" || !(target.post.sourceProductVariantId ? target.post.sourceProduct.variants.some((variant) => variant.id === target.post.sourceProductVariantId && variant.stock > 0) : (target.post.sourceProduct.stock > 0 || target.post.sourceProduct.variants.some((variant) => variant.stock > 0)))) return rejectTarget("SOCIAL_PRODUCT_UNAVAILABLE");
      const product = await tx.product.findUnique({ where: { id: target.post.sourceProductId }, select: { id: true, sku: true, name: true, price: true, originalPrice: true, kind: true, categoryId: true, gemstoneTypeId: true, category: { select: { pricingMode: true } }, variants: { select: { id: true, sku: true, price: true, originalPrice: true, carat: true, stock: true } } } });
      const variant = target.post.sourceProductVariantId ? product?.variants.find((item) => item.id === target.post.sourceProductVariantId) : null;
      if (!product || (target.post.sourceProductVariantId && !variant)) return rejectTarget("SOCIAL_PRICE_REVIEW_REQUIRED");
      const promotions = await loadActiveStorePromotions(tx);
      const currentCommerce = socialCommerceSnapshot(product, variant, promotions);
      if (socialCommerceSnapshotHash(currentCommerce) !== target.post.approvedCommerceSnapshotHash) return rejectTarget("SOCIAL_PRICE_CHANGED_AFTER_APPROVAL");
    }
    if (target.mediaAsset) {
      if (target.mediaAsset.isPrivate || target.mediaAsset.storageProvider !== "r2" || !target.mediaAsset.objectKey || !["image/jpeg", "image/png"].includes(target.mediaAsset.mimeType)) return rejectTarget("SOCIAL_MEDIA_NOT_PUBLIC");
      if (target.platform === "INSTAGRAM" && (target.mediaAsset.mimeType !== "image/jpeg" || target.mediaAsset.size > 8 * 1024 * 1024)) return rejectTarget("SOCIAL_INSTAGRAM_IMAGE_UNSUPPORTED");
      const [approvedOutput, approvedProductImage] = await Promise.all([
        tx.aiImageItem.findFirst({ where: { status: "APPROVED", qcStatus: "PASS", publishedAssetId: target.mediaAsset.id }, select: { id: true } }),
        tx.productMediaAsset.findFirst({ where: { mediaAssetId: target.mediaAsset.id, tag: "PRODUCT_IMAGE", approvedAt: { not: null } }, select: { id: true } }),
      ]);
      if (!approvedOutput && !approvedProductImage) return rejectTarget("SOCIAL_MEDIA_APPROVAL_REVOKED");
    }
    const attemptNumber = target.attemptCount + 1;
    await tx.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHING", attemptCount: attemptNumber, remoteContainerId: null, remoteMediaId: null, permalink: null, publishedAt: null } });
    await tx.socialPublishAttempt.create({ data: { targetId, revision, attemptNumber, idempotencyKey: `${targetId}:${revision}:${attemptNumber}`, status: "RUNNING" } });
    await tx.socialPost.update({ where: { id: target.postId }, data: { status: "PUBLISHING" } });
    return { ...target, account, attemptNumber };
  });
  if (!claim) return { skipped: true };

  let externalResult: MetaPublishResult | null = null;
  try {
    const token = decryptMetaToken(claim.account.accessTokenCiphertext);
    const imageUrl = claim.mediaAsset ? media.publicUrl(claim.mediaAsset.objectKey || "") : null;
    if (claim.mediaAsset && !imageUrl) throw new MetaRequestError("SOCIAL_MEDIA_CDN_NOT_CONFIGURED", false);
    externalResult = claim.platform === "INSTAGRAM"
      ? await meta.publishInstagram({ instagramId: claim.account.remoteAccountId, token, caption: claim.caption, imageUrl: imageUrl!, onContainerCreated: async (containerId) => {
        await prisma.$transaction(async (tx) => {
          const targetSaved = await tx.socialPostTarget.updateMany({ where: { id: targetId, status: "PUBLISHING", approvedRevision: revision }, data: { remoteContainerId: containerId } });
          const attemptSaved = await tx.socialPublishAttempt.updateMany({ where: { targetId, revision, attemptNumber: claim.attemptNumber, status: "RUNNING" }, data: { remoteContainerId: containerId } });
          if (targetSaved.count !== 1 || attemptSaved.count !== 1) throw new Error("SOCIAL_CONTAINER_AUDIT_SAVE_FAILED");
        });
      } })
      : await meta.publishFacebook({ pageId: claim.account.remoteAccountId, token, caption: claim.caption, linkUrl: claim.linkUrl, imageUrl });
    let permalink: string | null = null;
    try { permalink = await meta.permalink(externalResult.mediaId, token); } catch { /* The publish result remains successful if permalink lookup fails. */ }
    await prisma.$transaction([
      prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: "PUBLISHED", remoteContainerId: externalResult.containerId || null, remoteMediaId: externalResult.mediaId, permalink, publishedAt: new Date(), lastErrorCode: null, publishRequestedAt: null, nextAttemptAt: null } }),
      prisma.socialPublishAttempt.update({ where: { targetId_revision_attemptNumber: { targetId, revision, attemptNumber: claim.attemptNumber } }, data: { status: "SUCCEEDED", remoteContainerId: externalResult.containerId || null, remoteMediaId: externalResult.mediaId, finishedAt: new Date() } }),
    ]);
    await prisma.$transaction((tx) => refreshPost(tx, claim.postId, null));
    logger.log(JSON.stringify({ event: "social.publish.succeeded", postId: claim.postId, targetId, platform: claim.platform, remoteId: externalResult.mediaId }));
    return { published: true };
  } catch (error) {
    const metaError = error instanceof MetaRequestError ? error : null;
    const code = externalResult ? "SOCIAL_RESULT_PERSIST_FAILED" : metaError?.code || (error instanceof Error && error.message === "SOCIAL_ENCRYPTION_KEY_INVALID" ? "SOCIAL_ENCRYPTION_KEY_INVALID" : "SOCIAL_PUBLISH_FAILED");
    const unknown = Boolean(metaError?.unknownOutcome || externalResult);
    const reauth = Boolean(metaError?.reauthRequired);
    const canRetry = !unknown && !reauth && Boolean(metaError?.retryable) && claim.attemptNumber < 5;
    const retryAt = canRetry ? new Date(Date.now() + Math.min(60 * 60_000, 15_000 * (2 ** (claim.attemptNumber - 1)))) : null;
    await prisma.$transaction(async (tx) => {
      const targetStatus = unknown ? "UNKNOWN" : canRetry ? "SCHEDULED" : "FAILED";
      await tx.socialPostTarget.update({ where: { id: targetId }, data: { status: targetStatus, lastErrorCode: code, nextAttemptAt: retryAt, scheduledAt: retryAt || claim.scheduledAt, publishRequestedAt: canRetry ? (retryAt || new Date()) : null } });
      await tx.socialPublishAttempt.update({ where: { targetId_revision_attemptNumber: { targetId, revision, attemptNumber: claim.attemptNumber } }, data: { status: unknown ? "UNKNOWN" : "FAILED", errorCode: code, finishedAt: new Date() } });
      if (reauth) await tx.socialConnection.update({ where: { id: claim.account.connectionId }, data: { status: "REAUTH_REQUIRED" } });
      await refreshPost(tx, claim.postId, code);
    });
    logger.warn(JSON.stringify({ event: "social.publish.failed", postId: claim.postId, targetId, platform: claim.platform, code, unknownOutcome: unknown, retryScheduled: canRetry }));
    return { failed: true, code, retryScheduled: canRetry, unknownOutcome: unknown };
  }
}

async function recover() {
  // A worker restart cannot know whether an interrupted external request reached Meta.
  // Mark it UNKNOWN and force human reconciliation instead of risking duplicate posts.
  const staleBefore = new Date(Date.now() - 20 * 60_000);
  const interrupted = await prisma.socialPostTarget.findMany({ where: { status: "PUBLISHING", updatedAt: { lt: staleBefore } }, select: { id: true, postId: true, approvedRevision: true, attemptCount: true } });
  for (const target of interrupted) {
    await prisma.$transaction(async (tx) => {
      await tx.socialPostTarget.updateMany({ where: { id: target.id, status: "PUBLISHING" }, data: { status: "UNKNOWN", lastErrorCode: "WORKER_INTERRUPTED_UNKNOWN_OUTCOME", publishRequestedAt: null, nextAttemptAt: null } });
      await tx.socialPublishAttempt.updateMany({ where: { targetId: target.id, status: "RUNNING", ...(target.approvedRevision == null ? {} : { revision: target.approvedRevision }) }, data: { status: "UNKNOWN", errorCode: "WORKER_INTERRUPTED_UNKNOWN_OUTCOME", finishedAt: new Date() } });
      await refreshPost(tx, target.postId, "WORKER_INTERRUPTED_UNKNOWN_OUTCOME");
    });
  }
  const due = await prisma.socialPostTarget.findMany({ where: { status: "SCHEDULED", publishRequestedAt: { not: null }, nextAttemptAt: { lte: new Date() } }, select: { id: true, approvedRevision: true, nextAttemptAt: true } });
  const future = await prisma.socialPostTarget.findMany({ where: { status: "SCHEDULED", publishRequestedAt: { not: null }, nextAttemptAt: { gt: new Date() } }, select: { id: true, approvedRevision: true, nextAttemptAt: true } });
  for (const target of [...due, ...future]) if (target.approvedRevision != null) {
    const generation = target.nextAttemptAt || new Date();
    const jobId = `${target.id}-r${target.approvedRevision}-t${generation.getTime()}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") await existing.remove();
      else continue;
    }
    await queue.add("publish-approved-target", { targetId: target.id, revision: target.approvedRevision }, { jobId, delay: Math.max(0, generation.getTime() - Date.now()) });
  }
}

const worker = new Worker<SocialPublishPayload>(SOCIAL_PUBLISH_QUEUE, publish, { connection: redisConnectionOptions(true), concurrency: Math.max(1, Math.min(8, Number(process.env.SOCIAL_WORKER_CONCURRENCY) || 2)) });
worker.on("failed", (job, error) => logger.error(JSON.stringify({ event: "social.queue.job_failed", targetId: job?.data.targetId, code: error instanceof Error ? error.name : "JOB_FAILED" })));
worker.on("error", (error) => logger.error(JSON.stringify({ event: "social.queue.connection_error", code: error instanceof Error ? error.name : "REDIS_UNAVAILABLE" })));

await recover();
const recoveryTimer = setInterval(() => void recover().catch((error) => logger.error(JSON.stringify({ event: "social.queue.recovery_failed", code: error instanceof Error ? error.name : "RECOVERY_FAILED" }))), 15_000);
logger.log("Social publishing worker is ready.");

async function shutdown() {
  clearInterval(recoveryTimer);
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
}
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
