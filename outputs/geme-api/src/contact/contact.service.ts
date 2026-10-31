import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";

type Row = Record<string, any>;
const subjects = new Set(["Tư vấn sản phẩm", "Đơn hàng và giao hàng", "Đổi trả và bảo hành", "Khác"]);
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(input: unknown, origin: string | undefined, idempotencyKeyInput: string | undefined) {
    const body = input && typeof input === "object" ? input as Row : {};
    // Quietly accept the hidden honeypot so basic bots do not learn the field name.
    if (typeof body.website === "string" && body.website.trim()) return { accepted: true };
    const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
      .split(",").map((value) => value.trim()).filter(Boolean);
    if (!origin || !allowedOrigins.includes(origin)) throw new ForbiddenException("Nguồn gửi biểu mẫu không hợp lệ.");

    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (name.length < 2 || name.length > 120) throw new BadRequestException("Họ tên cần từ 2 đến 120 ký tự.");
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Email liên hệ không hợp lệ.");
    const phoneDigits = phone.replace(/\D/g, "");
    if (phone.length > 32 || (phone && (phoneDigits.length < 9 || phoneDigits.length > 15))) throw new BadRequestException("Số điện thoại cần có từ 9 đến 15 chữ số nếu nhập.");
    if (!subjects.has(subject)) throw new BadRequestException("Chủ đề liên hệ không hợp lệ.");
    if (message.length < 10 || message.length > 5000) throw new BadRequestException("Nội dung cần từ 10 đến 5.000 ký tự.");

    const idempotencyKey = String(idempotencyKeyInput || "").trim();
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new BadRequestException("Thiếu khóa gửi biểu mẫu hợp lệ.");
    const data = { name, email, phone, subject, message };
    const requestHash = stableHash(data);
    const existing = await this.prisma.contactInquiry.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException("Khóa gửi biểu mẫu đã được dùng cho nội dung khác.");
      return { accepted: true, id: existing.id, status: existing.status, createdAt: existing.createdAt, replayed: true };
    }
    try {
      const saved = await this.prisma.contactInquiry.create({ data: { id: randomUUID(), ...data, idempotencyKey, requestHash } });
      return { accepted: true, id: saved.id, status: saved.status, createdAt: saved.createdAt, replayed: false };
    } catch (error: any) {
      if (error?.code === "P2002") {
        const raced = await this.prisma.contactInquiry.findUnique({ where: { idempotencyKey } });
        if (raced?.requestHash === requestHash) return { accepted: true, id: raced.id, status: raced.status, createdAt: raced.createdAt, replayed: true };
        if (raced) throw new ConflictException("Khóa gửi biểu mẫu đã được dùng cho nội dung khác.");
      }
      throw error;
    }
  }

  list(limitInput?: string, cursor?: string) {
    const take = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    return this.prisma.contactInquiry.findMany({
      include: { handledBy: { select: { id: true, displayName: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async updateStatus(id: string, actor: AdminIdentity, input: unknown) {
    const body = input && typeof input === "object" ? input as Row : {};
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (!["IN_PROGRESS", "RESOLVED", "ARCHIVED"].includes(status)) throw new BadRequestException("Trạng thái yêu cầu liên hệ không hợp lệ.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    if (["RESOLVED", "ARCHIVED"].includes(status) && note.length < 5) throw new BadRequestException("Cần ghi chú xử lý tối thiểu 5 ký tự.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "contact_inquiries" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.contactInquiry.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy yêu cầu liên hệ.");
      if (current.status === status) return current;
      if (current.status === "ARCHIVED") throw new ConflictException("Yêu cầu đã lưu trữ; hãy khôi phục trước khi sửa tiếp.");
      const saved = await tx.contactInquiry.update({ where: { id }, data: {
        status,
        resolutionNote: note || null,
        handledByAdminId: actor.id,
        handledAt: status === "RESOLVED" || status === "ARCHIVED" ? new Date() : null,
      } });
      await tx.auditLog.create({ data: {
        adminId: actor.id, action: "CONTACT_INQUIRY_STATUS_CHANGED", entityType: "CONTACT_INQUIRY", entityId: id,
        before: { status: current.status }, after: { status, note: note || null },
      } });
      return saved;
    });
  }
}
