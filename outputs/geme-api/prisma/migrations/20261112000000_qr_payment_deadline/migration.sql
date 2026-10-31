ALTER TABLE "orders"
  ADD COLUMN "qr_payment_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "qr_payment_expires_at" TIMESTAMPTZ(3);
