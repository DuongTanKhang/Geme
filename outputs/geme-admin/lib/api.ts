export function normalizeApiBaseUrl(value: string): string {
  return value.replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1").replace(/\/$/, "");
}

export const apiBaseUrl = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");

/** Shared HTTP boundary for the future NestJS service. Keep auth secrets server-side. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${path.replace(/^\//, "")}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`API trả về lỗi ${response.status}.`);
  return response.json() as Promise<T>;
}
