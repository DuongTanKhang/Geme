import { AuthPage } from "../components/account-pages";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBanner, getStoreSiteSettings } from "../lib/store-api";

export default async function LoginPage() {
  const { settings } = await getStoreSiteSettings();
  const bannerImage = getStoreBanner(settings, "Đăng nhập - Banner", "/assets/category-jewelry-final.jpg");
  return <><SiteHeader /><AuthPage mode="login" bannerImage={bannerImage} /><SiteFooter /></>;
}
