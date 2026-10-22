ALTER TABLE "shopee_oauth_states"
  ADD COLUMN "partner_id" VARCHAR(20);

ALTER TABLE "shopee_connections"
  ADD COLUMN "partner_id" VARCHAR(20);

ALTER TABLE "shopee_imported_order_items"
  ADD COLUMN "model_original_price" DECIMAL(14,2),
  ADD COLUMN "model_discounted_price" DECIMAL(14,2);
