import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

type RateLimitRequest = { method: string; path: string; url?: string; ip?: string; socket: { remoteAddress?: string } };
type RateLimitResponse = {
  setHeader(name: string, value: string): unknown;
  status(code: number): RateLimitResponse;
  json(body: unknown): unknown;
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0 && trustProxyHops <= 5) {
    app.set("trust proxy", trustProxyHops);
  }

  // A generous per-client limit prevents abusive request loops while leaving
  // room for a burst of 500 shoppers behind the same NAT/proxy. For multiple
  // API replicas, enforce the same policy at the shared edge/load balancer.
  const requestsPerMinute = (name: string, fallback: number, minimum: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= minimum ? Math.min(value, 60_000) : fallback;
  };
  const readLimit = requestsPerMinute("API_READ_REQUESTS_PER_MINUTE", 30_000, 100);
  const writeLimit = requestsPerMinute("API_WRITE_REQUESTS_PER_MINUTE", 120, 20);
  const maxTrackedClients = 50_000;
  const requestWindows = new Map<string, { startedAt: number; reads: number; writes: number; adminLogins: number; guestOrders: number; accountOrders: number; contactMessages: number; sepayWebhooks: number }>();
  let requestCount = 0;
  app.use((request: RateLimitRequest, response: RateLimitResponse, next: () => void) => {
    const path = request.path || "";
    if (request.method === "OPTIONS" || path.startsWith("/api/v1/health") || (process.env.NODE_ENV !== "production" && path.startsWith("/api/v1/docs"))) {
      next();
      return;
    }

    const now = Date.now();
    requestCount++;
    if (requestCount % 1024 === 0) {
      for (const [address, entry] of requestWindows) {
        if (now - entry.startedAt >= 60_000) requestWindows.delete(address);
      }
    }
    const client = request.ip || request.socket.remoteAddress || "unknown";
    let window = requestWindows.get(client);
    if (!window || now - window.startedAt >= 60_000) {
      if (window) requestWindows.delete(client);
      if (requestWindows.size >= maxTrackedClients) {
        // The map is kept in LRU order below; evict one entry in O(1) instead
        // of scanning 50k clients on every request from a new address.
        const leastRecentlyUsed = requestWindows.keys().next().value;
        if (leastRecentlyUsed !== undefined) requestWindows.delete(leastRecentlyUsed);
      }
      window = { startedAt: now, reads: 0, writes: 0, adminLogins: 0, guestOrders: 0, accountOrders: 0, contactMessages: 0, sepayWebhooks: 0 };
      requestWindows.set(client, window);
    } else {
      // Keep the least-recently-used client first so the table remains bounded
      // even when a caller changes source IPs rapidly.
      requestWindows.delete(client);
      requestWindows.set(client, window);
    }

    const isRead = request.method === "GET" || request.method === "HEAD";
    const isAdminLogin = request.method === "POST" && path === "/api/v1/admin/auth/login";
    const isGuestOrder = request.method === "POST" && path === "/api/v1/orders";
    const isAccountOrder = request.method === "POST" && path === "/api/v1/account/orders";
    const isContactMessage = request.method === "POST" && path === "/api/v1/contact";
    const isSepayWebhook = request.method === "POST" && path === "/api/v1/integrations/sepay/webhook";
    const count = isAdminLogin ? ++window.adminLogins : isGuestOrder ? ++window.guestOrders : isAccountOrder ? ++window.accountOrders : isContactMessage ? ++window.contactMessages : isSepayWebhook ? ++window.sepayWebhooks : isRead ? ++window.reads : ++window.writes;
    const limit = isAdminLogin ? 10 : isGuestOrder ? 5 : isAccountOrder ? 600 : isContactMessage ? 5 : isSepayWebhook ? 1200 : isRead ? readLimit : writeLimit;
    if (count > limit) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.startedAt + 60_000 - now) / 1000))));
      response.status(429).json({ statusCode: 429, message: "Có quá nhiều yêu cầu từ kết nối này. Vui lòng thử lại sau." });
      return;
    }

    next();
  });

  // Apply limits before parsing request bodies so rejected traffic cannot
  // consume JSON parser memory or CPU first.
  app.useBodyParser("json", {
    limit: "12mb",
    verify: (request, _response, buffer) => {
      const requestPath = String(request.url ?? "").split("?", 1)[0];
      if (requestPath === "/api/v1/integrations/sepay/webhook") {
        (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    },
  });
  app.useBodyParser("urlencoded", { extended: true, limit: "12mb" });

  const configuredOrigins = process.env.CORS_ORIGINS?.trim();
  if (process.env.NODE_ENV === "production" && !configuredOrigins) {
    throw new Error("CORS_ORIGINS must list the exact storefront and admin origins in production.");
  }
  const origins = (configuredOrigins ?? "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production") {
    if (!origins.length || origins.includes("*") || origins.some((origin) => {
      try { return new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin; }
      catch { return true; }
    })) throw new Error("Production CORS_ORIGINS entries must be exact HTTPS origins without wildcards or paths.");
    if (Buffer.byteLength(process.env.ADMIN_AUTH_JWT_SECRET?.trim() ?? "", "utf8") < 32) {
      throw new Error("ADMIN_AUTH_JWT_SECRET must contain at least 32 bytes in production.");
    }
  }

  app.use(helmet());
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: true }));

  if (process.env.NODE_ENV !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("GEME API").setDescription("API cho storefront và trang quản trị GEME").setVersion("1").build(),
    );
    SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
