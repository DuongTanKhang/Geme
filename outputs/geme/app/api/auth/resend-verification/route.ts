import { NextRequest, NextResponse } from "next/server";
import { callAegis, upstreamError } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ message: "Vui lòng kiểm tra lại địa chỉ email." }, { status: 400 });
    }

    const upstream = await callAegis("/auth/resend-verification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "",
      },
      body: JSON.stringify({ email }),
    });
    if (!upstream.ok) return upstreamError(upstream);
    const result = await upstream.json();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực. Vui lòng thử lại sau." }, { status: 503 });
  }
}
