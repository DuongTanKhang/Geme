import { RequestRateLimitModule } from "./security/request-rate-limit.module.js";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccountModule } from "./account/account.module.js";
import { HealthModule } from "./health/health.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { MaterialsModule } from "./materials/materials.module.js";
import { CommerceModule } from "./commerce/commerce.module.js";
import { Pos365Module } from "./pos365/pos365.module.js";
import { ViettelPostModule } from "./viettel-post/viettel-post.module.js";
import { AdminAuthModule } from "./admin-auth/admin-auth.module.js";
import { SocialModule } from "./social/social.module.js";
import { ShopeeModule } from "./shopee/shopee.module.js";
import { ContactModule } from "./contact/contact.module.js";
import { SePayModule } from "./sepay/sepay.module.js";
import { AdminCalendarModule } from "./admin-calendar/admin-calendar.module.js";
import { GmailModule } from "./gmail/gmail.module.js";
import { MarketingModule } from "./marketing/marketing.module.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RequestRateLimitModule, PrismaModule, AdminAuthModule, AdminCalendarModule, MarketingModule, GmailModule, SocialModule, ShopeeModule, ContactModule, SePayModule, HealthModule, MaterialsModule, CommerceModule, AccountModule, Pos365Module, ViettelPostModule],
})
export class AppModule {}
