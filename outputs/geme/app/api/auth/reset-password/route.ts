import { NextRequest, NextResponse } from "next/server";
import { callAegis, upstreamError } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const otp = String(body.otp ?? "").trim();
    const newPassword = String(body.newPassword ?? "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ message: "Vui lòng kiểm tra lại địa chỉ email." }, { status: 400 });
    }
    if (!/^\d{6,10}$/.test(otp)) {
      return NextResponse.json({ message: "Vui lòng nhập mã xác nhận gồm 6 đến 10 chữ số." }, { status: 400 });
    }
    if (newPassword.length < 10 || newPassword.length > 128
      || !/[A-Z]/.test(newPassword)
      || !/[a-z]/.test(newPassword)
      || !/[0-9]/.test(newPassword)
      || !/[^a-zA-Z0-9]/.test(newPassword)) {
      return NextResponse.json({ message: "Mật khẩu cần từ 10 đến 128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt." }, { status: 400 });
    }

    const upstream = await callAegis("/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ email, otp, newPassword }),
    });
    if (!upstream.ok) return upstreamError(upstream);
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực. Vui lòng thử lại sau." }, { status: 503 });
  }
}
