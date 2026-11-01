import { connection } from "next/server";
import type { Metadata } from "next";
import "./globals.css";
import "./social-workspace.css";

export const metadata: Metadata = {
  title: "GEME Admin — Quản trị cửa hàng",
  description: "Bảng quản trị riêng cho cửa hàng GEME.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection(); // Per-request CSP nonce; explicit data caches remain available.
  return <html lang="vi"><body>{children}</body></html>;
}
