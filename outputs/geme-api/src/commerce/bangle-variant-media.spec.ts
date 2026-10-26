import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  assertBangleQualityImages,
  bangleQualitiesMissingImages,
  normalizeBangleQuality,
  synchronizeBangleVariantMedia,
} from "./bangle-variant-media.js";

test("all shapes and sizes of the same normalized quality share one media set", () => {
  const variants = synchronizeBangleVariantMedia("NSBAQ", [
    { sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", beadSize: "50", imageUrls: ["/media/round-2a.webp"], videoUrl: null },
    { sku: "NSBAQR02S52", shape: "ROUND", quality: " 2a ", beadSize: "52", imageUrls: ["/media/round-2a.webp"], videoUrl: null },
    { sku: "NSBAQO02S50", shape: "OVAL", quality: "2A", beadSize: "50", imageUrls: ["/media/round-2a.webp"], videoUrl: null },
    { sku: "NSBAQR03S50", shape: "ROUND", quality: "3A", beadSize: "50", imageUrls: ["/media/round-3a.webp"], videoUrl: null },
  ], { synchronizeAll: true });
  assert.deepEqual(variants.map((variant) => variant.imageUrls), [
    ["/media/round-2a.webp"], ["/media/round-2a.webp"], ["/media/round-2a.webp"], ["/media/round-3a.webp"],
  ]);
  assert.equal(normalizeBangleQuality(" ２a  "), "2A");
});
test("adding a size to an existing quality reuses its media without requiring another upload", () => {
  const prior = [
    { id: "v50", sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", beadSize: "50", imageUrls: ["/media/a.webp"], videoUrl: null },
    { id: "v52", sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", beadSize: "52", imageUrls: ["/media/a.webp"], videoUrl: null },
  ];
  const next = synchronizeBangleVariantMedia("NSBAQ", [
    ...prior,
    { id: "v54", sku: "NSBAQR02S54", shape: "ROUND", quality: "2A", beadSize: "54", imageUrls: [], videoUrl: null },
  ], { existingVariants: prior });
  assert.deepEqual(next.map((variant) => variant.imageUrls), [["/media/a.webp"], ["/media/a.webp"], ["/media/a.webp"]]);
});

test("changing variant shape or quality reuses target-quality media and keeps other qualities isolated", () => {
  const prior = [
    { id: "round-2a", sku: "NSBAQR02S54", shape: "ROUND", quality: "2A", beadSize: "54", imageUrls: ["/media/2a.webp"] },
    { id: "oval-3a", sku: "NSBAQO03S54", shape: "OVAL", quality: "3A", beadSize: "54", imageUrls: ["/media/3a.webp"] },
    { id: "round-3a", sku: "NSBAQR03S54", shape: "ROUND", quality: "3A", beadSize: "54", imageUrls: ["/media/3a.webp"] },
  ];
  const changed = synchronizeBangleVariantMedia("NSBAQ", [
    prior[0],
    { ...prior[1], shape: "ROUND", quality: "2A", beadSize: "56" },
    prior[2],
  ], { existingVariants: prior, synchronizeQualities: new Set(["2A", "3A"]) });
  assert.deepEqual(changed.map((variant) => variant.imageUrls), [["/media/2a.webp"], ["/media/2a.webp"], ["/media/3a.webp"]]);
});

test("legacy media conflicts are preserved until an explicit shared set is selected for the whole quality", () => {
  const legacy = [
    { id: "v50", sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", imageUrls: ["/media/a.webp"], videoUrl: null },
    { id: "v52", sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", imageUrls: ["/media/b.webp"], videoUrl: null },
  ];
  assert.deepEqual(synchronizeBangleVariantMedia("NSBAQ", legacy, { existingVariants: legacy }).map((variant) => variant.imageUrls), [["/media/a.webp"], ["/media/b.webp"]]);
  assert.throws(() => synchronizeBangleVariantMedia("NSBAQ", legacy, { synchronizeAll: true }),
    (error: unknown) => error instanceof BadRequestException && /NSBAQR02S50, NSBAQR02S52/.test(error.message) && /bộ ảnh khác nhau/i.test(error.message));

  const selected = [
    { ...legacy[0], imageUrls: ["/media/a.webp"] },
    { ...legacy[1], imageUrls: ["/media/a.webp"] },
  ];
  const resolved = synchronizeBangleVariantMedia("NSBAQ", selected, {
    existingVariants: legacy,
    changedVariantKeys: new Set(["v52"]),
    explicitVariantKeys: new Set(["v50", "v52"]),
  });
  assert.deepEqual(resolved.map((variant) => variant.imageUrls), [["/media/a.webp"], ["/media/a.webp"]]);

  assert.throws(() => synchronizeBangleVariantMedia("NSBAQ", selected, {
    existingVariants: legacy,
    changedVariantKeys: new Set(["v52"]),
    explicitVariantKeys: new Set(["v52"]),
  }), (error: unknown) => error instanceof BadRequestException && /chọn một bộ ảnh chung/i.test(error.message));
});

test("each bangle quality can have a different set and empty sets remain allowed for drafts", () => {
  const variants = synchronizeBangleVariantMedia("NSBAQ", [
    { sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", imageUrls: ["/media/2a.webp"] },
    { sku: "NSBAQO02S50", shape: "OVAL", quality: "2A", imageUrls: [] },
    { sku: "NSBAQR03S50", shape: "ROUND", quality: "3A", imageUrls: [] },
  ], { synchronizeAll: true });
  assert.deepEqual(variants.map((variant) => variant.imageUrls), [["/media/2a.webp"], ["/media/2a.webp"], []]);
  assert.deepEqual(bangleQualitiesMissingImages(variants), ["3A"]);
  assert.throws(() => assertBangleQualityImages("NSBAQ", variants), /chất lượng: 3A/);
  assert.doesNotThrow(() => assertBangleQualityImages("NSBAQ", variants, new Set(["2A"])));
});

test("a video alone does not satisfy the published photo requirement", () => {
  assert.deepEqual(bangleQualitiesMissingImages([
    { sku: "NSBAQR02S50", quality: "2A", imageUrls: [], videoUrl: "/media/2a.mp4" },
  ]), ["2A"]);
  assert.throws(
    () => assertBangleQualityImages("NSBAQ", [{ sku: "NSBAQR02S50", quality: "2A", imageUrls: [], videoUrl: "/media/2a.mp4" }]),
    /chất lượng: 2A/,
  );
});
