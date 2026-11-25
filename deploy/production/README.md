# GEME production deployment

This directory contains the production Compose, Caddy and sanitized environment template for:

| Hostname | Service |
| --- | --- |
| `https://geme.vn` | Storefront; `/api/v1/*` is routed to the GEME API |
| `https://gemedashboard.geme.vn` | Admin; `/api/v1/*` is routed to the GEME API |

The Compose project is named `geme-production`. Its networks and named volumes are separate from `geme-staging`; it does not copy staging data or reuse staging secrets. Nothing in this procedure changes DNS or starts services on the production host until the operator runs the commands there.

## Before first production start

1. Point both DNS records to the production VPS. Allow inbound TCP 80/443 for Caddy certificate issuance and HTTPS, and restrict SSH at the firewall. Do not expose PostgreSQL, Redis, SQL Server, API or AEGIS ports publicly.
2. Check that the host has enough RAM and disk for the Storefront, Admin, API, AEGIS, PostgreSQL, Redis, SQL Server and backups. The bundled SQL Server uses Express; check its database-size and resource limits against expected AEGIS growth and licensing needs.
3. From the repository root on the production host, create a private environment file from this template only if there is no existing `.env`. Never overwrite or reuse the current live/staging environment file; review any existing production values separately and merge only the needed settings:

   ```sh
   test ! -e .env && install -m 600 deploy/production/.env.example .env
   ```

   Set a unique value for every required secret. Generate independent random values, for example with `openssl rand -hex 32`, for `POSTGRES_PASSWORD`, `ADMIN_AUTH_JWT_SECRET`, `GEME_ORDER_EMAIL_API_KEY`, `AEGIS_OTP_HASHING_KEY`, `AEGIS_JWT_KEY`, and `SEPAY_WEBHOOK_SECRET`. Generate `GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY` and `SHOPEE_TOKEN_ENCRYPTION_KEY` once if those integrations will be enabled. Keep the AEGIS SQL password free of semicolons because it is embedded in a SQL connection string. Do not reuse staging secrets.
4. Fill in the production SMTP credentials, VietMap keys, production R2 credentials and `MEDIA_PUBLIC_BASE_URL`. Confirm the Worker URL points at the production media bucket and that the R2 access key has only the permissions the application needs. Restrict the browser-visible VietMap tile key to `geme.vn` and `gemedashboard.geme.vn` in the provider dashboard; keep the general VietMap API key server-side.
5. Review optional integrations before enabling them. Shopee, POS365 and SePay are disabled by default. Set their production credentials and callback URLs only after confirming the correct production app, shop, branch, bank account and webhook. SePay callback: `https://gemedashboard.geme.vn/api/v1/integrations/sepay/webhook`. Gmail callback: `https://gemedashboard.geme.vn/api/v1/integrations/gmail/callback`. Shopee callback: `https://gemedashboard.geme.vn/api/v1/shopee/callback`.
6. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are only for the one-time bootstrap of the first Admin on an empty database. Use a unique password of at least 12 characters. Remove both values from `.env` after the account is created; do not use the seed command to overwrite an existing production database.
7. Set `ACME_EMAIL` to an address monitored by the team. Caddy obtains and renews TLS certificates automatically after DNS and ports are ready.

Required production variables are guarded in Compose so an incomplete R2, VietMap, mail, database or TLS configuration fails before the services start. Check the resolved configuration without printing secrets:

```sh
docker compose --env-file .env -f deploy/production/compose.yaml config --quiet
```

Never paste the output of `docker compose config` into a public log; its unquiet form contains resolved secrets.

## First deployment

On the reviewed source checkout (Node.js 22 and Git required), before building production images or running the product-only cutover, verify that the commit contains matching, patched Next.js versions for Storefront and Admin:

```sh
node scripts/verify-production-release.mjs
```

The guard checks each app manifest against its frozen pnpm lockfile, requires the same stable version in both apps, and rejects versions earlier than the patched `16.4.5` baseline. The current release uses `16.4.6`. The database transfer utility below moves product data only; it does not package or deploy application code. Build the production images from the reviewed Git commit reported by the guard.

Build all images from the reviewed Git commit on the production host (or from a registry build made from that same commit), then start only the database services first:

```sh
docker compose --env-file .env -f deploy/production/compose.yaml build
docker compose --env-file .env -f deploy/production/compose.yaml up -d postgres redis sqlserver
docker compose --env-file .env -f deploy/production/compose.yaml ps
```

Before any schema change, take verified backups of the production PostgreSQL database and AEGIS SQL Server database, and retain a tested restore path. Apply migrations explicitly; ordinary service startup does not migrate or seed:

```sh
docker compose --env-file .env -f deploy/production/compose.yaml run --rm -e Database__MigrateOnly=true aegis
docker compose --env-file .env -f deploy/production/compose.yaml run --rm --no-deps api pnpm db:deploy
```

For a blank first install, run `pnpm db:seed` against the empty database to create default categories and the bootstrap Admin. For a product/content cutover, do not seed before import: the cutover utility imports categories and Admin accounts, and resets the explicitly selected Admin password during the same transaction. Confirm the target is the new isolated production database; never seed the old production database. Then start and verify the application services:

```sh
docker compose --env-file .env -f deploy/production/compose.yaml up -d
docker compose --env-file .env -f deploy/production/compose.yaml ps
docker compose --env-file .env -f deploy/production/compose.yaml logs --tail=100 caddy storefront admin api aegis postgres redis sqlserver
```

Check `https://geme.vn/`, `https://gemedashboard.geme.vn/login`, `https://geme.vn/api/v1/health/ready` and `https://gemedashboard.geme.vn/api/v1/health/ready`. Verify product images and variants, Admin sign-in, customer sign-in/OTP, search, stock, order creation, payment/webhook, email and the delivery map before moving DNS or customer traffic.

## Product-only cutover from test

The requested cutover replaces the old production application and database with the new release and the test catalog. It must not copy test customer accounts, addresses, favorites, reviews, orders, payments, returns, loyalty records, or marketing sessions. The Storefront starts with no customer/order history; customer features remain available for new production visitors after launch.

Transfer the catalog, operational stock, selected public content, and Admin access as one consistent snapshot. The allowlist is:

- `categories`, `material_options`, `jewelry_stone_groups`, `sphere_stone_groups`, and `sphere_stone_types`;
- selected `site_settings` rows for product SKU rules, product material applicability, customer-facing policy copy, banners/footer, catalog editorial promotions, new-arrivals media, shop-menu editorial content, blog categories, and public business contact/social information; runtime secrets and unrelated settings are not copied from the database;
- `products`, `product_images`, `product_price_variants`, `product_media_assets`, and media metadata linked to products or uploaded through the public content/blog media paths (`assets/` and `blog/`); customer-avatar media is excluded;
- `product_sphere_items` (including each physical item's weight/price/image references and its imported receipt relation);
- `inventory_movements`, `inventory_receipts`, `inventory_receipt_items`, `inventory_issues`, and `inventory_issue_items`, because these are product stock history and are not customer/order records.
- `blog_posts` and `blog_post_images`;
- `admin_calendar_events`;
- `admin_users` and `admin_permission_grants`, preserving accounts, roles and permissions. Reset one selected Admin account's password using the migration runtime variables described below; revoke existing sessions by incrementing its auth version.

Do not transfer `customers`, `orders`, `order_items`, `payments`, `payment_refunds`, `order_returns`, `order_return_items`, `inventory_reservations`, `customer_favorites`, `product_reviews`, `loyalty_point_transactions`, `marketing_sessions`, `promotion_usages`, contact inquiries, audit/notification history, customer-avatar media, POS sync queue state, payment webhook events, or integration-token state. Also exclude inventory movements tied to order codes. Keep `POS365_ORDER_SYNC_ENABLED=false` through cutover. Runtime environment values are transferred separately into the protected production `.env`; review domain-specific URLs and keep the required R2, payment, mapping, mail, POS and integration keys server-side. R2 object bytes are not copied by the database utility: ensure every selected product/blog/banner object key exists in the destination bucket and is readable by the production Worker before opening traffic.

Cutover sequence:

1. Record the exact staging Git commit and stop product/stock edits in Admin so the database export is consistent.
2. Back up the old production PostgreSQL and AEGIS SQL Server databases, current production `.env`, Caddy data and current image IDs. Also export the current POS catalog and any POS records scheduled for deletion. Store these encrypted outside the production VPS and verify the backup files can be read. Never put `.env` or database dumps in Git.
3. Build the reviewed new code and initialize the separate `geme-production` database volumes. Apply schema migrations; do not run seed against a non-empty database.
4. Import only the allowlisted product/content/Admin tables and linked media metadata. Preserve IDs within this isolated new database so foreign keys remain valid. Active stock reservations are not copied with their orders; the utility returns all held stock to availability and records a generic cutover stock movement without customer/order identifiers. It refuses to apply if it finds orphan `RESERVED` sphere items. Order-linked stock movements (whose reference matches an order code) are excluded. Recalculate/verify each product and variant count/stock; for kg-managed products verify `stock_kg` equals the sum of its quality variants and that each quality total equals its available `product_sphere_items`.
5. Compare table counts, SKU uniqueness, image URLs, prices, product status, integer stock, decimal kg stock, and several sphere/weight samples. Verify the new Storefront has no imported customer/order history and the Admin can manage products and stock.
6. Only after those checks, switch production traffic. Keep old production backups and volumes intact through the rollback window; rollback means restoring the old code/config and old DB together, not pointing old code at the new schema.

The guarded transfer utility is `outputs/geme-api/scripts/product-only-cutover.mjs`. It defaults to plan-only mode, prints table row counts only, requires identical migrated schemas, and refuses any target containing rows in an imported table or any customer/order privacy table. It reports active reservations without copying their order rows. Run it only from a secured machine that can reach both Postgres databases over private connections/tunnels; do not put either database URL in a command history or log. First run the plan and review every count and verified backup. For apply, set `CONFIRM_PRODUCT_ONLY_IMPORT=YES`, `PRODUCT_MIGRATION_ADMIN_EMAIL` to the exact source Admin account to reset, and `PRODUCT_MIGRATION_ADMIN_PASSWORD` to the new password, then pass `--apply`. The password is bcrypt-hashed in memory and is never printed; do not commit it or save it in a migration script. The import is transactional and does not truncate or delete target data. R2 media object bytes are not copied by this utility: copy/verify only selected referenced object keys before import.

### POS data boundary

POS365 is a separate live system; PostgreSQL cutover does not delete anything in POS365. The requested POS end state is the product catalog, prices, SKU and stock only. Before clearing POS customer/order history, export and verify a POS backup, then use the POS365-supported retention/deletion process. Production has independent `POS365_ENABLED` and `POS365_ORDER_SYNC_ENABLED` flags: keep order sync `false` to prevent GEME from creating POS customer/order records, while product, image, price and inventory sync can remain enabled. POS payment reconciliation that depends on a matching POS order will not be available while order sync is off. A POS purge is a separate cutover step and must not be inferred from importing the GEME product tables.

## Release and rollback

For each production release, record the Git commit, image IDs, environment/config version (never secret values), database backup IDs, migrations, smoke checks and result. Build the candidate while current containers continue serving. Back up current source/config and both databases when the release changes schema or data. Switch only after the candidate is healthy; retain the last verified production images and backups through the observation period. Do not run `docker compose down -v`, `docker volume rm`, or seed on a database containing business data.

Keep the production Worker, database, Redis namespace, SMTP, payment provider, OAuth apps and POS credentials isolated from staging. A test key or staging callback must never be used by these production services.
