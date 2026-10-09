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
