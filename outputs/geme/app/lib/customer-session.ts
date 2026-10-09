import { NextRequest, NextResponse } from "next/server";
import { normalizeApiBaseUrl } from "./api-base";

export const ACCESS_COOKIE = "geme_access";
export const REFRESH_COOKIE = "geme_refresh";
export const DEVICE_COOKIE = "device_id";

const AEGIS_BASE = normalizeApiBaseUrl(process.env.AEGIS_AUTH_API_URL
  || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:5130"));
const GEME_API_BASE = normalizeApiBaseUrl(process.env.GEME_API_BASE_URL
  || process.env.NEXT_PUBLIC_API_BASE_URL
  || "http://127.0.0.1:4000/api/v1");

export type TokenPair = { accessToken: string; refreshToken: string; deviceId?: string };
export type CustomerSession = {
  accessToken: string;
  user: { id: string; name: string; email: string; emailVerified: boolean };
};

/**
 * Check the browser Origin against the host that received the request.
 * Next's parsed URL can use an internal/proxy hostname, while Host or the
 * trusted reverse-proxy headers retain the public hostname the browser used.
 */
export function isSameOriginRequest(request: NextRequest) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return true;

  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;

  const hosts = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim(),
    request.nextUrl.host,
  ].filter((value): value is string => Boolean(value));
  const protocols = [
    request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim(),
    request.nextUrl.protocol.replace(/:$/, ""),
  ].filter((value): value is string => value === "http" || value === "https");

  return hosts.some((host) => {
    try {
      const normalizedHost = new URL(`${origin.protocol}//${host}`).host;
      return normalizedHost === origin.host && protocols.includes(origin.protocol.slice(0, -1));
    } catch {
      return false;
    }
  });
}

export async function callAegis(path: string, init: RequestInit = {}) {
  if (!AEGIS_BASE) throw new Error("AEGIS_AUTH_API_URL is required in production.");
  return fetch(`${AEGIS_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(8000),
    headers: new Headers(init.headers),
  });
}

export async function callGemeApi(path: string, accessToken: string, init: RequestInit = {}) {
  return fetch(`${GEME_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(8000),
    headers: new Headers({
      ...Object.fromEntries(new Headers(init.headers).entries()),
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    }),
  });
}

export async function callGemePublicApi(path: string, init: RequestInit = {}) {
  return fetch(`${GEME_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(8000),
    headers: new Headers({
      Accept: "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    }),
  });
}

export async function getCustomerSession(request: NextRequest): Promise<CustomerSession | null> {
  const accessToken = getCustomerAccessToken(request);
  if (!accessToken) return null;
  const me = await callAegis("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (me.status === 401 || me.status === 403) return null;
  if (!me.ok) throw new Error("Aegis session validation failed.");
  return { accessToken, user: await me.json() };
}

/** Read the HttpOnly access token for a server-side proxy to the API.
 * The API's customer guard is the authoritative session check; proxy routes
 * should not make a second round-trip to Aegis before forwarding it.
 */
export function getCustomerAccessToken(request: NextRequest) {
  return request.cookies.get(ACCESS_COOKIE)?.value || null;
}

export function applyAuthCookies(response: NextResponse, pair: TokenPair) {
  const secure = process.env.NODE_ENV === "production";
  const accessAge = jwtRemainingSeconds(pair.accessToken);
  response.cookies.set(ACCESS_COOKIE, pair.accessToken, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: accessAge,
  });
  // GEME customer sessions expire after the 15-minute Aegis access-token lifetime.
  // Remove refresh credentials issued by older storefront builds so they cannot
  // silently extend a session after the user has been asked to sign in again.
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0,
  });
  if (pair.deviceId) {
    response.cookies.set(DEVICE_COOKIE, pair.deviceId, {
      httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 30 * 24 * 60 * 60,
    });
  }
}

export function clearAuthCookies(response: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0,
    });
  }
}

export async function upstreamError(response: Response) {
  let message = "Không thể xử lý yêu cầu lúc này.";
  try {
    const payload = await response.json();
    if (response.status < 500 && typeof payload.message === "string") message = payload.message;
    else if (response.status < 500 && Array.isArray(payload.message)) message = payload.message.join(" ");
    else if (response.status < 500 && typeof payload.error === "string") {
      if (/validation failed:/i.test(payload.error)) {
        message = /\bPassword\b/.test(payload.error)
          ? "Mật khẩu cần tối thiểu 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt."
          : "Thông tin bạn nhập chưa hợp lệ. Vui lòng kiểm tra lại.";
      } else {
        message = payload.error;
      }
    }
  } catch { /* keep the generic message */ }
  const status = response.status >= 500 ? 502 : response.status;
  return NextResponse.json({ message }, { status });
}

export function jwtRemainingSeconds(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return 0;
    return Math.max(0, Math.min(15 * 60, payload.exp - Math.floor(Date.now() / 1000)));
  } catch {
    return 0;
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
