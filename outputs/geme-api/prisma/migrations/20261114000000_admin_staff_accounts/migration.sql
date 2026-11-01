ALTER TYPE "admin_role" ADD VALUE IF NOT EXISTS 'STAFF';

ALTER TABLE "admin_users"
  ADD COLUMN "username" VARCHAR(64),
  ADD COLUMN "job_title" VARCHAR(80),
  ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");
