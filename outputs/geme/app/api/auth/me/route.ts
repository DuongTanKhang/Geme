import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  getCustomerAccessToken,
  jwtRemainingSeconds,
} from "../../../lib/customer-session";

export async function GET(request: NextRequest) {
  try {
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
    }

    // The GEME API guard validates the token with Aegis and returns the
    // customer profile. Avoid checking the same token against Aegis here too.
    const profile = await callGemeApi("/account/me", accessToken);
    if (!profile.ok) {
      let message = profile.status === 401 ? "Phiên đăng nhập đã hết hạn." : "Không tải được hồ sơ khách hàng.";
      if (profile.status === 503) {
        message = "Dịch vụ xác thực đang tạm thời không truy cập được. Vui lòng thử lại.";
      } else if (profile.status === 429) {
        message = "Có quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.";
      } else if (profile.status < 500) {
        try {
          const payload = await profile.json();
          if (typeof payload.message === "string") message = payload.message;
          else if (Array.isArray(payload.message)) message = payload.message.join(" ");
        } catch { /* Keep the safe fallback. */ }
      }
      const status = profile.status >= 500 ? 502 : profile.status;
      return NextResponse.json({ message }, { status });
    }

    const customer = await profile.json();
    const response = NextResponse.json({
      customer,
      sessionExpiresAt: Date.now() + jwtRemainingSeconds(accessToken) * 1000,
    });
    return response;
  } catch {
    return NextResponse.json({ message: "Dịch vụ tài khoản hiện chưa kết nối được." }, { status: 503 });
  }
}

