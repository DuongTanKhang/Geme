import { Module } from "@nestjs/common";
import { AdminCalendarController } from "./admin-calendar.controller.js";
import { AdminCalendarService } from "./admin-calendar.service.js";

@Module({ controllers: [AdminCalendarController], providers: [AdminCalendarService] })
export class AdminCalendarModule {}
