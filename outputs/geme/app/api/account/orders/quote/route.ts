import { NextRequest, NextResponse } from "next/server";
import { callGemeApi, getCustomerAccessToken, isSameOriginRequest } from "../../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request, true)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
    const body = await request.json();
    const upstream = await callGemeApi("/account/orders/quote", accessToken, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let payload: unknown = {};
    try { payload = await upstream.json(); } catch { /* report a safe upstream fallback */ }
    if (!upstream.ok) {
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const message = Array.isArray(record.message) ? record.message.join(" ") : typeof record.message === "string" ? record.message : "Không kiểm tra được điểm thưởng cho đơn hàng.";
      return NextResponse.json({ message }, { status: upstream.status < 500 ? upstream.status : 502 });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
  } catch {
    return NextResponse.json({ message: "Dịch vụ báo giá thành viên hiện chưa kết nối được." }, { status: 503 });
  }
}
