ALTER TYPE "category_pricing_mode" ADD VALUE IF NOT EXISTS 'GEMSTONE_SIZE';
ALTER TYPE "category_pricing_mode" ADD VALUE IF NOT EXISTS 'GEMSTONE_CARAT';
ALTER TYPE "category_pricing_mode" ADD VALUE IF NOT EXISTS 'GEMSTONE_CARAT_AND_QUALITY';

ALTER TABLE "product_price_variants"
  ADD COLUMN "carat" DECIMAL(8,3),
  ADD COLUMN "gemstone_quality" VARCHAR(40);

ALTER TABLE "order_items"
  ADD COLUMN "carat" DECIMAL(8,3),
  ADD COLUMN "gemstone_quality" VARCHAR(40);

ALTER TABLE "inventory_receipt_items"
  ADD COLUMN "quality" VARCHAR(40),
  ADD COLUMN "bead_size" VARCHAR(24),
  ADD COLUMN "carat" DECIMAL(8,3),
  ADD COLUMN "gemstone_quality" VARCHAR(40);
