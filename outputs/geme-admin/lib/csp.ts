/** CSP for server-rendered HTML. Keep the two standalone app copies identical. */
export function contentSecurityPolicy(nonce: string, env: Record<string, string | undefined> = process.env) {
  if (!/^[a-zA-Z0-9+/=_-]{20,}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const development = env.NODE_ENV !== "production";
  const connect = new Set(["'self'", "blob:"]);
  for (const value of [env.NEXT_PUBLIC_API_BASE_URL, env.MEDIA_PUBLIC_BASE_URL, ...(env.CSP_CONNECT_ORIGINS || "").split(",")]) {
    if (!value?.trim() || value.trim().startsWith("/")) continue;
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("CSP connection origins must be HTTP(S) origins without credentials");
    if (!development && url.protocol !== "https:") throw new Error("Production browser API/media origins must use HTTPS");
    connect.add(url.origin);
  }
  if (development) { connect.add("http:"); connect.add("ws:"); }
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" + (development ? " 'unsafe-eval'" : ""),
    "script-src-attr 'none'",
    // React uses inline style attributes for gallery sizing and editing previews.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' https: data: blob:" + (development ? " http:" : ""),
    "media-src 'self' https: data: blob:" + (development ? " http:" : ""),
    "connect-src " + [...connect].join(" "),
    "frame-src 'self' blob: https://www.google.com",
    "worker-src 'self' blob:",
  ].join("; ");
}
