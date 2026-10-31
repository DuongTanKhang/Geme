CREATE TABLE "sepay_webhook_events" (
  "id" UUID NOT NULL,
  "transaction_id" VARCHAR(80) NOT NULL,
  "gateway" VARCHAR(80),
  "account_number" VARCHAR(40),
  "sub_account" VARCHAR(80),
  "payment_code" VARCHAR(120),
  "transfer_type" VARCHAR(12) NOT NULL,
  "amount" DECIMAL(14,0) NOT NULL,
  "transaction_date" TIMESTAMPTZ(3),
  "reference_code" VARCHAR(160),
  "content" TEXT,
  "raw_payload" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  "order_id" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sepay_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sepay_webhook_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sepay_webhook_events_transaction_id_key" ON "sepay_webhook_events"("transaction_id");
CREATE INDEX "sepay_webhook_events_status_next_attempt_at_created_at_idx" ON "sepay_webhook_events"("status", "next_attempt_at", "created_at");
CREATE INDEX "sepay_webhook_events_order_id_created_at_idx" ON "sepay_webhook_events"("order_id", "created_at" DESC);
CREATE INDEX "orders_normalized_payment_code_idx" ON "orders" (regexp_replace(upper("code"), '[^A-Z0-9]', '', 'g'));
