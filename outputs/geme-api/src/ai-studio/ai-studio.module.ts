import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module.js";
import { MediaModule } from "../media/media.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AiImageStudioService } from "./ai-image-studio.service.js";
import { AiProductAgentService } from "./ai-product-agent.service.js";
import { AiPhaseFourService } from "./ai-phase-four.service.js";
import { AiStudioController } from "./ai-studio.controller.js";
import { AiStudioQueue } from "./ai-studio.queue.js";
import { AiStudioService } from "./ai-studio.service.js";

@Module({ imports: [PrismaModule, MediaModule, CommerceModule], controllers: [AiStudioController], providers: [AiStudioService, AiImageStudioService, AiProductAgentService, AiPhaseFourService, AiStudioQueue] })
export class AiStudioModule {}
