ALTER TABLE "inventory_receipts"
  ADD COLUMN "subtotal_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
  ADD COLUMN "vat_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "vat_amount" DECIMAL(14,0) NOT NULL DEFAULT 0;

UPDATE "inventory_receipts" SET "subtotal_amount" = "total_amount";
