import { BadRequestException } from "@nestjs/common";

export type BangleVariantMedia = {
  id?: string | null;
  sku?: string | null;
  shape?: string | null;
  quality?: string | null;
  imageUrls?: string[] | null;
  videoUrl?: string | null;
};

const shapeLabel = (shape: string) => ({ ROUND: "Tròn", OVAL: "Oval", SQUARE: "Vuông" } as Record<string, string>)[shape] || shape;

function mediaKey(variant: BangleVariantMedia) {
  const images = (Array.isArray(variant.imageUrls) ? variant.imageUrls : []).map((url) => String(url || "").trim()).filter(Boolean);
  const video = typeof variant.videoUrl === "string" ? variant.videoUrl.trim() : "";
  return JSON.stringify({ images, video });
}

export function synchronizeBangleVariantMedia<T extends BangleVariantMedia>(
  productSku: string,
  variants: readonly T[],
  options: { changedVariantKeys?: ReadonlySet<string>; synchronizeAll?: boolean } = {},
): T[] {
  const groups = new Map<string, T[]>();
  for (const variant of variants) {
    const shape = String(variant.shape || "").trim().toLocaleUpperCase("en");
    const quality = String(variant.quality || "").trim().toLocaleUpperCase("en");
    const key = shape + "::" + quality;
    groups.set(key, [...(groups.get(key) || []), variant]);
  }

  const shared = new Map<string, { imageUrls: string[]; videoUrl: string | null }>();
  for (const [key, group] of groups) {
    const [shape, quality] = key.split("::");
    const label = "dáng " + shapeLabel(shape || "(thiếu)") + " · chất lượng " + (quality || "(thiếu)");
    const changedKeys = options.changedVariantKeys;
    const changedRows = changedKeys
      ? group.filter((variant) => changedKeys.has(String(variant.id || variant.sku || "")))
      : [];
    const shouldSynchronize = options.synchronizeAll || changedRows.length > 0;
    const emptyMediaKey = JSON.stringify({ images: [], video: "" });
    const nonEmptyRows = group.filter((variant) => mediaKey(variant) !== emptyMediaKey);
    const groupSkus = group.map((variant) => String(variant.sku || "(chưa có SKU)")).join(", ");
    const sources = shouldSynchronize
      ? (changedRows.length ? changedRows : group)
      : (nonEmptyRows.length ? nonEmptyRows : group);
    const distinctMedia = new Map(sources.map((variant) => [mediaKey(variant), variant]));
    if (!shouldSynchronize && distinctMedia.size > 1) continue;
    if (shouldSynchronize && distinctMedia.size > 1) {
      throw new BadRequestException("Kiềng SKU " + productSku + ", " + label + " có bộ ảnh khác nhau giữa " + groupSkus + ". Chọn một bộ ảnh chung cho mọi size của nhóm này.");
    }
    const source = distinctMedia.values().next().value as T | undefined;
    const imageUrls = (Array.isArray(source?.imageUrls) ? source.imageUrls : []).map((url) => String(url || "").trim()).filter(Boolean);
    const videoUrl = typeof source?.videoUrl === "string" ? source.videoUrl.trim() || null : null;
    if (imageUrls.length + Number(Boolean(videoUrl)) > 8) {
      throw new BadRequestException("Kiềng SKU " + productSku + ", " + label + " vượt quá 8 ảnh/video dùng chung.");
    }
    // A variant may intentionally have no media. The storefront then uses the
    // product gallery as its fallback. If one size has media, share it with the
    // other sizes in its shape + quality group.
    shared.set(key, { imageUrls, videoUrl });
  }

  return variants.map((variant) => {
    const key = String(variant.shape || "").trim().toLocaleUpperCase("en") + "::" + String(variant.quality || "").trim().toLocaleUpperCase("en");
    const media = shared.get(key);
    return media ? { ...variant, imageUrls: [...media.imageUrls], videoUrl: media.videoUrl } : { ...variant };
  });
}
