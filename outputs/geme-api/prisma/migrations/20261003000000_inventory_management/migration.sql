ALTER TABLE "products" ADD COLUMN "minimum_stock" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "product_name" VARCHAR(180) NOT NULL,
    "product_sku" VARCHAR(64) NOT NULL,
    "variant_label" VARCHAR(120),
    "type" VARCHAR(20) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stock_before" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "reference" VARCHAR(120),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "inventory_movements_product_id_created_at_idx" ON "inventory_movements"("product_id", "created_at" DESC);
CREATE INDEX "inventory_movements_created_at_idx" ON "inventory_movements"("created_at" DESC);
