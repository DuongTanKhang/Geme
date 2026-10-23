# GEME commerce operations: invariants and rollout

## Current model and compatibility boundary

The current production-compatible inventory behavior is a legacy reservation model: creating an accepted online order conditionally decrements `Product.stock` (and a selected variant's `stock`) and records `Order.inventoryReservedAt`. Cancelling before fulfillment increments stock once and records `inventoryReleasedAt`; fulfillment records `inventoryCommittedAt`. In this model `stock` is the quantity available after outstanding legacy holds, not a separate physical-on-hand count. Do not reinterpret it as physical stock, add old reservations back in bulk, or backfill reserved quantities from order status alone.

New changes retain these markers and conditional transactions. Historical orders may not have complete, reconcilable issue/return evidence; ambiguous rows must be reported for human review. Before any stock-model migration, take a database backup, run a read-only classification against orders, inventory movements, inventory issue records and carrier events, compare totals, and get explicit approval. No startup-time stock repair or production backfill is allowed.

## Operational invariants

- A payment state is independent from order and shipment state. A delivered COD parcel is not proof that the carrier remitted money; settlement is recorded separately.
- A payment, inventory hold/release/issue, and return receipt/refund must be idempotent and concurrency-checked.
- No customer request, webhook, retry, or duplicate click may decrement or restore stock twice.
- Each order line resolves to one product or exact variant SKU. A variant order must never fall back to its parent SKU.
- Cancellation is allowed only before inventory issue/commit. After issue, use a return/refund workflow; never cancel to restore stock.
- State transitions are forward-only. Carrier-owned shipment states are advanced only from carrier events; same/older webhook events are no-ops.
- Prices and money use database Decimal or integer currency units; frontend totals are confirmations, never authoritative.
- Public checkout validates the shipping contact and address and rejects over-limit input instead of silently truncating it.
- Side effects such as email, POS, carrier, and social synchronization run after the database transaction and are never simulated against live services by tests.
- Order confirmation email is stored in `order_email_outbox` in the order transaction. `ACCEPTED` means Aegis durably queued the request, not that a mailbox received it. Aegis uses the same idempotency key to return the original delivery state and never sends the same key twice. Ambiguous timeouts/5xx are marked `UNKNOWN`; GEME checks Aegis before any explicit retry and blocks retries while the outcome is uncertain.
- `inventory_reservations` records each unpaid order line separately. `Product.stock` remains available stock for backward compatibility; physical on-hand is reported as available plus active reservations. `ORDER_INVENTORY_RESERVATION_TTL_MINUTES` defaults to 30 and is clamped to 5–1440 minutes. The worker expires only unpaid `PENDING_CONFIRMATION` non-COD orders. COD holds remain through fulfillment; paid or accepted (`PROCESSING`) orders lose the expiry but retain the active hold. Existing active legacy holds are backfilled without expiry so deployment does not cancel old orders or alter stock; review those rows separately before setting any expiry.
- Return requests are accepted only for delivered orders and cannot exceed quantities purchased across non-rejected returns. Restocking requires an explicit per-line decision after receipt. Refund entries are an internal money ledger; they do not call a payment provider or move money.
- COD batches require delivered COD orders, a unique carrier statement reference, and per-order expected/received/fee values. Exact matches mark COD payment as collected; variances remain visible and require an explicit close note.
- Admin endpoints have per-function permissions, including private media reads. Permission changes, denied access attempts by authenticated admins, and admin mutation attempts (success or failure) are written to `audit_logs`; audit entries exclude request bodies and secrets.

## Email delivery configuration

Set `AEGIS_ORDER_EMAIL_URL` and `GEME_ORDER_EMAIL_API_KEY` in the GEME API environment. Configure the same random secret (at least 32 characters) as `InternalApi__OrderEmailKey` in Aegis/Compose. Keep both values server-side. Apply the additive GEME and Aegis migrations before starting the new binaries. Aegis stores the idempotency key and request hash, and temporarily stores the queued email payload as AES-GCM encrypted data until the single SMTP attempt finishes; it clears the payload on `SENT` or `UNKNOWN`. Keep database backups protected and drain queued messages before rotating the shared secret, since it also encrypts queued payloads. Repeating the same key/payload returns the stored state; reusing a key with different content is rejected. Aegis does not automatically retry an ambiguous SMTP result because SMTP cannot guarantee exactly-once delivery. Admin retry checks Aegis first; a `SENT` result is synchronized without resending, and an ambiguous `UNKNOWN` result stays blocked until an operator verifies the mailbox/provider outcome. `ACCEPTED` means Aegis recorded the request, not delivery to the recipient's mailbox.

## Current implementation boundary

The order-line reservation ledger and expiry worker are additive over the existing decrement-at-checkout behavior, so `stock` continues to mean available quantity to legacy clients. The Admin Vận hành workspace exposes reservation metrics, return/refund processing, COD batches, and audit history. A refund record is accounting evidence only and a staff member must issue the actual refund using the payment provider. Database-backed concurrency tests and both migrations must be applied before deployment.

## Verification and rollout

1. Back up the target database and record the deployed commit.
2. Apply only additive Prisma migrations in a non-production environment first.
3. Run API unit/contract tests and a database-backed concurrency suite with a dedicated test database.
4. Reconcile legacy orders without changing stock; export ambiguous order IDs for operator review.
5. Validate checkout, POS, Viettel Post, reports, and inventory movement totals against a known fixture.
6. Deploy application and migration separately; never run an unreviewed stock backfill at application startup.
7. Roll back code first if required; a schema rollback or data repair must use a reviewed backup/forward migration, not an automatic destructive down migration.

## Current environment limitations

Local Docker Engine access is required for database-backed transaction/concurrency checks. A unit-test pass is not evidence that two independent buyers cannot reserve the final unit. External Aegis email and live commerce provider calls must use test doubles and are not called by the local test suite.
