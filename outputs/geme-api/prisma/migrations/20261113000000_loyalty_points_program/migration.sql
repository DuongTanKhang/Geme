ALTER TABLE "orders"
  ADD COLUMN "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loyalty_discount_amount" DECIMAL(14,0) NOT NULL DEFAULT 0;

CREATE TABLE "loyalty_point_transactions" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "order_id" UUID,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'POSTED',
  "points" INTEGER NOT NULL,
  "amount_vnd" DECIMAL(14,0),
  "note" VARCHAR(500),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loyalty_point_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loyalty_point_transactions_idempotency_key_key"
  ON "loyalty_point_transactions"("idempotency_key");
CREATE INDEX "loyalty_point_transactions_customer_id_status_created_at_idx"
  ON "loyalty_point_transactions"("customer_id", "status", "created_at" DESC);
CREATE INDEX "loyalty_point_transactions_order_id_type_idx"
  ON "loyalty_point_transactions"("order_id", "type");

ALTER TABLE "loyalty_point_transactions"
  ADD CONSTRAINT "loyalty_point_transactions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_point_transactions"
  ADD CONSTRAINT "loyalty_point_transactions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
