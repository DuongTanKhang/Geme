CREATE TABLE "shopee_oauth_states" (
    "state_hash" CHAR(64) NOT NULL,
    "admin_id" UUID NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shopee_oauth_states_pkey" PRIMARY KEY ("state_hash")
);

CREATE TABLE "shopee_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "environment" VARCHAR(20) NOT NULL,
    "shop_id" VARCHAR(40) NOT NULL,
    "shop_name" VARCHAR(180),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "access_token_ciphertext" TEXT NOT NULL,
    "refresh_token_ciphertext" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "refresh_lease_until" TIMESTAMPTZ(3),
    "sync_cursor_at" TIMESTAMPTZ(3),
    "last_sync_started_at" TIMESTAMPTZ(3),
    "last_sync_completed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(80),
    "created_by_admin_id" UUID NOT NULL,
    "disconnected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shopee_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopee_imported_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "order_sn" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "currency" VARCHAR(12),
    "total_amount" DECIMAL(14,2),
    "estimated_shipping_fee" DECIMAL(14,2),
    "actual_shipping_fee" DECIMAL(14,2),
    "cod" BOOLEAN,
    "payment_method" VARCHAR(100),
    "shipping_carrier" VARCHAR(120),
    "create_time" TIMESTAMPTZ(3) NOT NULL,
    "shopee_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "pay_time" TIMESTAMPTZ(3),
    "recipient_address" JSONB,
    "message_to_seller" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shopee_imported_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopee_item_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "item_id" VARCHAR(40) NOT NULL,
    "model_id" VARCHAR(40) NOT NULL DEFAULT '',
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "sku" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shopee_item_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopee_imported_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "item_id" VARCHAR(40) NOT NULL,
    "model_id" VARCHAR(40) NOT NULL DEFAULT '',
    "item_name" VARCHAR(255) NOT NULL,
    "item_sku" VARCHAR(120),
    "model_sku" VARCHAR(120),
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2),
    "variation_discounted_price" DECIMAL(14,2),
    "currency" VARCHAR(12),
    "mapped_sku" VARCHAR(64),
    "mapped_product_id" UUID,
    "mapped_variant_id" UUID,
    "mapping_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shopee_imported_order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopee_order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "shopee_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shopee_order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopee_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "from_time" TIMESTAMPTZ(3),
    "to_time" TIMESTAMPTZ(3),
    "orders_read" INTEGER NOT NULL DEFAULT 0,
    "orders_created" INTEGER NOT NULL DEFAULT 0,
    "orders_updated" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(80),
    "retry_of_id" UUID,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shopee_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopee_connections_environment_shop_id_key" ON "shopee_connections"("environment", "shop_id");
CREATE INDEX "shopee_connections_status_last_sync_completed_at_idx" ON "shopee_connections"("status", "last_sync_completed_at");
CREATE UNIQUE INDEX "shopee_imported_orders_connection_id_order_sn_key" ON "shopee_imported_orders"("connection_id", "order_sn");
CREATE INDEX "shopee_imported_orders_connection_id_create_time_idx" ON "shopee_imported_orders"("connection_id", "create_time" DESC);
CREATE INDEX "shopee_imported_orders_connection_id_status_create_time_idx" ON "shopee_imported_orders"("connection_id", "status", "create_time" DESC);
CREATE UNIQUE INDEX "shopee_item_mappings_connection_id_item_id_model_id_key" ON "shopee_item_mappings"("connection_id", "item_id", "model_id");
CREATE INDEX "shopee_item_mappings_product_id_idx" ON "shopee_item_mappings"("product_id");
CREATE INDEX "shopee_item_mappings_variant_id_idx" ON "shopee_item_mappings"("variant_id");
CREATE INDEX "shopee_imported_order_items_order_id_idx" ON "shopee_imported_order_items"("order_id");
CREATE INDEX "shopee_imported_order_items_mapping_id_idx" ON "shopee_imported_order_items"("mapping_id");
CREATE INDEX "shopee_imported_order_items_mapped_sku_idx" ON "shopee_imported_order_items"("mapped_sku");
CREATE UNIQUE INDEX "shopee_order_status_history_order_id_status_shopee_updated_at_key" ON "shopee_order_status_history"("order_id", "status", "shopee_updated_at");
CREATE INDEX "shopee_order_status_history_order_id_observed_at_idx" ON "shopee_order_status_history"("order_id", "observed_at" DESC);
CREATE INDEX "shopee_sync_runs_connection_id_created_at_idx" ON "shopee_sync_runs"("connection_id", "created_at" DESC);
CREATE INDEX "shopee_sync_runs_status_created_at_idx" ON "shopee_sync_runs"("status", "created_at" DESC);

ALTER TABLE "shopee_oauth_states" ADD CONSTRAINT "shopee_oauth_states_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopee_connections" ADD CONSTRAINT "shopee_connections_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopee_imported_orders" ADD CONSTRAINT "shopee_imported_orders_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "shopee_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopee_item_mappings" ADD CONSTRAINT "shopee_item_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "shopee_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopee_item_mappings" ADD CONSTRAINT "shopee_item_mappings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopee_item_mappings" ADD CONSTRAINT "shopee_item_mappings_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopee_imported_order_items" ADD CONSTRAINT "shopee_imported_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shopee_imported_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopee_imported_order_items" ADD CONSTRAINT "shopee_imported_order_items_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "shopee_item_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopee_imported_order_items" ADD CONSTRAINT "shopee_imported_order_items_mapped_product_id_fkey" FOREIGN KEY ("mapped_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopee_imported_order_items" ADD CONSTRAINT "shopee_imported_order_items_mapped_variant_id_fkey" FOREIGN KEY ("mapped_variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopee_order_status_history" ADD CONSTRAINT "shopee_order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shopee_imported_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopee_sync_runs" ADD CONSTRAINT "shopee_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "shopee_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
