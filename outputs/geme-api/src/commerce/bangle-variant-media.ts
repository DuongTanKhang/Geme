import { BadRequestException } from "@nestjs/common";

export type BangleVariantMedia = {
  id?: string | null;
  sku?: string | null;
  shape?: string | null;
  quality?: string | null;
  beadSize?: string | null;
  imageUrls?: string[] | null;
  videoUrl?: string | null;
};

export const normalizeBangleQuality = (value: unknown) => String(value || "")
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleUpperCase("en");

function mediaKey(variant: BangleVariantMedia) {
  const images = (Array.isArray(variant.imageUrls) ? variant.imageUrls : []).map((url) => String(url || "").trim()).filter(Boolean);
  const video = typeof variant.videoUrl === "string" ? variant.videoUrl.trim() : "";
  return JSON.stringify({ images, video });
}
function hasMedia(variant: BangleVariantMedia) {
  return (Array.isArray(variant.imageUrls) && variant.imageUrls.some((url) => String(url || "").trim()))
    || Boolean(typeof variant.videoUrl === "string" && variant.videoUrl.trim());
}

function variantKey(variant: BangleVariantMedia) {
  return String(variant.id || variant.sku || "");
}

function groupsByQuality<T extends BangleVariantMedia>(variants: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const variant of variants) {
    const key = normalizeBangleQuality(variant.quality);
    groups.set(key, [...(groups.get(key) || []), variant]);
  }
  return groups;
}

function sharedMediaError(productSku: string, quality: string, variants: readonly BangleVariantMedia[]) {
  const label = quality || "(chưa có chất lượng)";
  const groupSkus = variants.map((variant) => String(variant.sku || "(chưa có SKU)")).join(", ");
  return new BadRequestException(`Kiềng SKU ${productSku}, chất lượng ${label} có bộ ảnh khác nhau giữa ${groupSkus}. Chọn một bộ ảnh chung cho mọi size/chất lượng tương ứng rồi lưu.`);
}

export function synchronizeBangleVariantMedia<T extends BangleVariantMedia>(
  productSku: string,
  variants: readonly T[],
  options: {
    changedVariantKeys?: ReadonlySet<string>;
    explicitVariantKeys?: ReadonlySet<string>;
    synchronizeQualities?: ReadonlySet<string>;
    existingVariants?: readonly T[];
    synchronizeAll?: boolean;
  } = {},
): T[] {
  const groups = groupsByQuality(variants);
  const previousGroups = groupsByQuality(options.existingVariants || []);
  const shared = new Map<string, { imageUrls: string[]; videoUrl: string | null }>();

  for (const [quality, group] of groups) {
    const changedRows = options.changedVariantKeys
      ? group.filter((variant) => options.changedVariantKeys!.has(variantKey(variant)))
      : [];
    const explicitRows = options.explicitVariantKeys
      ? group.filter((variant) => options.explicitVariantKeys!.has(variantKey(variant)))
      : [];
    const priorGroup = previousGroups.get(quality) || [];
    const priorMediaKeys = new Set(priorGroup.map(mediaKey));
    const hasLegacyConflict = priorMediaKeys.size > 1;
    const priorKeys = new Set(priorGroup.map(variantKey));
    const hasAddedSize = priorGroup.length > 0 && group.some((variant) => !priorKeys.has(variantKey(variant)));
    const shouldSynchronize = options.synchronizeAll
      || changedRows.length > 0
      || options.synchronizeQualities?.has(quality) === true
      || hasAddedSize
      || (hasLegacyConflict && explicitRows.length > 0);

    if (!shouldSynchronize) continue;
    if (hasLegacyConflict && !options.synchronizeAll && explicitRows.length !== group.length) {
      throw sharedMediaError(productSku, quality, priorGroup);
    }

    const sources = changedRows.length ? changedRows : explicitRows.length ? explicitRows : priorGroup.length ? priorGroup : group;
    const mediaSources = options.synchronizeAll && sources.some(hasMedia) ? sources.filter(hasMedia) : sources;
    const distinctMedia = new Map(mediaSources.map((variant) => [mediaKey(variant), variant]));
    if (distinctMedia.size > 1) throw sharedMediaError(productSku, quality, sources);

    const source = distinctMedia.values().next().value as T | undefined;
    const imageUrls = (Array.isArray(source?.imageUrls) ? source.imageUrls : []).map((url) => String(url || "").trim()).filter(Boolean);
    const videoUrl = typeof source?.videoUrl === "string" ? source.videoUrl.trim() || null : null;
    if (imageUrls.length + Number(Boolean(videoUrl)) > 8) {
      throw new BadRequestException(`Kiềng SKU ${productSku}, chất lượng ${quality || "(chưa có chất lượng)"} vượt quá 8 ảnh/video dùng chung.`);
    }
    shared.set(quality, { imageUrls, videoUrl });
  }

  return variants.map((variant) => {
    const media = shared.get(normalizeBangleQuality(variant.quality));
    return media ? { ...variant, imageUrls: [...media.imageUrls], videoUrl: media.videoUrl } : { ...variant };
  });
}

export function bangleQualitiesMissingImages(
  variants: readonly BangleVariantMedia[],
  qualityKeys?: ReadonlySet<string>,
  fallbackImageUrls: readonly string[] = [],
) {
  const missing: string[] = [];
  for (const [quality, group] of groupsByQuality(variants)) {
    if (qualityKeys && !qualityKeys.has(quality)) continue;
    if (!fallbackImageUrls.some((url) => String(url || "").trim())
      && !group.some((variant) => (Array.isArray(variant.imageUrls) ? variant.imageUrls : []).some((url) => String(url || "").trim()))) {
      const label = String(group[0]?.quality || "").trim() || "(chưa có chất lượng)";
      missing.push(label);
    }
  }
  return [...new Set(missing)];
}

export function assertBangleQualityImages(
  productSku: string,
  variants: readonly BangleVariantMedia[],
  qualityKeys?: ReadonlySet<string>,
  fallbackImageUrls: readonly string[] = [],
) {
  const missing = bangleQualitiesMissingImages(variants, qualityKeys, fallbackImageUrls);
  if (missing.length) {
    throw new BadRequestException(`Kiềng SKU ${productSku} chưa có ảnh cho chất lượng: ${missing.join(", ")}. Hãy thêm ít nhất một ảnh cho mỗi chất lượng trong Hồ sơ sản phẩm.`);
  }
}

\n