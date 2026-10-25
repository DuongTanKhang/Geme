-- Reversed settlements remain part of the financial audit trail, but their
-- orders become eligible for a corrected statement with a new reference.
ALTER TABLE "cod_reconciliation_batches"
  DROP CONSTRAINT IF EXISTS "cod_reconciliation_batches_status_check",
  ADD CONSTRAINT "cod_reconciliation_batches_status_check"
    CHECK ("status" IN ('OPEN', 'RECONCILED', 'RECONCILED_WITH_VARIANCE', 'REVERSED'));

ALTER TABLE "cod_reconciliation_items"
  DROP CONSTRAINT IF EXISTS "cod_reconciliation_items_status_check",
  ADD CONSTRAINT "cod_reconciliation_items_status_check"
    CHECK ("status" IN ('MATCHED', 'VARIANCE', 'REVERSED'));
