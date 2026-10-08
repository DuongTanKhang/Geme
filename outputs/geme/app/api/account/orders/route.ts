import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  clearAuthCookies,
  getCustomerSession,
} from "../../../lib/customer-session";

export async function GET(request: NextRequest) {
  try {
    const session = await getCustomerSession(request);
    if (!session) {
      const response = NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }

    const upstream = await callGemeApi("/account/orders", session.accessToken);
    if (!upstream.ok) {
      const response = NextResponse.json({ message: "Không tải được đơn hàng." }, { status: upstream.status === 401 ? 401 : 502 });
      if (upstream.status === 401) clearAuthCookies(response);
      return response;
    }
    const response = NextResponse.json(await upstream.json());
    return response;
  } catch {
    return NextResponse.json({ message: "Dịch vụ đơn hàng hiện chưa kết nối được." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCustomerSession(request);
    if (!session) {
      const response = NextResponse.json({ message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }

    const body = await request.json();
    const upstream = await callGemeApi("/account/orders", session.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      const response = NextResponse.json({ message: "Không tạo được đơn hàng." }, { status: upstream.status === 401 ? 401 : 502 });
      if (upstream.status === 401) clearAuthCookies(response);
      return response;
    }
    const response = NextResponse.json(await upstream.json(), { status: upstream.status });
    return response;
  } catch {
    return NextResponse.json({ message: "Dịch vụ đơn hàng hiện chưa kết nối được." }, { status: 503 });
  }
}
