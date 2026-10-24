-- One logical return refund can be allocated across several captured payment
-- transactions. Keep a shared request key/hash on each atomic allocation row
-- so retries can replay the whole request without creating duplicate money rows.
ALTER TABLE "payment_refunds"
  ADD COLUMN "request_key" VARCHAR(128),
  ADD COLUMN "request_hash" VARCHAR(64);

CREATE INDEX "payment_refunds_request_key_idx" ON "payment_refunds"("request_key");
