ALTER TABLE "orders"
  ADD COLUMN "carrier_freight_payment" VARCHAR(12),
  ADD COLUMN "carrier_cod_amount" DECIMAL(14,0);
