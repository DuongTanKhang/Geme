CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(240) NOT NULL,
    "source_key" VARCHAR(500),
    "mime_type" VARCHAR(100) NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "alt" VARCHAR(240),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_source_key_key" ON "media_assets"("source_key");
CREATE INDEX "media_assets_created_at_idx" ON "media_assets"("created_at" DESC);
