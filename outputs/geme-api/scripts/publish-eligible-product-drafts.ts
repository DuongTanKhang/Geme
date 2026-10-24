import "reflect-metadata";
import { CommerceService } from "../src/commerce/commerce.service.js";
import { MediaAssetsService } from "../src/media/media-assets.service.js";
import { MediaStorageService } from "../src/media/media-storage.service.js";
import { Pos365Service } from "../src/pos365/pos365.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

type Candidate = {
  id: string;
  sku: string;
  name: string;
  kind: "JEWELRY" | "GEMSTONE";
  status: string;
  price: unknown;
  stock: number;
  description: string | null;
  fullDescription: string | null;
  category: { name: string; slug: string; kind: string; level: number } | null;
  gemstoneType: { name: string } | null;
  materialOption: { name: string; kind: string } | null;
  images: Array<{ url: string; alt: string | null; isPrimary: boolean; sortOrder: number }>;
  variants: Array<{ sku: string | null; price: unknown; stock: number; shape: string | null; quality: string | null; beadSize: string | null }>;
};

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limitArg = process.argv.slice(2).find((value) => value.startsWith("--limit="));
const requestedLimit = limitArg ? Number(limitArg.slice("--limit=".length)) : Number.POSITIVE_INFINITY;
if (!(requestedLimit === Number.POSITIVE_INFINITY || (Number.isInteger(requestedLimit) && requestedLimit >= 1))) {
  throw new Error("--limit must be a positive integer.");
}

const parsePrice = (value: unknown) => Number(value ?? 0);
const safeShort = (value: string) => {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 160) return text;
  const shortened = text.slice(0, 157).replace(/\s+\S*$/, "").trim();
  return `${shortened || text.slice(0, 157)}…`;
};

function productFacts(product: Candidate) {
  const gemstone = product.gemstoneType?.name || (product.materialOption?.kind === "STONE" ? product.materialOption.name : undefined);
  const material = product.kind === "JEWELRY" ? "Bạc" : product.materialOption?.kind === "MATERIAL" ? product.materialOption.name : undefined;
  return {
    sku: product.sku,
    name: product.name,
    ...(product.category?.name ? { category: product.category.name } : {}),
    ...(gemstone ? { gemstone } : {}),
    ...(material ? { material } : {}),
  };
}

function isEligible(product: Candidate) {
  const hasPrice = product.variants.length
    ? product.variants.every((variant) => parsePrice(variant.price) > 0)
    : parsePrice(product.price) > 0;
  const hasStock = product.variants.length
    ? product.variants.reduce((total, variant) => total + variant.stock, 0) > 0
    : product.stock > 0;
  return product.status === "DRAFT" && product.images.length > 0 && hasPrice && hasStock;
}

async function imageBytesFor(media: MediaAssetsService, imageUrl: string) {
  const match = imageUrl.match(/^\/media\/([0-9a-f-]{36})\/?$/i);
  if (!match) throw new Error("IMAGE_URL_NOT_SUPPORTED");
  const asset = await media.findById(match[1]);
  if (asset.isPrivate) throw new Error("PRODUCT_IMAGE_IS_PRIVATE");
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(asset.mimeType)) throw new Error("UNSUPPORTED_IMAGE_TYPE");
  if (asset.size > 8 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  return { bytes: await media.read(asset), mimeType: asset.mimeType, filename: asset.filename };
}

async function generateDescriptions(product: Candidate, media: MediaAssetsService, catalogs: {
  categories: string[];
  materials: string[];
  gemstones: string[];
}) {
  const image = [...product.images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)[0];
  const { bytes, mimeType, filename } = await imageBytesFor(media, image.url);
  const form = new FormData();
  form.append("image_file", new Blob([Uint8Array.from(bytes)], { type: mimeType }), filename);
  form.append("category_options", JSON.stringify(catalogs.categories));
  form.append("material_options", JSON.stringify(catalogs.materials));
  form.append("gemstone_options", JSON.stringify(catalogs.gemstones));
  form.append("verified_product_json", JSON.stringify(productFacts(product)));

  const coreUrl = (process.env.AI_CORE_URL || "http://ai-core:8000").replace(/\/+$/, "");
  const secret = process.env.AI_CORE_SHARED_SECRET?.trim() || "";
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("AI_CORE_NOT_CONFIGURED");
  const response = await fetch(`${coreUrl}/internal/products/generate-draft`, {
    method: "POST",
    headers: { "X-AI-Core-Key": secret },
    body: form,
    signal: AbortSignal.timeout(150_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { detail?: unknown } | null;
    const code = typeof error?.detail === "string" && /^[A-Z0-9_]{3,80}$/.test(error.detail) ? error.detail : `AI_CORE_HTTP_${response.status}`;
    throw new Error(code);
  }
  const envelope = await response.json() as { result?: Record<string, unknown> };
  const result = envelope.result;
  if (!result || typeof result !== "object") throw new Error("AI_CORE_INVALID_RESPONSE");
  const shortDescription = typeof result.short_description === "string" ? safeShort(result.short_description) : "";
  const detailedDescription = typeof result.detailed_description === "string" ? result.detailed_description.trim() : "";
  const reasons = Array.isArray(result.review_reasons) ? result.review_reasons.filter((reason): reason is string => typeof reason === "string") : [];
  const genericFallback = shortDescription.startsWith("Thiết kế trang sức GEME được mô tả từ")
    || detailedDescription.startsWith("Bản mô tả trung tính dựa trên hình ảnh đã duyệt.");
  if (shortDescription.length < 35 || detailedDescription.length < 80 || genericFallback || reasons.includes("UNVERIFIED_PRODUCT_CLAIM_REMOVED")) {
    throw new Error("AI_COPY_NEEDS_REVIEW");
  }
  return { shortDescription, detailedDescription };
}

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const media = new MediaAssetsService(prisma, new MediaStorageService());
  const commerce = new CommerceService(prisma, new Pos365Service(prisma), media);
  const admins = await prisma.adminUser.findMany({ where: { isActive: true }, select: { id: true, role: true }, orderBy: { createdAt: "asc" } });
  const admin = admins.find(({ role }) => role === "SUPER_ADMIN") || admins.find(({ role }) => role === "ADMIN");
  if (!admin) throw new Error("ACTIVE_ADMIN_NOT_FOUND");
  const actor = { id: admin.id, correlationId: `product-agent-bulk-${new Date().toISOString()}` };

  const [products, categories, materials, gemstoneCategories, gemstones] = await Promise.all([
    prisma.product.findMany({
      where: { status: "DRAFT" },
      select: {
        id: true, sku: true, name: true, kind: true, status: true, price: true, stock: true,
        description: true, fullDescription: true,
        category: { select: { name: true, slug: true, kind: true, level: true } },
        gemstoneType: { select: { name: true } },
        materialOption: { select: { name: true, kind: true } },
        images: { select: { url: true, alt: true, isPrimary: true, sortOrder: true }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] },
        variants: { select: { sku: true, price: true, stock: true, shape: true, quality: true, beadSize: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ sku: "asc" }],
    }) as Promise<Candidate[]>,
    prisma.category.findMany({ where: { status: "ACTIVE", usage: "PRODUCT_CATEGORY", level: { lte: 3 } }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.materialOption.findMany({ where: { active: true, kind: "MATERIAL" }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.category.findMany({ where: { status: "ACTIVE", usage: "GEMSTONE_TYPE", level: 2 }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
    prisma.materialOption.findMany({ where: { active: true, kind: "STONE" }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 300 }),
  ]);
  const eligible = products.filter(isEligible);
  const picked = eligible.slice(0, requestedLimit);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", draftProducts: products.length, eligibleWithImagePriceStock: eligible.length, selected: picked.length }));
  if (!apply) {
    console.log(JSON.stringify({ sampleSkus: picked.slice(0, 12).map(({ sku }) => sku) }));
    process.exitCode = 0;
  } else {
    const catalogs = {
      categories: [...new Set(categories.map(({ name }) => name))],
      materials: [...new Set(materials.map(({ name }) => name))],
      gemstones: [...new Set([...gemstoneCategories, ...gemstones].map(({ name }) => name))],
    };
    let published = 0;
    let skipped = 0;
    let nextIndex = 0;
    let stopForProviderError = false;
    const processOne = async (product: Candidate) => {
      try {
        let descriptions: { shortDescription: string; detailedDescription: string } | null = null;
        if (!product.description?.trim() || !product.fullDescription?.trim()) {
          descriptions = await generateDescriptions(product, media, catalogs);
          const update: Record<string, string> = {};
          if (!product.description?.trim()) update.description = descriptions.shortDescription;
          if (!product.fullDescription?.trim()) update.fullDescription = descriptions.detailedDescription;
          await commerce.updateProductFields(product.id, update, actor);
        }
        await commerce.updateProductPublication(product.id, "ACTIVE", actor, "AI Product tạo mô tả, Admin duyệt và đăng bán");
        published += 1;
        console.log(JSON.stringify({ sku: product.sku, result: "PUBLISHED", generated: Boolean(descriptions) }));
      } catch (error) {
        skipped += 1;
        const code = error instanceof Error ? error.message : "PROCESSING_FAILED";
        if (["OPENAI_PRODUCT_QUOTA_EXCEEDED", "OPENAI_PRODUCT_AUTH_FAILED", "OPENAI_NOT_CONFIGURED"].includes(code)) stopForProviderError = true;
        console.log(JSON.stringify({ sku: product.sku, result: "SKIPPED", code: /^[A-Z0-9_:-]{3,120}$/.test(code) ? code : "PUBLISH_VALIDATION_FAILED" }));
      }
    };
    const worker = async () => {
      while (!stopForProviderError) {
        const index = nextIndex++;
        if (index >= picked.length) return;
        await processOne(picked[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, picked.length) }, () => worker()));
    const remainingNotStarted = Math.max(0, picked.length - nextIndex);
    skipped += remainingNotStarted;
    console.log(JSON.stringify({ result: "COMPLETE", published, skipped }));
    if (stopForProviderError) console.log(JSON.stringify({ stopped: "AI_PROVIDER_CONFIGURATION_OR_QUOTA", remainingNotStarted }));
  }
} finally {
  await prisma.$disconnect();
}
