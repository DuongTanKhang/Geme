ALTER TABLE "categories"
  DROP CONSTRAINT "categories_level_range",
  DROP CONSTRAINT "categories_root_level";

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_level_range"
    CHECK ("level" BETWEEN 1 AND 4),
  ADD CONSTRAINT "categories_root_level"
    CHECK (("parent_id" IS NULL AND "level" = 1) OR ("parent_id" IS NOT NULL AND "level" IN (2, 3, 4))),
  ADD CONSTRAINT "categories_other_level_limit"
    CHECK (("kind" = 'OTHER' AND "level" <= 4) OR ("kind" <> 'OTHER' AND "level" <= 3));
