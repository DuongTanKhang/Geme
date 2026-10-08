CREATE TYPE "material_option_scope" AS ENUM ('JEWELRY', 'GEMSTONE');
CREATE TYPE "material_option_kind" AS ENUM ('MATERIAL', 'STONE');

CREATE TABLE "material_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "scope" "material_option_scope" NOT NULL,
    "kind" "material_option_kind" NOT NULL DEFAULT 'STONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "material_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_options_scope_slug_key" ON "material_options"("scope", "slug");
CREATE INDEX "material_options_scope_kind_active_sort_order_idx" ON "material_options"("scope", "kind", "active", "sort_order");
