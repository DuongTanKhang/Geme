import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Thiếu DATABASE_URL. Hãy tạo file .env từ .env.example và cấu hình PostgreSQL.");
    }
    const configuredPoolMax = Number(process.env.DB_POOL_MAX);
    const poolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax >= 5 && configuredPoolMax <= 80
      ? configuredPoolMax
      : 20;
    super({ adapter: new PrismaPg({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
