import { AuthPage } from "../components/account-pages";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export default function RegisterPage() {
  return <><SiteHeader /><AuthPage mode="register" /><SiteFooter /></>;
}
