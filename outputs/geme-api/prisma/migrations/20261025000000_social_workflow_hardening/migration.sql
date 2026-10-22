CREATE TYPE "social_link_source" AS ENUM ('NONE', 'PRODUCT', 'MANUAL');
CREATE TYPE "social_reconciliation_decision" AS ENUM ('CONFIRMED_PUBLISHED', 'CONFIRMED_NOT_PUBLISHED', 'UNRESOLVED', 'RETRY_AUTHORIZED');
CREATE TYPE "social_reconciliation_source" AS ENUM ('META_API', 'MANUAL');

ALTER TABLE "social_post_targets"
  ADD COLUMN "link_source" "social_link_source" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "reconciliation_claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN "reconciliation_claimed_by_admin_id" UUID;

UPDATE "social_post_targets"
SET "link_source" = 'MANUAL'
WHERE "link_url" IS NOT NULL AND "link_url" <> '';

-- Infer legacy auto-links only when the product slug is an exact path suffix.
UPDATE "social_post_targets" AS target
SET "link_source" = 'PRODUCT'
FROM "social_posts" AS post
JOIN "products" AS product ON product.id = post.source_product_id
WHERE target.post_id = post.id
  AND target.link_url IS NOT NULL
  AND regexp_replace(target.link_url, '^https?://[^/]+', '') = '/san-pham/' || product.slug;

ALTER TABLE "social_posts"
  ADD COLUMN "source_product_variant_id" UUID,
  ADD COLUMN "approved_commerce_snapshot" JSONB,
  ADD COLUMN "approved_commerce_snapshot_hash" CHAR(64),
  ADD CONSTRAINT "social_posts_source_product_variant_id_fkey"
    FOREIGN KEY ("source_product_variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "social_post_targets"
  ADD CONSTRAINT "social_post_targets_reconciliation_claimed_by_admin_id_fkey"
    FOREIGN KEY ("reconciliation_claimed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "social_target_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "decision" "social_reconciliation_decision" NOT NULL,
  "source" "social_reconciliation_source" NOT NULL,
  "remote_id_queried" VARCHAR(140),
  "result_code" VARCHAR(80),
  "notes" VARCHAR(1200),
  "evidence_reference" VARCHAR(2000),
  "published_at_reported" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_target_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_target_reconciliations_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "social_post_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "social_target_reconciliations_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "social_target_reconciliations_target_id_created_at_idx"
  ON "social_target_reconciliations"("target_id", "created_at" DESC);
CREATE INDEX "social_target_reconciliations_admin_id_created_at_idx"
  ON "social_target_reconciliations"("admin_id", "created_at" DESC);
CREATE INDEX "social_post_targets_reconciliation_claimed_at_idx"
  ON "social_post_targets"("reconciliation_claimed_at");
CREATE INDEX "social_posts_updated_at_id_idx"
  ON "social_posts"("updated_at" DESC, "id" DESC);
CREATE INDEX "social_posts_source_product_variant_id_created_at_idx"
  ON "social_posts"("source_product_variant_id", "created_at" DESC);
