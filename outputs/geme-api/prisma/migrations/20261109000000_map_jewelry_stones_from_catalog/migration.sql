-- New Arrivals groups should follow the existing jewelry gemstone catalog.
-- Use exact source slugs from Đá gắn/Chất liệu and gemstone taxonomy; never
-- infer gemstone identity from the product display name.
WITH source_stones AS (
  SELECT mo.slug, mo.name, mo.sort_order, 0 AS source_priority
  FROM material_options mo
  WHERE mo.scope = 'JEWELRY'
    AND mo.kind = 'STONE'
    AND mo.active = true
    AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.material_option_id = mo.id
        AND p.kind = 'JEWELRY'
        AND p.status <> 'ARCHIVED'
    )

  UNION ALL

  SELECT c.slug, c.name, c.sort_order, 1 AS source_priority
  FROM categories c
  WHERE c.kind = 'GEMSTONE'
    AND c.usage = 'GEMSTONE_TYPE'
    AND c.status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM products p
      WHERE p.gemstone_type_id = c.id
        AND p.kind = 'JEWELRY'
        AND p.status <> 'ARCHIVED'
    )
), distinct_stones AS (
  SELECT DISTINCT ON (slug) slug, name, sort_order
  FROM source_stones
  ORDER BY slug, source_priority, sort_order, name
)
INSERT INTO jewelry_stone_groups (id, slug, name, active, sort_order, pinned_order, created_at, updated_at)
SELECT gen_random_uuid(), slug, name, true, sort_order, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM distinct_stones
ON CONFLICT (slug) DO NOTHING;

-- Preserve any existing explicit mapping. Only fill missing mappings, matching
-- the source catalog slug exactly to the canonical group slug.
UPDATE material_options mo
SET jewelry_stone_group_id = g.id,
    updated_at = CURRENT_TIMESTAMP
FROM jewelry_stone_groups g
WHERE mo.jewelry_stone_group_id IS NULL
  AND mo.scope = 'JEWELRY'
  AND mo.kind = 'STONE'
  AND mo.active = true
  AND mo.slug = g.slug
  AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.material_option_id = mo.id
      AND p.kind = 'JEWELRY'
      AND p.status <> 'ARCHIVED'
  );

UPDATE categories c
SET jewelry_stone_group_id = g.id,
    updated_at = CURRENT_TIMESTAMP
FROM jewelry_stone_groups g
WHERE c.jewelry_stone_group_id IS NULL
  AND c.kind = 'GEMSTONE'
  AND c.usage = 'GEMSTONE_TYPE'
  AND c.status = 'ACTIVE'
  AND c.slug = g.slug
  AND EXISTS (
    SELECT 1 FROM products p
    WHERE p.gemstone_type_id = c.id
      AND p.kind = 'JEWELRY'
      AND p.status <> 'ARCHIVED'
  );
