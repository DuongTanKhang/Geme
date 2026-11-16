-- Vật phẩm are managed by weight (kg) and retain up to three decimal places.
-- Existing count-based inventory remains unchanged in the integer columns.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "stock_kg" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "product_price_variants"
  ADD COLUMN IF NOT EXISTS "stock_kg" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3);

ALTER TABLE "inventory_reservations"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3);

ALTER TABLE "order_return_items"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3);

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "stock_before_kg" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "stock_after_kg" DECIMAL(14,3);

ALTER TABLE "inventory_receipts"
  ADD COLUMN IF NOT EXISTS "total_quantity_kg" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "inventory_receipt_items"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3);

ALTER TABLE "inventory_issues"
  ADD COLUMN IF NOT EXISTS "total_quantity_kg" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "inventory_issue_items"
  ADD COLUMN IF NOT EXISTS "quantity_kg" DECIMAL(14,3);
