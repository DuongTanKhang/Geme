import { NextRequest, NextResponse } from "next/server.js";
import { buildAdminApiTarget, hasSameOrigin, prepareAdminProxyRequest, requiresSameOrigin } from "../../../../lib/social-proxy.mjs";

export const dynamic = "force-dynamic";

const ADMIN_COOKIE = "geme_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
type RouteContext = { params: Promise<{ path: string[] }> };

function apiBaseUrl() {
  const value = process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1";
  return value.replace(/\/+$/, "");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function login(request: NextRequest) {
  if (!hasSameOrigin(request)) return jsonError("Yêu cầu không hợp lệ.", 403);
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonError("Thông tin đăng nhập không hợp lệ.", 400);
  }
  try {
    const upstream = await fetch(`${apiBaseUrl()}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json().catch(() => ({})) as { accessToken?: string; expiresIn?: number; admin?: unknown; message?: string };
    if (!upstream.ok || !result.accessToken) {
      return jsonError(typeof result.message === "string" ? result.message : "Không đăng nhập được. Vui lòng thử lại.", upstream.status >= 500 ? 502 : upstream.status);
    }
    const response = NextResponse.json({ admin: result.admin }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADMIN_COOKIE, result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: Math.min(SESSION_SECONDS, Math.max(60, Number(result.expiresIn) || SESSION_SECONDS)),
    });
    return response;
  } catch {
    return jsonError("Không kết nối được máy chủ đăng nhập GEME.", 502);
  }
}

async function logout(request: NextRequest) {
  if (!hasSameOrigin(request)) return jsonError("Yêu cầu không hợp lệ.", 403);
  const response = NextResponse.json({ loggedOut: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!path?.length) return jsonError("Không tìm thấy API quản trị.", 404);

  if (path.join("/") === "auth/login" && request.method === "POST") return login(request);
  if (path.join("/") === "auth/logout" && request.method === "POST") return logout(request);
  if (requiresSameOrigin(request.method) && !hasSameOrigin(request)) return jsonError("Yêu cầu không hợp lệ.", 403);

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return jsonError("Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.", 401);

  const targetUrl = buildAdminApiTarget(apiBaseUrl(), path, request.nextUrl.search);

  try {
    const init = await prepareAdminProxyRequest(request, token);
    const upstream = await fetch(targetUrl, {
      ...init,
      signal: AbortSignal.timeout(path.join("/") === "ai-studio/product-agent/direct-upload" ? 120_000 : 30_000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "content-disposition", "retry-after", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonError("Không kết nối được API GEME. Vui lòng thử lại.", 502);
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
