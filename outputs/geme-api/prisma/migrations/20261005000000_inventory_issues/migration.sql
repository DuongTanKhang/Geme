CREATE TABLE "inventory_issues" (
    "id" UUID NOT NULL,
    "issue_no" VARCHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(24) NOT NULL,
    "recipient" VARCHAR(180),
    "warehouse_name" VARCHAR(120) NOT NULL DEFAULT 'Kho chính',
    "status" VARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "inventory_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_issue_items" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "product_name" VARCHAR(180) NOT NULL,
    "product_sku" VARCHAR(64) NOT NULL,
    "variant_label" VARCHAR(120),
    "category_name" VARCHAR(120),
    "stone_name" VARCHAR(120),
    "kind" VARCHAR(24) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,0) NOT NULL,
    "line_total" DECIMAL(14,0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_issue_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_issue_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "inventory_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_issue_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "inventory_issue_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_issues_issue_no_key" ON "inventory_issues"("issue_no");
CREATE INDEX "inventory_issues_issued_at_idx" ON "inventory_issues"("issued_at" DESC);
CREATE INDEX "inventory_issues_reason_issued_at_idx" ON "inventory_issues"("reason", "issued_at" DESC);
CREATE INDEX "inventory_issue_items_issue_id_idx" ON "inventory_issue_items"("issue_id");
CREATE INDEX "inventory_issue_items_product_id_created_at_idx" ON "inventory_issue_items"("product_id", "created_at" DESC);
