import { NextRequest, NextResponse } from "next/server";
import { applyAuthCookies, callAegis, jwtRemainingSeconds, upstreamError, type TokenPair } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = String(body.userId ?? "");
    const otp = String(body.otp ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^\d{6,10}$/.test(otp)) {
      return NextResponse.json({ message: "Mã xác minh không hợp lệ." }, { status: 400 });
    }

    const deviceId = request.cookies.get("device_id")?.value;
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": request.headers.get("user-agent") ?? "",
    });
    if (deviceId) headers.set("Cookie", `device_id=${encodeURIComponent(deviceId)}`);

    const upstream = await callAegis("/auth/verify-2fa", {
      method: "POST",
      headers,
      body: JSON.stringify({ userId, otp }),
    });
    if (!upstream.ok) return upstreamError(upstream);
    const result = await upstream.json();
    if (typeof result.accessToken !== "string" || typeof result.refreshToken !== "string" || jwtRemainingSeconds(result.accessToken) <= 0) {
      return NextResponse.json({ message: "Máy chủ xác thực trả về phiên không hợp lệ." }, { status: 502 });
    }

    const response = NextResponse.json({ success: true });
    applyAuthCookies(response, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      deviceId: result.deviceId,
    } satisfies TokenPair);
    return response;
  } catch {
    return NextResponse.json({ message: "Không kết nối được máy chủ xác thực." }, { status: 503 });
  }
}

