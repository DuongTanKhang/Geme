import { NextRequest, NextResponse } from "next/server";
import { callAegis, upstreamError } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const otp = String(body.otp ?? "").trim();
    if (!email || !/^\d{6,10}$/.test(otp)) {
      return NextResponse.json({ message: "Vui lòng nhập email và mã xác nhận từ 6 đến 10 chữ số." }, { status: 400 });
    }

    const upstream = await callAegis("/auth/verify-email-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ email, otp }),
    });
    if (!upstream.ok) return upstreamError(upstream);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực. Mã bạn vừa nhập vẫn được giữ lại." }, { status: 503 });
  }
}
