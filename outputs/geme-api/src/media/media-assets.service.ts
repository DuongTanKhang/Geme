import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { MediaStorageService } from "./media-storage.service.js";
import type { MediaAsset } from "../generated/prisma/client.js";

type SaveMediaInput = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sourceKey?: string | null;
  isPrivate?: boolean;
  alt?: string | null;
  updateExisting?: boolean;
};

type MediaReferenceShape = { id: string; isPrivate: boolean; storageProvider: string; bucketName: string | null; objectKey: string | null; sourceKey: string | null };

export async function lockMediaObject(tx: any, bucketName: string, objectKey: string, isPrivate: boolean) {
  const lockKey = `geme-media:${bucketName}:${isPrivate ? "private" : "public"}:${objectKey}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

@Injectable()
export class MediaAssetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaAssetsService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService, private readonly storage: MediaStorageService) {}

  onModuleInit() {
    void this.processPendingObjectCleanups().catch(() => this.logger.warn("Initial R2 cleanup retry did not finish."));
    this.cleanupTimer = setInterval(() => {
      void this.processPendingObjectCleanups().catch(() => this.logger.warn("Scheduled R2 cleanup retry did not finish."));
    }, 30_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async save(input: SaveMediaInput) {
    const sourceKey = input.sourceKey || null;
    const isPrivate = input.isPrivate === true;
    const useR2 = isPrivate ? this.storage.usesPrivateR2 : this.storage.usesR2;
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/").pop() || "bin";
    const objectKey = useR2 ? `${isPrivate ? "private-media" : "media"}/${digest}.${extension}` : null;
    const bucketName = useR2 ? this.storage.bucketName(isPrivate) : "";
    const data = {
      filename: input.filename,
      sourceKey,
      mimeType: input.mimeType,
      isPrivate,
      storageProvider: useR2 ? "r2" : "database",
      bucketName: useR2 ? bucketName : null,
      objectKey,
      data: useR2 ? null : new Uint8Array(input.bytes),
      size: input.bytes.byteLength,
      alt: input.alt || null,
    };
    const select = { id: true, filename: true, sourceKey: true, mimeType: true, isPrivate: true, storageProvider: true, bucketName: true, objectKey: true, size: true, alt: true, createdAt: true } as const;
    let objectWriteAttempted = false;
    const persist = async (db: any) => {
      if (sourceKey && !input.updateExisting) {
        const prior = await db.mediaAsset.findUnique({ where: { sourceKey }, select });
        if (prior) return prior;
      }
      if (useR2 && objectKey) {
        objectWriteAttempted = true;
        if (isPrivate) await this.storage.putPrivateObject(objectKey, input.bytes, input.mimeType);
        else await this.storage.putPublicObject(objectKey, input.bytes, input.mimeType);
        await db.mediaObjectCleanup.deleteMany({ where: { storageProvider: "r2", bucketName, objectKey, isPrivate } });
      }
      return sourceKey
        ? db.mediaAsset.upsert({ where: { sourceKey }, create: data, update: input.updateExisting ? data : {}, select })
        : db.mediaAsset.create({ data, select });
    };
    let asset: Awaited<ReturnType<typeof persist>>;
    try {
      asset = useR2 && objectKey
        ? await this.prisma.$transaction(async (tx) => {
            await this.lockObject(tx, bucketName, objectKey, isPrivate);
            return persist(tx);
          }, { maxWait: 10_000, timeout: 90_000 })
        : await persist(this.prisma);
    } catch (error) {
      if (objectWriteAttempted && bucketName && objectKey) {
        await this.queueUnreferencedObjectCleanup(bucketName, objectKey, isPrivate, sourceKey).catch(() => undefined);
      }
      throw error;
    }
    return { ...asset, url: this.urlFor(asset) };
  }

  urlFor(asset: Pick<MediaAsset, "id" | "isPrivate" | "storageProvider" | "objectKey" | "sourceKey">) {
    if (!asset.isPrivate && asset.storageProvider === "r2" && asset.objectKey) {
      return this.storage.publicUrl(asset.objectKey) || `/media/${asset.id}`;
    }
    return `/media/${asset.id}`;
  }

  async findById(id: string) {
    const asset = await this.findAsset({ id });
    if (!asset) throw new NotFoundException("Không tìm thấy media trong thư viện.");
    return asset;
  }

  async findPublicByAssetKey(key: string) {
    let decodedKey: string;
    try { decodedKey = decodeURIComponent(key); } catch { throw new NotFoundException("Không tìm thấy media trong thư viện."); }
    const safeKey = `assets/${decodedKey.replace(/^\/+/, "")}`;
    const asset = await this.findAsset({ sourceKey: safeKey });
    if (!asset || asset.isPrivate) throw new NotFoundException("Không tìm thấy media trong thư viện.");
    return asset;
  }

  private async findAsset(where: { id: string } | { sourceKey: string }): Promise<MediaAsset | null> {
    const metadata = await this.prisma.mediaAsset.findUnique({
      where,
      select: { id: true, filename: true, sourceKey: true, mimeType: true, isPrivate: true, storageProvider: true, bucketName: true, objectKey: true, size: true, alt: true, createdAt: true, updatedAt: true },
    });
    if (!metadata) return null;
    const storedData = metadata.storageProvider === "r2"
      ? null
      : (await this.prisma.mediaAsset.findUnique({ where, select: { data: true } }))?.data ?? null;
    return { ...metadata, data: storedData } as MediaAsset;
  }

  publicDeliveryUrl(asset: MediaAsset) {
    if (asset.isPrivate || asset.storageProvider !== "r2" || !asset.objectKey) return null;
    return this.storage.publicUrl(asset.objectKey);
  }

  async read(asset: MediaAsset) {
    if (asset.storageProvider === "r2" && asset.objectKey) {
      return asset.isPrivate
        ? this.storage.getPrivateObject(asset.objectKey, asset.bucketName || undefined)
        : this.storage.getPublicObject(asset.objectKey, asset.bucketName || undefined);
    }
    if (asset.data) return Buffer.from(asset.data);
    throw new ServiceUnavailableException("Media chưa có dữ liệu trong database hoặc object storage.");
  }

  async removeUnreferencedAsset(id: string) {
    const metadata = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, sourceKey: true, isPrivate: true, storageProvider: true, bucketName: true, objectKey: true },
    });
    if (!metadata) return true;
    const bucketName = metadata.storageProvider === "r2" ? metadata.bucketName || this.storage.bucketName(metadata.isPrivate) : "";
    let cleanupId: string | null = null;
    try {
      const removed = await this.prisma.$transaction(async (tx) => {
        if (metadata.storageProvider === "r2" && metadata.objectKey) await this.lockObject(tx, bucketName, metadata.objectKey, metadata.isPrivate);
        const asset = await tx.mediaAsset.findUnique({ where: { id }, select: { id: true, sourceKey: true, isPrivate: true, storageProvider: true, bucketName: true, objectKey: true } });
        if (!asset) return true;
        const urls = this.referenceUrls(asset);
        if (await this.hasReferences(tx, asset, urls)) return false;
        await tx.mediaAsset.delete({ where: { id } });
        if (asset.storageProvider === "r2" && asset.objectKey) {
          const sibling = await tx.mediaAsset.findFirst({ where: { id: { not: id }, storageProvider: "r2", objectKey: asset.objectKey, isPrivate: asset.isPrivate, OR: [{ bucketName }, { bucketName: null }] }, select: { id: true } });
          if (sibling) {
            await tx.mediaObjectCleanup.deleteMany({ where: { storageProvider: "r2", bucketName, objectKey: asset.objectKey, isPrivate: asset.isPrivate } });
          } else {
            const cleanup = await tx.mediaObjectCleanup.upsert({
              where: { storageProvider_bucketName_objectKey_isPrivate: { storageProvider: "r2", bucketName, objectKey: asset.objectKey, isPrivate: asset.isPrivate } },
              create: { storageProvider: "r2", bucketName, objectKey: asset.objectKey, isPrivate: asset.isPrivate, urlCandidates: urls },
              update: { nextAttemptAt: new Date(), lastErrorCode: null, urlCandidates: urls },
              select: { id: true },
            });
            cleanupId = cleanup.id;
          }
        }
        return true;
      }, { maxWait: 10_000, timeout: 90_000 });
      if (!removed) return false;
    } catch (error) {
      if ((error as { code?: string })?.code === "P2003" || (error as { code?: string })?.code === "P2014") return false;
      throw error;
    }
    if (cleanupId) await this.processObjectCleanup(cleanupId);
    return true;
  }

  async processPendingObjectCleanups(limit = 10) {
    const jobs = await this.prisma.mediaObjectCleanup.findMany({
      where: { nextAttemptAt: { lte: new Date() } }, orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(25, limit)), select: { id: true },
    });
    for (const job of jobs) await this.processObjectCleanup(job.id);
    return jobs.length;
  }

  private async processObjectCleanup(id: string) {
    const job = await this.prisma.mediaObjectCleanup.findUnique({ where: { id } });
    if (!job) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockObject(tx, job.bucketName, job.objectKey, job.isPrivate);
        const current = await tx.mediaObjectCleanup.findUnique({ where: { id } });
        if (!current) return;
        const sibling = await tx.mediaAsset.findFirst({ where: { storageProvider: "r2", objectKey: job.objectKey, isPrivate: job.isPrivate, OR: [{ bucketName: job.bucketName }, { bucketName: null }] }, select: { id: true } });
        if (sibling || await this.hasLegacyReferences(tx, job.urlCandidates || [])) {
          await tx.mediaObjectCleanup.deleteMany({ where: { id } });
          return;
        }
        if (job.isPrivate) await this.storage.deletePrivateObject(job.objectKey, job.bucketName);
        else await this.storage.deletePublicObject(job.objectKey, job.bucketName);
        await tx.mediaObjectCleanup.deleteMany({ where: { id } });
      }, { maxWait: 10_000, timeout: 90_000 });
    } catch (error) {
      const attempts = Math.min(12, Number(job.attemptCount || 0) + 1);
      const delay = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 10));
      await this.prisma.mediaObjectCleanup.updateMany({ where: { id }, data: { attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + delay), lastErrorCode: error instanceof Error && /timeout/i.test(error.message) ? "R2_TIMEOUT" : "R2_DELETE_FAILED" } }).catch(() => undefined);
      this.logger.warn(`R2 object cleanup remains queued after attempt ${attempts}.`);
    }
  }

  private async lockObject(tx: any, bucketName: string, objectKey: string, isPrivate: boolean) {
    await lockMediaObject(tx, bucketName, objectKey, isPrivate);
  }

  private async queueUnreferencedObjectCleanup(bucketName: string, objectKey: string, isPrivate: boolean, sourceKey: string | null) {
    const urls = new Set<string>();
    if (!isPrivate) {
      const publicUrl = this.storage.publicUrl(objectKey);
      if (publicUrl) urls.add(publicUrl);
    }
    if (sourceKey?.startsWith("assets/")) {
      const path = sourceKey.slice("assets/".length);
      urls.add(`/api/v1/media/assets/${path.split("/").map(encodeURIComponent).join("/")}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockObject(tx, bucketName, objectKey, isPrivate);
      const sibling = await tx.mediaAsset.findFirst({ where: { storageProvider: "r2", objectKey, isPrivate, OR: [{ bucketName }, { bucketName: null }] }, select: { id: true } });
      if (sibling || await this.hasLegacyReferences(tx, [...urls])) return;
      await tx.mediaObjectCleanup.upsert({
        where: { storageProvider_bucketName_objectKey_isPrivate: { storageProvider: "r2", bucketName, objectKey, isPrivate } },
        create: { storageProvider: "r2", bucketName, objectKey, isPrivate, urlCandidates: [...urls] },
        update: { nextAttemptAt: new Date(), lastErrorCode: null, urlCandidates: [...urls] },
      });
    }, { maxWait: 10_000, timeout: 90_000 });
  }

  private referenceUrls(asset: MediaReferenceShape) {
    const urls = new Set<string>([`/media/${asset.id}`, `/api/v1/media/${asset.id}`]);
    if (asset.sourceKey?.startsWith("assets/")) {
      const path = asset.sourceKey.slice("assets/".length);
      urls.add(`/api/v1/media/assets/${path.split("/").map(encodeURIComponent).join("/")}`);
    }
    if (!asset.isPrivate && asset.storageProvider === "r2" && asset.objectKey) {
      const publicUrl = this.storage.publicUrl(asset.objectKey);
      if (publicUrl) urls.add(publicUrl);
    }
    return [...urls];
  }

  private async hasReferences(tx: any, asset: MediaReferenceShape, urls: string[]) {
    const [ai, productMedia, social, gallery, productFields, variants, pos] = await Promise.all([
      tx.aiImageItem.findFirst({ where: { OR: [{ originalAssetId: asset.id }, { outputAssetId: asset.id }, { publishedAssetId: asset.id }] }, select: { id: true } }),
      tx.productMediaAsset.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
      tx.socialPostTarget.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
      tx.productImage.findFirst({ where: { url: { in: urls } }, select: { id: true } }),
      tx.product.findFirst({ where: { OR: [{ coverVideoUrl: { in: urls } }, { technicalImageUrl: { in: urls } }, { technicalVideoUrl: { in: urls } }] }, select: { id: true } }),
      tx.productPriceVariant.findFirst({ where: { OR: [{ videoUrl: { in: urls } }, ...(urls.length ? [{ imageUrls: { hasSome: urls } }] : [])] }, select: { id: true } }),
      tx.pos365ProductImageSync.findFirst({ where: { imageUrl: { in: urls } }, select: { id: true } }),
    ]);
    return Boolean(ai || productMedia || social || gallery || productFields || variants || pos);
  }

  private async hasLegacyReferences(tx: any, urls: string[]) {
    if (!urls.length) return false;
    const [gallery, productFields, variants, pos] = await Promise.all([
      tx.productImage.findFirst({ where: { url: { in: urls } }, select: { id: true } }),
      tx.product.findFirst({ where: { OR: [{ coverVideoUrl: { in: urls } }, { technicalImageUrl: { in: urls } }, { technicalVideoUrl: { in: urls } }] }, select: { id: true } }),
      tx.productPriceVariant.findFirst({ where: { OR: [{ videoUrl: { in: urls } }, { imageUrls: { hasSome: urls } }] }, select: { id: true } }),
      tx.pos365ProductImageSync.findFirst({ where: { imageUrl: { in: urls } }, select: { id: true } }),
    ]);
    return Boolean(gallery || productFields || variants || pos);
  }
}
