-- Explicit hierarchy for weight-managed sphere inventory.
-- Existing rows are intentionally not guessed or backfilled: they must be
-- classified by an administrator when their source data is confirmed.
CREATE TABLE "sphere_stone_groups" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(140) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sphere_stone_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sphere_stone_groups_slug_key" ON "sphere_stone_groups"("slug");
CREATE INDEX "sphere_stone_groups_is_active_sort_order_idx" ON "sphere_stone_groups"("is_active", "sort_order");

CREATE TABLE "sphere_stone_types" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(140) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sphere_stone_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sphere_stone_types_group_id_slug_key" ON "sphere_stone_types"("group_id", "slug");
CREATE INDEX "sphere_stone_types_group_id_is_active_sort_order_idx" ON "sphere_stone_types"("group_id", "is_active", "sort_order");

ALTER TABLE "products" ADD COLUMN "sphere_stone_type_id" UUID;
ALTER TABLE "products" ADD COLUMN "sphere_quality" VARCHAR(60);
CREATE INDEX "products_sphere_stone_type_id_status_idx" ON "products"("sphere_stone_type_id", "status");
ALTER TABLE "products" ADD CONSTRAINT "products_sphere_stone_type_id_fkey"
  FOREIGN KEY ("sphere_stone_type_id") REFERENCES "sphere_stone_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_receipt_items" ADD COLUMN "sphere_stone_group_name" VARCHAR(120);
ALTER TABLE "inventory_receipt_items" ADD COLUMN "sphere_stone_type_name" VARCHAR(120);
ALTER TABLE "inventory_receipt_items" ADD COLUMN "sphere_quality" VARCHAR(60);
