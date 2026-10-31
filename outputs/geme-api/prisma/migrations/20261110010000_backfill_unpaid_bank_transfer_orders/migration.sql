UPDATE "orders" AS order_row
SET "status" = 'PENDING_PAYMENT',
    "updated_at" = CURRENT_TIMESTAMP
WHERE order_row."status" = 'PENDING_CONFIRMATION'
  AND EXISTS (
    SELECT 1
    FROM "payments" AS payment_row
    WHERE payment_row."order_id" = order_row."id"
      AND payment_row."method" = 'BANK_TRANSFER'
  )
  AND COALESCE((
    SELECT SUM(payment_row."amount")
    FROM "payments" AS payment_row
    WHERE payment_row."order_id" = order_row."id"
      AND payment_row."status" IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
  ), 0) < order_row."total_amount";
