const SAFE_FORWARD_HEADERS = ["content-type", "accept-language", "last-event-id", "idempotency-key"];
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The Social admin controller has an additional `admin/` segment after the
 * global API prefix. Keep every other admin proxy route on its existing path.
 * The OAuth callback is a separate, public state-validated backend route.
 * @param {string[]} segments
 */
function mapAdminSegments(segments) {
  const isSocialAdminRoute = segments[0] === "social"
    && !(segments[1] === "meta" && segments[2] === "callback");
  return isSocialAdminRoute ? ["admin", ...segments] : segments;
}

/** @param {string} baseUrl @param {string[]} segments @param {string} search */
export function buildAdminApiTarget(baseUrl, segments, search = "") {
  const path = mapAdminSegments(segments).map((part) => encodeURIComponent(part)).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${path}${search}`;
}

/** @param {string} method */
export function requiresSameOrigin(method) {
  return !READ_ONLY_METHODS.has(method.toUpperCase());
}

/** @param {{ headers: Headers; nextUrl: URL }} request */
export function hasSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? forwardedProto
    : request.nextUrl.protocol.replace(/:$/, "");
  if (!host || (protocol !== "http" && protocol !== "https")) return false;
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

/** @param {Request} request @param {string} token @returns {RequestInit} */
export async function prepareAdminProxyRequest(request, token) {
  const headers = new Headers({
    Accept: request.headers.get("accept") || "application/json",
    Authorization: `Bearer ${token}`,
  });
  for (const name of SAFE_FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = !["GET", "HEAD"].includes(request.method);
  return {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  };
}
