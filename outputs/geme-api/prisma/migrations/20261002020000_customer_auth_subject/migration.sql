ALTER TABLE "customers"
ADD COLUMN "auth_subject_id" UUID;

CREATE UNIQUE INDEX "customers_auth_subject_id_key"
ON "customers" ("auth_subject_id");
