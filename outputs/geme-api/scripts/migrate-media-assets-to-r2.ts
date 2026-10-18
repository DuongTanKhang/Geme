import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { MediaStorageService } from "../src/media/media-storage.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
if ((process.env.MEDIA_STORAGE_PROVIDER || "").toLowerCase() !== "r2") throw new Error("Set MEDIA_STORAGE_PROVIDER=r2 before running this migration.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const storage = new MediaStorageService();
const batchSize = 20;
let migrated = 0;

try {
  while (true) {
    const candidates = await prisma.mediaAsset.findMany({
      where: { storageProvider: "database", isPrivate: false, data: { not: null } },
      select: { id: true, filename: true, mimeType: true, size: true },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    if (!candidates.length) break;

    for (const candidate of candidates) {
      const current = await prisma.mediaAsset.findUnique({ where: { id: candidate.id }, select: { data: true } });
      if (!current?.data?.length) {
        throw new Error(`Cannot migrate ${candidate.id}: media bytes are missing.`);
      }
      const bytes = Buffer.from(current.data);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const extension = candidate.mimeType === "image/jpeg" ? "jpg" : candidate.mimeType.split("/").pop() || "bin";
      const objectKey = `media/${digest}.${extension}`;
      await storage.putPublicObject(objectKey, bytes, candidate.mimeType);
      // Drop the database blob only after the remote upload returned success.
      await prisma.mediaAsset.update({
        where: { id: candidate.id },
        data: { storageProvider: "r2", objectKey, data: null },
      });
      migrated++;
      console.log(`Migrated ${migrated}: ${candidate.filename} (${candidate.size} bytes)`);
    }
  }
  console.log(`Completed R2 migration for ${migrated} media assets.`);
} finally {
  await prisma.$disconnect();
}
