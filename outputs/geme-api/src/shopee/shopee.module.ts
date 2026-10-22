import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { ShopeeAdminController, ShopeeOAuthCallbackController } from "./shopee.controller.js";
import { ShopeeSyncQueue } from "./shopee.queue.js";
import { ShopeeService } from "./shopee.service.js";

@Module({ imports: [PrismaModule], controllers: [ShopeeAdminController, ShopeeOAuthCallbackController], providers: [ShopeeService, ShopeeSyncQueue] })
export class ShopeeModule {}
