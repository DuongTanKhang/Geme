ALTER TABLE "inventory_receipt_items"
  ALTER COLUMN "unit_cost" DROP NOT NULL,
  ALTER COLUMN "line_total" DROP NOT NULL;
