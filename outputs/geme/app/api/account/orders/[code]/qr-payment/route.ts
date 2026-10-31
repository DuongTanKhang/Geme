import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  getCustomerAccessToken,
  isSameOriginRequest,
} from "../../../../../lib/customer-session";

async function forwardError(upstream: Response) {
  let message = "Không thể mở thanh toán QR cho đơn hàng.";
  try {
    const payload = await upstream.json();
    if (typeof payload.message === "string") message = payload.message;
    else if (Array.isArray(payload.message)) message = payload.message.join(" ");
  } catch { /* keep the fallback */ }
  return NextResponse.json({ message }, { status: upstream.status >= 500 ? 502 : upstream.status });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/account/orders/[code]/qr-payment">) {
  if (!isSameOriginRequest(request, true)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  const accessToken = getCustomerAccessToken(request);
  if (!accessToken) return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

  try {
    const { code } = await context.params;
    const upstream = await callGemeApi(`/account/orders/${encodeURIComponent(code)}/qr-payment`, accessToken, { method: "POST" });
    if (!upstream.ok) return await forwardError(upstream);
    return NextResponse.json(await upstream.json(), { headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" } });
  } catch {
    return NextResponse.json({ message: "Dịch vụ thanh toán hiện chưa kết nối được." }, { status: 503 });
  }
}
