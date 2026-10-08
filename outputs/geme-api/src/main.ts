import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: "12mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "12mb" });
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
