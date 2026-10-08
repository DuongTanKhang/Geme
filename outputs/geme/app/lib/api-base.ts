/** Normalize host-side localhost API URLs to IPv4 for consistent Docker Desktop routing. */
export function normalizeApiBaseUrl(value: string): string {
  return value
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1")
    .replace(/\/$/, "");
}
