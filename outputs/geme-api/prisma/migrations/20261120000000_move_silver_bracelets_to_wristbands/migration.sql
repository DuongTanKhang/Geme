-- Reclassify all products from the retired "Vòng tay bạc" child category to
-- the existing "Lắc tay" category, then remove the retired category.
-- Keep promotion behavior attached to the exact products that were in the old
-- category instead of widening those promotions to every "Lắc tay" product.
BEGIN;

CREATE TEMP TABLE _geme_old_silver_bracelet_category ON COMMIT DROP AS
SELECT id
FROM categories
WHERE slug = 'vong-tay-bac';

CREATE TEMP TABLE _geme_lac_tay_category ON COMMIT DROP AS
SELECT id
FROM categories
WHERE slug = 'lac-tay';

DO $$
DECLARE
  old_id uuid;
  target_id uuid;
  old_category categories%ROWTYPE;
  target_category categories%ROWTYPE;
BEGIN
  SELECT id INTO old_id FROM _geme_old_silver_bracelet_category LIMIT 1;
  IF old_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO target_id FROM _geme_lac_tay_category LIMIT 1;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'Cannot move products: required category slug "lac-tay" is missing';
  END IF;

  SELECT * INTO old_category FROM categories WHERE id = old_id;
  SELECT * INTO target_category FROM categories WHERE id = target_id;

  IF old_category.kind <> 'JEWELRY' OR old_category.usage <> 'PRODUCT_CATEGORY' THEN
    RAISE EXCEPTION 'Unexpected source category shape for slug "vong-tay-bac"';
  END IF;
  IF target_category.kind <> 'JEWELRY' OR target_category.usage <> 'PRODUCT_CATEGORY' OR target_category.level <> 2 THEN
    RAISE EXCEPTION 'Unexpected target category shape for slug "lac-tay"';
  END IF;
  IF EXISTS (SELECT 1 FROM categories WHERE parent_id = old_id) THEN
    RAISE EXCEPTION 'Cannot remove "vong-tay-bac": it has child categories';
  END IF;
END $$;

CREATE TEMP TABLE _geme_moved_silver_bracelet_products ON COMMIT DROP AS
SELECT id
FROM products
WHERE category_id IN (SELECT id FROM _geme_old_silver_bracelet_category);

CREATE TEMP TABLE _geme_old_silver_bracelet_promotion_targets ON COMMIT DROP AS
SELECT DISTINCT promotion_id, excluded
FROM promotion_targets
WHERE category_id IN (SELECT id FROM _geme_old_silver_bracelet_category);

UPDATE products AS product
SET category_id = target.id,
    updated_at = now()
FROM _geme_lac_tay_category AS target
WHERE product.category_id IN (SELECT id FROM _geme_old_silver_bracelet_category);

INSERT INTO promotion_targets (id, promotion_id, category_id, product_id, excluded)
SELECT gen_random_uuid(), old_target.promotion_id, NULL, moved_product.id, old_target.excluded
FROM _geme_old_silver_bracelet_promotion_targets AS old_target
CROSS JOIN _geme_moved_silver_bracelet_products AS moved_product
WHERE NOT EXISTS (
  SELECT 1
  FROM promotion_targets AS existing_target
  WHERE existing_target.promotion_id = old_target.promotion_id
    AND existing_target.product_id = moved_product.id
    AND existing_target.excluded = old_target.excluded
);

DELETE FROM promotion_targets
WHERE category_id IN (SELECT id FROM _geme_old_silver_bracelet_category);

DELETE FROM categories
WHERE id IN (SELECT id FROM _geme_old_silver_bracelet_category);

COMMIT;
