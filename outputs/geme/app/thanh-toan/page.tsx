import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { StoreCheckout } from "../components/store-checkout";

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return <><SiteHeader /><StoreCheckout /><SiteFooter /></>;
}
import type { Metadata } from "next";
