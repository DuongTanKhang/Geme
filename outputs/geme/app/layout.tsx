import type { Metadata } from "next";
import { CatalogLiveSync } from "./components/catalog-live-sync";
import { WishlistProvider } from "./components/wishlist-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEME — Đá quý tự nhiên, dấu ấn riêng",
  description: "Trang sức đá quý tự nhiên, tinh tế và độc bản từ GEME.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <CatalogLiveSync />
        <WishlistProvider>{children}</WishlistProvider>
      </body>
    </html>
  );
}
