import { Injectable, UnauthorizedException } from "@nestjs/common";
import { compare } from "bcryptjs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const DEVELOPMENT_SECRET = randomBytes(48).toString("base64url");

export type AdminIdentity = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

type AdminTokenPayload = AdminIdentity & { sub: string; iat: number; exp: number; iss: "geme-admin" };

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(emailInput: unknown, passwordInput: unknown) {
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase().slice(0, 320) : "";
    const password = typeof passwordInput === "string" ? passwordInput : "";
    if (!email || !password || password.length > 256) throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");

    const admin = await this.prisma.adminUser.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, displayName: true, role: true, isActive: true, lockedUntil: true },
    });
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }
    const matches = admin?.isActive ? await compare(password, admin.passwordHash) : false;
    if (!admin || !admin.isActive || !matches) {
      if (admin?.isActive) await this.recordFailedLogin(admin.id);
      throw new UnauthorizedException("Email hoặc mật khẩu không đúng.");
    }
    const identity: AdminIdentity = { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role };
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    return { accessToken: this.sign(identity), expiresIn: TOKEN_LIFETIME_SECONDS, admin: identity };
  }

  async authenticateAuthorization(value: unknown): Promise<AdminIdentity | null> {
    if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
    const token = value.slice(7).trim();
    const payload = this.verify(token);
    if (!payload) return null;

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, role: true, isActive: true },
    });
    if (!admin?.isActive || admin.email !== payload.email || admin.role !== payload.role) return null;
    return { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role };
  }

  private sign(identity: AdminIdentity) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: "HS256", typ: "JWT" });
    const payload = this.encode({ ...identity, sub: identity.id, iat: issuedAt, exp: issuedAt + TOKEN_LIFETIME_SECONDS, iss: "geme-admin" });
    const input = `${header}.${payload}`;
    return `${input}.${this.signature(input)}`;
  }

  private verify(token: string): AdminTokenPayload | null {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, suppliedSignature] = parts;
    if (!headerPart || !payloadPart || !suppliedSignature) return null;
    const expectedSignature = this.signature(`${headerPart}.${payloadPart}`);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    try {
      const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string; typ?: string };
      const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<AdminTokenPayload>;
      const now = Math.floor(Date.now() / 1000);
      if (header.alg !== "HS256" || header.typ !== "JWT" || payload.iss !== "geme-admin"
        || typeof payload.sub !== "string" || typeof payload.email !== "string"
        || typeof payload.displayName !== "string" || typeof payload.role !== "string"
        || typeof payload.exp !== "number" || payload.exp <= now
        || typeof payload.iat !== "number" || payload.iat > now + 30
        || !["SUPER_ADMIN", "ADMIN", "CONTENT_EDITOR"].includes(payload.role)) return null;
      return payload as AdminTokenPayload;
    } catch {
      return null;
    }
  }

  private signature(value: string) {
    return createHmac("sha256", this.secret()).update(value).digest("base64url");
  }

  private async recordFailedLogin(adminId: string) {
    await this.prisma.$executeRaw`
      UPDATE "admin_users"
      SET "failed_login_attempts" = "failed_login_attempts" + 1,
          "locked_until" = CASE
            WHEN "failed_login_attempts" + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
            ELSE "locked_until"
          END,
          "updated_at" = NOW()
      WHERE "id" = ${adminId}::uuid AND "is_active" = true
    `;
  }

  private secret() {
    const configured = process.env.ADMIN_AUTH_JWT_SECRET?.trim();
    if (configured && Buffer.byteLength(configured, "utf8") >= 32) return configured;
    if (process.env.NODE_ENV !== "production") return DEVELOPMENT_SECRET;
    throw new Error("ADMIN_AUTH_JWT_SECRET must contain at least 32 bytes in production.");
  }

  private encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
}
