import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  // Keep production builds isolated from a concurrently running Next dev server.
  // This also allows CI/local builds to use a dedicated output directory when needed.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
  async rewrites() {
    const configuredApiBase = process.env.GEME_API_BASE_URL
      || (process.env.NODE_ENV === "production" ? "" : process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
    if (!configuredApiBase) throw new Error("GEME_API_BASE_URL is required for production Admin builds; use the internal API service URL.");
    const apiBase = configuredApiBase.replace(/\/$/, "");
    const storefrontAssetsBase = (process.env.GEME_STOREFRONT_ASSETS_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
    return { beforeFiles: [
      { source: "/geme-assets/:path*", destination: `${storefrontAssetsBase}/assets/:path*` },
      { source: "/geme-images/:path*", destination: `${storefrontAssetsBase}/images/:path*` },
      { source: "/assets/:path*", destination: `${storefrontAssetsBase}/assets/:path*` },
      { source: "/media/:id", destination: `${apiBase}/media/:id` },
    ] };
  },
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
};

export default nextConfig;
