CREATE TYPE "category_pricing_mode" AS ENUM ('FIXED', 'QUALITY', 'QUALITY_AND_BEAD_SIZE');

ALTER TABLE "categories"
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pricing_mode" "category_pricing_mode" NOT NULL DEFAULT 'FIXED';

-- Existing categories were roots or direct children. Move the bracelet subcategories
-- to level 3 and classify them under the jewelry branch.
UPDATE "categories" AS child
SET "level" = 2
WHERE child."parent_id" IS NOT NULL;

UPDATE "categories" AS child
SET "parent_id" = bracelet."id",
    "kind" = 'JEWELRY',
    "level" = 3,
    "pricing_mode" = CASE child."slug"
      WHEN 'kieng-da' THEN 'QUALITY'::"category_pricing_mode"
      ELSE 'QUALITY_AND_BEAD_SIZE'::"category_pricing_mode"
    END
FROM "categories" AS bracelet
WHERE child."slug" IN ('vong-chuoi-deo', 'vong-chuoi-tay', 'vong-chuoi-hat', 'kieng-da')
  AND bracelet."slug" = 'vong-tay';

UPDATE "categories"
SET "name" = 'Mặt đá quý',
    "pricing_mode" = 'QUALITY'
WHERE "slug" = 'mat-da' AND "usage" = 'PRODUCT_CATEGORY';

UPDATE "categories"
SET "status" = 'INACTIVE'
WHERE "slug" IN ('da-roi', 'da-phong-thuy', 'vong-da', 'da-tho', 'kieng')
  AND "usage" = 'PRODUCT_CATEGORY';

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_level_range" CHECK ("level" BETWEEN 1 AND 3),
  ADD CONSTRAINT "categories_root_level" CHECK (("parent_id" IS NULL AND "level" = 1) OR ("parent_id" IS NOT NULL AND "level" IN (2, 3))),
  ADD CONSTRAINT "categories_stone_type_level" CHECK ("usage" <> 'GEMSTONE_TYPE' OR "level" = 2);

DROP INDEX "categories_parent_id_status_sort_order_idx";
CREATE INDEX "categories_parent_id_level_status_sort_order_idx" ON "categories"("parent_id", "level", "status", "sort_order");

CREATE FUNCTION "validate_category_hierarchy"() RETURNS TRIGGER AS $$
DECLARE
  parent_level INTEGER;
  parent_kind "product_kind";
BEGIN
  IF NEW.parent_id IS NULL THEN
    IF NEW.level <> 1 THEN
      RAISE EXCEPTION 'Root categories must be level 1';
    END IF;
  ELSE
    SELECT "level", "kind" INTO parent_level, parent_kind
    FROM "categories" WHERE "id" = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent category does not exist';
    END IF;
    IF NEW.level <> parent_level + 1 OR NEW.kind <> parent_kind THEN
      RAISE EXCEPTION 'Category level and kind must follow its parent';
    END IF;
    IF NEW.usage = 'GEMSTONE_TYPE' AND (parent_level <> 1 OR parent_kind <> 'GEMSTONE') THEN
      RAISE EXCEPTION 'Gemstone types must be children of the gemstone root';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "categories_hierarchy_trigger"
BEFORE INSERT OR UPDATE OF "parent_id", "level", "kind", "usage"
ON "categories"
FOR EACH ROW EXECUTE FUNCTION "validate_category_hierarchy"();
