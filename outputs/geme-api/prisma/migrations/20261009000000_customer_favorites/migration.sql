CREATE TABLE "customer_favorites" (
  "customer_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("customer_id", "product_id"),
  CONSTRAINT "customer_favorites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "customer_favorites_product_id_idx" ON "customer_favorites"("product_id");
CREATE INDEX "customer_favorites_customer_id_created_at_idx" ON "customer_favorites"("customer_id", "created_at" DESC);
