# GEME Product Agent (Phase 3)

> **Trạng thái:** API AI Studio Phase 1–4 đã được tháo khỏi ứng dụng. Tài liệu này chỉ lưu đặc tả lịch sử; Product Agent không khả dụng trong runtime hiện tại. Dữ liệu, migration và ảnh đã lưu được giữ nguyên.

Product Agent is a tab inside Admin → AI Studio. It accepts only private output images from approved Phase 2 `PRODUCT_PHOTO` batches. Technical drawings, unapproved images, and public media assets are rejected.

## Workflow and safety boundaries

1. Admin selects up to 5 approved images per batch, matching the default per-admin active-task limit.
2. NestJS creates one durable AI task and one `AiProductDraft` per image in a manifest-hashed batch, then enqueues them on the existing Redis/BullMQ queue.
3. The worker reads the approved private output image, sends it to the private AI Core over the internal Docker network, and supplies active category/material/gemstone labels as suggestions.
4. AI Core returns structured Vietnamese product copy. The worker validates suggestions against the live catalog and saves the content to `ai_product_drafts` only.
5. Admin can edit, approve, reject, cancel, or retry the content draft. Approving a draft only marks the content reviewed. There is no Product Agent publication endpoint and no write to commerce products, SKU, prices, inventory, or orders.

Image pixels and embedded text are treated as untrusted input. Without verified product data, material and gemstone identity are always blank; claims detected from the configured catalog or certification/authenticity phrases are replaced with neutral copy and flagged. Every generated draft remains in the manual review workspace.

## Provider setup

No new provider key is introduced. Set `GEME_OPENAI_API_KEY` in the ignored `.env.docker` file; Compose passes it to `ai-core` as `OPENAI_API_KEY`, never to Admin or the browser. The API and worker need the existing `AI_CORE_SHARED_SECRET` (at least 32 random bytes). The `ai-core` service remains internal and is not published to the host.

The provider must support the existing OpenAI Responses API vision format. The Product Agent uses `GEME_OPENAI_IMAGE_ANALYSIS_MODEL` or falls back to `GEME_OPENAI_TEXT_MODEL`. Check provider/model access before enabling this workflow in production.

## Database and local setup

The migration `outputs/geme-api/prisma/migrations/20261019010000_ai_product_agent/migration.sql` adds the task enum value and separate batch/draft tables. It does not update existing commerce data. Apply through the existing migration process, then regenerate Prisma Client:

```powershell
Set-Location outputs/geme-api
pnpm db:generate
pnpm build
pnpm test
```

Python contract tests for AI Core:

```powershell
Set-Location outputs/ai-core
python -m pip install -r requirements.txt
python -m unittest discover -s tests
```

Compose already includes the API, shared AI worker, Redis, and private AI Core. No new service or public port is required. To exercise the end-to-end workflow, start the existing compose stack with the required environment configured, approve a `PRODUCT_PHOTO` output in Image Studio, then select it in the Product Agent tab.

## Admin API

All routes below are nested under `/api/v1/admin/ai-studio` in NestJS and protected by `AdminAuthGuard`:

- `GET product-agent/approved-images`
- `GET product-agent/status`
- `GET product-agent/batches` and `GET product-agent/batches/:id`
- `POST product-agent/batches` with `Idempotency-Key` and `{ "imageItemIds": ["..."] }`
- `GET product-agent/drafts` and `GET product-agent/drafts/:id`
- `PATCH product-agent/drafts/:id` (content fields only)
- `POST product-agent/drafts/:id/approve`, `/reject`, `/cancel`, `/retry`

The internal AI Core contract is `POST /internal/products/generate-draft` with the shared internal key, a validated image, and bounded catalog option arrays. It is not exposed through the public web ingress.

## Operational limits and validation

- Image size: 8 MiB; decoded image pixel limit: 25 million.
- Catalog lists and response sizes are bounded; the API caps batch requests at 5 images and enforces active task admission/rate limits.
- Redis retries are inherited from the shared AI Studio queue. Task/draft state is authoritative in PostgreSQL and idempotency is recorded per manifest.
- AI confidence is advisory. All generated content must be checked against actual product records before use.
- No live test images, provider call, migration, Compose startup, or deployment is included in this code change. Use a representative, admin-approved image set and review outputs manually before production.
