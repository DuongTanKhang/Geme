CREATE TYPE "admin_role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'CONTENT_EDITOR');
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "product_kind" AS ENUM ('JEWELRY', 'GEMSTONE');
CREATE TYPE "category_usage" AS ENUM ('PRODUCT_CATEGORY', 'GEMSTONE_TYPE');
CREATE TYPE "category_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN');
CREATE TYPE "order_status" AS ENUM ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED');
CREATE TYPE "payment_method" AS ENUM ('COD', 'BANK_TRANSFER', 'MOMO', 'CREDIT_CARD', 'OTHER');
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "promotion_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'GIFT', 'POINTS');
CREATE TYPE "promotion_status" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "blog_status" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');
CREATE TYPE "review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "admin_users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "role" "admin_role" NOT NULL DEFAULT 'ADMIN',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_login_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

CREATE TABLE "customers" (
  "id" UUID NOT NULL,
  "code" VARCHAR(32),
  "name" VARCHAR(160) NOT NULL,
  "email" VARCHAR(320),
  "phone" VARCHAR(32),
  "default_address" TEXT,
  "status" "customer_status" NOT NULL DEFAULT 'ACTIVE',
  "segment" VARCHAR(40),
  "avatar_url" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");
CREATE INDEX "customers_status_created_at_idx" ON "customers"("status", "created_at");
CREATE INDEX "customers_name_idx" ON "customers"("name");

CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "kind" "product_kind" NOT NULL,
  "usage" "category_usage" NOT NULL DEFAULT 'PRODUCT_CATEGORY',
  "parent_id" UUID,
  "description" TEXT,
  "status" "category_status" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "image_url" TEXT,
  "banner_url" TEXT,
  "seo_title" VARCHAR(180),
  "seo_description" VARCHAR(320),
  "is_hot" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parent_id_status_sort_order_idx" ON "categories"("parent_id", "status", "sort_order");
CREATE INDEX "categories_kind_usage_status_idx" ON "categories"("kind", "usage", "status");

CREATE TABLE "products" (
  "id" UUID NOT NULL,
  "sku" VARCHAR(64) NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "slug" VARCHAR(220) NOT NULL,
  "kind" "product_kind" NOT NULL,
  "category_id" UUID NOT NULL,
  "gemstone_type_id" UUID,
  "description" TEXT,
  "full_description" TEXT,
  "status" "product_status" NOT NULL DEFAULT 'DRAFT',
  "is_new" BOOLEAN NOT NULL DEFAULT false,
  "is_featured" BOOLEAN NOT NULL DEFAULT false,
  "price" DECIMAL(14,0),
  "original_price" DECIMAL(14,0),
  "seo_title" VARCHAR(180),
  "seo_description" VARCHAR(320),
  "kiot_viet_product_id" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "products_gemstone_type_id_fkey" FOREIGN KEY ("gemstone_type_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "products_price_nonnegative" CHECK ("price" IS NULL OR "price" >= 0),
  CONSTRAINT "products_original_price_nonnegative" CHECK ("original_price" IS NULL OR "original_price" >= 0)
);
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");
CREATE UNIQUE INDEX "products_kiot_viet_product_id_key" ON "products"("kiot_viet_product_id");
CREATE INDEX "products_kind_status_is_new_idx" ON "products"("kind", "status", "is_new");
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");
CREATE INDEX "products_gemstone_type_id_idx" ON "products"("gemstone_type_id");

CREATE TABLE "product_images" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "alt" VARCHAR(240),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

CREATE TABLE "product_price_variants" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "option_key" VARCHAR(100) NOT NULL,
  "quality" VARCHAR(40) NOT NULL,
  "bead_size" VARCHAR(24),
  "sku" VARCHAR(64),
  "price" DECIMAL(14,0) NOT NULL,
  "original_price" DECIMAL(14,0),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_price_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_price_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_price_variants_price_nonnegative" CHECK ("price" >= 0),
  CONSTRAINT "product_price_variants_original_price_nonnegative" CHECK ("original_price" IS NULL OR "original_price" >= 0)
);
CREATE UNIQUE INDEX "product_price_variants_sku_key" ON "product_price_variants"("sku");
CREATE UNIQUE INDEX "product_price_variants_product_id_option_key_key" ON "product_price_variants"("product_id", "option_key");
CREATE INDEX "product_price_variants_product_id_sort_order_idx" ON "product_price_variants"("product_id", "sort_order");

CREATE TABLE "product_reviews" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "customer_id" UUID,
  "rating" INTEGER NOT NULL,
  "title" VARCHAR(160),
  "content" TEXT,
  "status" "review_status" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "product_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5)
);
CREATE INDEX "product_reviews_product_id_status_created_at_idx" ON "product_reviews"("product_id", "status", "created_at");

CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "customer_id" UUID,
  "status" "order_status" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "customer_name" VARCHAR(160) NOT NULL,
  "customer_email" VARCHAR(320),
  "customer_phone" VARCHAR(32),
  "shipping_address" TEXT NOT NULL,
  "shipping_method" VARCHAR(120),
  "tracking_code" VARCHAR(120),
  "subtotal" DECIMAL(14,0) NOT NULL,
  "discount_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "shipping_fee" DECIMAL(14,0) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(14,0) NOT NULL,
  "note" TEXT,
  "kiot_viet_order_id" VARCHAR(80),
  "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "orders_amounts_nonnegative" CHECK ("subtotal" >= 0 AND "discount_amount" >= 0 AND "shipping_fee" >= 0 AND "total_amount" >= 0)
);
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");
CREATE UNIQUE INDEX "orders_kiot_viet_order_id_key" ON "orders"("kiot_viet_order_id");
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at");

CREATE TABLE "order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" UUID,
  "variant_id" UUID,
  "product_name" VARCHAR(180) NOT NULL,
  "product_sku" VARCHAR(64) NOT NULL,
  "quality" VARCHAR(40),
  "bead_size" VARCHAR(24),
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(14,0) NOT NULL,
  "line_total" DECIMAL(14,0) NOT NULL,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_price_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_amounts_nonnegative" CHECK ("unit_price" >= 0 AND "line_total" >= 0)
);
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

CREATE TABLE "payments" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "method" "payment_method" NOT NULL,
  "status" "payment_status" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(14,0) NOT NULL,
  "provider_ref" VARCHAR(160),
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payments_amount_nonnegative" CHECK ("amount" >= 0)
);
CREATE INDEX "payments_order_id_status_idx" ON "payments"("order_id", "status");

CREATE TABLE "promotions" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "type" "promotion_type" NOT NULL,
  "code" VARCHAR(48),
  "value" DECIMAL(14,0),
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "promotion_status" NOT NULL DEFAULT 'DRAFT',
  "usage_limit" INTEGER,
  "auto_end_at_limit" BOOLEAN NOT NULL DEFAULT false,
  "minimum_order" DECIMAL(14,0),
  "conditions" JSONB,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "image_url" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotions_usage_limit_positive" CHECK ("usage_limit" IS NULL OR "usage_limit" > 0),
  CONSTRAINT "promotions_dates_valid" CHECK ("ends_at" >= "starts_at"),
  CONSTRAINT "promotions_amounts_nonnegative" CHECK (("value" IS NULL OR "value" >= 0) AND ("minimum_order" IS NULL OR "minimum_order" >= 0))
);
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");
CREATE INDEX "promotions_status_starts_at_ends_at_idx" ON "promotions"("status", "starts_at", "ends_at");

CREATE TABLE "promotion_targets" (
  "id" UUID NOT NULL,
  "promotion_id" UUID NOT NULL,
  "category_id" UUID,
  "product_id" UUID,
  "excluded" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "promotion_targets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "promotion_targets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "promotion_targets_one_target" CHECK (("category_id" IS NOT NULL) <> ("product_id" IS NOT NULL))
);
CREATE INDEX "promotion_targets_promotion_id_excluded_idx" ON "promotion_targets"("promotion_id", "excluded");
CREATE INDEX "promotion_targets_category_id_idx" ON "promotion_targets"("category_id");
CREATE INDEX "promotion_targets_product_id_idx" ON "promotion_targets"("product_id");

CREATE TABLE "promotion_usages" (
  "id" UUID NOT NULL,
  "promotion_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "customer_id" UUID,
  "discount_amount" DECIMAL(14,0) NOT NULL,
  "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promotion_usages_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "promotion_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "promotion_usages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "promotion_usages_discount_nonnegative" CHECK ("discount_amount" >= 0)
);
CREATE UNIQUE INDEX "promotion_usages_order_id_key" ON "promotion_usages"("order_id");
CREATE INDEX "promotion_usages_promotion_id_used_at_idx" ON "promotion_usages"("promotion_id", "used_at");
CREATE INDEX "promotion_usages_customer_id_used_at_idx" ON "promotion_usages"("customer_id", "used_at");

CREATE TABLE "blog_posts" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(220) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "summary" VARCHAR(500),
  "content" TEXT NOT NULL,
  "cover_image_url" TEXT,
  "status" "blog_status" NOT NULL DEFAULT 'DRAFT',
  "views" INTEGER NOT NULL DEFAULT 0,
  "seo_title" VARCHAR(180),
  "seo_description" VARCHAR(320),
  "author_id" UUID,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");

CREATE TABLE "blog_post_images" (
  "id" UUID NOT NULL,
  "post_id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "alt" VARCHAR(240),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "blog_post_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blog_post_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "blog_post_images_post_id_sort_order_idx" ON "blog_post_images"("post_id", "sort_order");

CREATE TABLE "site_settings" (
  "key" VARCHAR(120) NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "admin_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" VARCHAR(80),
  "before" JSONB,
  "after" JSONB,
  "ip_address" INET,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at");
