ALTER TABLE "orders"
  ADD COLUMN "shipping_latitude" DOUBLE PRECISION,
  ADD COLUMN "shipping_longitude" DOUBLE PRECISION;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_shipping_coordinates_pair_check"
  CHECK (("shipping_latitude" IS NULL) = ("shipping_longitude" IS NULL));

CREATE INDEX "orders_shipping_coordinates_idx"
  ON "orders" ("shipping_latitude", "shipping_longitude")
  WHERE "shipping_latitude" IS NOT NULL AND "shipping_longitude" IS NOT NULL;
