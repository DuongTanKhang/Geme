# SePay payment confirmation

GEME accepts verified SePay bank-in webhooks at:

```text
POST /api/v1/integrations/sepay/webhook
```

For the staging domains, use `https://testadmin.geme.vn/api/v1/integrations/sepay/webhook`. Caddy routes `/api/v1/*` directly to the NestJS API. Do not configure this URL in SePay until the updated API and database migration have been deployed.

## What GEME verifies

- HMAC-SHA256 over the original request bytes, using `X-SePay-Timestamp` and `X-SePay-Signature`; timestamps older than five minutes are rejected.
- The event ID is stored under a unique constraint so retries and replays do not create a second payment.
- Only incoming transfers to the one active bank account read from SePay API are considered when `SEPAY_API_TOKEN` is configured. Until that token is added, the legacy `SEPAY_ACCOUNT_NUMBERS` allowlist remains as a temporary migration fallback.
- The SePay `code` must use the `GEME` prefix and resolve to exactly one order.
- The order must still be waiting for payment, use bank transfer, and have no captured payment.
- The received integer VND amount must equal the full order amount. Partial, excess, ambiguous, unknown, or late/cancelled transfers are stored as `REVIEW`; they do not change the order.
- Valid events are acknowledged quickly with HTTP 200 and `{"success":true}`; a database-backed worker performs matching and payment/POS updates.

After a valid full payment, GEME moves the order to **Chờ xác nhận** and queues the existing POS365 order sync. POS365 must be enabled and `POS365_ACCOUNT_ID_BANK_TRANSFER` must identify the payment account to record the transfer there. If POS365 sync is not configured or fails, GEME keeps the bank-confirmed payment and the existing POS sync status/error indicates the follow-up needed.

## Environment

Set these only on the API environment, never in browser code or committed files:

```dotenv
SEPAY_WEBHOOK_ENABLED=true
SEPAY_WEBHOOK_SECRET=<same HMAC secret configured in the SePay webhook>
SEPAY_API_TOKEN=<SePay API v2 token; server-side only>
SEPAY_API_BASE_URL=https://userapi.sepay.vn/v2
```

GEME calls `GET /v2/bank-accounts?active=1&per_page=100` on the API server, caches the result for five minutes, and accepts it only when exactly one active account is returned. The account number, holder, and bank code then feed the per-order VietQR; the browser never receives the API token. If more than one active account exists, GEME disables QR and does not automatically confirm transfers until the account selection is unambiguous. The QR form is no longer editable in Admin. `SEPAY_ACCOUNT_NUMBERS` is only a temporary fallback for deployments that have not yet received an API token; remove it after migration. It is independent of `POS365_ACCOUNT_ID_BANK_TRANSFER`.

SePay documents that API Tokens currently have full access and do not support per-token permission restrictions. Keep the token only in the API environment, do not paste it into chat or expose it to the storefront. OAuth with `bank-account:read` is a narrower alternative, but requires SePay to approve/register the application. See [SePay API token setup](https://developer.sepay.vn/vi/sepay-api/v2/tao-api-token), [list linked bank accounts](https://developer.sepay.vn/vi/sepay-api/v2/tai-khoan-ngan-hang/danh-sach), and [OAuth bank-account read scope](https://developer.sepay.vn/vi/sepay-oauth2/tai-khoan-ngan-hang).

Keep `SEPAY_WEBHOOK_ENABLED=false` until the webhook secret and receiving-account allowlist are in place. Never paste the secret into chat, source control, or a browser form other than SePay's own webhook setup. Restart/recreate the API container after changing environment variables.

## SePay dashboard setup

1. Link and activate the one bank account GEME will receive transfers into. SePay supports ACB, MB, and VietinBank accounts; the exact linking method depends on the account type and SePay account plan.
2. In Company Settings → General → Payment Code Structure, enable recognition and add prefix `GEME`, suffix length **8–30**, character set **alphanumeric**. GEME's QR transfer note is `GEME` followed immediately by the normalized order code, so keep the prefix contiguous.
3. Create a webhook for incoming transfers and select the linked GEME bank accounts. Set the URL above, enable the payment-code prefix filter for `GEME` (and “only send when payment code is present” if shown), choose JSON, and select **HMAC-SHA256**. Generate a secret and copy it directly into the API environment.
4. Create an API Token in SePay → Company Settings → API Access, then set `SEPAY_API_TOKEN` and `SEPAY_API_BASE_URL` on the API (not in Admin). The token currently has full API access. Deploy the API and migration, set the webhook HMAC secret, then enable the webhook and send a small test transfer. Verify the SePay event is applied and the order advances to **Chờ xác nhận**; separately verify POS365 records the paid amount.

SePay's webhook docs recommend a periodic API reconciliation because events can be missed during long outages. This implementation deduplicates and retries events that reach GEME, but it does not yet poll SePay's transaction API to recover a webhook that was never delivered. Keep SePay's webhook retry enabled and reconcile the bank/SePay transaction list during operations until that API backfill is added.

## Official references

- [Webhook integration and payload/response contract](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook)
- [HMAC-SHA256 webhook authentication](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc)
- [Payment-code prefix and suffix configuration](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan)
- [Webhook security and periodic reconciliation guidance](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat)
- [VietQR generator and per-bank transfer-note rules](https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code)
