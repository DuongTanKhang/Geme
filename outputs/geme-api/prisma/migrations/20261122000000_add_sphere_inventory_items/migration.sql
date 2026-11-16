-- Each row records one physical sphere under a shared, weight-managed SKU.
-- The product's stock_kg remains the aggregate sellable stock.
CREATE TABLE "product_sphere_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "receipt_id" UUID,
  "label" VARCHAR(120),
  "weight_kg" DECIMAL(14,3) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_sphere_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_sphere_items"
  ADD CONSTRAINT "product_sphere_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_sphere_items"
  ADD CONSTRAINT "product_sphere_items_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES "inventory_receipts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "product_sphere_items_product_id_status_sort_order_idx"
  ON "product_sphere_items"("product_id", "status", "sort_order");

CREATE INDEX "product_sphere_items_receipt_id_idx"
  ON "product_sphere_items"("receipt_id");
