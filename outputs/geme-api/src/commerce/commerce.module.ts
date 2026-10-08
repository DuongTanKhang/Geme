import { Module } from "@nestjs/common";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";
import { Pos365Module } from "../pos365/pos365.module.js";

@Module({ imports: [Pos365Module], controllers: [CommerceController], providers: [CommerceService], exports: [CommerceService] })
export class CommerceModule {}

