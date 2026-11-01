import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./security/csp";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  // Overwrite supplied values; only this server may choose a nonce/policy.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  // HTML/RSC with a nonce must never be reused for another document.
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Surrogate-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|media(?:/|$)|assets(?:/|$)|geme-assets(?:/|$)|geme-images(?:/|$)|images(?:/|$)|fonts(?:/|$)|favicon.ico|robots.txt|sitemap.xml).*)"],
};
