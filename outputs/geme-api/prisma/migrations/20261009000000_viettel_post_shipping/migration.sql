ALTER TABLE "orders"
  ADD COLUMN "shipping_provider" VARCHAR(40),
  ADD COLUMN "shipping_service_code" VARCHAR(24),
  ADD COLUMN "carrier_shipment_status" VARCHAR(20),
  ADD COLUMN "carrier_shipment_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "carrier_shipment_error" TEXT,
  ADD COLUMN "carrier_status_code" INTEGER,
  ADD COLUMN "carrier_status_name" VARCHAR(180),
  ADD COLUMN "carrier_status_at" TIMESTAMPTZ(3),
  ADD COLUMN "carrier_location" VARCHAR(255),
  ADD COLUMN "carrier_fee" DECIMAL(14, 0);

CREATE INDEX "orders_tracking_code_idx" ON "orders"("tracking_code");
