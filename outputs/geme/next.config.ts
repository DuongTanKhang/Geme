import type { NextConfig } from "next";

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: "/cam-nang-da-quy", destination: "/da-quy", permanent: true },
      { source: "/cam-nang-da-quy/:slug", destination: "/da-quy", permanent: true },
    ];
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
