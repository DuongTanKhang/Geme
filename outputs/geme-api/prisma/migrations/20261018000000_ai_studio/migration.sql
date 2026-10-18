CREATE TYPE "ai_task_type" AS ENUM (
  'CONTENT_DRAFT',
  'IMAGE_GENERATION',
  'PRODUCT_PUBLICATION_PROPOSAL'
);

CREATE TYPE "ai_task_status" AS ENUM (
  'QUEUED',
  'RUNNING',
  'AWAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "ai_approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ai_tasks" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "requested_by_admin_id" UUID NOT NULL,
  "type" "ai_task_type" NOT NULL,
  "status" "ai_task_status" NOT NULL DEFAULT 'QUEUED',
  "title" VARCHAR(120) NOT NULL,
  "input" JSONB NOT NULL,
  "result" JSONB,
  "error_code" VARCHAR(80),
  "error_message" VARCHAR(500),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_approvals" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "reviewed_by_admin_id" UUID,
  "status" "ai_approval_status" NOT NULL DEFAULT 'PENDING',
  "decision_note" VARCHAR(1000),
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_tasks_idempotency_key_key" ON "ai_tasks"("idempotency_key");
CREATE INDEX "ai_tasks_status_created_at_idx" ON "ai_tasks"("status", "created_at" DESC);
CREATE INDEX "ai_tasks_requested_by_admin_id_created_at_idx" ON "ai_tasks"("requested_by_admin_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_approvals_task_id_key" ON "ai_approvals"("task_id");
CREATE INDEX "ai_approvals_status_requested_at_idx" ON "ai_approvals"("status", "requested_at" DESC);
CREATE INDEX "ai_approvals_reviewed_by_admin_id_reviewed_at_idx" ON "ai_approvals"("reviewed_by_admin_id", "reviewed_at" DESC);

ALTER TABLE "ai_tasks"
  ADD CONSTRAINT "ai_tasks_requested_by_admin_id_fkey"
  FOREIGN KEY ("requested_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_approvals"
  ADD CONSTRAINT "ai_approvals_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "ai_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_approvals_reviewed_by_admin_id_fkey"
  FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
