import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  getCustomerAccessToken,
  isSameOriginRequest,
} from "../../../lib/customer-session";

async function forwardError(upstream: Response, fallback: string) {
  let message = fallback;
  try {
    const payload = await upstream.json();
    if (typeof payload.message === "string") message = payload.message;
    else if (Array.isArray(payload.message)) message = payload.message.join(" ");
  } catch { /* retain the fallback */ }
  return NextResponse.json({ message }, { status: upstream.status >= 500 ? 502 : upstream.status });
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
    }

    const upstream = await callGemeApi("/account/orders", accessToken);
    if (!upstream.ok) return await forwardError(upstream, "Không tải được đơn hàng.");
    return NextResponse.json(await upstream.json(), {
      headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" },
    });
  } catch {
    return NextResponse.json({ message: "Dịch vụ đơn hàng hiện chưa kết nối được." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
    }

    const body = await request.json();
    const upstream = await callGemeApi("/account/orders", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) return await forwardError(upstream, "Không tạo được đơn hàng.");
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ message: "Dịch vụ đơn hàng hiện chưa kết nối được." }, { status: 503 });
  }
}
