ALTER TABLE "products"
  ADD COLUMN "pos365_price_sync_status" VARCHAR(20),
  ADD COLUMN "pos365_price_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pos365_price_sync_last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_price_sync_next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_price_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_price_sync_error" TEXT;

CREATE INDEX "products_pos365_price_sync_status_pos365_price_sync_next_attempt_at_idx"
  ON "products"("pos365_price_sync_status", "pos365_price_sync_next_attempt_at");
