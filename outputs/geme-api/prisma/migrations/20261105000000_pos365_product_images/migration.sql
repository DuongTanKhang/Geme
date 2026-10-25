ALTER TABLE "products"
  ADD COLUMN "pos365_image_sync_status" VARCHAR(20),
  ADD COLUMN "pos365_image_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pos365_image_sync_last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_image_sync_next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_image_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_image_sync_error" TEXT;

CREATE INDEX "products_pos365_image_sync_status_pos365_image_sync_next_attempt_at_idx"
  ON "products"("pos365_image_sync_status", "pos365_image_sync_next_attempt_at");

CREATE TABLE "pos365_product_image_sync" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "sku" VARCHAR(64) NOT NULL,
  "pos365_image_id" VARCHAR(32) NOT NULL,
  "image_url" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pos365_product_image_sync_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos365_product_image_sync_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pos365_product_image_sync_sku_pos365_image_id_key"
  ON "pos365_product_image_sync"("sku", "pos365_image_id");
CREATE INDEX "pos365_product_image_sync_product_id_sku_idx"
  ON "pos365_product_image_sync"("product_id", "sku");
