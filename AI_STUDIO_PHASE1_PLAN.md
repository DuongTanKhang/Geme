# GEME AI Studio — Phase 1 implementation plan

> **Trạng thái:** AI Studio đã được gỡ khỏi ứng dụng đang chạy; đây là kế hoạch triển khai lịch sử. API, worker và AI Core đã được tháo khỏi cấu hình runtime. Bảng dữ liệu và migration cũ được giữ nguyên.

## Repository findings

- The repository already separates the Next.js storefront, Next.js Admin, NestJS commerce API, ASP.NET Core AEGIS authentication, PostgreSQL, and Redis in Docker Compose.
- Admin uses a same-origin Next.js route handler. It reads the HttpOnly Admin session cookie, exchanges it for a bearer token, and forwards requests to NestJS. AI Studio should use this boundary instead of exposing AEGIS tokens in browser code.
- NestJS is the commerce and database authority. Existing admin authorization rejects the legacy content-editor role; the new controller can reuse that guard.
- Prisma migrations are applied by the API container on startup. Any AI schema change must be additive and must not rewrite current commerce tables or records.
- The existing Redis instance serves AEGIS. AI queue traffic should use an isolated Redis service so it cannot compete with authentication/session workloads.

## Target request and job flow

```text
Admin browser
  -> same-origin Admin proxy + HttpOnly session
  -> authenticated NestJS AI Studio API
  -> PostgreSQL task record + dedicated AI Redis/BullMQ job
  -> bounded standalone worker
  -> private FastAPI AI Core
  -> PostgreSQL task result / approval record
```

NestJS remains authoritative for task admission, task state, and human decisions. The AI Core has no published port and accepts worker requests only with a server-side shared secret. No AI path writes product, price, inventory, or order records. A publication approval records a decision only; an actual publishing workflow is a later phase.

## Incremental rollout steps

1. **Admin entry and experience:** add the AI Studio navigation entry and a responsive GEME-styled workspace with command submission, task history/details/cancel, agent overview, and approval center.
2. **Authenticated NestJS API:** add guarded routes for overview, task list/detail/create/cancel, and approve/reject. Validate task type, prompt/title length, allowed fields, and required idempotency key. Enforce per-admin rolling request limits and active-task caps.
3. **Durable job handling:** save task rows in PostgreSQL; enqueue BullMQ jobs in dedicated Redis with retries/backoff, bounded retention, duplicate protection, worker recovery, and cancellation-safe result commits.
4. **Private AI Core:** add a small FastAPI service with health and authenticated internal task processing. Return provider-disabled scaffolds and an Image Worker contract; do not configure paid providers.
5. **Additive persistence and deployment config:** add only AI task/approval enums, tables, indexes, and foreign keys through a new Prisma migration. Add AI Core, worker, and isolated AOF-enabled Redis to Compose without exposing internal ports.
6. **Validation and rollout:** generate Prisma Client; validate schema; run API and Python contract tests; build API and Admin; validate Compose. Apply the additive migration only through the normal API startup/deploy process after backup and environment configuration.

## Phase 1 safeguards and limits

- All Admin routes use the existing `AdminAuthGuard`; Admin browser calls pass through the existing cookie-backed proxy.
- Queue creation is idempotent and rate-limited per administrator. Active jobs are bounded per administrator and worker concurrency is capped.
- Internal AI credentials remain in server-side environment variables. Compose requires an explicit 32+ character secret; the Core and its Redis have no host-published ports.
- Image generation is contract-only. There are no live provider keys or paid calls.
- The current Core returns scaffolds, not generated copy or images. Approval does not automatically publish anything.
- Phase 1 has no production load benchmark; capacity settings need measurement on the eventual production host before providers or high-volume AI usage are enabled.
