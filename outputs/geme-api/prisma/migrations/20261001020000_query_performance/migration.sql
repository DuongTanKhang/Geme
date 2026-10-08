-- Query indexes for the storefront and admin list/report screens.
-- Existing indexes that only covered filter columns are replaced with
-- filter + newest-first indexes so PostgreSQL can avoid an extra sort.

CREATE INDEX "customers_created_at_id_idx"
  ON "customers" ("created_at" DESC, "id" DESC);

DROP INDEX "products_kind_status_is_new_idx";
CREATE INDEX "products_kind_status_created_at_idx"
  ON "products" ("kind", "status", "created_at" DESC);
CREATE INDEX "products_status_is_new_created_at_idx"
  ON "products" ("status", "is_new", "created_at" DESC);
DROP INDEX "products_category_id_status_idx";
CREATE INDEX "products_category_id_status_created_at_idx"
  ON "products" ("category_id", "status", "created_at" DESC);
DROP INDEX "products_gemstone_type_id_idx";
CREATE INDEX "products_gemstone_type_id_status_created_at_idx"
  ON "products" ("gemstone_type_id", "status", "created_at" DESC);
CREATE INDEX "products_status_is_featured_created_at_idx"
  ON "products" ("status", "is_featured", "created_at" DESC);
CREATE INDEX "products_status_created_at_idx"
  ON "products" ("status", "created_at" DESC);
CREATE INDEX "products_created_at_id_idx"
  ON "products" ("created_at" DESC, "id" DESC);

CREATE INDEX "product_price_variants_product_id_quality_bead_size_idx"
  ON "product_price_variants" ("product_id", "quality", "bead_size");

DROP INDEX "product_reviews_product_id_status_created_at_idx";
CREATE INDEX "product_reviews_product_id_status_created_at_idx"
  ON "product_reviews" ("product_id", "status", "created_at" DESC);
CREATE INDEX "product_reviews_customer_id_created_at_idx"
  ON "product_reviews" ("customer_id", "created_at" DESC);

DROP INDEX "orders_status_placed_at_idx";
CREATE INDEX "orders_status_placed_at_idx"
  ON "orders" ("status", "placed_at" DESC);
DROP INDEX "orders_customer_id_placed_at_idx";
CREATE INDEX "orders_customer_id_placed_at_idx"
  ON "orders" ("customer_id", "placed_at" DESC);
CREATE INDEX "orders_placed_at_idx"
  ON "orders" ("placed_at" DESC);

CREATE INDEX "order_items_variant_id_idx"
  ON "order_items" ("variant_id");

CREATE INDEX "payments_status_paid_at_idx"
  ON "payments" ("status", "paid_at" DESC);

DROP INDEX "blog_posts_status_published_at_idx";
CREATE INDEX "blog_posts_status_published_at_idx"
  ON "blog_posts" ("status", "published_at" DESC);
CREATE INDEX "blog_posts_author_id_created_at_idx"
  ON "blog_posts" ("author_id", "created_at" DESC);

DROP INDEX "audit_logs_entity_type_entity_id_created_at_idx";
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx"
  ON "audit_logs" ("entity_type", "entity_id", "created_at" DESC);
DROP INDEX "audit_logs_admin_id_created_at_idx";
CREATE INDEX "audit_logs_admin_id_created_at_idx"
  ON "audit_logs" ("admin_id", "created_at" DESC);
