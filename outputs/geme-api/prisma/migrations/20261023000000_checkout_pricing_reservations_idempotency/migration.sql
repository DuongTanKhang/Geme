ALTER TABLE "orders"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "idempotency_request_hash" VARCHAR(64),
  ADD COLUMN "inventory_reserved_at" TIMESTAMPTZ(3),
  ADD COLUMN "inventory_committed_at" TIMESTAMPTZ(3),
  ADD COLUMN "inventory_released_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "orders_idempotency_key_key"
  ON "orders" ("idempotency_key");

CREATE INDEX "orders_inventory_reserved_at_inventory_committed_at_inventory_released_at_idx"
  ON "orders" ("inventory_reserved_at", "inventory_committed_at", "inventory_released_at");
