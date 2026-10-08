import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  @ApiOperation({ summary: "Kiểm tra API còn hoạt động" })
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Kiểm tra API kết nối được PostgreSQL" })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "connected" };
    } catch (error) {
      this.logger.error("PostgreSQL readiness query failed", error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException({ status: "unavailable", database: "disconnected" });
    }
  }
}
