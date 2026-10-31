import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module.js";
import { SePayController } from "./sepay.controller.js";
import { SePayService } from "./sepay.service.js";

@Module({
  imports: [CommerceModule],
  controllers: [SePayController],
  providers: [SePayService],
})
export class SePayModule {}
