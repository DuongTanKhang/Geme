ALTER TABLE "product_price_variants"
  ADD COLUMN "shape" VARCHAR(20);

ALTER TABLE "order_items"
  ADD COLUMN "shape" VARCHAR(20);

ALTER TABLE "inventory_receipt_items"
  ADD COLUMN "shape" VARCHAR(20);
