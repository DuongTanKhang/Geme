import { NextRequest, NextResponse } from "next/server";
import {
  callGemeApi,
  getCustomerAccessToken,
  isSameOriginRequest,
} from "../../../lib/customer-session";

export async function PATCH(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ message: "Yêu cầu cập nhật hồ sơ không hợp lệ." }, { status: 403 });
    }
    const accessToken = getCustomerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
    }

    const body = await request.json();
    const upstream = await callGemeApi("/account/me", accessToken, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: body.name,
        phone: body.phone,
        defaultAddress: body.defaultAddress,
        avatarDataUrl: body.avatarDataUrl,
        removeAvatar: body.removeAvatar === true,
      }),
    });
    if (!upstream.ok) {
      let message = "Không lưu được thông tin tài khoản.";
      try {
        const payload = await upstream.json();
        if (typeof payload.message === "string") message = payload.message;
        else if (Array.isArray(payload.message)) message = payload.message.join(" ");
      } catch { /* retain the safe fallback */ }
      const response = NextResponse.json({ message }, { status: upstream.status === 401 ? 401 : upstream.status < 500 ? upstream.status : 502 });
      return response;
    }
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ message: "Dịch vụ tài khoản hiện chưa kết nối được." }, { status: 503 });
  }
}

