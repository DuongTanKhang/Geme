import { HttpException, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { catchError, from, mergeMap, throwError, type Observable } from "rxjs";
import type { AdminIdentity } from "./admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

type AdminAuditRequest = {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
  path?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  adminIdentity?: AdminIdentity;
};
type AuditResponse = { statusCode?: number; setHeader(name: string, value: string): void };

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AdminAuditRequest>();
    const method = String(request.method || "").toUpperCase();
    const identity = request.adminIdentity;
    if (!identity || !["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next.handle();

    const incoming = request.headers?.["x-request-id"];
    const correlationId = typeof incoming === "string" && /^[A-Za-z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID();
    identity.correlationId = correlationId;
    const response = context.switchToHttp().getResponse<AuditResponse>();
    response.setHeader("X-Request-ID", correlationId);

    const route = String(request.route?.path || `${request.baseUrl || ""}${request.path || ""}`).replace(/[^A-Za-z0-9_/:.{}-]/g, "").slice(0, 80);
    const entityId = ["id", "orderId", "batchId", "draftId", "taskId"].map((key) => request.params?.[key]).find((value) => typeof value === "string");
    const record = async (statusCode: number, outcome: "SUCCEEDED" | "FAILED") => {
      try {
        await this.prisma.auditLog.create({ data: {
          adminId: identity.id,
          correlationId,
          action: `ADMIN_API_${method}_${outcome}`,
          entityType: route || "UNKNOWN_ROUTE",
          entityId: typeof entityId === "string" ? entityId.slice(0, 80) : null,
          after: { method, statusCode, outcome },
        } });
      } catch (error) {
        this.logger.warn(`Không ghi được audit cho ${method} ${route}: ${error instanceof Error ? error.name : "UNKNOWN"}`);
      }
    };
    return next.handle().pipe(
      mergeMap(async (result) => {
        await record(Number(response.statusCode) || 200, "SUCCEEDED");
        return result;
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : Number(response.statusCode) || 500;
        return from(record(statusCode, "FAILED")).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }
}
