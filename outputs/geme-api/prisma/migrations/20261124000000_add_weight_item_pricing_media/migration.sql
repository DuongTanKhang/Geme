-- Store per-physical-item sale price and verified gallery, and retain the
-- selected physical item across orders, inventory reservations, and issues.
ALTER TABLE "product_sphere_items"
  ADD COLUMN "price" DECIMAL(14,0),
  ADD COLUMN "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "order_items" ADD COLUMN "sphere_item_id" UUID;
ALTER TABLE "inventory_reservations" ADD COLUMN "sphere_item_id" UUID;
ALTER TABLE "inventory_movements" ADD COLUMN "sphere_item_id" UUID;
ALTER TABLE "inventory_issue_items" ADD COLUMN "sphere_item_id" UUID;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sphere_item_id_fkey"
  FOREIGN KEY ("sphere_item_id") REFERENCES "product_sphere_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_sphere_item_id_fkey"
  FOREIGN KEY ("sphere_item_id") REFERENCES "product_sphere_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sphere_item_id_fkey"
  FOREIGN KEY ("sphere_item_id") REFERENCES "product_sphere_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_issue_items" ADD CONSTRAINT "inventory_issue_items_sphere_item_id_fkey"
  FOREIGN KEY ("sphere_item_id") REFERENCES "product_sphere_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_items_sphere_item_id_idx" ON "order_items"("sphere_item_id");
CREATE INDEX "inventory_reservations_sphere_item_id_status_idx" ON "inventory_reservations"("sphere_item_id", "status");
CREATE INDEX "inventory_movements_sphere_item_id_created_at_idx" ON "inventory_movements"("sphere_item_id", "created_at" DESC);
CREATE INDEX "inventory_issue_items_sphere_item_id_created_at_idx" ON "inventory_issue_items"("sphere_item_id", "created_at" DESC);
