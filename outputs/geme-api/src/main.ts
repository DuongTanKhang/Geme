import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { RequestRateLimitService } from "./security/request-rate-limit.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0 && trustProxyHops <= 5) {
    app.set("trust proxy", trustProxyHops);
  }

  app.enableShutdownHooks();
  app.use(app.get(RequestRateLimitService).middleware);

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
