import { readFile, writeFile } from "node:fs/promises";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const sourcePath = new URL("../import-data/weight-managed-item-source-audit-20261115.json", import.meta.url);
const outputPath = new URL("../import-data/weight-managed-item-media-source-matches-20261115.json", import.meta.url);
const sourceRows = JSON.parse(await readFile(sourcePath, "utf8"));
const filenames = [...new Set(sourceRows.map((row) => row.legacyImage).filter(Boolean))];
const prisma = new PrismaService();
try {
  await prisma.$connect();
  const assets = await prisma.mediaAsset.findMany({
    where: { filename: { in: filenames } },
    select: { id: true, filename: true, sourceKey: true, objectKey: true, storageProvider: true, bucketName: true, alt: true },
  });
  await writeFile(outputPath, JSON.stringify(assets, null, 2), "utf8");
  console.log(JSON.stringify({ legacyFilenames: filenames.length, mediaAssetExactNameMatches: assets.length, output: "import-data/weight-managed-item-media-source-matches-20261115.json" }, null, 2));
} finally {
  await prisma.$disconnect();
}
