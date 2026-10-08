"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { normalizeApiBaseUrl } from "../lib/api-base";

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");

export function CatalogLiveSync() {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const events = new EventSource(`${API_BASE}/products/events`);

    events.onopen = () => {
      // Also recover pages rendered while the API was temporarily unavailable.
      // EventSource reconnects automatically after network failures.
      router.refresh();
      window.dispatchEvent(new Event("geme:categories-changed"));
    };

    events.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { entity?: string };
        if (change.entity === "category") window.dispatchEvent(new Event("geme:categories-changed"));
      } catch { /* Ignore malformed events and still refresh the catalog. */ }
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 120);
    };

    return () => {
      events.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return null;
}
