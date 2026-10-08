import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    const apiBase = (process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1").replace(/\/$/, "");
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
