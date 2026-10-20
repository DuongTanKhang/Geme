import { ProfilePage } from "../components/account-pages";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = { title: "Tài khoản", robots: { index: false, follow: false } };

export default function AccountPage() {
  return <><SiteHeader /><ProfilePage /><SiteFooter /></>;
}
import type { Metadata } from "next";
