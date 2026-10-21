import type { NextConfig } from "next";

function getRemoteImagePatterns() {
  const urls = [process.env.GEME_SITE_URL, process.env.MEDIA_PUBLIC_BASE_URL]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => {
      try {
        const url = new URL(value);
        if (url.hostname === "geme.vn" || url.hostname === "www.geme.vn") {
          const alias = new URL(url.href);
          alias.hostname = url.hostname === "geme.vn" ? "www.geme.vn" : "geme.vn";
          return [url, alias];
        }
        return [url];
      } catch {
        return [];
      }
    });
  const seen = new Set<string>();
  return urls.flatMap((url) => {
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    const key = `${url.protocol}//${url.host}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ protocol: url.protocol.slice(0, -1) as "https" | "http", hostname: url.hostname, port: url.port, pathname: "/**" }];
  });
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: getRemoteImagePatterns(),
    formats: ["image/webp"],
    qualities: [75, 80],
    minimumCacheTTL: 3600,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const apiBase = (process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1").replace(/\/$/, "");
    return {
      afterFiles: [
        { source: "/assets/:path*", destination: `${apiBase}/media/assets/:path*` },
        { source: "/media/:id", destination: `${apiBase}/media/:id` },
      ],
    };
  },
};

export default nextConfig;
