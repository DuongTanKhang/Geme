CREATE TABLE "order_email_outbox" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL DEFAULT 'ORDER_CONFIRMATION',
    "idempotency_key" VARCHAR(180) NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_email_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_email_outbox_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "order_email_outbox_idempotency_key_key" ON "order_email_outbox"("idempotency_key");
CREATE UNIQUE INDEX "order_email_outbox_order_id_event_type_key" ON "order_email_outbox"("order_id", "event_type");
CREATE INDEX "order_email_outbox_status_next_attempt_at_idx" ON "order_email_outbox"("status", "next_attempt_at");
