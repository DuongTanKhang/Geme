ALTER TABLE "media_assets" ADD COLUMN "bucket_name" VARCHAR(128);

CREATE INDEX "media_assets_storage_provider_bucket_name_object_key_is_private_idx"
ON "media_assets"("storage_provider", "bucket_name", "object_key", "is_private");

CREATE TABLE "media_object_cleanups" (
    "id" UUID NOT NULL,
    "storage_provider" VARCHAR(24) NOT NULL DEFAULT 'r2',
    "bucket_name" VARCHAR(128) NOT NULL,
    "object_key" VARCHAR(700) NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "url_candidates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_object_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_object_cleanups_storage_provider_bucket_name_object_key_is_private_key"
ON "media_object_cleanups"("storage_provider", "bucket_name", "object_key", "is_private");

CREATE INDEX "media_object_cleanups_next_attempt_at_created_at_idx"
ON "media_object_cleanups"("next_attempt_at", "created_at");
