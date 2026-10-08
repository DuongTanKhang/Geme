import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEME Admin — Quản trị cửa hàng",
  description: "Bảng quản trị riêng cho cửa hàng GEME.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
