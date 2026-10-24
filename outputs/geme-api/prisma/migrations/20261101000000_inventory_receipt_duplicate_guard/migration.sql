ALTER TABLE "inventory_receipts"
ADD COLUMN "request_fingerprint" VARCHAR(64);

CREATE INDEX "inventory_receipts_request_fingerprint_created_at_idx"
ON "inventory_receipts"("request_fingerprint", "created_at" DESC);
