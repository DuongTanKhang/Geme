import { Module } from "@nestjs/common";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";
import { Pos365Module } from "../pos365/pos365.module.js";
import { MediaModule } from "../media/media.module.js";
import { OperationsController } from "../operations/operations.controller.js";
import { OperationsService } from "../operations/operations.service.js";

@Module({ imports: [Pos365Module, MediaModule], controllers: [CommerceController, OperationsController], providers: [CommerceService, OperationsService], exports: [CommerceService] })
export class CommerceModule {}

