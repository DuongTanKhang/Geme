import { Module } from "@nestjs/common";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";
import { Pos365Module } from "../pos365/pos365.module.js";
import { MediaModule } from "../media/media.module.js";
import { OperationsController } from "../operations/operations.controller.js";
import { OperationsService } from "../operations/operations.service.js";
import { NewArrivalsController } from "./new-arrivals.controller.js";
import { NewArrivalsService } from "./new-arrivals.service.js";
import { SePayBankAccountService } from "../sepay/sepay-bank-account.service.js";

@Module({ imports: [Pos365Module, MediaModule], controllers: [CommerceController, NewArrivalsController, OperationsController], providers: [CommerceService, NewArrivalsService, OperationsService, SePayBankAccountService], exports: [CommerceService, NewArrivalsService, SePayBankAccountService] })
export class CommerceModule {}

