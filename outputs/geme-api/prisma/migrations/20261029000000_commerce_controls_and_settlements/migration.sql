ALTER TABLE "orders"
  ADD COLUMN "inventory_reservation_expires_at" TIMESTAMPTZ(3);

CREATE INDEX "orders_status_inventory_reservation_expires_at_idx"
  ON "orders"("status", "inventory_reservation_expires_at");

CREATE TABLE "admin_permission_grants" (
  "admin_id" UUID NOT NULL,
  "permission" VARCHAR(80) NOT NULL,
  "effect" VARCHAR(8) NOT NULL DEFAULT 'ALLOW',
  "granted_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "admin_permission_grants_pkey" PRIMARY KEY ("admin_id", "permission"),
  CONSTRAINT "admin_permission_grants_effect_check" CHECK ("effect" IN ('ALLOW', 'DENY')),
  CONSTRAINT "admin_permission_grants_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "admin_permission_grants_granted_by_admin_id_fkey" FOREIGN KEY ("granted_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "admin_permission_grants_permission_effect_idx"
  ON "admin_permission_grants"("permission", "effect");

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "variant_id" UUID,
  "quantity" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(3),
  "committed_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "release_reason" VARCHAR(40),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_reservations_status_check" CHECK ("status" IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT "inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_reservations_order_item_id_key" ON "inventory_reservations"("order_item_id");
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");
CREATE INDEX "inventory_reservations_product_id_variant_id_status_idx" ON "inventory_reservations"("product_id", "variant_id", "status");
CREATE INDEX "inventory_reservations_order_id_status_idx" ON "inventory_reservations"("order_id", "status");

INSERT INTO "inventory_reservations" (
  "id", "order_id", "order_item_id", "product_id", "variant_id", "quantity", "status", "expires_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), o."id", oi."id", oi."product_id", oi."variant_id", oi."quantity", 'ACTIVE',
       o."inventory_reservation_expires_at", o."inventory_reserved_at", CURRENT_TIMESTAMP
FROM "orders" o
JOIN "order_items" oi ON oi."order_id" = o."id"
WHERE o."inventory_reserved_at" IS NOT NULL
  AND o."inventory_committed_at" IS NULL
  AND o."inventory_released_at" IS NULL
  AND o."status" IN ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPING')
  AND oi."product_id" IS NOT NULL
ON CONFLICT ("order_item_id") DO NOTHING;

CREATE TABLE "order_returns" (
  "id" UUID NOT NULL,
  "code" VARCHAR(48) NOT NULL,
  "order_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
  "refund_status" VARCHAR(20) NOT NULL DEFAULT 'NONE',
  "reason" TEXT NOT NULL,
  "idempotency_key" VARCHAR(128),
  "request_hash" VARCHAR(64),
  "decision_note" TEXT,
  "created_by_admin_id" UUID,
  "received_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_returns_status_check" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CLOSED')),
  CONSTRAINT "order_returns_refund_status_check" CHECK ("refund_status" IN ('NONE', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  CONSTRAINT "order_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "order_returns_code_key" ON "order_returns"("code");
CREATE UNIQUE INDEX "order_returns_idempotency_key_key" ON "order_returns"("idempotency_key");
CREATE INDEX "order_returns_status_created_at_idx" ON "order_returns"("status", "created_at" DESC);
CREATE INDEX "order_returns_order_id_created_at_idx" ON "order_returns"("order_id", "created_at" DESC);

CREATE TABLE "order_return_items" (
  "id" UUID NOT NULL,
  "return_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "product_id" UUID,
  "variant_id" UUID,
  "product_name" VARCHAR(180) NOT NULL,
  "product_sku" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "restock" BOOLEAN NOT NULL DEFAULT FALSE,
  "condition_note" TEXT,
  "restocked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_return_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "order_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "order_return_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "order_return_items_return_id_order_item_id_key" ON "order_return_items"("return_id", "order_item_id");
CREATE INDEX "order_return_items_order_item_id_idx" ON "order_return_items"("order_item_id");

CREATE TABLE "payment_refunds" (
  "id" UUID NOT NULL,
  "return_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "amount" DECIMAL(14,0) NOT NULL,
  "note" TEXT NOT NULL,
  "created_by_admin_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_refunds_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payment_refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "order_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_refunds_idempotency_key_key" ON "payment_refunds"("idempotency_key");
CREATE INDEX "payment_refunds_payment_id_created_at_idx" ON "payment_refunds"("payment_id", "created_at");
CREATE INDEX "payment_refunds_return_id_created_at_idx" ON "payment_refunds"("return_id", "created_at");

CREATE TABLE "cod_reconciliation_batches" (
  "id" UUID NOT NULL,
  "external_reference" VARCHAR(120) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "carrier" VARCHAR(32) NOT NULL DEFAULT 'VIETTEL_POST',
  "statement_date" DATE NOT NULL,
  "expected_total" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "received_total" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "fee_total" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "decision_note" TEXT,
  "created_by_admin_id" UUID NOT NULL,
  "reconciled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "cod_reconciliation_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cod_reconciliation_batches_status_check" CHECK ("status" IN ('OPEN', 'RECONCILED', 'RECONCILED_WITH_VARIANCE'))
);

CREATE UNIQUE INDEX "cod_reconciliation_batches_external_reference_key" ON "cod_reconciliation_batches"("external_reference");
CREATE INDEX "cod_reconciliation_batches_status_statement_date_idx" ON "cod_reconciliation_batches"("status", "statement_date" DESC);
CREATE INDEX "cod_reconciliation_batches_carrier_statement_date_idx" ON "cod_reconciliation_batches"("carrier", "statement_date" DESC);

CREATE TABLE "cod_reconciliation_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "expected_amount" DECIMAL(14,0) NOT NULL,
  "received_amount" DECIMAL(14,0) NOT NULL,
  "carrier_fee" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "variance_amount" DECIMAL(14,0) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cod_reconciliation_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cod_reconciliation_items_status_check" CHECK ("status" IN ('MATCHED', 'VARIANCE')),
  CONSTRAINT "cod_reconciliation_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cod_reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cod_reconciliation_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cod_reconciliation_items_order_id_key" ON "cod_reconciliation_items"("order_id");
CREATE UNIQUE INDEX "cod_reconciliation_items_batch_id_order_id_key" ON "cod_reconciliation_items"("batch_id", "order_id");
CREATE INDEX "cod_reconciliation_items_batch_id_status_idx" ON "cod_reconciliation_items"("batch_id", "status");
