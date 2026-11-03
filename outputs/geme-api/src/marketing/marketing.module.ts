import { Module } from "@nestjs/common";
import { MarketingService } from "./marketing.service.js";
import { AdminMarketingController, PublicMarketingController } from "./marketing.controller.js";

@Module({ controllers: [PublicMarketingController, AdminMarketingController], providers: [MarketingService] })
export class MarketingModule {}
