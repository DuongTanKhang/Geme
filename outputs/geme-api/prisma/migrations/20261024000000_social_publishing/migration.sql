CREATE TYPE "social_platform" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM');
CREATE TYPE "social_connection_status" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED');
CREATE TYPE "social_post_status" AS ENUM ('DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'UNKNOWN', 'CANCELLED');
CREATE TYPE "social_target_status" AS ENUM ('DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'CANCELLED');
CREATE TYPE "social_attempt_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

CREATE TABLE "social_oauth_states" (
  "state_hash" CHAR(64) NOT NULL,
  "admin_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("state_hash"),
  CONSTRAINT "social_oauth_states_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "social_oauth_states_expires_at_idx" ON "social_oauth_states"("expires_at");

CREATE TABLE "social_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "meta_user_id" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(180) NOT NULL,
  "user_token_ciphertext" TEXT NOT NULL,
  "user_token_expires_at" TIMESTAMPTZ(3),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "social_connection_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_admin_id" UUID NOT NULL,
  "disconnected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_connections_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "social_connections_status_updated_at_idx" ON "social_connections"("status", "updated_at" DESC);

CREATE TABLE "social_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "platform" "social_platform" NOT NULL,
  "remote_account_id" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(180) NOT NULL,
  "username" VARCHAR(180),
  "linked_page_id" VARCHAR(100),
  "access_token_ciphertext" TEXT NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "social_accounts_platform_remote_account_id_key" ON "social_accounts"("platform", "remote_account_id");
CREATE INDEX "social_accounts_connection_id_active_selected_idx" ON "social_accounts"("connection_id", "active", "selected");

CREATE TABLE "social_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" VARCHAR(180) NOT NULL,
  "status" "social_post_status" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approved_revision" INTEGER,
  "approved_snapshot_hash" CHAR(64),
  "approved_at" TIMESTAMPTZ(3),
  "approved_by_admin_id" UUID,
  "created_by_admin_id" UUID NOT NULL,
  "updated_by_admin_id" UUID,
  "source_product_id" UUID,
  "source_marketing_draft_id" UUID,
  "approved_snapshot" JSONB,
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_posts_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "social_posts_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "social_posts_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "social_posts_source_product_id_fkey" FOREIGN KEY ("source_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "social_posts_source_marketing_draft_id_fkey" FOREIGN KEY ("source_marketing_draft_id") REFERENCES "ai_marketing_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "social_posts_status_updated_at_idx" ON "social_posts"("status", "updated_at" DESC);
CREATE INDEX "social_posts_source_product_id_created_at_idx" ON "social_posts"("source_product_id", "created_at" DESC);

CREATE TABLE "social_post_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "post_id" UUID NOT NULL,
  "account_id" UUID,
  "media_asset_id" UUID,
  "platform" "social_platform" NOT NULL,
  "caption" VARCHAR(2200) NOT NULL DEFAULT '',
  "link_url" VARCHAR(1000),
  "status" "social_target_status" NOT NULL DEFAULT 'DRAFT',
  "approved_revision" INTEGER,
  "approved_payload_hash" CHAR(64),
  "scheduled_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3),
  "publish_requested_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "remote_container_id" VARCHAR(140),
  "remote_media_id" VARCHAR(140),
  "permalink" TEXT,
  "published_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_post_targets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "social_post_targets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "social_post_targets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "social_post_targets_post_id_account_id_key" ON "social_post_targets"("post_id", "account_id");
CREATE INDEX "social_post_targets_status_scheduled_at_idx" ON "social_post_targets"("status", "scheduled_at");
CREATE INDEX "social_post_targets_publish_requested_at_status_idx" ON "social_post_targets"("publish_requested_at", "status");

CREATE TABLE "social_publish_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "status" "social_attempt_status" NOT NULL DEFAULT 'RUNNING',
  "error_code" VARCHAR(80),
  "remote_container_id" VARCHAR(140),
  "remote_media_id" VARCHAR(140),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "social_publish_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_publish_attempts_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "social_post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "social_publish_attempts_idempotency_key_key" ON "social_publish_attempts"("idempotency_key");
CREATE UNIQUE INDEX "social_publish_attempts_target_id_revision_attempt_number_key" ON "social_publish_attempts"("target_id", "revision", "attempt_number");
CREATE INDEX "social_publish_attempts_target_id_started_at_idx" ON "social_publish_attempts"("target_id", "started_at" DESC);
