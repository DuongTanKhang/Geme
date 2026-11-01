import { createHash } from "node:crypto";

export type RateRequest = { method: string; path: string; ip?: string; socket: { remoteAddress?: string } };
export type RatePolicy = { bucket: string; limit: number; read: boolean };
export type RateResult = { allowed: boolean; retryAfter: number };
export type RateResponse = { setHeader(name: string, value: string): unknown; status(code: number): RateResponse; json(body: unknown): unknown };

export function ratePolicy(request: RateRequest, readLimit = 30_000, writeLimit = 120): RatePolicy | null {
  const method = request.method.toUpperCase();
  // Express routes are case insensitive and accept trailing slashes.
  const path = request.path.toLowerCase().replace(/\/+$/, "");
  const read = method === "GET" || method === "HEAD";
  if (method === "OPTIONS" || (read && /^\/api\/v1\/health\/(live|ready)$/.test(path))) return null;
  const special: Record<string, [string, number]> = {
    "/api/v1/admin/auth/login": ["admin-login", 10],
    "/api/v1/orders": ["guest-order", 5],
    "/api/v1/account/orders": ["account-order", 600],
    "/api/v1/contact": ["contact", 5],
    "/api/v1/integrations/sepay/webhook": ["sepay-webhook", 1200],
  };
  const selected = method === "POST" ? special[path] : undefined;
  return selected ? { bucket: selected[0], limit: selected[1], read: false }
    : { bucket: read ? "read" : "write", limit: read ? readLimit : writeLimit, read };
}

// One atomic operation shared by every API replica; expiry is never extended
// by later traffic. Redis keys contain a hashed client address, not a raw IP.
export const RATE_LIMIT_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count <= tonumber(ARGV[1]) then count = redis.call('INCR', KEYS[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], 60000); ttl = 60000 end
return {count, ttl}
`;

export interface RateStore { consume(key: string, limit: number): Promise<RateResult> }

export class MemoryRateStore implements RateStore {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now = Date.now, private readonly maximum = 50_000) {}
  async consume(key: string, limit: number): Promise<RateResult> {
    const now = this.now();
    let entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + 60_000 };
    entry.count = Math.min(entry.count + 1, limit + 1);
    if (this.entries.size >= this.maximum) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, entry);
    return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) };
  }
}

export function rateLimitMiddleware(store: RateStore, options: {
  readLimit?: number; writeLimit?: number; prefix?: string;
  onUnavailable?: () => void; readFallback?: RateStore;
} = {}) {
  return async (request: RateRequest, response: RateResponse, next: () => void) => {
    const policy = ratePolicy(request, options.readLimit, options.writeLimit);
    if (!policy) { next(); return; }
    // Only Express's trusted-proxy resolution is used, never raw X-Forwarded-For.
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const digest = createHash("sha256").update(address).digest("hex");
    const key = `${options.prefix || "geme:rate-limit:v1"}:${policy.bucket}:${digest}`;
    let result: RateResult;
    try { result = await store.consume(key, policy.limit); }
    catch {
      options.onUnavailable?.();
      if (policy.read && options.readFallback) result = await options.readFallback.consume(key, policy.limit);
      else {
        response.setHeader("Retry-After", "5");
        response.status(503).json({ statusCode: 503, message: "Hệ thống tạm bận. Vui lòng thử lại sau." });
        return;
      }
    }
    if (!result.allowed) {
      response.setHeader("Retry-After", String(result.retryAfter));
      response.status(429).json({ statusCode: 429, message: "Có quá nhiều yêu cầu từ kết nối này. Vui lòng thử lại sau." });
      return;
    }
    next();
  };
}
