export const dynamic = "force-dynamic";

export async function GET() {
  const tilemapKey = process.env.VIETMAP_TILEMAP_KEY?.trim() || "";
  return Response.json({
    configured: Boolean(tilemapKey),
    tilemapKey: tilemapKey || null,
    apiConfigured: Boolean(process.env.VIETMAP_API_KEY?.trim()),
  }, { headers: { "Cache-Control": "no-store" } });
}
