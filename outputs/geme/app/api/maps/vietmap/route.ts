export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VIETMAP_API = "https://maps.vietmap.vn/api";
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 90;
const requestWindows = new Map<string, number[]>();

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function withinVietnam(latitude: number, longitude: number) {
  return latitude >= 8.2 && latitude <= 23.5 && longitude >= 102 && longitude <= 110;
}

function allowedRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("x-real-ip")?.trim() || forwarded || "unknown";
  const now = Date.now();
  const recent = (requestWindows.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return false;
  recent.push(now);
  requestWindows.set(ip, recent);
  if (requestWindows.size > 2_000) {
    for (const [key, values] of requestWindows) if (!values.some((time) => now - time < WINDOW_MS)) requestWindows.delete(key);
  }
  return true;
}

async function vietmapRequest(path: string, params: Record<string, string>) {
  const apiKey = process.env.VIETMAP_API_KEY?.trim();
  if (!apiKey) return { error: json({ message: "Máy chủ chưa cấu hình VietMap API key." }, 503) } as const;
  const url = new URL(`${VIETMAP_API}/${path}`);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { error: json({ message: response.status === 423 ? "VietMap đã hết hạn mức hoặc API chưa được bật cho key." : "VietMap chưa trả được dữ liệu địa chỉ. Vui lòng thử lại." }, response.status === 423 ? 503 : 502) } as const;
    return { data: await response.json() as unknown } as const;
  } catch {
    return { error: json({ message: "Không kết nối được VietMap. Vui lòng thử lại." }, 502) } as const;
  }
}

export async function GET(request: Request) {
  if (!allowedRequest(request)) return json({ message: "Bạn đang tìm địa chỉ quá nhanh. Vui lòng đợi một chút rồi thử lại." }, 429);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  if (action === "autocomplete") {
    const text = (url.searchParams.get("text") || "").trim().slice(0, 160);
    if (text.length < 2) return json({ suggestions: [] });
    const result = await vietmapRequest("autocomplete/v4", { text, display_type: "6", layers: "ADDRESS,POI,STREET" });
    if ("error" in result) return result.error;
    const values = Array.isArray(result.data) ? result.data : [];
    return json({ suggestions: values.slice(0, 8).flatMap((value) => {
      const item = record(value);
      const refId = typeof item.ref_id === "string" ? item.ref_id.slice(0, 2048) : "";
      const label = typeof item.display === "string" ? item.display.trim().slice(0, 500) : "";
      return refId && label ? [{ refId, label }] : [];
    }) });
  }

  if (action === "place") {
    const refId = (url.searchParams.get("refid") || "").trim();
    if (refId.length > 2048 || !/^(auto|geocode):[A-Za-z0-9_\-]+$/.test(refId)) return json({ message: "Kết quả địa chỉ VietMap không hợp lệ. Hãy tìm và chọn lại địa chỉ." }, 400);
    const result = await vietmapRequest("place/v4", { refid: refId });
    if ("error" in result) return result.error;
    const place = record(result.data);
    const latitude = Number(place.lat ?? place.latitude);
    const longitude = Number(place.lng ?? place.longitude);
    const address = typeof place.display === "string" ? place.display.trim().slice(0, 500) : "";
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !withinVietnam(latitude, longitude) || !address) return json({ message: "VietMap không trả về vị trí giao hàng hợp lệ. Hãy chọn kết quả khác." }, 502);
    return json({ latitude, longitude, address });
  }

  if (action === "reverse") {
    const latitude = Number(url.searchParams.get("lat"));
    const longitude = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !withinVietnam(latitude, longitude)) return json({ message: "Vị trí ghim phải nằm trong lãnh thổ Việt Nam." }, 400);
    const result = await vietmapRequest("reverse/v4", { lat: String(latitude), lng: String(longitude), display_type: "6" });
    if ("error" in result) return result.error;
    const first = Array.isArray(result.data) ? record(result.data[0]) : record(result.data);
    const address = typeof first.display === "string" ? first.display.trim().slice(0, 500) : "";
    if (!address) return json({ message: "VietMap chưa nhận diện được địa chỉ tại điểm này. Hãy chọn vị trí gần địa chỉ giao hàng hơn." }, 422);
    return json({ latitude, longitude, address });
  }

  return json({ message: "Yêu cầu VietMap không hợp lệ." }, 404);
}
