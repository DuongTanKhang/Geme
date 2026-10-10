ALTER TABLE "customers"
  ADD COLUMN "pos365_partner_id" VARCHAR(80);

CREATE UNIQUE INDEX "customers_pos365_partner_id_key"
  ON "customers"("pos365_partner_id");
