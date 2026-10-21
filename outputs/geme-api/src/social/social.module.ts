import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { SocialController, SocialOAuthCallbackController } from "./social.controller.js";
import { SocialPublishQueue } from "./social.queue.js";
import { SocialService } from "./social.service.js";

@Module({ imports: [PrismaModule, MediaModule], controllers: [SocialController, SocialOAuthCallbackController], providers: [SocialService, SocialPublishQueue] })
export class SocialModule {}
