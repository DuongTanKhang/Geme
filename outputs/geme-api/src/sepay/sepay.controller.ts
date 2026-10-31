import { Controller, HttpCode, Post, Req, ServiceUnavailableException, UnauthorizedException, Body } from "@nestjs/common";
import { SePayService } from "./sepay.service.js";

type SePayRequest = { rawBody?: Buffer; header(name: string): string | undefined };

@Controller("integrations/sepay")
export class SePayController {
  constructor(private readonly sepay: SePayService) {}

  @Post("webhook")
  @HttpCode(200)
  async receiveWebhook(@Req() request: SePayRequest, @Body() body: unknown) {
    const result = await this.sepay.acceptWebhook(
      request.rawBody,
      body,
      request.header("x-sepay-signature"),
      request.header("x-sepay-timestamp"),
    );
    if (result === "disabled") throw new ServiceUnavailableException("SePay webhook chưa được cấu hình.");
    if (result === "invalid-signature") throw new UnauthorizedException("Chữ ký SePay không hợp lệ.");
    if (result === "invalid-request") throw new UnauthorizedException("Yêu cầu webhook SePay không hợp lệ.");
    return { success: true };
  }
}
