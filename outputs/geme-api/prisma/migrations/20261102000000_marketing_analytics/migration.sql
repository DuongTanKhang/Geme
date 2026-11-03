ALTER TABLE "orders" ADD COLUMN "marketing_session_id" UUID;

CREATE TABLE "marketing_sessions" (
    "id" UUID NOT NULL,
    "visitor_hash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(120),
    "medium" VARCHAR(120),
    "campaign" VARCHAR(160),
    "referrer_host" VARCHAR(180),
    "landing_path" VARCHAR(512) NOT NULL,
    "last_path" VARCHAR(512) NOT NULL,
    "page_views" INTEGER NOT NULL DEFAULT 1,
    "signed_up_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing_spend" (
    "id" UUID NOT NULL,
    "spent_on" DATE NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "campaign" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "note" VARCHAR(500),
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_spend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "orders_marketing_session_id_placed_at_idx" ON "orders"("marketing_session_id", "placed_at" DESC);
CREATE INDEX "marketing_sessions_started_at_idx" ON "marketing_sessions"("started_at" DESC);
CREATE INDEX "marketing_sessions_signed_up_at_idx" ON "marketing_sessions"("signed_up_at" DESC);
CREATE INDEX "marketing_sessions_source_started_at_idx" ON "marketing_sessions"("source", "started_at" DESC);
CREATE INDEX "marketing_sessions_campaign_started_at_idx" ON "marketing_sessions"("campaign", "started_at" DESC);
CREATE INDEX "marketing_spend_spent_on_source_idx" ON "marketing_spend"("spent_on" DESC, "source");
CREATE INDEX "marketing_spend_campaign_spent_on_idx" ON "marketing_spend"("campaign", "spent_on" DESC);

ALTER TABLE "orders" ADD CONSTRAINT "orders_marketing_session_id_fkey"
FOREIGN KEY ("marketing_session_id") REFERENCES "marketing_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
