import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ContactService } from "./contact.service.js";

const body = { name: "Nguyễn An", email: "AN@example.com", phone: "+84 912 345 678", subject: "Tư vấn sản phẩm", message: "Tôi cần tư vấn về một mẫu nhẫn." };
const allowedOrigin = process.env.CORS_ORIGINS?.split(",")[0]?.trim() || "http://localhost:3000";

function fixture() {
  const rows = new Map<string, any>();
  const prisma = {
    contactInquiry: {
      findUnique: async ({ where }: any) => [...rows.values()].find((row) => row.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }: any) => { const value = { id: data.id || "inquiry-1", status: "NEW", createdAt: new Date(), ...data }; rows.set(value.id, value); return value; },
    },
  };
  return { service: new ContactService(prisma as any), rows };
}

test("contact form is saved and replay of the same idempotency key is safe", async () => {
  const { service, rows } = fixture();
  const first = await service.submit(body, allowedOrigin, "contact-request-00000001");
  const replay = await service.submit(body, allowedOrigin, "contact-request-00000001");
  assert.equal(rows.size, 1);
  assert.equal(first.accepted, true);
  assert.equal(replay.replayed, true);
});

test("contact form rejects key reuse with different content", async () => {
  const { service } = fixture();
  await service.submit(body, allowedOrigin, "contact-request-00000002");
  await assert.rejects(service.submit({ ...body, message: "Nội dung khác hoàn toàn." }, allowedOrigin, "contact-request-00000002"), ConflictException);
});

test("contact form rejects invalid origin and malformed email", async () => {
  const { service } = fixture();
  await assert.rejects(service.submit(body, "https://attacker.example", "contact-request-00000003"), ForbiddenException);
  await assert.rejects(service.submit({ ...body, email: "bad-email" }, allowedOrigin, "contact-request-00000004"), BadRequestException);
});
