import { AuthPage } from "../components/account-pages";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBanner, getStoreRegistrationPrivacyPolicy, getStoreSiteSettings } from "../lib/store-api";

export const metadata: Metadata = { title: "Đăng ký", robots: { index: false, follow: false } };

export default async function RegisterPage() {
  const [{ settings }, { policy: privacyPolicy }] = await Promise.all([getStoreSiteSettings(), getStoreRegistrationPrivacyPolicy()]);
  const bannerImage = getStoreBanner(settings, "Đăng nhập - Banner", "/assets/category-jewelry-final.jpg");
  return <><SiteHeader /><AuthPage mode="register" bannerImage={bannerImage} privacyPolicy={privacyPolicy} /><SiteFooter /></>;
}
import type { Metadata } from "next";
