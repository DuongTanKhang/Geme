CREATE TABLE "inventory_receipts" (
    "id" UUID NOT NULL,
    "receipt_no" VARCHAR(64) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "supplier_name" VARCHAR(180),
    "receiver" VARCHAR(120),
    "warehouse_name" VARCHAR(120) NOT NULL DEFAULT 'Kho chính',
    "payment_method" VARCHAR(40),
    "status" VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "additional_note" TEXT,
    "document_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_receipt_items" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "product_name" VARCHAR(180) NOT NULL,
    "product_sku" VARCHAR(64) NOT NULL,
    "category_name" VARCHAR(120),
    "stone_name" VARCHAR(120),
    "kind" VARCHAR(24) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,0) NOT NULL,
    "line_total" DECIMAL(14,0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_receipt_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "inventory_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inventory_receipt_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_receipts_receipt_no_key" ON "inventory_receipts"("receipt_no");
CREATE INDEX "inventory_receipts_received_at_idx" ON "inventory_receipts"("received_at" DESC);
CREATE INDEX "inventory_receipts_supplier_name_received_at_idx" ON "inventory_receipts"("supplier_name", "received_at" DESC);
CREATE INDEX "inventory_receipt_items_receipt_id_idx" ON "inventory_receipt_items"("receipt_id");
CREATE INDEX "inventory_receipt_items_product_id_created_at_idx" ON "inventory_receipt_items"("product_id", "created_at" DESC);
