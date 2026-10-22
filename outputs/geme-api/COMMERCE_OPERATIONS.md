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
- Order confirmation email is stored in `order_email_outbox` in the order transaction. `ACCEPTED` means Aegis accepted the request, not that a mailbox received it. GEME sends an idempotency key; Aegis must enforce it before automatic retries can guarantee no duplicate email. Ambiguous timeouts/5xx are marked `UNKNOWN` and require an operator to verify at Aegis before explicit retry.

## Email delivery configuration

Set `AEGIS_ORDER_EMAIL_URL` and `GEME_ORDER_EMAIL_API_KEY` in the API environment. Keep the key server-side. Apply the additive `order_email_outbox` migration before starting a new API binary. Admin order detail shows queued/accepted/failed/unknown state and offers an explicit retry. Check Aegis logs before retrying an `UNKNOWN` result.

## Current implementation boundary

The API currently uses the legacy decrement-at-acceptance stock model. It has an additive order state guard, conditional updates, idempotent guest checkout keys, price revalidation, and carrier event ordering checks. Existing POS and admin interfaces still expose a coarse stock/order model; a full physical/held/available ledger, reservation expiry worker, payment transaction ledger, returns and refunds, COD settlement, fine-grained permissions, audit timeline, and operational dashboard require a separately reviewed additive rollout. Do not infer these capabilities from `inventoryReservedAt` or a successful build.

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
