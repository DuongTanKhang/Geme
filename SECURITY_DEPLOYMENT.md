# GEME security rollout

## Changes in this review

- Admin APIs now require an active `AdminUser` session. The admin UI uses a same-origin, `HttpOnly`, `Secure` in production, `SameSite=Strict` cookie; API tokens never reach browser JavaScript. `CONTENT_EDITOR` is denied until a separate permission policy is implemented.
- Store checkout accepts only product identifiers, quantities, buyer/contact fields, and a supported payment method. Prices, discounts, paid state, customer identity, and sales channel are decided by the server. Only the protected admin order route can create a store sale. Five failed admin passwords lock that account for 15 minutes.
- Customer account/order/favorite writes require an `Origin` header matching GEME. Customer orders remain bound to the authenticated customer.
- Admin/order, inventory, customer, report, settings, POS365, Viettel Post, and media management routes require admin authentication. Private receipt files and PDFs cannot be fetched from public media URLs.
- Blog HTML is sanitized on writes and reads. Media upload verifies file signatures as well as declared MIME type; PDFs are private by default.
- Production API startup requires a 32-byte admin JWT secret and exact HTTPS CORS origins. Swagger is development-only. The two Next hosts add frame/content-type/referrer protections and production HSTS. The local compose file binds host ports to loopback.

## Required before deploying to geme.vn

1. Set a random `ADMIN_AUTH_JWT_SECRET` of at least 32 bytes, exact production `CORS_ORIGINS`, and the existing AEGIS/JWT, database, email, POS365, and carrier secrets in the server secret store. Do not use values from example files.
2. Apply the GEME API migration with `pnpm db:deploy`. If the database has no admin user, bootstrap one once with `ADMIN_EMAIL` and a unique password of at least 12 characters using the existing `pnpm db:seed` command, then remove those bootstrap environment values.
3. Serve both web hosts over HTTPS. Put the API, AEGIS, SQL Server, Redis, and Mailpit behind private networking; expose only the reverse proxy. The checked-in `compose.yaml` is for local development, not production.
4. Configure `TRUST_PROXY_HOPS` for the exact Express proxy depth and AEGIS `ForwardedHeaders:KnownProxy` for the trusted proxy address. Never trust arbitrary forwarded-IP headers from the public internet.
5. GEME API request limits now use atomic Redis counters shared by replicas. Production requires `REDIS_URL`; use the same `API_RATE_LIMIT_PREFIX` within a deployment and a different namespace/database for staging. Redis outages return 503 for writes/webhooks and readiness; reads retain a bounded local fallback. Keep edge/WAF limits for connection floods, bot traffic and AEGIS OTP/login, and alert on repeated authentication failures. See [the production host checklist](NOTE-HOST-CHINH.md).
6. Run a production penetration review and a separate 500-client load test against the actual hosting/database plan before switching the domain. Builds passing does not prove a security or capacity guarantee.
7. AEGIS targets .NET 10 LTS and uses the 10.0.13 ASP.NET Core and Entity Framework Core servicing line. Keep the SDK, runtime container images, and Microsoft package family on current .NET 10 patches. Microsoft lists .NET 10 support through November 14, 2028.
8. **Media/R2 still needs deployment configuration.** Create the Cloudflare R2 bucket and a bucket-scoped token, deploy `outputs/geme-media-worker`, and keep the bucket private. This gateway only serves image objects under `media/`; do not attach a public custom domain directly to the shared bucket because private objects may be stored there too. Then set `MEDIA_STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_BASE_URL` to the Worker's HTTPS URL in the server-side API environment. Use its `workers.dev` URL if `geme.vn` is managed in another Cloudflare account. Back up the database, apply migrations, and run `pnpm media:migrate-r2` from `outputs/geme-api`; verify migrated media loads before considering the move complete. Private PDFs stay in PostgreSQL. The separate 8 GB DirectAdmin image archive also needs a distinct import and review; this migration command does not include it. **Remind the owner to configure and verify this before the deployment is considered ready.**

## Verification performed

The earlier results below describe the prior security review. The current portable-hardening checks and remaining host work are recorded separately in [NOTE-HOST-CHINH.md](NOTE-HOST-CHINH.md).

- `pnpm audit` reports no known vulnerabilities for the storefront, admin host, or GEME API.
- NuGet vulnerability audit reports no vulnerable packages for AEGIS. AEGIS targets .NET 10 and its ASP.NET Core/EF Core packages are aligned to 10.0.13.
- Production builds passed for the storefront, admin host, and GEME API; AEGIS also built with zero warnings and errors.
- This review did not run a live penetration test, production configuration scan, or 500-client load test.

## Portable hardening — 2026-10-31

- Next dependency patches, bounded/normalized search terms, and API dependency fixes are preserved in the application manifests and lockfiles.
- Storefront and Admin issue a fresh CSP nonce on each HTML response. Next scripts and JSON-LD receive the nonce; production blocks inline script handlers and eval. Inline CSS remains permitted for the existing UI. HTML is dynamic/private/no-store; static assets and explicit data caches remain available. Measure the server-rendering impact before production rollout.
- API rate limiting runs before body parsing, shares Redis quotas, normalizes Express route aliases, and does not trust client-supplied forwarded headers directly. Correct reverse-proxy trust configuration is still a deployment requirement.
- From the repository root: `node --experimental-strip-types --test scripts/security-csp.test.mjs` tests both CSP policies. `node scripts/security-csp-render.mjs http://127.0.0.1:<port>/<page>` verifies fresh nonces and rendered script tags against an isolated production build.
- From `outputs/geme-api`: `pnpm test:security` runs limiter tests. Set `SECURITY_TEST_REDIS=true` and a test `REDIS_URL` to include the real Redis concurrency/expiry check; it uses only a unique temporary key and removes it afterward. It is skipped without opt-in.
- Host-specific DNS/TLS, credentials, Redis/network isolation, WAF, payment callbacks, backups, monitoring and release checks are in [NOTE-HOST-CHINH.md](NOTE-HOST-CHINH.md). No production environment is configured by a successful build.
