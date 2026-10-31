CREATE TABLE "admin_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" VARCHAR(40) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "message" TEXT NOT NULL,
  "entity_type" VARCHAR(40),
  "entity_id" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_notification_reads" (
  "notification_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_notification_reads_pkey" PRIMARY KEY ("notification_id", "admin_id"),
  CONSTRAINT "admin_notification_reads_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "admin_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "admin_notification_reads_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "admin_notifications_created_at_idx" ON "admin_notifications"("created_at" DESC);
CREATE INDEX "admin_notifications_entity_type_entity_id_created_at_idx" ON "admin_notifications"("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "admin_notification_reads_admin_id_read_at_idx" ON "admin_notification_reads"("admin_id", "read_at");
