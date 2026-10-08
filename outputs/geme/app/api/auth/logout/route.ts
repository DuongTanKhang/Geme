import { NextRequest, NextResponse } from "next/server";
import { callAegis, clearAuthCookies, getCustomerSession } from "../../../lib/customer-session";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  try {
    const session = await getCustomerSession(request);
    if (session) {
      await callAegis("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
    }
  } catch {
    // Always clear browser credentials; AEGIS still expires access tokens and rejects revoked sessions.
  }
  clearAuthCookies(response);
  return response;
}

