import { Module } from "@nestjs/common";
import { Pos365Module } from "../pos365/pos365.module.js";
import { ViettelPostController } from "./viettel-post.controller.js";
import { ViettelPostService } from "./viettel-post.service.js";

@Module({
  imports: [Pos365Module],
  controllers: [ViettelPostController],
  providers: [ViettelPostService],
})
export class ViettelPostModule {}
