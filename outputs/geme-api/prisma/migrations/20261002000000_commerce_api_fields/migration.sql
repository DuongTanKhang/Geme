ALTER TABLE "products" ALTER COLUMN "category_id" DROP NOT NULL;
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "material_option_id" UUID;
ALTER TABLE "products" ADD CONSTRAINT "products_material_option_id_fkey" FOREIGN KEY ("material_option_id") REFERENCES "material_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "products_material_option_id_status_created_at_idx" ON "products"("material_option_id", "status", "created_at" DESC);
ALTER TABLE "product_price_variants" ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "blog_posts" ADD COLUMN "category" VARCHAR(120);
ALTER TABLE "blog_posts" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
