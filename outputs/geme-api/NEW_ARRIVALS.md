# GEME New Arrivals

## Data rules

- `firstPublishedAt` is the first proven transition of a known-new product from a non-public status to `ACTIVE`. It is not the product creation date or inventory receipt date. Republishing preserves the first timestamp.
- `publicationHistoryKnown=false` is the conservative legacy state. A transition to `ACTIVE` does not manufacture a date for those products.
- `newLabelActive` is computed for every public storefront product response as `isNew && (newUntil is null || newUntil > now)`. The existing `new=true` product filter still means `isNew=true`; this feature does not change that API contract.
- New Arrivals itself includes only active jewelry whose `newLabelActive` is true. A recent publish/re-publish date never adds an untagged or expired product to the collection. Legacy `mode=all|tagged|published` URLs are accepted for compatibility and all resolve to the tagged collection.
- A direct product stone group is the primary presentation group. Without one, category and jewelry-stone material mappings are used only if they agree. A mismatch or missing mapping is displayed once under **Trang sức khác**; product names are never guessed as a source of stone identity.
- Inactive groups do not hide products. Products whose direct group is inactive, or whose mapped sources conflict, resolve to the fallback group until an administrator fixes the configuration.

## Public API

- `GET /api/v1/catalog/new-arrivals`: optional legacy `mode`, repeated `categoryId`, `stoneGroupId`, and `size`, `search`, `minPrice`, `maxPrice`, `sort=recommended|newest|best_selling|price_asc|price_desc`, and `groupPage`.
- `GET /api/v1/catalog/new-arrivals/groups/:slug/products`: same filters, a 1-based `page`, 40 products per page. Pages are deterministic for an unchanged catalog; changes made between requests can move products across a page boundary, so refresh before continuing after catalog edits.
- `GET /api/v1/catalog/jewelry-stone-groups`: active group choices for storefront filters.
- New Arrivals returns current category, stone, and variant-size facets for the tagged collection. Public catalog query responses have a five-second shared-cache TTL. Stone-group choices have a 30-second TTL. Product, mapping, and group changes publish the existing catalog event; expiring New tags age out without a write or cron job.

The group overview applies filters before counting and ordering, then returns at most 8 cards per group and 12 groups per page. A group detail page returns at most 40 cards. Each card query selects only the product fields required by the existing card and at most two image records. It does not load the entire catalog into Node or run one query per group. Static query count is four database round trips for a nonempty overview (settings, category visibility, grouped SQL, card rows); empty result sets use a totals query in place of the card query. A named-group page uses six round trips (group, settings, categories, count, page, cards); the fallback group skips the group lookup and uses five.

For GEME's current product card, price ordering/filtering starts from the parent `Product.price` and applies the highest applicable active percentage promotion using the same product/category inclusion and exclusion rules as the storefront. Contact prices are null/zero and sort last for either price direction. The card itself continues to render through the existing `StoreProductCard` and promotion helper.

## Admin controls

- Product editing shows the first publication date read-only (`Chưa xác định` for legacy records), the independent New label and expiry, and a primary stone group.
- **New Arrivals & nhóm đá** manages active state, name/slug, order, pin order, and mappings from gemstone taxonomy and jewelry stone sources.
- Product label edits require `catalog.publish`; group and mapping edits require `catalog.write`. These checks run on the API and all changes are audited.
- Mapping sources are restricted to gemstone-type categories and jewelry stone options. Mapping does not modify SKU, price, stock, images, or product taxonomy.

The expiry field is transmitted as an ISO timestamp. The Admin form converts local `datetime-local` input in `Asia/Ho_Chi_Minh` to UTC and converts it back for display. The first-publication date is never accepted from a product edit payload.

## Migration and legacy backfill

The additive Prisma migrations are:

```text
prisma/migrations/20261108000000_jewelry_new_arrivals/migration.sql
prisma/migrations/20261109000000_map_jewelry_stones_from_catalog/migration.sql
```

The first creates the canonical stone-group table, nullable mappings, nullable timestamps, the legacy-history marker, foreign keys, and query indexes. The second maps existing jewelry stone/material sources to canonical groups by exact catalog slug. It does not infer from product names or alter price, stock, SKU, images, or product taxonomy. Both migrations were applied to the local GEME database for verification; production remains unchanged.

The backfill script defaults to read-only dry-run and uses only `PRODUCT_PUBLISHED` transition events whose previous status was not `ACTIVE`, and only products marked `publicationHistoryKnown=true`. An already-active no-op is not publication evidence. It will not infer from `createdAt`, current status, or incomplete legacy records. Conflicting evidence is reported and skipped. For an apply-mode rehearsal, point `DATABASE_URL` only at a disposable **local** database whose database name contains `test`, `integration`, or `ci`, then run:

```powershell
pnpm data:backfill-first-published
pnpm data:backfill-first-published --apply --confirm-nonproduction
```

The script rejects production-like connection strings and refuses apply mode for remote hosts, staging hosts, or databases without a test marker. Do not run this command against a production or shared business database. Inspect a dry-run on a separately verified environment before any future production backfill decision.

## Tests and verification

Unit coverage for New-tag boundaries and SQL ordering is in `src/commerce/new-arrivals.rules.spec.ts`. Publication lifecycle tests are in `src/commerce/commerce-publication.spec.ts`. PostgreSQL coverage for canonical resolution, conflict fallback, public visibility, tag-only legacy modes, price order/filter, facets, preview limits, and stable pagination is in `src/commerce/new-arrivals.integration.spec.ts`; it runs only when `RUN_POSTGRES_INTEGRATION_TESTS=1` and `DATABASE_URL` is a dedicated local test database.

The New Arrivals list query has a statically bounded output (up to 96 product cards and 192 image metadata rows per overview response; up to 40 cards and 80 image metadata rows per group page). This is a code-level response bound, **not a measured byte size or latency benchmark**. A dataset-backed `EXPLAIN ANALYZE`, response-size measurement, and test migration against both empty and legacy PostgreSQL databases remain to be run on a disposable local database.
