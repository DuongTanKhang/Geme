import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";

const VN_TZ = "Asia/Ho_Chi_Minh";
type EventInput = { title: string; description: string | null; location: string | null; startsAt: Date; endsAt: Date; allDay: boolean };

function dateValue(value: unknown, field: string) {
  if (typeof value !== "string" || value.length > 40) throw new BadRequestException(`${field} chưa hợp lệ.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} chưa hợp lệ.`);
  return date;
}

function eventInput(body: Record<string, unknown>): EventInput {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  if (title.length < 2 || title.length > 160) throw new BadRequestException("Tên sự kiện phải từ 2 đến 160 ký tự.");
  if (description.length > 2000) throw new BadRequestException("Mô tả sự kiện tối đa 2.000 ký tự.");
  if (location.length > 160) throw new BadRequestException("Địa điểm tối đa 160 ký tự.");
  const startsAt = dateValue(body.startsAt, "Thời gian bắt đầu");
  const endsAt = dateValue(body.endsAt, "Thời gian kết thúc");
  if (endsAt <= startsAt) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86400000) throw new BadRequestException("Một sự kiện không thể kéo dài quá 31 ngày.");
  return { title, description: description || null, location: location || null, startsAt, endsAt, allDay: body.allDay === true };
}

function todayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  const midnightUtc = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))) - 7 * 60 * 60 * 1000;
  return { from: new Date(midnightUtc), to: new Date(midnightUtc + 86400000), date: `${part("year")}-${part("month")}-${part("day")}` };
}

@Injectable()
export class AdminCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async today() {
    const window = todayWindow();
    const events = await this.prisma.adminCalendarEvent.findMany({
      where: { startsAt: { lt: window.to }, endsAt: { gte: window.from } },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
    return { date: window.date, timeZone: VN_TZ, events };
  }

  async list(fromValue?: string, toValue?: string) {
    if (!fromValue || !toValue) throw new BadRequestException("Cần truyền khoảng thời gian from và to.");
    const from = dateValue(fromValue, "Ngày bắt đầu");
    const to = dateValue(toValue, "Ngày kết thúc");
    if (to <= from || to.getTime() - from.getTime() > 62 * 86400000) throw new BadRequestException("Khoảng xem lịch phải từ 1 đến 62 ngày.");
    return this.prisma.adminCalendarEvent.findMany({
      where: { startsAt: { lt: to }, endsAt: { gte: from } },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
  }

  async create(actor: AdminIdentity, body: Record<string, unknown>) {
    const input = eventInput(body);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.adminCalendarEvent.create({ data: { ...input, createdByAdminId: actor.id } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "ADMIN_CALENDAR_EVENT_CREATED", entityType: "ADMIN_CALENDAR_EVENT", entityId: created.id, after: input as any } });
      return created;
    });
  }

  async update(id: string, actor: AdminIdentity, body: Record<string, unknown>) {
    const input = eventInput(body);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.adminCalendarEvent.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy sự kiện.");
      const updated = await tx.adminCalendarEvent.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "ADMIN_CALENDAR_EVENT_UPDATED", entityType: "ADMIN_CALENDAR_EVENT", entityId: id, before: current as any, after: input as any } });
      return updated;
    });
  }

  async remove(id: string, actor: AdminIdentity) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.adminCalendarEvent.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy sự kiện.");
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "ADMIN_CALENDAR_EVENT_DELETED", entityType: "ADMIN_CALENDAR_EVENT", entityId: id, before: current as any } });
      await tx.adminCalendarEvent.delete({ where: { id } });
      return { ok: true };
    });
  }
}
