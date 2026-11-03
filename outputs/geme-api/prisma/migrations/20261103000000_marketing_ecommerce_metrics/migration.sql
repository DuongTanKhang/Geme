ALTER TABLE "marketing_sessions"
  ADD COLUMN "cart_add_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "marketing_sessions"
  ADD COLUMN "cart_added_at" TIMESTAMPTZ(3);

CREATE INDEX "marketing_sessions_visitor_hash_started_at_idx"
  ON "marketing_sessions"("visitor_hash", "started_at" DESC);

CREATE INDEX "marketing_sessions_cart_added_at_idx"
  ON "marketing_sessions"("cart_added_at" DESC);
