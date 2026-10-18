import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module.js";
import { AegisCustomerGuard } from "../auth/aegis-customer.guard.js";
import { AccountController } from "./account.controller.js";
import { AccountService } from "./account.service.js";
import { MediaModule } from "../media/media.module.js";

@Module({
  imports: [CommerceModule, MediaModule],
  controllers: [AccountController],
  providers: [AccountService, AegisCustomerGuard],
})
export class AccountModule {}


