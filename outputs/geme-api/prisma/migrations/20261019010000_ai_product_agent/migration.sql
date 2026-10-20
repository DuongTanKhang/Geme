ALTER TYPE "ai_task_type" ADD VALUE IF NOT EXISTS 'PRODUCT_DRAFT_GENERATION';

CREATE TYPE "ai_product_draft_batch_status" AS ENUM ('PROCESSING', 'REVIEW', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "ai_product_draft_status" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED');

CREATE TABLE "ai_product_draft_batches" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "manifest_hash" CHAR(64) NOT NULL,
  "created_by_admin_id" UUID NOT NULL,
  "status" "ai_product_draft_batch_status" NOT NULL DEFAULT 'PROCESSING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_product_draft_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_product_draft_batches_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ai_product_drafts" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "source_image_item_id" UUID NOT NULL,
  "reviewed_by_admin_id" UUID,
  "status" "ai_product_draft_status" NOT NULL DEFAULT 'QUEUED',
  "product_name" VARCHAR(180) NOT NULL DEFAULT '',
  "short_description" VARCHAR(500) NOT NULL DEFAULT '',
  "detailed_description" TEXT NOT NULL DEFAULT '',
  "category_suggestion" VARCHAR(160),
  "material_suggestion" VARCHAR(160),
  "gemstone_suggestion" VARCHAR(160),
  "seo_title" VARCHAR(180) NOT NULL DEFAULT '',
  "seo_meta_description" VARCHAR(320) NOT NULL DEFAULT '',
  "alt_text" VARCHAR(500) NOT NULL DEFAULT '',
  "confidence_score" INTEGER NOT NULL DEFAULT 0,
  "category_confidence" INTEGER,
  "material_confidence" INTEGER,
  "gemstone_confidence" INTEGER,
  "needs_review" BOOLEAN NOT NULL DEFAULT TRUE,
  "review_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidence" JSONB,
  "reviewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_product_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_product_drafts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ai_product_draft_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_product_drafts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_product_drafts_source_image_item_id_fkey" FOREIGN KEY ("source_image_item_id") REFERENCES "ai_image_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_product_drafts_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_product_drafts_confidence_score_check" CHECK ("confidence_score" BETWEEN 0 AND 100),
  CONSTRAINT "ai_product_drafts_category_confidence_check" CHECK ("category_confidence" IS NULL OR "category_confidence" BETWEEN 0 AND 100),
  CONSTRAINT "ai_product_drafts_material_confidence_check" CHECK ("material_confidence" IS NULL OR "material_confidence" BETWEEN 0 AND 100),
  CONSTRAINT "ai_product_drafts_gemstone_confidence_check" CHECK ("gemstone_confidence" IS NULL OR "gemstone_confidence" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "ai_product_draft_batches_idempotency_key_key" ON "ai_product_draft_batches"("idempotency_key");
CREATE INDEX "ai_product_draft_batches_created_by_admin_id_created_at_idx" ON "ai_product_draft_batches"("created_by_admin_id", "created_at" DESC);
CREATE INDEX "ai_product_draft_batches_status_updated_at_idx" ON "ai_product_draft_batches"("status", "updated_at" DESC);
CREATE UNIQUE INDEX "ai_product_drafts_task_id_key" ON "ai_product_drafts"("task_id");
CREATE INDEX "ai_product_drafts_batch_id_status_created_at_idx" ON "ai_product_drafts"("batch_id", "status", "created_at");
CREATE INDEX "ai_product_drafts_status_updated_at_idx" ON "ai_product_drafts"("status", "updated_at" DESC);
CREATE INDEX "ai_product_drafts_source_image_item_id_created_at_idx" ON "ai_product_drafts"("source_image_item_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_product_drafts_one_active_per_source_key" ON "ai_product_drafts"("source_image_item_id") WHERE "status" IN ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'READY_FOR_REVIEW');
