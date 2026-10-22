# GEME Shopee read-only order import

This integration imports Shopee order snapshots into separate `shopee_*` tables. It deliberately does not create or modify website orders, reserve/decrement GEME stock, update Shopee prices/stock, confirm or cancel Shopee orders, create shipments, call POS365/Viettel Post, or add Shopee sales to website revenue reports.

## Configure the Shopee Open Platform app

1. Create/configure a Shopee Open Platform partner application and obtain its Partner ID and Partner Key.
2. Add the exact callback URL to the application. The production URL must point to the public NestJS API:

   ```text
   https://api.geme.vn/api/v1/shopee/callback
   ```

   For local testing use a public HTTPS development tunnel mapped to the local API, and register that exact URL. Shopee cannot redirect to a private LAN address or localhost. Do not expose the worker or Redis port.
3. Configure the environment variables below in the API and its private worker. `.env.docker.example` and `outputs/geme-api/.env.example` contain empty examples; put real secrets only in the local deployment secret store or ignored `.env.docker` file.

   ```dotenv
   SHOPEE_ENVIRONMENT=sandbox
   SHOPEE_PARTNER_ID=
   SHOPEE_PARTNER_KEY=
   SHOPEE_REDIRECT_URI=https://api.geme.vn/api/v1/shopee/callback
   SHOPEE_ADMIN_RETURN_URL=https://admin.geme.vn/?view=shopee
   SHOPEE_TOKEN_ENCRYPTION_KEY=
   SHOPEE_INITIAL_SYNC_DAYS=30
   SHOPEE_POLL_INTERVAL_MINUTES=5
   SHOPEE_WORKER_CONCURRENCY=2
   ```

   Use `SHOPEE_ENVIRONMENT=production` only when the partner app/shop is enabled for production. The API and worker must use the same environment, Partner ID/Key, callback URL, and encryption key.
4. Generate a dedicated 32-byte encryption key once, then preserve it in the secret store and backups. Changing it makes saved tokens unreadable and requires the shop to authorize again.

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

   Copy the output into `SHOPEE_TOKEN_ENCRYPTION_KEY`. Do not paste it into chat, commit it, or reuse the Meta/AI key.

## Start locally

After reviewing the migration and setting the variables, start the API, private worker, Admin, PostgreSQL, and the internal Redis service using the repository's standard Compose workflow. The worker connects to `ai-redis` on the internal Compose network and does not publish a host port. The API applies the existing startup migration workflow; do not point a local command at production without the normal release review.

Open Admin → **Shopee** → **Kết nối shop**. The app redirects to Shopee for the seller's consent. On callback, a one-time state tied to the initiating active Admin is checked before tokens are exchanged and stored encrypted. Shopee access tokens expire and refresh tokens rotate; the worker persists both replacement tokens together.

Use **Đồng bộ ngay** for a manual run. A scheduled worker checks active shops at the configured interval. Imported orders appear under **Đơn hàng → Đơn Shopee**. Exact, unique SKU matches are attached automatically; ambiguous or missing matches remain in **Ghép SKU** for an Admin to resolve. A manual mapping applies to subsequent imports and existing matching lines for that shop.

## Operational behavior and data handling

- Order-list windows are limited to 14 days, with cursor pagination and a five-minute overlap to pick up late Shopee updates. The initial lookback defaults to 30 days and is configurable from 1 to 365 days.
- Order detail requests are batched at up to 50 order numbers. Redis jobs are durable, idempotent per shop, retried with backoff, and tracked in `ShopeeSyncRun`.
- Marketplace records stay outside the website `Order` model so existing checkout, inventory, payments, shipping, POS365, and sales reports keep their existing behavior.
- The Admin can read order details and shipping information but has no Shopee write actions. Disconnecting removes local credentials only; it retains imported orders and mappings and does not revoke the seller grant at Shopee. Reauthorize from Shopee/Open Platform if remote revocation is required.
- Shopee recipient/shipping details can contain personal data. They are stored in the GEME database only when the Shopee API returns them, and access is behind Admin authentication. Apply the deployment's existing database backup, access, and retention controls.
- The migration only creates new Shopee tables, indexes, and relations. It does not rewrite or delete existing commerce records. No production migration or real shop connection is performed as part of this implementation.

## API endpoints

All Admin endpoints use the existing `AdminAuthGuard` and `/api/v1/admin/shopee` prefix:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Config, shop connections, Redis queue summary |
| `POST` | `/authorize` | Start a state-bound seller consent flow |
| `POST` | `/connections/:id/sync` | Queue a read-only import |
| `DELETE` | `/connections/:id` | Disconnect locally and clear local tokens |
| `GET` | `/orders` / `/orders/:id` | Search and inspect imported marketplace orders |
| `GET` | `/mappings/unmatched` / `/mappings/catalog` | List unmatched lines and find GEME products/SKUs |
| `POST` | `/mappings/:id` | Save an explicit item/model-to-SKU mapping |
| `GET` | `/sync-runs` | Read sync history |
| `POST` | `/sync-runs/:id/retry` | Retry a failed run |

The sole public endpoint is `GET /api/v1/shopee/callback`; it accepts short-lived authorization parameters only and consumes the matching one-time state. It does not return tokens to the browser.

## References

- [Shopee Open Platform: order list](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1)
- [Shopee Open Platform: order detail](https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1)
- [Shopee Open Platform: get access token](https://open.shopee.com/documents/v2/v2.public.get_access_token?module=120&type=1)
- [Shopee Open Platform: refresh access token](https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=120&type=1)
