ALTER TYPE "ai_task_type" ADD VALUE IF NOT EXISTS 'IMAGE_STUDIO_PROCESSING';

CREATE TYPE "ai_image_preset" AS ENUM ('STONE_GREY', 'WARM_IVORY', 'SOFT_SAGE');
CREATE TYPE "ai_image_batch_status" AS ENUM ('UPLOADING', 'PROCESSING', 'REVIEW', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "ai_image_item_status" AS ENUM ('PENDING_UPLOAD', 'QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED');
CREATE TYPE "ai_image_qc_status" AS ENUM ('PENDING', 'PASS', 'REVIEW', 'FAIL');

CREATE TABLE "ai_image_batches" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "manifest_hash" CHAR(64) NOT NULL,
  "created_by_admin_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "preset" "ai_image_preset" NOT NULL,
  "status" "ai_image_batch_status" NOT NULL DEFAULT 'UPLOADING',
  "total_bytes" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_image_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_image_batches_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ai_image_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "task_id" UUID,
  "original_asset_id" UUID,
  "output_asset_id" UUID,
  "published_asset_id" UUID,
  "attached_product_id" UUID,
  "original_filename" VARCHAR(240) NOT NULL,
  "relative_path" VARCHAR(500) NOT NULL DEFAULT '',
  "mime_type" VARCHAR(100) NOT NULL,
  "expected_size" INTEGER NOT NULL,
  "source_sha256" CHAR(64),
  "classification_hint" VARCHAR(120),
  "classification" JSONB,
  "status" "ai_image_item_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "qc_status" "ai_image_qc_status" NOT NULL DEFAULT 'PENDING',
  "qc_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "qc_report" JSONB,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_image_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_image_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ai_image_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_image_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_image_items_original_asset_id_fkey" FOREIGN KEY ("original_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_image_items_output_asset_id_fkey" FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_image_items_published_asset_id_fkey" FOREIGN KEY ("published_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_image_items_attached_product_id_fkey" FOREIGN KEY ("attached_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ai_image_batches_idempotency_key_key" ON "ai_image_batches"("idempotency_key");
CREATE INDEX "ai_image_batches_created_by_admin_id_created_at_idx" ON "ai_image_batches"("created_by_admin_id", "created_at" DESC);
CREATE INDEX "ai_image_batches_status_updated_at_idx" ON "ai_image_batches"("status", "updated_at" DESC);
CREATE UNIQUE INDEX "ai_image_items_task_id_key" ON "ai_image_items"("task_id");
CREATE UNIQUE INDEX "ai_image_items_original_asset_id_key" ON "ai_image_items"("original_asset_id");
CREATE UNIQUE INDEX "ai_image_items_output_asset_id_key" ON "ai_image_items"("output_asset_id");
CREATE UNIQUE INDEX "ai_image_items_published_asset_id_key" ON "ai_image_items"("published_asset_id");
CREATE INDEX "ai_image_items_batch_id_status_created_at_idx" ON "ai_image_items"("batch_id", "status", "created_at");
CREATE INDEX "ai_image_items_status_updated_at_idx" ON "ai_image_items"("status", "updated_at");
CREATE INDEX "ai_image_items_attached_product_id_idx" ON "ai_image_items"("attached_product_id");
