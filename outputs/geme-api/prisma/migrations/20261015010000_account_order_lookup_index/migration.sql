-- Account-created guest orders use normalized email, so link them by exact
-- email while keeping the account order lookup indexed.
UPDATE "orders"
SET "customer_email" = LOWER("customer_email")
WHERE "customer_id" IS NULL
  AND "customer_email" IS NOT NULL
  AND "customer_email" <> LOWER("customer_email");

CREATE INDEX "orders_customer_id_customer_email_idx"
ON "orders" ("customer_id", "customer_email");

CREATE INDEX "products_status_stock_sold_out_at_idx"
ON "products" ("status", "stock", "sold_out_at");
