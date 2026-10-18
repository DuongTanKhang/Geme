ALTER TABLE "media_assets"
ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "admin_users"
ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "locked_until" TIMESTAMPTZ(3);

-- Receipt attachments have historically shared the public media table. Hide
-- known receipt uploads and PDFs from unauthenticated asset URLs as well.
UPDATE "media_assets"
SET "is_private" = true
WHERE lower("mime_type") = 'application/pdf'
   OR lower(coalesce("alt", '')) LIKE lower('Chứng từ nhập hàng %');
