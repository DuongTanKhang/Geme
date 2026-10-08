import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const dataImage = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/i;
const cachedUrls = new Map<string, string>();

async function storeDataImage(value: string, alt: string) {
  if (!value.startsWith("data:image/")) return value;
  const cached = cachedUrls.get(value);
  if (cached) return cached;
  const match = dataImage.exec(value);
  if (!match) return value;
  const mimeType = match[1].toLocaleLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) return value;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  const sourceKey = `blog/${digest}.${extension}`;
  const asset = await prisma.mediaAsset.upsert({
    where: { sourceKey },
    create: { filename: `blog-${digest}.${extension}`, sourceKey, mimeType, data: bytes, size: bytes.length, alt: alt.slice(0, 240) || null },
    update: {},
    select: { id: true },
  });
  const url = `/media/${asset.id}`;
  cachedUrls.set(value, url);
  return url;
}

try {
  const posts = await prisma.blogPost.findMany({
    select: { id: true, title: true, content: true, coverImageUrl: true, images: { select: { id: true, url: true } } },
  });
  let updatedPosts = 0;
  let migratedImages = 0;
  for (const post of posts) {
    const coverImageUrl = post.coverImageUrl ? await storeDataImage(post.coverImageUrl, post.title) : null;
    let content = post.content;
    const sources = new Set([...content.matchAll(/data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+/gi)].map((match) => match[0]));
    for (const source of sources) {
      const target = await storeDataImage(source, post.title);
      if (target !== source) content = content.split(source).join(target);
    }
    const imageUrls = await Promise.all(post.images.map(async (image) => ({ id: image.id, oldUrl: image.url, url: await storeDataImage(image.url, post.title) })));
    const changedImages = imageUrls.filter((image) => image.url !== image.oldUrl);
    const changed = coverImageUrl !== post.coverImageUrl || content !== post.content || changedImages.length > 0;
    if (!changed) continue;
    await prisma.$transaction([
      prisma.blogPost.update({ where: { id: post.id }, data: { coverImageUrl, content } }),
      ...changedImages.map((image) => prisma.blogPostImage.update({ where: { id: image.id }, data: { url: image.url } })),
    ]);
    updatedPosts++;
    migratedImages += changedImages.length + (coverImageUrl !== post.coverImageUrl ? 1 : 0) + sources.size;
  }
  console.log(`Migrated ${migratedImages} blog image references across ${updatedPosts} posts.`);
} finally {
  await prisma.$disconnect();
}
