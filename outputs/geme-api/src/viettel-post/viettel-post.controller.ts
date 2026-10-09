import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ViettelPostService } from "./viettel-post.service.js";

@ApiTags("integrations")
@Controller("integrations/viettel-post")
export class ViettelPostController {
  constructor(private readonly viettelPost: ViettelPostService) {}

  @Get("status")
  @ApiOperation({ summary: "Xem Viettel Post đã được cấu hình ở backend chưa" })
  status() { return this.viettelPost.status(); }

  @Post("orders/:id/services")
  @ApiOperation({ summary: "Lấy dịch vụ và cước dự kiến cho đơn hàng" })
  services(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.viettelPost.servicesForOrder(id, body);
  }

  @Post("orders/:id/shipment")
  @ApiOperation({ summary: "Tạo vận đơn Viettel Post cho đơn hàng" })
  createShipment(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.viettelPost.createShipment(id, body);
  }

  @Post("orders/:id/print-url")
  @ApiOperation({ summary: "Tạo link in nhãn vận đơn Viettel Post" })
  printUrl(@Param("id") id: string) {
    return this.viettelPost.printUrl(id);
  }

  @Post("webhook")
  @ApiOperation({ summary: "Nhận hành trình vận đơn Viettel Post" })
  webhook(@Body() body: Record<string, any>) {
    return this.viettelPost.receiveWebhook(body);
  }
}
