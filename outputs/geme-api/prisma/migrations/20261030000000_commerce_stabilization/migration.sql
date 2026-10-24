-- Expand safely: historical rows retain NULL for the newly distinguished
-- carrier remittance figures and are not assigned invented financial values.
DROP INDEX IF EXISTS "cod_reconciliation_items_order_id_key";
CREATE INDEX "cod_reconciliation_items_order_id_idx" ON "cod_reconciliation_items"("order_id");

ALTER TABLE "cod_reconciliation_batches"
  ALTER COLUMN "status" TYPE VARCHAR(32),
  ADD COLUMN "remitted_total" DECIMAL(14,0);

ALTER TABLE "cod_reconciliation_batches"
  ADD CONSTRAINT "cod_reconciliation_batches_remitted_total_check"
  CHECK ("remitted_total" IS NULL OR "remitted_total" >= 0);

ALTER TABLE "cod_reconciliation_items"
  ADD COLUMN "remitted_amount" DECIMAL(14,0),
  ADD COLUMN "remittance_variance" DECIMAL(14,0),
  ADD CONSTRAINT "cod_reconciliation_items_remitted_amount_check"
  CHECK ("remitted_amount" IS NULL OR "remitted_amount" >= 0);

ALTER TABLE "payment_refunds"
  ALTER COLUMN "return_id" DROP NOT NULL,
  ADD COLUMN "external_reference" VARCHAR(160);

ALTER TABLE "payments"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "recorded_by_admin_id" UUID,
  ADD COLUMN "recording_note" VARCHAR(1000);

CREATE UNIQUE INDEX "payments_idempotency_key_key"
  ON "payments"("idempotency_key");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_recorded_by_admin_id_fkey"
  FOREIGN KEY ("recorded_by_admin_id") REFERENCES "admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "contact_inquiries" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "phone" VARCHAR(32) NOT NULL,
  "subject" VARCHAR(80) NOT NULL,
  "message" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
  "resolution_note" TEXT,
  "handled_by_admin_id" UUID,
  "handled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_inquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contact_inquiries_status_check" CHECK ("status" IN ('NEW', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED')),
  CONSTRAINT "contact_inquiries_handler_fkey" FOREIGN KEY ("handled_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contact_inquiries_idempotency_key_key" ON "contact_inquiries"("idempotency_key");
CREATE INDEX "contact_inquiries_status_created_at_idx" ON "contact_inquiries"("status", "created_at" DESC);
CREATE INDEX "contact_inquiries_created_at_id_idx" ON "contact_inquiries"("created_at" DESC, "id" DESC);

ALTER TABLE "audit_logs" ADD COLUMN "correlation_id" VARCHAR(80);
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");
