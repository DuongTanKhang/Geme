import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module.js";
import { AegisCustomerGuard } from "../auth/aegis-customer.guard.js";
import { AccountController } from "./account.controller.js";
import { AccountService } from "./account.service.js";

@Module({
  imports: [CommerceModule],
  controllers: [AccountController],
  providers: [AccountService, AegisCustomerGuard],
})
export class AccountModule {}


