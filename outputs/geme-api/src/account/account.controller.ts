import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AegisCustomerGuard, type AegisCustomerIdentity } from "../auth/aegis-customer.guard.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { AccountService } from "./account.service.js";

type AuthenticatedRequest = { customerIdentity: AegisCustomerIdentity };

@Controller("account")
@UseGuards(AegisCustomerGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly commerce: CommerceService,
  ) {}

  @Get("me")
  profile(@Req() request: AuthenticatedRequest) {
    return this.account.profile(request.customerIdentity);
  }

  @Patch("me")
  updateProfile(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.account.updateProfile(request.customerIdentity, body);
  }

  @Get("orders")
  orders(@Req() request: AuthenticatedRequest) {
    return this.account.orders(request.customerIdentity);
  }

  @Post("orders")
  async createOrder(@Req() request: AuthenticatedRequest, @Body() body: Record<string, any>) {
    const customerId = await this.account.customerId(request.customerIdentity);
    return this.commerce.createOrder(body, customerId);
  }
}
