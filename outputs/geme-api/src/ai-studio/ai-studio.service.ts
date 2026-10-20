import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiStudioQueue } from "./ai-studio.queue.js";
import { AiTaskInputError, normalizeAiTaskSubmission } from "./ai-studio.contract.js";

const taskStatuses = ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED", "APPROVED", "REJECTED"] as const;
type TaskStatus = (typeof taskStatuses)[number];

const agents = [
  { id: "content", name: "Content Atelier", capability: "Chuẩn bị bản nháp nội dung", status: "SCAFFOLD" },
  { id: "image", name: "GEME Visual Agent", capability: "Tạo bối cảnh theo chỉ dẫn, ghép mask và giữ sản phẩm gốc", status: "PROVIDER_DISABLED" },
  { id: "product", name: "GEME Product Agent", capability: "Tạo bản nháp sản phẩm từ ảnh đã duyệt, luôn cần admin rà soát", status: "PROVIDER_DISABLED" },
  { id: "sales", name: "GEME Sales Agent", capability: "Tư vấn dựa trên sản phẩm ACTIVE, tồn kho hiện tại và chính sách đã duyệt; chuyển người khi thiếu dữ kiện", status: "PROVIDER_DISABLED" },
  { id: "marketing", name: "GEME Marketing Agent", capability: "Soạn nội dung theo sản phẩm đã duyệt; chỉ lưu nháp, không tự đăng hoặc gửi", status: "PROVIDER_DISABLED" },
  { id: "catalog-review", name: "Catalog Reviewer", capability: "Đưa đề xuất xuất bản vào trung tâm duyệt", status: "APPROVAL_REQUIRED" },
];

@Injectable()
export class AiStudioService {
  private readonly logger = new Logger(AiStudioService.name);

  constructor(private readonly prisma: PrismaService, private readonly queue: AiStudioQueue) {}

  async overview() {
    const [groups, queue] = await Promise.all([
      this.prisma.aiTask.groupBy({ by: ["status"], _count: { _all: true } }),
      this.queue.counts(),
    ]);
    const taskCounts: Record<TaskStatus, number> = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as Record<TaskStatus, number>;
    for (const group of groups) taskCounts[group.status] = group._count._all;
    return {
      agents: agents.map((agent) => {
        if (agent.id === "image") return { ...agent, status: process.env.PHOTOROOM_CONFIGURED?.trim() === "true" || Boolean(process.env.PHOTOROOM_API_KEY?.trim()) ? "READY" : "PROVIDER_DISABLED" };
        if (agent.id === "content") return { ...agent, status: process.env.OPENAI_CONFIGURED?.trim() === "true" ? "READY" : "PROVIDER_DISABLED" };
        if (agent.id === "product") return { ...agent, status: process.env.OPENAI_CONFIGURED?.trim() === "true" ? "READY" : "PROVIDER_DISABLED" };
        if (agent.id === "sales" || agent.id === "marketing") return { ...agent, status: process.env.OPENAI_CONFIGURED?.trim() === "true" ? "READY" : "PROVIDER_DISABLED" };
        return agent;
      }),
      taskCounts,
      queue,
    };
  }

  async listTasks(statusInput?: string, limitInput?: string) {
    let status: TaskStatus | undefined;
    if (statusInput) {
      if (!taskStatuses.includes(statusInput as TaskStatus)) throw new BadRequestException("Trạng thái tác vụ không hợp lệ.");
      status = statusInput as TaskStatus;
    }
    const parsedLimit = Number(limitInput || 30);
    const take = Number.isInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 30;
    return this.prisma.aiTask.findMany({
      where: status ? { status } : undefined,
      include: { approval: { select: { id: true, status: true, decisionNote: true, requestedAt: true, reviewedAt: true } }, requestedBy: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async task(id: string) {
    const task = await this.prisma.aiTask.findUnique({
      where: { id },
      include: { approval: { include: { reviewedBy: { select: { id: true, displayName: true, email: true } } } }, requestedBy: { select: { id: true, displayName: true, email: true } } },
    });
    if (!task) throw new NotFoundException("Không tìm thấy tác vụ AI.");
    return task;
  }

  async createTask(actor: AdminIdentity, body: unknown, idempotencyKey: unknown) {
    let submission;
    try {
      submission = normalizeAiTaskSubmission(body, idempotencyKey);
    } catch (error) {
      if (error instanceof AiTaskInputError) throw new BadRequestException(error.message);
      throw error;
    }
    const input = { prompt: submission.prompt } satisfies Prisma.InputJsonObject;
    const existing = await this.prisma.aiTask.findUnique({ where: { idempotencyKey: submission.idempotencyKey } });
    if (existing) return this.returnExistingOrConflict(existing, actor, submission, input);

    await this.queue.consumeCreateQuota(actor.id);
    const activeLimit = this.activeTaskLimit();
    let task;
    try {
      task = await this.prisma.$transaction(async (transaction) => {
        // Serialize only task admission for this admin. Concurrent submit bursts
        // cannot race past the per-admin active-task cap.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
        const activeCount = await transaction.aiTask.count({
          where: { requestedByAdminId: actor.id, status: { in: ["QUEUED", "RUNNING"] } },
        });
        if (activeCount >= activeLimit) throw new ConflictException(`Mỗi tài khoản quản trị chỉ được có tối đa ${activeLimit} tác vụ đang chạy.`);
        return transaction.aiTask.create({
          data: {
            idempotencyKey: submission.idempotencyKey,
            requestedByAdminId: actor.id,
            type: submission.type,
            title: submission.title,
            input,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const raced = await this.prisma.aiTask.findUnique({ where: { idempotencyKey: submission.idempotencyKey } });
        if (raced) return this.returnExistingOrConflict(raced, actor, submission, input);
      }
      throw error;
    }

    try {
      await this.queue.enqueue(task.id);
      this.log("ai.task.queued", actor.id, task.id, { type: task.type });
      return task;
    } catch (error) {
      await this.prisma.aiTask.updateMany({
        where: { id: task.id, status: "QUEUED" },
        data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi chưa sẵn sàng. Hãy tạo lại tác vụ với khóa yêu cầu mới.", completedAt: new Date() },
      });
      throw error;
    }
  }

  async cancelTask(actor: AdminIdentity, id: string) {
    const existing = await this.prisma.aiTask.findUnique({ where: { id }, select: { type: true, input: true } });
    const changed = await this.prisma.aiTask.updateMany({
      where: { id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date(),
        ...(existing?.type === "SALES_ANSWER" ? { input: redactSalesInput(existing.input) } : {}),
      },
    });
    if (changed.count === 0) {
      const current = await this.prisma.aiTask.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy tác vụ AI.");
      if (current.status !== "CANCELLED") throw new ConflictException("Tác vụ đã kết thúc nên không thể hủy.");
      return current;
    }
    await this.queue.removeIfWaiting(id);
    await this.prisma.aiMarketingDraft.updateMany({ where: { taskId: id, status: { in: ["QUEUED", "GENERATING"] } }, data: { status: "CANCELLED" } });
    this.log("ai.task.cancelled", actor.id, id);
    return this.task(id);
  }

  async approvals(limitInput?: string) {
    const parsedLimit = Number(limitInput || 30);
    const take = Number.isInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 30;
    return this.prisma.aiApproval.findMany({
      include: {
        task: { select: { id: true, type: true, status: true, title: true, input: true, result: true, createdAt: true, requestedBy: { select: { displayName: true } } } },
        reviewedBy: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      take,
    });
  }

  async decideApproval(actor: AdminIdentity, taskId: string, decision: "APPROVED" | "REJECTED", noteInput: unknown) {
    const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 1000) || null : null;
    const current = await this.prisma.aiApproval.findUnique({ where: { taskId } });
    if (!current) throw new NotFoundException("Không tìm thấy yêu cầu phê duyệt.");
    if (current.status !== "PENDING") {
      if (current.status === decision) return this.prisma.aiApproval.findUnique({ where: { taskId }, include: { task: true, reviewedBy: { select: { id: true, displayName: true } } } });
      throw new ConflictException("Yêu cầu này đã được quyết định trước đó.");
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const approvalUpdate = await transaction.aiApproval.updateMany({
          where: { taskId, status: "PENDING" },
          data: { status: decision, reviewedByAdminId: actor.id, decisionNote: note, reviewedAt: new Date() },
        });
        if (approvalUpdate.count !== 1) throw new ConflictException("Yêu cầu này vừa được người khác quyết định.");
        const taskUpdate = await transaction.aiTask.updateMany({
          where: { id: taskId, status: "AWAITING_APPROVAL" },
          data: { status: decision },
        });
        if (taskUpdate.count !== 1) throw new ConflictException("Trạng thái tác vụ không còn chờ duyệt.");
        const imageItem = await transaction.aiImageItem.findUnique({ where: { taskId }, select: { id: true, batchId: true } });
        if (imageItem) {
          await transaction.aiImageItem.update({ where: { id: imageItem.id }, data: { status: decision, errorCode: null } });
          const statuses = (await transaction.aiImageItem.findMany({ where: { batchId: imageItem.batchId }, select: { status: true } })).map((item) => item.status);
          let batchStatus: "UPLOADING" | "PROCESSING" | "REVIEW" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" = "PROCESSING";
          if (statuses.some((value) => value === "PENDING_UPLOAD")) batchStatus = "UPLOADING";
          else if (statuses.some((value) => value === "QUEUED" || value === "RUNNING")) batchStatus = "PROCESSING";
          else if (statuses.some((value) => value === "AWAITING_APPROVAL")) batchStatus = "REVIEW";
          else if (statuses.every((value) => value === "APPROVED")) batchStatus = "COMPLETE";
          else if (statuses.every((value) => value === "CANCELLED")) batchStatus = "CANCELLED";
          else if (statuses.every((value) => value === "FAILED")) batchStatus = "FAILED";
          else batchStatus = "PARTIAL";
          await transaction.aiImageBatch.update({ where: { id: imageItem.batchId }, data: { status: batchStatus } });
        }
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.error(JSON.stringify({ event: "ai.approval.persist_failed", taskId, decision, message: error instanceof Error ? error.message : "unknown" }));
      throw new ServiceUnavailableException("Không thể lưu quyết định duyệt AI.");
    }

    this.log(`ai.approval.${decision.toLowerCase()}`, actor.id, taskId);
    return this.prisma.aiApproval.findUnique({ where: { taskId }, include: { task: true, reviewedBy: { select: { id: true, displayName: true } } } });
  }

  private async returnExistingOrConflict<T extends { id: string; status: TaskStatus; errorCode: string | null; requestedByAdminId: string; type: string; title: string; input: Prisma.JsonValue }>(
    existing: T,
    actor: AdminIdentity,
    submission: { type: string; title: string; prompt: string; idempotencyKey: string },
    input: Prisma.InputJsonObject,
  ) {
    if (existing.requestedByAdminId !== actor.id) throw new ConflictException("Khóa idempotency này đã được sử dụng.");
    if (existing.type !== submission.type || existing.title !== submission.title || JSON.stringify(existing.input) !== JSON.stringify(input)) {
      throw new ConflictException("Khóa idempotency đã gắn với nội dung yêu cầu khác.");
    }
    if (existing.status === "FAILED" && existing.errorCode === "QUEUE_UNAVAILABLE") {
      const requeued = await this.prisma.aiTask.updateMany({
        where: { id: existing.id, status: "FAILED", errorCode: "QUEUE_UNAVAILABLE" },
        data: { status: "QUEUED", errorCode: null, errorMessage: null, completedAt: null },
      });
      if (requeued.count === 1) {
        try {
          await this.queue.enqueue(existing.id, true);
          this.log("ai.task.requeued", actor.id, existing.id, { type: existing.type });
        } catch (error) {
          await this.prisma.aiTask.updateMany({
            where: { id: existing.id, status: "QUEUED" },
            data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi chưa sẵn sàng. Thử lại cùng khóa yêu cầu.", completedAt: new Date() },
          });
          throw error;
        }
        return this.task(existing.id);
      }
      return this.task(existing.id);
    }
    return existing;
  }

  private isUniqueConstraintError(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private activeTaskLimit() {
    const configured = Number(process.env.AI_STUDIO_ACTIVE_TASK_LIMIT);
    return Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 25) : 5;
  }

  private log(event: string, adminId: string, taskId: string, fields: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ event, adminId, taskId, ...fields, at: new Date().toISOString() }));
  }
}

function redactSalesInput(value: unknown): Prisma.InputJsonObject {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const ids = (field: "catalog" | "knowledge") => Array.isArray(input[field])
    ? (input[field] as unknown[]).map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "").filter(Boolean).slice(0, 16)
    : [];
  return { redacted: true, sourceProductIds: ids("catalog"), policySourceIds: ids("knowledge"), requestFingerprint: typeof input.requestFingerprint === "string" ? input.requestFingerprint : "" };
}
