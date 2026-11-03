CREATE TABLE "gmail_oauth_states" (
  "state_hash" CHAR(64) NOT NULL,
  "admin_id" UUID NOT NULL,
  "code_verifier" VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gmail_oauth_states_pkey" PRIMARY KEY ("state_hash")
);

CREATE INDEX "gmail_oauth_states_expires_at_idx" ON "gmail_oauth_states"("expires_at");

CREATE TABLE "gmail_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  "refresh_token_ciphertext" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by_admin_id" UUID NOT NULL,
  "disconnected_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "gmail_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gmail_connections_email_key" ON "gmail_connections"("email");
CREATE INDEX "gmail_connections_status_updated_at_idx" ON "gmail_connections"("status", "updated_at" DESC);

ALTER TABLE "gmail_oauth_states" ADD CONSTRAINT "gmail_oauth_states_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
