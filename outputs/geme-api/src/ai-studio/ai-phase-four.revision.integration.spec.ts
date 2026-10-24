import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiPhaseFourService } from "./ai-phase-four.service.js";

function isDedicatedLocalTestDatabase(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "postgres"].includes(url.hostname) && /(test|integration|ci)/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "1" && isDedicatedLocalTestDatabase(process.env.DATABASE_URL);
let prisma: PrismaService | null = null;
let actorId = "";
const draftIds: string[] = [];

before(async () => {
  if (!enabled) return;
  prisma = new PrismaService();
  await prisma.$connect();
});

after(async () => {
  if (!prisma) return;
  const db = prisma;
  if (draftIds.length) {
    await db.auditLog.deleteMany({ where: { entityType: "AI_PHASE4", entityId: { in: draftIds } } });
    await db.aiMarketingDraft.deleteMany({ where: { id: { in: draftIds } } });
  }
  if (actorId) await db.aiTask.deleteMany({ where: { requestedByAdminId: actorId } });
  if (actorId) await db.adminUser.delete({ where: { id: actorId } }).catch(() => undefined);
  await db.$disconnect();
});

test("PostgreSQL permits only one writer for each Marketing draft revision", { skip: !enabled }, async (t) => {
  if (!prisma) throw new Error("PostgreSQL integration service was not initialized.");
  const suffix = randomUUID();
  const admin = await prisma.adminUser.create({ data: {
    email: "phase4-" + suffix + "@example.invalid", passwordHash: "integration-test-only", displayName: "Phase 4 CI", role: "ADMIN",
  } });
  actorId = admin.id;
  const actor = { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role };
  const service = new AiPhaseFourService(prisma, {} as any);
  const createDraft = async (suffixLabel: string) => {
    const task = await prisma!.aiTask.create({ data: {
      idempotencyKey: "phase4-revision-" + suffix + "-" + suffixLabel,
      requestedByAdminId: admin.id,
      type: "MARKETING_DRAFT_GENERATION",
      status: "SUCCEEDED",
      title: "Revision test " + suffixLabel,
      input: {},
      result: {},
    } });
    const draft = await prisma!.aiMarketingDraft.create({ data: {
      taskId: task.id, createdByAdminId: admin.id, status: "DRAFT", channel: "INSTAGRAM", objective: "CI concurrency",
      title: "Before", caption: "Caption", body: "Body",
    } });
    draftIds.push(draft.id);
    return draft;
  };

  await t.test("simultaneous edit/edit accepts one revision and rejects the stale writer", async () => {
    const draft = await createDraft("edit-edit");
    const results = await Promise.allSettled([
      service.updateMarketingDraft(actor as any, draft.id, { expectedRevision: 1, title: "Editor one" }),
      service.updateMarketingDraft(actor as any, draft.id, { expectedRevision: 1, title: "Editor two" }),
    ]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    const rejected = results.find((row): row is PromiseRejectedResult => row.status === "rejected");
    assert.ok(rejected?.reason instanceof ConflictException);
    const saved = await prisma!.aiMarketingDraft.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(saved.revision, 2);
    assert.ok(["Editor one", "Editor two"].includes(saved.title));
    assert.equal(await prisma!.auditLog.count({ where: { entityType: "AI_PHASE4", entityId: draft.id } }), 1);
  });

  await t.test("simultaneous edit/approve cannot approve stale content", async () => {
    const draft = await createDraft("edit-approve");
    const results = await Promise.allSettled([
      service.updateMarketingDraft(actor as any, draft.id, { expectedRevision: 1, title: "Edited title" }),
      service.decideMarketingDraft(actor as any, draft.id, "APPROVED", { expectedRevision: 1 }),
    ]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    const rejected = results.find((row): row is PromiseRejectedResult => row.status === "rejected");
    assert.ok(rejected?.reason instanceof ConflictException);
    const saved = await prisma!.aiMarketingDraft.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(saved.revision, 2);
    if (saved.status === "APPROVED") {
      await assert.rejects(() => service.updateMarketingDraft(actor as any, draft.id, { expectedRevision: 1, title: "Stale" }), ConflictException);
      const revised = await service.updateMarketingDraft(actor as any, draft.id, { expectedRevision: 2, title: "Revised after approval" });
      assert.equal(revised.status, "DRAFT");
      assert.equal(revised.revision, 3);
      assert.equal(revised.title, "Revised after approval");
    } else {
      assert.equal(saved.status, "DRAFT");
      await assert.rejects(() => service.decideMarketingDraft(actor as any, draft.id, "APPROVED", { expectedRevision: 1 }), ConflictException);
    }
  });
});
