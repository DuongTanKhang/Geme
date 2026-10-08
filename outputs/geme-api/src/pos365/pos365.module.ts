import { Module } from "@nestjs/common";
import { Pos365Controller } from "./pos365.controller.js";
import { Pos365Service } from "./pos365.service.js";

@Module({
  controllers: [Pos365Controller],
  providers: [Pos365Service],
  exports: [Pos365Service],
})
export class Pos365Module {}
