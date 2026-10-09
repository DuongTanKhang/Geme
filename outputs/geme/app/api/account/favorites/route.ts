import { NextRequest, NextResponse } from "next/server";
import { callGemeApi, getCustomerAccessToken, isSameOriginRequest } from "../../../lib/customer-session";

function unauthenticated(message = "Bạn chưa đăng nhập.") {
  return NextResponse.json({ message }, { status: 401 });
}

async function forwardError(upstream: Response, fallback: string) {
  let message = fallback;
  try {
    const payload = await upstream.json();
    if (typeof payload.message === "string") message = payload.message;
    else if (Array.isArray(payload.message)) message = payload.message.join(" ");
  } catch { /* keep the safe fallback */ }
  return NextResponse.json({ message }, { status: upstream.status >= 500 ? 502 : upstream.status });
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) return unauthenticated();
    const upstream = await callGemeApi("/account/favorites", accessToken);
    if (!upstream.ok) return await forwardError(upstream, "Không tải được sản phẩm yêu thích.");
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ message: "Dịch vụ sản phẩm yêu thích hiện chưa kết nối được." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) return unauthenticated();
    const body = await request.json();
    const upstream = await callGemeApi("/account/favorites", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: body.productId }),
    });
    if (!upstream.ok) return await forwardError(upstream, "Không lưu được sản phẩm yêu thích.");
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ message: "Dịch vụ sản phẩm yêu thích hiện chưa kết nối được." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) return unauthenticated();
    const body = await request.json();
    const upstream = await callGemeApi("/account/favorites", accessToken, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: body.productId }),
    });
    if (!upstream.ok) return await forwardError(upstream, "Không bỏ được sản phẩm khỏi danh sách yêu thích.");
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json({ message: "Dịch vụ sản phẩm yêu thích hiện chưa kết nối được." }, { status: 503 });
  }
}
