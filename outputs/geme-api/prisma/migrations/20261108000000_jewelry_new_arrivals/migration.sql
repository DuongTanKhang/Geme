CREATE TABLE "jewelry_stone_groups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(120) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "pinned_order" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "jewelry_stone_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "jewelry_stone_groups_slug_key" ON "jewelry_stone_groups"("slug");
CREATE INDEX "jewelry_stone_groups_active_pinned_order_sort_order_idx" ON "jewelry_stone_groups"("active", "pinned_order", "sort_order");

ALTER TABLE "categories" ADD COLUMN "jewelry_stone_group_id" UUID;
ALTER TABLE "material_options" ADD COLUMN "jewelry_stone_group_id" UUID;
ALTER TABLE "products"
  ADD COLUMN "new_until" TIMESTAMPTZ(3),
  ADD COLUMN "first_published_at" TIMESTAMPTZ(3),
  ADD COLUMN "publication_history_known" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "jewelry_stone_group_id" UUID;

ALTER TABLE "categories" ADD CONSTRAINT "categories_jewelry_stone_group_id_fkey" FOREIGN KEY ("jewelry_stone_group_id") REFERENCES "jewelry_stone_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_options" ADD CONSTRAINT "material_options_jewelry_stone_group_id_fkey" FOREIGN KEY ("jewelry_stone_group_id") REFERENCES "jewelry_stone_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_jewelry_stone_group_id_fkey" FOREIGN KEY ("jewelry_stone_group_id") REFERENCES "jewelry_stone_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "categories_jewelry_stone_group_id_idx" ON "categories"("jewelry_stone_group_id");
CREATE INDEX "material_options_jewelry_stone_group_id_idx" ON "material_options"("jewelry_stone_group_id");
CREATE INDEX "products_kind_status_first_published_at_id_idx" ON "products"("kind", "status", "first_published_at" DESC, "id");
CREATE INDEX "products_kind_status_is_new_new_until_first_published_at_idx" ON "products"("kind", "status", "is_new", "new_until", "first_published_at" DESC);
CREATE INDEX "products_jewelry_stone_group_id_status_first_published_at_idx" ON "products"("jewelry_stone_group_id", "status", "first_published_at" DESC);
