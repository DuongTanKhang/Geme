import { NextRequest, NextResponse } from "next/server";
import { callAegis, upstreamError } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = String(body.userId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      return NextResponse.json({ message: "Phiên xác minh không hợp lệ. Hãy đăng nhập lại." }, { status: 400 });
    }

    const upstream = await callAegis("/auth/resend-login-otp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ userId }),
    });
    if (!upstream.ok) return upstreamError(upstream);
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực. Vui lòng thử lại sau." }, { status: 503 });
  }
}
