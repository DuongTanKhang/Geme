ALTER TYPE "ai_task_type" ADD VALUE IF NOT EXISTS 'SALES_ANSWER';
ALTER TYPE "ai_task_type" ADD VALUE IF NOT EXISTS 'MARKETING_DRAFT_GENERATION';

CREATE TYPE "ai_sales_knowledge_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ai_marketing_draft_status" AS ENUM ('QUEUED', 'GENERATING', 'DRAFT', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED');

CREATE TABLE "ai_sales_knowledge_sources" (
  "id" UUID NOT NULL,
  "document_key" VARCHAR(100) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(180) NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "source_label" VARCHAR(200) NOT NULL,
  "content" TEXT NOT NULL,
  "status" "ai_sales_knowledge_status" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_by_admin_id" UUID NOT NULL,
  "reviewed_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_sales_knowledge_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_sales_knowledge_sources_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_sales_knowledge_sources_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_sales_knowledge_sources_version_check" CHECK ("version" > 0),
  CONSTRAINT "ai_sales_knowledge_sources_dates_check" CHECK ("expires_at" IS NULL OR "effective_from" IS NULL OR "expires_at" > "effective_from")
);

CREATE TABLE "ai_marketing_drafts" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "created_by_admin_id" UUID NOT NULL,
  "reviewed_by_admin_id" UUID,
  "status" "ai_marketing_draft_status" NOT NULL DEFAULT 'QUEUED',
  "channel" VARCHAR(24) NOT NULL,
  "objective" VARCHAR(800) NOT NULL,
  "title" VARCHAR(180) NOT NULL DEFAULT '',
  "caption" VARCHAR(1200) NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "call_to_action" VARCHAR(240) NOT NULL DEFAULT '',
  "seo_title" VARCHAR(180) NOT NULL DEFAULT '',
  "seo_description" VARCHAR(320) NOT NULL DEFAULT '',
  "alt_text" VARCHAR(500) NOT NULL DEFAULT '',
  "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_facts" JSONB,
  "fact_warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "decision_note" VARCHAR(1000),
  "error_code" VARCHAR(80),
  "generated_at" TIMESTAMPTZ(3),
  "reviewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_marketing_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_marketing_drafts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_marketing_drafts_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_marketing_drafts_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_marketing_drafts_channel_check" CHECK ("channel" IN ('THREADS', 'FACEBOOK', 'INSTAGRAM', 'BLOG', 'EMAIL', 'BANNER'))
);

CREATE TABLE "ai_sales_metrics" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "needs_handoff" BOOLEAN NOT NULL DEFAULT FALSE,
  "unresolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "recommended_product_count" INTEGER NOT NULL DEFAULT 0,
  "click_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_sales_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_sales_metrics_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_sales_metrics_counts_check" CHECK ("recommended_product_count" >= 0 AND "click_count" >= 0)
);

CREATE UNIQUE INDEX "ai_sales_knowledge_sources_document_key_version_key" ON "ai_sales_knowledge_sources"("document_key", "version");
CREATE UNIQUE INDEX "ai_sales_knowledge_sources_one_active_version" ON "ai_sales_knowledge_sources"("document_key") WHERE "status" = 'ACTIVE';
CREATE INDEX "ai_sales_knowledge_sources_status_effective_from_expires_at_idx" ON "ai_sales_knowledge_sources"("status", "effective_from", "expires_at");
CREATE INDEX "ai_sales_knowledge_sources_document_key_status_version_idx" ON "ai_sales_knowledge_sources"("document_key", "status", "version" DESC);

CREATE UNIQUE INDEX "ai_marketing_drafts_task_id_key" ON "ai_marketing_drafts"("task_id");
CREATE INDEX "ai_marketing_drafts_status_updated_at_idx" ON "ai_marketing_drafts"("status", "updated_at" DESC);
CREATE INDEX "ai_marketing_drafts_created_by_admin_id_created_at_idx" ON "ai_marketing_drafts"("created_by_admin_id", "created_at" DESC);
CREATE INDEX "ai_marketing_drafts_channel_created_at_idx" ON "ai_marketing_drafts"("channel", "created_at" DESC);

CREATE UNIQUE INDEX "ai_sales_metrics_task_id_key" ON "ai_sales_metrics"("task_id");
CREATE INDEX "ai_sales_metrics_created_at_idx" ON "ai_sales_metrics"("created_at" DESC);
CREATE INDEX "ai_sales_metrics_needs_handoff_created_at_idx" ON "ai_sales_metrics"("needs_handoff", "created_at" DESC);
