import { NextRequest, NextResponse } from "next/server";
import { callGemeApi, getCustomerAccessToken } from "../../../lib/customer-session";

export async function GET(request: NextRequest) {
  try {
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
    const upstream = await callGemeApi("/account/loyalty", accessToken);
    let payload: unknown = {};
    try { payload = await upstream.json(); } catch { /* handled below */ }
    if (!upstream.ok) {
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const message = Array.isArray(record.message) ? record.message.join(" ") : typeof record.message === "string" ? record.message : "Không tải được điểm thưởng.";
      return NextResponse.json({ message }, { status: upstream.status < 500 ? upstream.status : 502 });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ message: "Dịch vụ điểm thưởng hiện chưa kết nối được." }, { status: 503 });
  }
}
