import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

type RateLimitRequest = { method: string; path: string; ip?: string; socket: { remoteAddress?: string } };
type RateLimitResponse = {
  setHeader(name: string, value: string): unknown;
  status(code: number): RateLimitResponse;
  json(body: unknown): unknown;
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: "12mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "12mb" });
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
  const requestWindows = new Map<string, { startedAt: number; reads: number; writes: number }>();
  let requestCount = 0;
  app.use((request: RateLimitRequest, response: RateLimitResponse, next: () => void) => {
    const path = request.path || "";
    if (request.method === "OPTIONS" || path.startsWith("/api/v1/health") || path.startsWith("/api/v1/docs")) {
      next();
      return;
    }

    const now = Date.now();
    const client = request.ip || request.socket.remoteAddress || "unknown";
    let window = requestWindows.get(client);
    if (!window || now - window.startedAt >= 60_000) {
      window = { startedAt: now, reads: 0, writes: 0 };
      requestWindows.set(client, window);
    }

    const isRead = request.method === "GET" || request.method === "HEAD";
    const count = isRead ? ++window.reads : ++window.writes;
    const limit = isRead ? readLimit : writeLimit;
    if (count > limit) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.startedAt + 60_000 - now) / 1000))));
      response.status(429).json({ statusCode: 429, message: "Có quá nhiều yêu cầu từ kết nối này. Vui lòng thử lại sau." });
      return;
    }

    requestCount++;
    if (requestCount % 1024 === 0) {
      for (const [address, entry] of requestWindows) {
        if (now - entry.startedAt >= 120_000) requestWindows.delete(address);
      }
    }
    next();
  });

  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: true }));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle("GEME API").setDescription("API cho storefront và trang quản trị GEME").setVersion("1").build(),
  );
  SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
