# GEME + AEGIS local Docker environment

The Compose environment runs the GEME storefront, admin, GEME API, and AEGIS on one Docker network. The storefront and admin remain reachable from the browser; server-to-server requests use Compose service names.

| Service | Browser URL | Internal URL |
| --- | --- | --- |
| GEME storefront | http://127.0.0.1:3000 | `http://storefront:3000` |
| GEME admin | http://localhost:3001 | `http://admin:3001` |
| GEME API | http://127.0.0.1:4000/api/v1 | `http://geme-api:4000/api/v1` |
| AEGIS | http://localhost:5130 | `http://aegis:5130` |
| Mailpit inbox | http://localhost:8025 | `mailpit:1025` (SMTP) |

## First run

1. Confirm Docker Desktop is running.
2. Copy `.env.docker.example` to `.env.docker` and check `AEGIS_SOURCE_PATH`.
3. Set `GEME_DATABASE_URL` to the existing GEME PostgreSQL database, replacing `127.0.0.1` with `host.docker.internal`. This keeps the products and records already stored in the host database.
4. Set unique development-only values for `AEGIS_SQL_PASSWORD` and `AEGIS_OTP_HASHING_KEY` (the OTP key must contain at least 32 characters).
5. Replace `AI_CORE_SHARED_SECRET` with a random secret of at least 32 characters; the API worker and private AI Core must use the same value.
5. From this directory, run:

   ```powershell
   docker compose --env-file .env.docker up --build -d
   ```

The API runs Prisma migrations on startup. AEGIS runs its EF migrations on startup in Development. SQL Server and Redis use named Docker volumes and keep their data when containers stop. AEGIS email is routed to Mailpit, so no real SMTP credentials are required. The Node API runs its compiled Nest app so dependency injection metadata is preserved; rebuild it after changing API source with `docker compose --env-file .env.docker up --build -d geme-api`. The admin container uses Next.js Webpack because its Windows `node_modules` junction is incompatible with Turbopack's Docker filesystem root.

## Product media storage

Local development keeps `MEDIA_STORAGE_PROVIDER=database`, so the new storage path works without Cloudflare credentials and existing media URLs keep working. For production, create a Cloudflare R2 bucket and a bucket-scoped access token, then deploy the restricted media gateway in `outputs/geme-media-worker`. Keep the R2 bucket private; do not attach a public R2 bucket domain because public and private objects can share this bucket. Put the R2 credentials only in the API environment and set `MEDIA_STORAGE_PROVIDER=r2` plus `MEDIA_PUBLIC_BASE_URL` to the Worker's HTTPS URL after it is deployed. Use its `workers.dev` URL if the `geme.vn` zone is managed by another Cloudflare account. Do not set these as `NEXT_PUBLIC_*` variables.

The Prisma migration adds provider/key metadata while retaining all existing media bytes. After configuring R2 and taking a database backup, run `pnpm media:migrate-r2` from `outputs/geme-api` to move existing public records in small batches; each row is removed from PostgreSQL only after the object upload succeeds. PDFs/private documents remain in PostgreSQL. This code does not yet import the separate 8 GB DirectAdmin image folder: that requires access to the original files or an archive, so the import and visual redesign can happen after the new hosting and R2 domain are ready.

## AI Studio Phase 1

AI Studio keeps NestJS as the authenticated admin API and database authority. BullMQ uses a dedicated `ai-redis` service and persistent volume, isolated from AEGIS's existing Redis. The AI Redis enables AOF with `appendfsync everysec` and `noeviction`. PostgreSQL remains the authoritative task/approval history. The standalone `ai-worker` service consumes jobs and calls the FastAPI `ai-core` service over an `internal: true` Compose network. AI Core and AI Redis have no published host ports or public routes. Set a random `AI_CORE_SHARED_SECRET` of at least 32 characters in `.env.docker`; Compose intentionally fails closed when it is missing.

The initial agents return scaffold/provider-disabled results. The Image Worker contract does not call a paid service. Publication approvals record a human decision only; they do not change product publication, price, stock, or order data. Configure `AI_WORKER_CONCURRENCY`, `AI_STUDIO_ACTIVE_TASK_LIMIT`, and `AI_STUDIO_RATE_LIMIT_PER_MINUTE` conservatively before enabling any future provider. The API startup applies the additive Prisma migration. To run local checks:

```powershell
cd outputs/geme-api
pnpm db:generate
pnpm build
pnpm test
cd ../ai-core
python -m unittest discover -s tests -v
cd ../geme-admin
pnpm build
```

Then start/rebuild `geme-api`, `ai-redis`, `ai-core`, `ai-worker`, and `admin` with Compose; use `docker compose --env-file .env.docker logs -f ai-worker ai-core ai-redis geme-api` to inspect structured service logs. In Admin, open **AI Studio**, submit a scaffold task, cancel a queued task, and submit a publication proposal to exercise approval without changing catalog data.

## Send email through GEME Gmail

For a local real-email test, enable 2-Step Verification on the GEME Google account and create an App Password. Put the SMTP settings in the ignored `.env.docker` file (never commit or share it):

```dotenv
AEGIS_EMAIL_HOST=smtp.gmail.com
AEGIS_EMAIL_PORT=587
AEGIS_EMAIL_ENABLE_SSL=true
AEGIS_EMAIL_USERNAME=geme-account@gmail.com
AEGIS_EMAIL_PASSWORD=your-16-character-app-password
AEGIS_EMAIL_FROM_EMAIL=geme-account@gmail.com
AEGIS_EMAIL_FROM_NAME=GEME
AEGIS_EMAIL_PUBLIC_BASE_URL=http://localhost:5130
```

Use the Gmail App Password, not the account's normal password. Gmail SMTP uses the authenticated Gmail address as the sender; keep `AEGIS_EMAIL_FROM_EMAIL` the same as `AEGIS_EMAIL_USERNAME`. Google requires 2-Step Verification for App Passwords, and some account types may not offer them: [Google App Password help](https://support.google.com/accounts/answer/185833?hl=en).

Restart AEGIS to apply the settings:

```powershell
docker compose --env-file .env.docker up -d aegis
```

The localhost base URL is for local testing only. Before sending verification links to customers, set `AEGIS_EMAIL_PUBLIC_BASE_URL` to the publicly reachable HTTPS AEGIS URL. Unset the Gmail variables to return to Mailpit defaults.

## SQL Server edition for production

The checked-in `compose.yaml` is a **local development** stack. It now uses SQL Server Express by default through `AEGIS_SQL_EDITION=Express`, so local behavior matches the intended production edition. The prior local Developer data volume is left untouched; the new service uses `aegis_sql_express_data` and initializes a separate Express database. No volume is deleted.

For production, use SQL Server Express if its capacity and feature limits fit AEGIS. Microsoft permits Express for production at no license cost. For the current SQL Server 2022 image, Express is limited to 10 GB per database, four cores, and 1,410 MB of buffer pool. It also does not include SQL Server Agent, so schedule backups with the host's scheduler or an external backup service. See Microsoft's [SQL Server 2022 edition limits](https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2022?view=sql-server-ver17) and [SQL Server Express backup guidance](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/backup-restore/schedule-automate-backup-database).

Set `AEGIS_SQL_EDITION=Express` in the production secret/environment configuration as well. The SQL Server container reads `MSSQL_PID` during initial setup, so production must have its **own empty data volume**. Never point production at a local volume, and do not run `docker compose down -v` on a system containing data. If a Developer database later contains records that must be preserved, take a `.bak`, restore it into the new Express instance, and verify the restore and application behavior before cutover. Check that database size and used features fit Express first.

If Express limits are not suitable, obtain a valid SQL Server Standard license and set `AEGIS_SQL_EDITION=Standard` for the production instance. Do not use Developer or Evaluation in production. The production Compose stack, HTTPS reverse proxy, secrets, backups, and host deployment still need to be configured separately; do not deploy this local development Compose file to a public host. See Microsoft's [SQL Server container licensing and production guidance](https://learn.microsoft.com/en-us/sql/linux/containers/deploy?view=sql-server-linux-ver15) and [container edition variable reference](https://learn.microsoft.com/en-us/sql/linux/configure/environment-variables?view=sql-server-ver17).

Order confirmations are sent to the email entered at checkout through the same AEGIS SMTP/Gmail configuration. Set `GEME_ORDER_EMAIL_API_KEY` to a separate random secret in the ignored `.env.docker`; Compose shares it only between the API and AEGIS internal endpoint. Set `AEGIS_JWT_KEY` to a stable random secret so local customer sessions survive AEGIS restarts. Do not commit either secret.

## POS365 connection setup (read-only first step)

POS365 credentials are passed only to the `geme-api` container. They are not exposed to the storefront or admin browser. Keep integration disabled until POS365 confirms API access and grants the required permissions. Put real values only in the ignored `.env.docker` file:

```dotenv
POS365_ENABLED=false
POS365_API_BASE_URL=https://<store-link>.pos365.vn
POS365_USERNAME=
POS365_PASSWORD=
POS365_BRANCH_ID=
```

Use the store-specific link printed in POS365 (for example, `https://695.pos365.vn`), not the general API documentation host `https://api.pos365.vn`. Use the store administrator username and password described by the supplied POS365 API spec. Keep the integration disabled; the admin's **Cài đặt → POS365** panel performs a read-only check: POST `/api/auth`, take `SessionId` as the `ss-id` cookie, then GET `/api/branchs?format=json&$top=1&$skip=0`. No credentials or session IDs are returned to the browser. The check does not create or update POS365 records.

After editing `.env.docker`, restart the API so Docker loads the new environment:

```powershell
docker compose --env-file .env.docker up -d geme-api
```

The supplied API spec says sessions may expire and clients should log in again after HTTP 401. Product, order, and inventory synchronization is a separate next phase; do not enable live writes until the store, branch, permissions, and sync direction have been agreed and verified.

## Useful commands

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f storefront admin geme-api aegis
docker compose --env-file .env.docker down
```

Do not add `.env.docker` to source control or use these Development settings for a public deployment.

## GEME Visual Agent — Image Studio (Phase 2)

Image Studio is an authenticated Admin workspace backed by the existing NestJS AI Studio task/approval tables and BullMQ queue. The API stores originals as private media, the worker calls AI Core over the Compose network, and AI Core is the only service that receives the Photoroom key. AI Core has no published host port. Outputs remain private until an admin approves them; attaching an approved result is limited to a `DRAFT` product and does not publish the product or change prices, inventory, or orders.

Before processing a batch, configure a Photoroom API key in the ignored `.env.docker` file. Keep it blank until you are ready to authorize provider calls. `PHOTOROOM_SANDBOX=true` requires a Photoroom sandbox key and returns sandbox-watermarked results; use the production key only after visual review. Each processed image makes a provider request that may incur a charge. See the [Photoroom segment API quickstart](https://docs.photoroom.com/remove-background-api-basic-plan/quickstart-guide) and [supported image limits](https://docs.photoroom.com/remove-background-api-basic-plan/file-size-resolution-and-format).

```dotenv
PHOTOROOM_API_KEY=
PHOTOROOM_SANDBOX=false
```

The app rejects uploads over 8 MB each, more than 50 images per batch, or more than 100 MB total. PNG, JPEG, and WebP are accepted. Review the generated mask and flagged items before approving. Output images are PNG; individual export supports PNG/JPEG/WebP and approved batch export supports ZIP (up to 120 MB uncompressed input). ZIP assembly is memory-bounded by that limit. Classification currently uses admin hints and filename metadata and marks every suggestion for human review; it is not a trained vision classifier.

By default, private media bytes are stored in PostgreSQL. For larger production image volumes, configure a separate **private**, non-public R2 bucket with `R2_PRIVATE_BUCKET_NAME` and the existing R2 credentials. Do not set the private bucket to public or point it at the storefront bucket. Public product media continues to use `R2_BUCKET_NAME`; the private originals and pending outputs use a separate bucket and authenticated reads.

Rebuild and start only when you want to apply the image-studio migration locally:

```powershell
docker compose --env-file .env.docker up -d --build geme-api ai-core ai-worker admin
docker compose --env-file .env.docker logs -f geme-api ai-core ai-worker
```

The migration is additive and does not touch existing product, order, or inventory records. Unit tests mock the Photoroom HTTP request, so they do not use a live key or incur provider charges:

```powershell
pnpm --dir outputs/geme-api test
pnpm --dir outputs/geme-api build
docker build -t geme-ai-core-test outputs/ai-core
docker run --rm --entrypoint python geme-ai-core-test -m unittest discover -s /app/tests -v
```

Before production, process a representative 30–50 image sample across Opal, transparent stones, Emerald/Jade, detailed settings, and polished metal. Record and visually compare the originals and outputs; do not treat the automated QC as proof of perfect color preservation. Provider-backed sample validation needs an authorized Photoroom key and should be performed before using the outputs on live catalog products.
