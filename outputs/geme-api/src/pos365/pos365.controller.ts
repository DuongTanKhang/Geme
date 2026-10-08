import { Controller, Get, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Pos365Service } from "./pos365.service.js";

@ApiTags("integrations")
@Controller("integrations/pos365")
export class Pos365Controller {
  constructor(private readonly pos365: Pos365Service) {}

  @Get("status")
  @ApiOperation({ summary: "Kiểm tra POS365 đã có cấu hình phía máy chủ chưa" })
  status() {
    return this.pos365.status();
  }

  @Post("test-connection")
  @ApiOperation({ summary: "Đăng nhập POS365 và kiểm tra quyền đọc chi nhánh (chỉ đọc)" })
  testConnection() {
    return this.pos365.testConnection();
  }

  @Post("sync-current-inventory")
  @ApiOperation({ summary: "Đồng bộ số tồn hiện tại sang POS365 bằng phiếu kiểm kê và xác minh SKU" })
  syncCurrentInventory() {
    return this.pos365.syncCurrentInventory();
  }

  @Post("sync-product-prices")
  @ApiOperation({ summary: "Đưa các giá bán đã cấu hình vào hàng đợi đồng bộ POS365" })
  syncProductPrices() {
    return this.pos365.queueAllProductPriceSync();
  }

  @Get("sync-summary")
  @ApiOperation({ summary: "Xem trạng thái hàng đợi đồng bộ tồn, giá và đơn hàng POS365" })
  syncSummary() {
    return this.pos365.syncQueueSummary();
  }

  @Post("sync-unsent-orders")
  @ApiOperation({ summary: "Đưa các đơn hàng chưa đồng bộ vào hàng đợi POS365" })
  syncUnsentOrders() {
    return this.pos365.queueUnsentOrders();
  }
}
