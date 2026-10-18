import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
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

@Injectable()
export class MediaAssetsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: MediaStorageService) {}

  async save(input: SaveMediaInput) {
    const sourceKey = input.sourceKey || null;
    const isPrivate = input.isPrivate === true;
    // Private originals and pending AI outputs use a separate non-public bucket
    // when configured. Otherwise they remain private BYTEA records in PostgreSQL.
    const useR2 = isPrivate ? this.storage.usesPrivateR2 : this.storage.usesR2;
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/").pop() || "bin";
    const objectKey = useR2 ? `${isPrivate ? "private-media" : "media"}/${digest}.${extension}` : null;
    if (useR2 && objectKey) {
      if (isPrivate) await this.storage.putPrivateObject(objectKey, input.bytes, input.mimeType);
      else await this.storage.putPublicObject(objectKey, input.bytes, input.mimeType);
    }

    const data = {
      filename: input.filename,
      sourceKey,
      mimeType: input.mimeType,
      isPrivate,
      storageProvider: useR2 ? "r2" : "database",
      objectKey,
      data: useR2 ? null : new Uint8Array(input.bytes),
      size: input.bytes.byteLength,
      alt: input.alt || null,
    };
    const select = { id: true, filename: true, sourceKey: true, mimeType: true, isPrivate: true, storageProvider: true, objectKey: true, size: true, alt: true, createdAt: true } as const;
    const asset = sourceKey
      ? await this.prisma.mediaAsset.upsert({
          where: { sourceKey },
          create: data,
          update: input.updateExisting ? data : {},
          select,
        })
      : await this.prisma.mediaAsset.create({ data, select });
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
      select: { id: true, filename: true, sourceKey: true, mimeType: true, isPrivate: true, storageProvider: true, objectKey: true, size: true, alt: true, createdAt: true, updatedAt: true },
    });
    if (!metadata) return null;
    // Avoid loading a BYTEA column for R2-backed files, especially on the
    // redirect path used when a public CDN domain is configured.
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
      return asset.isPrivate ? this.storage.getPrivateObject(asset.objectKey) : this.storage.getPublicObject(asset.objectKey);
    }
    if (asset.data) return Buffer.from(asset.data);
    throw new ServiceUnavailableException("Media chưa có dữ liệu trong database hoặc object storage.");
  }

  async removeUnreferencedAsset(id: string) {
    const asset = await this.findById(id);
    const referenced = await this.prisma.aiImageItem.findFirst({
      where: { OR: [{ originalAssetId: id }, { outputAssetId: id }, { publishedAssetId: id }] },
      select: { id: true },
    });
    if (referenced) return false;
    if (asset.storageProvider === "r2" && asset.objectKey) {
      if (asset.isPrivate) await this.storage.deletePrivateObject(asset.objectKey);
      else await this.storage.deletePublicObject(asset.objectKey);
    }
    await this.prisma.mediaAsset.deleteMany({ where: { id } });
    return true;
  }
}
