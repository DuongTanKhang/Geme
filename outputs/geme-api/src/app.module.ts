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
import { AiStudioModule } from "./ai-studio/ai-studio.module.js";
import { SocialModule } from "./social/social.module.js";
import { ShopeeModule } from "./shopee/shopee.module.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AdminAuthModule, AiStudioModule, SocialModule, ShopeeModule, HealthModule, MaterialsModule, CommerceModule, AccountModule, Pos365Module, ViettelPostModule],
})
export class AppModule {}
