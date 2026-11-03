ALTER TABLE "orders"
  ADD COLUMN "sales_channel" VARCHAR(40) NOT NULL DEFAULT 'WEBSITE',
  ADD COLUMN "sales_channel_buyer_ref" VARCHAR(160),
  ADD COLUMN "buyer_type_at_checkout" VARCHAR(20);

-- Preserve the store orders that the old report inferred from shipping text.
UPDATE "orders"
SET "sales_channel" = 'DIRECT'
WHERE "shipping_method" = 'Bán trực tiếp tại cửa hàng';

CREATE INDEX "orders_sales_channel_placed_at_idx"
  ON "orders"("sales_channel", "placed_at" DESC);
