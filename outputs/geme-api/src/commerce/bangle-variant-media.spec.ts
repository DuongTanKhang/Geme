import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { synchronizeBangleVariantMedia } from "./bangle-variant-media.js";

test("all sizes of the same bangle shape and quality share one media set", () => {
  const variants = synchronizeBangleVariantMedia("NSBAQ", [
    { sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", beadSize: "50", imageUrls: ["/media/round-2a.webp"], videoUrl: null },
    { sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", beadSize: "52", imageUrls: [], videoUrl: null },
    { sku: "NSBAQO02S50", shape: "OVAL", quality: "2A", beadSize: "50", imageUrls: ["/media/oval-2a.webp"], videoUrl: null },
    { sku: "NSBAQR03S50", shape: "ROUND", quality: "3A", beadSize: "50", imageUrls: ["/media/round-3a.webp"], videoUrl: null },
  ]);
  assert.deepEqual(variants.map((variant) => variant.imageUrls), [
    ["/media/round-2a.webp"], ["/media/round-2a.webp"], ["/media/oval-2a.webp"], ["/media/round-3a.webp"],
  ]);
});

test("legacy differences remain editable until a media change explicitly synchronizes the group", () => {
  const legacy = [
    { id: "v50", sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", imageUrls: ["/media/a.webp"] },
    { id: "v52", sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", imageUrls: ["/media/b.webp"] },
  ];
  assert.deepEqual(synchronizeBangleVariantMedia("NSBAQ", legacy).map((variant) => variant.imageUrls), [["/media/a.webp"], ["/media/b.webp"]]);
  assert.throws(() => synchronizeBangleVariantMedia("NSBAQ", legacy, { synchronizeAll: true }),
    (error: unknown) => error instanceof BadRequestException && /NSBAQR02S50, NSBAQR02S52/.test(error.message) && /chọn một bộ ảnh chung/i.test(error.message));
  assert.deepEqual(synchronizeBangleVariantMedia("NSBAQ", legacy, { changedVariantKeys: new Set(["v50"]) }).map((variant) => variant.imageUrls), [["/media/a.webp"], ["/media/a.webp"]]);
});

test("variant photos are optional and fall back to product gallery; media edits sync sizes", () => {
  const noImages = synchronizeBangleVariantMedia("NSBAQ", [
    { sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", imageUrls: [] },
    { sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", imageUrls: [] },
  ]);
  assert.deepEqual(noImages.map((variant) => variant.imageUrls), [[], []]);

  const result = synchronizeBangleVariantMedia("NSBAQ", [
    { id: "v50", sku: "NSBAQR02S50", shape: "ROUND", quality: "2A", imageUrls: ["/media/a.webp"], videoUrl: "/media/a.mp4" },
    { id: "v52", sku: "NSBAQR02S52", shape: "ROUND", quality: "2A", imageUrls: [] },
  ], { changedVariantKeys: new Set(["v50"]) });
  assert.equal(result[1]?.videoUrl, "/media/a.mp4");
  assert.deepEqual(result[1]?.imageUrls, ["/media/a.webp"]);
});
