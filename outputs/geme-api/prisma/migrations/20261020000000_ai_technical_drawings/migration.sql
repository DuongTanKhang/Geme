CREATE TYPE "ai_image_purpose" AS ENUM ('PRODUCT_PHOTO', 'TECHNICAL_DRAWING');
CREATE TYPE "product_media_tag" AS ENUM ('PRODUCT_IMAGE', 'TECHNICAL_DRAWING', 'TECHNICAL_VIDEO', 'CERTIFICATE', 'OTHER');

ALTER TABLE "ai_image_batches"
  ADD COLUMN "purpose" "ai_image_purpose" NOT NULL DEFAULT 'PRODUCT_PHOTO',
  ADD COLUMN "target_product_id" UUID;

ALTER TABLE "ai_image_batches"
  ADD CONSTRAINT "ai_image_batches_target_product_id_fkey"
  FOREIGN KEY ("target_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ai_image_batches_target_product_id_idx" ON "ai_image_batches"("target_product_id");

CREATE TABLE "product_media_assets" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "tag" "product_media_tag" NOT NULL,
  "source_ai_image_item_id" UUID,
  "approved_by_admin_id" UUID,
  "approved_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_media_assets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_media_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_media_assets_media_asset_id_tag_key" ON "product_media_assets"("media_asset_id", "tag");
CREATE INDEX "product_media_assets_product_id_tag_created_at_idx" ON "product_media_assets"("product_id", "tag", "created_at" DESC);
CREATE INDEX "product_media_assets_source_ai_image_item_id_idx" ON "product_media_assets"("source_ai_image_item_id");
