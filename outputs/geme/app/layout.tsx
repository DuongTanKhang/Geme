import type { Metadata } from "next";
import { CatalogLiveSync } from "./components/catalog-live-sync";
import { StructuredData } from "./components/structured-data";
import { WishlistProvider } from "./components/wishlist-provider";
import { absoluteSiteUrl, getPublicSiteUrl } from "./lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: getPublicSiteUrl(),
  title: { default: "GEME — Đá quý tự nhiên, dấu ấn riêng", template: "%s | GEME" },
  description: "Trang sức đá quý tự nhiên, tinh tế và độc bản từ GEME.",
  openGraph: {
    type: "website",
    siteName: "GEME",
    locale: "vi_VN",
    title: "GEME — Đá quý tự nhiên, dấu ấn riêng",
    description: "Trang sức đá quý tự nhiên, tinh tế và độc bản từ GEME.",
  },
  twitter: { card: "summary_large_image", title: "GEME — Đá quý tự nhiên, dấu ấn riêng", description: "Trang sức đá quý tự nhiên, tinh tế và độc bản từ GEME." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organization = { "@context": "https://schema.org", "@type": "Organization", "@id": `${absoluteSiteUrl("/")}#organization`, name: "GEME", url: absoluteSiteUrl("/") };
  return (
    <html lang="vi">
      <body>
        <StructuredData value={organization} />
        <CatalogLiveSync />
        <WishlistProvider>{children}</WishlistProvider>
      </body>
    </html>
  );
}
