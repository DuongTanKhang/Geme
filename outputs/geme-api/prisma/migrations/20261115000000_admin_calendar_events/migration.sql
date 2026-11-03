CREATE TABLE "admin_calendar_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(2000),
  "location" VARCHAR(160),
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "all_day" BOOLEAN NOT NULL DEFAULT false,
  "created_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "admin_calendar_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_calendar_events_time_order_check" CHECK ("ends_at" > "starts_at")
);

CREATE INDEX "admin_calendar_events_starts_at_ends_at_idx" ON "admin_calendar_events"("starts_at", "ends_at");
CREATE INDEX "inventory_receipt_items_product_sku_normalized_idx" ON "inventory_receipt_items"(UPPER(BTRIM("product_sku")));
CREATE INDEX "inventory_receipts_status_received_at_idx" ON "inventory_receipts"("status", "received_at");
ALTER TABLE "admin_calendar_events" ADD CONSTRAINT "admin_calendar_events_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
