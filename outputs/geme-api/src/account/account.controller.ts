import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AegisCustomerGuard, type AegisCustomerIdentity } from "../auth/aegis-customer.guard.js";
import { CommerceService } from "../commerce/commerce.service.js";
import { onlineOrderInput, onlineOrderQuoteInput } from "../commerce/online-order-input.js";
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

  @Post("orders/quote")
  async quoteOrder(@Req() request: AuthenticatedRequest, @Body() body: Record<string, any>) {
    const customerId = await this.account.customerId(request.customerIdentity);
    return this.commerce.quoteOrder(onlineOrderQuoteInput(body), customerId);
  }

  @Get("loyalty")
  async loyalty(@Req() request: AuthenticatedRequest) {
    const customerId = await this.account.customerId(request.customerIdentity);
    return this.account.loyaltySummary(customerId);
  }

  @Post("orders/:code/qr-payment")
  async startQrPayment(@Req() request: AuthenticatedRequest, @Param("code") code: string) {
    const customerId = await this.account.customerId(request.customerIdentity);
    return this.commerce.startCustomerQrPayment(customerId, code);
  }

  @Get("favorites")
  favorites(@Req() request: AuthenticatedRequest) {
    return this.account.favorites(request.customerIdentity);
  }

  @Post("favorites")
  addFavorite(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const productId = String(body.productId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      throw new BadRequestException("Mã sản phẩm không hợp lệ.");
    }
    return this.account.addFavorite(request.customerIdentity, productId);
  }

  @Delete("favorites")
  removeFavorite(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const productId = String(body.productId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      throw new BadRequestException("Mã sản phẩm không hợp lệ.");
    }
    return this.account.removeFavorite(request.customerIdentity, productId);
  }

  @Post("orders")
  async createOrder(@Req() request: AuthenticatedRequest, @Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) {
    const customerId = await this.account.customerId(request.customerIdentity);
    return this.commerce.createOrder(onlineOrderInput(body), customerId, false, idempotencyKey);
  }
}
