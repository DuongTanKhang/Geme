-- Existing mappings are preserved as explicit/admin-reviewed mappings because
-- older rows do not record whether they were created manually or by auto-match.
ALTER TABLE "shopee_item_mappings"
  ADD COLUMN "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL';
