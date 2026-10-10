"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { invalidateStorefrontCatalog } from "../actions/catalog-cache";
import { normalizeApiBaseUrl } from "../lib/api-base";

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");

export function CatalogLiveSync() {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const events = new EventSource(`${API_BASE}/products/events`);
    let disconnected = false;
    let categoriesChanged = false;
    let refreshPending = false;
    const scheduleRefresh = (minDelayMs: number, maxDelayMs: number) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        if (document.hidden) { refreshPending = true; return; }
        refreshPending = false;
        if (categoriesChanged) {
          window.dispatchEvent(new Event("geme:categories-changed"));
          categoriesChanged = false;
        }
        void invalidateStorefrontCatalog()
          .catch(() => undefined)
          .finally(() => router.refresh());
      }, minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)));
    };
    const refreshForMaterialChange = () => scheduleRefresh(100, 700);
    const refreshWhenVisible = () => {
      if (!document.hidden && refreshPending) scheduleRefresh(0, 0);
    };

    events.onopen = () => {
      // The initial HTML already contains the server-rendered catalogue.
      // Refresh only after a real disconnect so connecting 500 new visitors
      // does not immediately double the page's API traffic.
      if (disconnected) {
        categoriesChanged = true;
        // Spread recovery traffic across clients after a proxy/API interruption.
        scheduleRefresh(300, 2_000);
        disconnected = false;
      }
    };

    events.onerror = () => { disconnected = true; };

    events.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { entity?: string };
        if (change.entity === "ping") return;
        if (change.entity === "category") categoriesChanged = true;
      } catch { /* Ignore malformed events and still refresh the catalog. */ }
      scheduleRefresh(100, 700);
    };

    window.addEventListener("geme:catalog-changed", refreshForMaterialChange);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("geme:catalog-changed", refreshForMaterialChange);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      events.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return null;
}
