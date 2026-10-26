# API checks

Install dependencies and generate the Prisma client before running API checks:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm test
pnpm build
```

PostgreSQL integration tests (including the New Arrivals query suite) require a dedicated local database whose name includes
`test`, `integration`, or `ci`. The tests deliberately skip unless
`RUN_POSTGRES_INTEGRATION_TESTS=1` and the database host is local. For example:

```powershell
$env:DATABASE_URL = "postgresql://geme:geme@localhost:5432/geme_integration_ci"
$env:RUN_POSTGRES_INTEGRATION_TESTS = "1"
pnpm exec prisma migrate deploy
pnpm test:integration
```

Use a disposable test database only. The integration suite writes and removes its
own fixtures; it must never be pointed at a production or shared business database.
