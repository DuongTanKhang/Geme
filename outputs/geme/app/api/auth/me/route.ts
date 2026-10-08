import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  clearAuthCookies,
  getCustomerSession,
  jwtRemainingSeconds,
} from "../../../lib/customer-session";

export async function GET(request: NextRequest) {
  try {
    const session = await getCustomerSession(request);
    if (!session) {
      const response = NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }

    const profile = await callGemeApi("/account/me", session.accessToken);
    if (!profile.ok) {
      const response = NextResponse.json(
        { message: profile.status === 401 ? "Phiên đăng nhập đã hết hạn." : "Không tải được hồ sơ khách hàng." },
        { status: profile.status === 401 ? 401 : 502 },
      );
      if (profile.status === 401) clearAuthCookies(response);
      return response;
    }

    const response = NextResponse.json({
      user: session.user,
      customer: await profile.json(),
      sessionExpiresAt: Date.now() + jwtRemainingSeconds(session.accessToken) * 1000,
    });
    return response;
  } catch {
    return NextResponse.json({ message: "Dịch vụ tài khoản hiện chưa kết nối được." }, { status: 503 });
  }
}

