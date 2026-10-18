// Admin API traffic stays same-origin so its HttpOnly session cookie can be
// exchanged for a backend bearer token by the server-side Route Handler.
export const apiBaseUrl = "/api/admin";

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
