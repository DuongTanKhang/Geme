"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackMarketingPageView } from "../lib/marketing-tracking";

export function MarketingTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) trackMarketingPageView(pathname);
  }, [pathname]);
  return null;
}
