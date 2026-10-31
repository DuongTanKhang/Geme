# GEME public media gateway

This Cloudflare Worker lets the storefront and POS365 read public product images and videos while the R2 bucket stays private. It serves allowlisted raster images and MP4/WebM objects under `media/`, plus legacy catalog images only when their key matches `product-images/{SKU}/{SKU}-{sequence}.{jpg|jpeg|png|webp}`. All other paths (including `private-media/`, PDF, and SVG) return 404. It supports GET, HEAD, byte ranges for video seeking, and immutable caching. It does not list the bucket or accept uploads.

Run the isolated Worker tests with `npm test`; the same command runs in the `media-worker` CI job.

## Deploy

The checked-in `wrangler.toml` binds the existing `geme-media` bucket and publishes the Worker on its Cloudflare `workers.dev` hostname. The logged-in Cloudflare account does not contain the `geme.vn` zone, so a `media.geme.vn` custom domain cannot be attached from this account.

1. From this directory, authenticate Wrangler to the Cloudflare account that owns the `geme.vn` zone: `pnpm dlx wrangler login`.
2. Deploy the Worker: `pnpm dlx wrangler deploy`.
3. Confirm the `workers.dev` URL printed by Wrangler. Keep the R2 bucket private; do not enable R2's public bucket URL or bind a public R2 custom domain directly to this bucket.
4. In the root `.env.docker`, set `MEDIA_PUBLIC_BASE_URL` to that `https://<worker>.<account-subdomain>.workers.dev` URL, then recreate the API with `docker compose --env-file .env.docker up -d --force-recreate geme-api`.
5. Open Admin → Cài đặt → Kết nối POS365 and click **Đồng bộ ảnh sản phẩm**. Check that content-addressed images load from `<worker-url>/media/...`, SKU catalog images load from `<worker-url>/product-images/{SKU}/{SKU}-{sequence}.{ext}`, and a `/private-media/...` path returns 404.

The Worker requires no application secrets. Its request handler only reads objects and has no upload, delete, or bucket-list endpoint.
