import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { RequireAdminPermissions } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { OperationsService } from "./operations.service.js";

type AdminRequest = { adminIdentity: AdminIdentity };

@Controller()
@UseGuards(AdminAuthGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("operations/dashboard")
  @RequireAdminPermissions("dashboard.read")
  dashboard() { return this.operations.dashboard(); }

  @Get("returns")
  @RequireAdminPermissions("returns.read")
  returns(@Query("limit") limit?: string) { return this.operations.listReturns(limit); }

  @Get("operations/return-eligible-orders")
  @RequireAdminPermissions("returns.read")
  returnEligibleOrders(@Query("limit") limit?: string) { return this.operations.returnEligibleOrders(limit); }

  @Get("operations/cod-eligible-orders")
  @RequireAdminPermissions("finance.read")
  codEligibleOrders(@Query("limit") limit?: string) { return this.operations.codEligibleOrders(limit); }

  @Post("orders/:orderId/returns")
  @RequireAdminPermissions("returns.manage")
  createReturn(@Param("orderId") orderId: string, @Req() request: AdminRequest, @Body() body: Record<string, any>) {
    return this.operations.createReturn(orderId, request.adminIdentity, body);
  }

  @Patch("returns/:id/status")
  @RequireAdminPermissions("returns.manage")
  updateReturn(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, any>) {
    return this.operations.updateReturnStatus(id, request.adminIdentity, body);
  }

  @Post("returns/:id/refunds")
  @RequireAdminPermissions("finance.manage")
  refund(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, any>) {
    return this.operations.recordRefund(id, request.adminIdentity, body);
  }

  @Get("cod-reconciliations")
  @RequireAdminPermissions("finance.read")
  codReconciliations(@Query("limit") limit?: string) { return this.operations.listCodReconciliations(limit); }

  @Post("cod-reconciliations")
  @RequireAdminPermissions("finance.manage")
  createCodReconciliation(@Req() request: AdminRequest, @Body() body: Record<string, any>) {
    return this.operations.createCodReconciliation(request.adminIdentity, body);
  }

  @Post("cod-reconciliations/:id/reconcile")
  @RequireAdminPermissions("finance.manage")
  reconcileCod(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, any>) {
    return this.operations.reconcileCod(id, request.adminIdentity, body);
  }

  @Get("audit-logs")
  @RequireAdminPermissions("audit.read")
  auditLogs(@Query() query: Record<string, any>) { return this.operations.auditLogs(query); }
}
