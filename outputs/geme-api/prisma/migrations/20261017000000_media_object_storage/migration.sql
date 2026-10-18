ALTER TABLE "media_assets"
  ADD COLUMN "storage_provider" VARCHAR(24) NOT NULL DEFAULT 'database',
  ADD COLUMN "object_key" VARCHAR(700);

ALTER TABLE "media_assets"
  ALTER COLUMN "data" DROP NOT NULL;

CREATE INDEX "media_assets_storage_provider_object_key_idx"
  ON "media_assets" ("storage_provider", "object_key");
