ALTER TABLE "inventory_receipts"
  ADD COLUMN "pos365_sync_status" VARCHAR(20),
  ADD COLUMN "pos365_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pos365_sync_last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_sync_next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "pos365_sync_code" VARCHAR(64),
  ADD COLUMN "pos365_sync_error" TEXT;

CREATE INDEX "inventory_receipts_pos365_sync_status_pos365_sync_next_attempt_at_idx"
  ON "inventory_receipts"("pos365_sync_status", "pos365_sync_next_attempt_at");
