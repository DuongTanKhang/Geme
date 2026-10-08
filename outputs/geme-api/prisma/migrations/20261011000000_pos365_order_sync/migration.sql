ALTER TABLE "orders"
  ADD COLUMN "pos365_order_id" VARCHAR(80),
  ADD COLUMN "pos365_sync_status" VARCHAR(20),
  ADD COLUMN "pos365_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pos365_sync_last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_sync_next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_sync_error" TEXT;

CREATE UNIQUE INDEX "orders_pos365_order_id_key" ON "orders"("pos365_order_id");
CREATE INDEX "orders_pos365_sync_status_pos365_sync_next_attempt_at_idx"
  ON "orders"("pos365_sync_status", "pos365_sync_next_attempt_at");
CREATE INDEX "orders_placed_at_status_idx"
  ON "orders"("placed_at" DESC, "status");
