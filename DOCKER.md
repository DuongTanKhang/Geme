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
5. From this directory, run:

   ```powershell
   docker compose --env-file .env.docker up --build -d
   ```

The API runs Prisma migrations on startup. AEGIS runs its EF migrations on startup in Development. SQL Server and Redis use named Docker volumes and keep their data when containers stop. AEGIS email is routed to Mailpit, so no real SMTP credentials are required. The Node API runs its compiled Nest app so dependency injection metadata is preserved; rebuild it after changing API source with `docker compose --env-file .env.docker up --build -d geme-api`. The admin container uses Next.js Webpack because its Windows `node_modules` junction is incompatible with Turbopack's Docker filesystem root.

## Product media storage

Local development keeps `MEDIA_STORAGE_PROVIDER=database`, so the new storage path works without Cloudflare credentials and existing media URLs keep working. For production, create a Cloudflare R2 bucket, create a bucket-scoped access token, and attach a Cloudflare custom domain such as `media.geme.vn`. Put the R2 credentials only in the API environment and set `MEDIA_STORAGE_PROVIDER=r2` plus `MEDIA_PUBLIC_BASE_URL=https://media.geme.vn`. Do not set these as `NEXT_PUBLIC_*` variables.

The Prisma migration adds provider/key metadata while retaining all existing media bytes. After configuring R2 and taking a database backup, run `pnpm media:migrate-r2` from `outputs/geme-api` to move existing public records in small batches; each row is removed from PostgreSQL only after the object upload succeeds. PDFs/private documents remain in PostgreSQL. This code does not yet import the separate 8 GB DirectAdmin image folder: that requires access to the original files or an archive, so the import and visual redesign can happen after the new hosting and R2 domain are ready.

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
