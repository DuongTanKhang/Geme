import { NextRequest, NextResponse } from "next/server";
import { callAegis, clearAuthCookies, getCustomerAccessToken, isSameOriginRequest, upstreamError } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request, true)) {
    return NextResponse.json({ message: "Yêu cầu đổi mật khẩu không hợp lệ." }, { status: 403 });
  }

  const accessToken = getCustomerAccessToken(request);
  if (!accessToken) return NextResponse.json({ message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." }, { status: 401 });

  try {
    const body = await request.json();
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!currentPassword || currentPassword.length > 128) {
      return NextResponse.json({ message: "Vui lòng nhập mật khẩu hiện tại." }, { status: 400 });
    }
    if (newPassword.length < 10 || newPassword.length > 128
      || !/[A-Z]/.test(newPassword)
      || !/[a-z]/.test(newPassword)
      || !/[0-9]/.test(newPassword)
      || !/[^a-zA-Z0-9]/.test(newPassword)) {
      return NextResponse.json({ message: "Mật khẩu mới cần từ 10 đến 128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt." }, { status: 400 });
    }

    const upstream = await callAegis("/auth/change-password", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!upstream.ok) return upstreamError(upstream);

    const response = NextResponse.json(await upstream.json());
    clearAuthCookies(response);
    return response;
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực. Vui lòng thử lại sau." }, { status: 503 });
  }
}
