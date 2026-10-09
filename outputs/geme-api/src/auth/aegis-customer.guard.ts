import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";

export type AegisCustomerIdentity = {
  id: string;
  name: string;
  email: string;
  emailVerified: true;
};

type CustomerRequest = {
  headers: { authorization?: string };
  customerIdentity?: AegisCustomerIdentity;
};

// Several storefront requests (header, account, orders, favorites) can arrive
// together when a customer changes pages. Coalesce those checks and briefly
// reuse only identities that Aegis has already verified. Cache keys are hashes
// so bearer tokens are never retained as map keys or logged.
const verifiedIdentityCache = new Map<string, { identity: AegisCustomerIdentity; expiresAt: number }>();
const pendingIdentityChecks = new Map<string, Promise<AegisCustomerIdentity>>();
const VERIFIED_IDENTITY_TTL_MS = 3_000;
const VERIFIED_IDENTITY_CACHE_LIMIT = 5_000;
let cacheSweepCounter = 0;

function jwtExpiryMs(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

@Injectable()
export class AegisCustomerGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Đăng nhập để tiếp tục.");
    }

    const token = authorization.slice("Bearer ".length).trim();
    const cacheKey = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const cached = verifiedIdentityCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      request.customerIdentity = cached.identity;
      return true;
    }
    if (cached) verifiedIdentityCache.delete(cacheKey);

    // Clear expired entries periodically and bound memory if many customers are
    // active in the same API process.
    if (++cacheSweepCounter % 128 === 0) {
      for (const [key, entry] of verifiedIdentityCache) {
        if (entry.expiresAt <= now) verifiedIdentityCache.delete(key);
      }
    }

    let identityCheck = pendingIdentityChecks.get(cacheKey);
    if (!identityCheck) {
      identityCheck = this.fetchVerifiedIdentity(authorization);
      pendingIdentityChecks.set(cacheKey, identityCheck);
    }
    try {
      const identity = await identityCheck;
      request.customerIdentity = identity;
      return true;
    } finally {
      if (pendingIdentityChecks.get(cacheKey) === identityCheck) pendingIdentityChecks.delete(cacheKey);
    }
  }

  private async fetchVerifiedIdentity(authorization: string): Promise<AegisCustomerIdentity> {
    const token = authorization.slice("Bearer ".length).trim();

    const configuredBaseUrl = process.env.AEGIS_AUTH_API_URL?.trim().replace(/\/+$/, "");
    const baseUrl = configuredBaseUrl
      || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:5130");
    if (!baseUrl) {
      throw new ServiceUnavailableException("Chưa cấu hình dịch vụ xác thực.");
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/auth/me`, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException("Không thể kết nối dịch vụ xác thực.");
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("Phiên đăng nhập đã hết hạn.");
    }
    if (response.status === 429) {
      throw new HttpException("Dịch vụ xác thực đang bận. Vui lòng thử lại sau ít phút.", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Dịch vụ xác thực đang gặp sự cố.");
    }

    const identity = await response.json() as Partial<AegisCustomerIdentity>;
    if (
      typeof identity.id !== "string"
      || typeof identity.email !== "string"
      || typeof identity.name !== "string"
      || identity.emailVerified !== true
    ) {
      throw new UnauthorizedException("Tài khoản chưa được xác minh.");
    }

    const verifiedIdentity = identity as AegisCustomerIdentity;
    const expiresAt = Math.min(Date.now() + VERIFIED_IDENTITY_TTL_MS, jwtExpiryMs(token));
    if (expiresAt > Date.now()) {
      verifiedIdentityCache.set(createHash("sha256").update(token).digest("hex"), { identity: verifiedIdentity, expiresAt });
      while (verifiedIdentityCache.size > VERIFIED_IDENTITY_CACHE_LIMIT) {
        const oldestKey = verifiedIdentityCache.keys().next().value;
        if (!oldestKey) break;
        verifiedIdentityCache.delete(oldestKey);
      }
    }
    return verifiedIdentity;
  }
}
