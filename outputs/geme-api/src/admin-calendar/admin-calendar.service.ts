import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";

const VN_TZ = "Asia/Ho_Chi_Minh";
type EventInput = { title: string; description: string | null; location: string | null; startsAt: Date; endsAt: Date; allDay: boolean };

const VIETNAM_HOLIDAYS: Array<{ title: string; date: string; description: string }> = [
  { title: "Tết Dương lịch", date: "2026-01-01", description: "Ngày nghỉ lễ toàn quốc." },
  { title: "Kỳ nghỉ Tết Nguyên đán Bính Ngọ", date: "2026-02-14", description: "Ngày đầu kỳ nghỉ Tết Nguyên đán 2026 theo lịch nghỉ chính thức." },
  { title: "Mùng 1 Tết Bính Ngọ", date: "2026-02-17", description: "Ngày đầu năm âm lịch 2026." },
  { title: "Giỗ Tổ Hùng Vương", date: "2026-04-26", description: "Ngày lễ quốc gia; nghỉ bù ngày 27/04/2026." },
  { title: "Ngày Giải phóng miền Nam", date: "2026-04-30", description: "Ngày nghỉ lễ toàn quốc." },
  { title: "Quốc tế Lao động", date: "2026-05-01", description: "Ngày nghỉ lễ toàn quốc." },
  { title: "Quốc khánh", date: "2026-09-02", description: "Ngày nghỉ lễ toàn quốc; lịch nghỉ 2026 có ngày liền kề theo phương án đã công bố." },
  { title: "Ngày Văn hóa Việt Nam", date: "2026-11-24", description: "Ngày nghỉ hưởng nguyên lương theo lịch nghỉ năm 2026 đã công bố." },
  { title: "Tết Dương lịch", date: "2027-01-01", description: "Ngày nghỉ lễ toàn quốc." },
  { title: "Kỳ nghỉ Tết Nguyên đán Đinh Mùi", date: "2027-02-04", description: "Bắt đầu kỳ nghỉ Tết Nguyên đán 2027; lịch nghỉ công bố từ 04/02 đến hết 10/02." },
  { title: "Mùng 1 Tết Đinh Mùi", date: "2027-02-06", description: "Ngày đầu năm âm lịch 2027." },
  { title: "Giỗ Tổ Hùng Vương", date: "2027-04-16", description: "Ngày nghỉ lễ toàn quốc; kỳ nghỉ liền mạch 16–18/04/2027." },
  { title: "Ngày Giải phóng miền Nam", date: "2027-04-30", description: "Ngày nghỉ lễ toàn quốc." },
  { title: "Quốc tế Lao động", date: "2027-05-01", description: "Ngày nghỉ lễ toàn quốc; kỳ nghỉ liền mạch 30/04–03/05/2027." },
  { title: "Quốc khánh", date: "2027-09-02", description: "Ngày nghỉ lễ toàn quốc; lịch nghỉ công chức 2027 gồm 02–03/09." },
  { title: "Ngày Văn hóa Việt Nam", date: "2027-11-24", description: "Ngày nghỉ hưởng nguyên lương theo lịch nghỉ năm 2027 đã công bố." },
];

const vnDayStart = (date: string) => new Date(`${date}T00:00:00+07:00`);

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
  private holidaysReady = false;
  private holidaySeedPromise?: Promise<void>;

  private async ensureVietnamHolidays() {
    if (this.holidaysReady) return;
    if (!this.holidaySeedPromise) this.holidaySeedPromise = this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('geme-admin-calendar-vietnam-holidays'))`;
        for (const holiday of VIETNAM_HOLIDAYS) {
          const startsAt = vnDayStart(holiday.date);
          const exists = await tx.adminCalendarEvent.findFirst({ where: { title: holiday.title, startsAt }, select: { id: true } });
          if (exists) continue;
          const endsAt = new Date(startsAt.getTime() + 86400000);
          await tx.adminCalendarEvent.create({ data: { title: holiday.title, description: holiday.description, location: null, startsAt, endsAt, allDay: true } });
        }
      }).then(() => { this.holidaysReady = true; }).finally(() => { this.holidaySeedPromise = undefined; });
    await this.holidaySeedPromise;
  }

  private async notifyEventOnce(event: { id: string; title: string; description: string | null; startsAt: Date }, phase: "DATE" | "TIME", date: string) {
    const entityId = `${phase}:${event.id}:${date}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`geme-calendar:${entityId}`}))`;
      const existing = await tx.adminNotification.findFirst({ where: { type: "CALENDAR_EVENT", entityId }, select: { id: true } });
      if (existing) return false;
      await tx.adminNotification.create({ data: {
        type: "CALENDAR_EVENT",
        title: phase === "DATE" ? `Hôm nay: ${event.title}` : `Đến giờ: ${event.title}`,
        message: event.description || (phase === "DATE" ? "Sự kiện diễn ra trong ngày hôm nay." : "Sự kiện đã đến thời gian bắt đầu."),
        entityType: "CALENDAR_EVENT",
        entityId,
      } });
      return true;
    });
  }

  async today() {
    const window = todayWindow();
    await this.ensureVietnamHolidays();
    const events = await this.prisma.adminCalendarEvent.findMany({
      where: { startsAt: { lt: window.to }, endsAt: { gte: window.from } },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
    for (const event of events) await this.notifyEventOnce(event, "DATE", window.date);
    return { date: window.date, timeZone: VN_TZ, events };
  }

  async due() {
    const window = todayWindow();
    await this.ensureVietnamHolidays();
    const now = new Date();
    const events = await this.prisma.adminCalendarEvent.findMany({
      where: { startsAt: { lte: now, gte: window.from, lt: window.to } },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
    for (const event of events) await this.notifyEventOnce(event, "TIME", window.date);
    return { date: window.date, timeZone: VN_TZ, events };
  }

  async list(fromValue?: string, toValue?: string) {
    if (!fromValue || !toValue) throw new BadRequestException("Cần truyền khoảng thời gian from và to.");
    await this.ensureVietnamHolidays();
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
