export const dynamic = "force-dynamic";

/**
 * The tilemap key is browser-visible by design; the general VietMap API key
 * stays server-side. Both are runtime values so deployments do not bake keys
 * into the Admin image.
 */
export async function GET() {
  const tilemapKey = process.env.VIETMAP_TILEMAP_KEY?.trim() || "";
  const apiConfigured = Boolean(process.env.VIETMAP_API_KEY?.trim());
  return Response.json(
    { configured: tilemapKey.length > 0, tilemapKey, apiConfigured },
    { headers: { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" } },
  );
}
