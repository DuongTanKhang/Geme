"use client";

import { normalizeApiBaseUrl } from "./api-base";

const SESSION_KEY = "geme-marketing-session-v1";
const VISITOR_KEY = "geme-marketing-visitor-v1";
const SESSION_COOKIE = "geme_mkt_session";
const SESSION_TTL = 30 * 60 * 1000;

type StoredSession = { id: string; lastSeenAt: number; lastPath?: string; lastTrackedAt?: number; source?: string; medium?: string; campaign?: string; referrer?: string };

function uuid() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
}

export function getMarketingSessionId() {
  if (typeof window === "undefined") return "";
  const now = Date.now();
  let session: StoredSession | null = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as StoredSession | null; } catch { session = null; }
  if (!session || !/^[0-9a-f-]{36}$/i.test(session.id) || now - Number(session.lastSeenAt || 0) > SESSION_TTL) {
    const id = uuid();
    if (!id) return "";
    session = { id, lastSeenAt: now };
  } else {
    session.lastSeenAt = now;
  }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Analytics is optional when browser storage is disabled. */ }
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.id)}; Path=/; Max-Age=1800; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return session.id;
}

function getVisitorId() {
  try {
    let visitorId = localStorage.getItem(VISITOR_KEY) || "";
    if (!/^[0-9a-f-]{36}$/i.test(visitorId)) visitorId = uuid();
    if (visitorId) localStorage.setItem(VISITOR_KEY, visitorId);
    return visitorId;
  } catch { return uuid(); }
}

export async function trackMarketingPageView(pathname: string, options: { ensure?: boolean } = {}) {
  if (typeof window === "undefined" || !pathname.startsWith("/")) return false;
  const sessionId = getMarketingSessionId();
  if (!sessionId) return false;
  let session: StoredSession;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}") as StoredSession; } catch { return false; }
  const alreadyTracked = session.lastPath === pathname && Date.now() - Number(session.lastTrackedAt || 0) < 2000;
  if (alreadyTracked && !options.ensure) return true;
  const visitorId = getVisitorId();
  if (!visitorId) return false;
  const hasPreviousPath = Boolean(session.lastPath);

  if (!session.source && !session.medium && !session.campaign && !session.referrer) {
    const query = new URLSearchParams(location.search);
    session.source = query.get("utm_source") || (query.has("gclid") ? "google" : query.has("fbclid") ? "facebook" : "");
    session.medium = query.get("utm_medium") || (query.has("gclid") ? "cpc" : query.has("fbclid") ? "social" : "");
    session.campaign = query.get("utm_campaign") || "";
    try {
      if (document.referrer) {
        const referrerUrl = new URL(document.referrer);
        if (referrerUrl.origin !== location.origin) session.referrer = referrerUrl.origin;
      }
    } catch { session.referrer = ""; }
  }
  session.lastPath = pathname;
  session.lastTrackedAt = Date.now();
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Tracking should not interrupt shopping. */ }

  const apiBase = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
  try {
    const response = await fetch(`${apiBase}/marketing/page-view`, {
      method: "POST", keepalive: true, credentials: "omit", signal: AbortSignal.timeout(options.ensure ? 1200 : 4000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, visitorId, path: pathname, source: session.source, medium: session.medium, campaign: session.campaign, referrer: session.referrer, touchOnly: Boolean(options.ensure && hasPreviousPath) }),
    });
    return response.ok;
  } catch { return false; }
}

export async function trackMarketingCartAdd() {
  if (typeof window === "undefined") return false;
  await trackMarketingPageView(window.location.pathname, { ensure: true });
  const sessionId = getMarketingSessionId();
  if (!sessionId) return false;
  const apiBase = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
  try {
    const response = await fetch(`${apiBase}/marketing/cart-add`, {
      method: "POST", keepalive: true, credentials: "omit", signal: AbortSignal.timeout(2500),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }),
    });
    return response.ok;
  } catch { return false; }
}
