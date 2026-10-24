import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type AiMarketingDraftStatus, type AiSalesKnowledgeStatus } from "../generated/prisma/client.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AiStudioQueue } from "./ai-studio.queue.js";
import { expectedMarketingRevision, normalizeMarketingEdits, normalizeMarketingSubmission, normalizeSalesSubmission, validateKnowledgeDocument } from "./ai-phase-four.contract.js";

const activeKnowledgeStatuses: AiSalesKnowledgeStatus[] = ["ACTIVE"];
type PhaseFourTaskType = "SALES_ANSWER" | "MARKETING_DRAFT_GENERATION";

@Injectable()
export class AiPhaseFourService {
  private readonly logger = new Logger(AiPhaseFourService.name);

  constructor(private readonly prisma: PrismaService, private readonly queue: AiStudioQueue) {}

  async salesStatus() {
    return {
      mode: "INTERNAL_PILOT",
      providerConfigured: process.env.OPENAI_CONFIGURED?.trim() === "true" || Boolean(process.env.OPENAI_API_KEY?.trim()),
      publicChatEnabled: false,
      safeguards: ["ACTIVE_IN_STOCK_PRODUCTS_ONLY", "VERSIONED_ACTIVE_POLICIES_ONLY", "NO_ORDER_OR_CUSTOMER_LOOKUP", "NO_COMMERCE_WRITES", "HUMAN_HANDOFF_ON_UNCERTAINTY"],
    };
  }

  async askSales(actor: AdminIdentity, body: unknown, idempotencyKey: unknown) {
    const request = normalizeSalesSubmission(body);
    const key = normalizeIdempotencyKey(idempotencyKey);
    const semantic = { question: request.question, privateRequest: request.privateRequest, maxBudget: request.maxBudget };
    const fingerprint = fingerprintOf(semantic);
    const existing = await this.findExistingTask(actor.id, key, "SALES_ANSWER", fingerprint);
    if (existing) return existing;

    const [catalog, knowledge] = await Promise.all([
      request.privateRequest ? Promise.resolve([]) : this.findSalesCatalog(request.question, request.maxBudget),
      request.privateRequest ? Promise.resolve([]) : this.findActiveKnowledge(request.question),
    ]);
    const input = {
      question: request.question,
      catalog,
      knowledge,
      request: { maxBudget: request.maxBudget },
      requestFingerprint: fingerprint,
    } satisfies Prisma.InputJsonObject;
    const task = await this.enqueueTask(actor, "SALES_ANSWER", "Sales Agent · tư vấn sản phẩm/chính sách", input, key, fingerprint);
    this.log("ai.sales.question_queued", actor.id, task.id, { privateRequest: request.privateRequest, catalogCount: catalog.length, knowledgeCount: knowledge.length });
    return task;
  }

  async salesAnalytics() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalQuestions, handoffs, unresolved, clicks, generatedDrafts, approvedDrafts] = await Promise.all([
      this.prisma.aiSalesMetric.count({ where: { createdAt: { gte: since } } }),
      this.prisma.aiSalesMetric.count({ where: { createdAt: { gte: since }, needsHandoff: true } }),
      this.prisma.aiSalesMetric.count({ where: { createdAt: { gte: since }, unresolved: true } }),
      this.prisma.aiSalesMetric.aggregate({ where: { createdAt: { gte: since } }, _sum: { clickCount: true } }),
      this.prisma.aiMarketingDraft.count({ where: { createdAt: { gte: since }, status: { notIn: ["FAILED", "CANCELLED"] } } }),
      this.prisma.aiMarketingDraft.count({ where: { createdAt: { gte: since }, status: "APPROVED" } }),
    ]);
    return {
      periodDays: 30,
      sales: { totalQuestions, handoffCount: handoffs, unresolvedCount: unresolved, productClicks: clicks._sum.clickCount || 0 },
      marketing: { draftCount: generatedDrafts, approvedCount: approvedDrafts },
      storesMessageContent: false,
    };
  }

  async recordProductClick(taskId: string, productIdInput: unknown) {
    const productId = typeof productIdInput === "string" ? productIdInput : "";
    const task = await this.prisma.aiTask.findUnique({ where: { id: taskId }, select: { type: true, result: true } });
    if (!task || task.type !== "SALES_ANSWER") throw new NotFoundException("Không tìm thấy kết quả tư vấn.");
    const result = asRecord(task.result);
    const allowedIds = Array.isArray(result.recommended_product_ids) ? result.recommended_product_ids : [];
    if (!allowedIds.includes(productId)) throw new BadRequestException("Sản phẩm không nằm trong danh sách đã được Agent gợi ý.");
    const metric = await this.prisma.aiSalesMetric.updateMany({ where: { taskId }, data: { clickCount: { increment: 1 } } });
    if (metric.count !== 1) throw new ConflictException("Kết quả tư vấn chưa sẵn sàng ghi nhận lượt xem.");
    return { recorded: true };
  }

  async listKnowledge(includeArchived = false) {
    return this.prisma.aiSalesKnowledgeSource.findMany({
      where: includeArchived ? undefined : { status: { not: "ARCHIVED" } },
      include: { createdBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } } },
      orderBy: [{ documentKey: "asc" }, { version: "desc" }],
      take: 200,
    });
  }

  async createKnowledge(actor: AdminIdentity, body: unknown) {
    const data = validateKnowledgeDocument(body);
    const existing = await this.prisma.aiSalesKnowledgeSource.findFirst({ where: { documentKey: data.documentKey }, select: { id: true } });
    if (existing) throw new ConflictException("Mã tài liệu đã có. Hãy tạo phiên bản mới từ tài liệu hiện có.");
    const source = await this.prisma.aiSalesKnowledgeSource.create({ data: { ...data, version: 1, createdByAdminId: actor.id } });
    await this.audit(actor, "AI_SALES_KNOWLEDGE_CREATED", source.id, null, { documentKey: source.documentKey, version: source.version, status: source.status });
    return source;
  }

  async createKnowledgeRevision(actor: AdminIdentity, id: string, body: unknown) {
    const current = await this.prisma.aiSalesKnowledgeSource.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy tài liệu chính sách.");
    const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const data = validateKnowledgeDocument({
      documentKey: current.documentKey,
      title: value.title ?? current.title,
      topic: value.topic ?? current.topic,
      sourceLabel: value.sourceLabel ?? current.sourceLabel,
      content: value.content ?? current.content,
      effectiveFrom: value.effectiveFrom ?? current.effectiveFrom?.toISOString() ?? null,
      expiresAt: value.expiresAt ?? current.expiresAt?.toISOString() ?? null,
    });
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.documentKey})::bigint)`;
      const latest = await transaction.aiSalesKnowledgeSource.findFirst({ where: { documentKey: current.documentKey }, orderBy: { version: "desc" }, select: { version: true } });
      return transaction.aiSalesKnowledgeSource.create({ data: { ...data, version: (latest?.version || 0) + 1, createdByAdminId: actor.id } });
    });
    await this.audit(actor, "AI_SALES_KNOWLEDGE_REVISION_CREATED", created.id, { sourceId: current.id, version: current.version }, { sourceId: created.id, version: created.version, status: created.status });
    return created;
  }

  async activateKnowledge(actor: AdminIdentity, id: string) {
    const current = await this.prisma.aiSalesKnowledgeSource.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy tài liệu chính sách.");
    if (current.status === "ACTIVE") return current;
    if (current.status !== "DRAFT") throw new ConflictException("Chỉ có thể kích hoạt phiên bản nháp.");
    const now = new Date();
    if (current.effectiveFrom && current.effectiveFrom > now) throw new BadRequestException("Ngày hiệu lực đang ở tương lai.");
    if (current.expiresAt && current.expiresAt <= now) throw new BadRequestException("Phiên bản này đã hết hiệu lực.");
    const active = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.documentKey})::bigint)`;
      await transaction.aiSalesKnowledgeSource.updateMany({ where: { documentKey: current.documentKey, status: "ACTIVE" }, data: { status: "ARCHIVED" } });
      return transaction.aiSalesKnowledgeSource.update({ where: { id }, data: { status: "ACTIVE", effectiveFrom: current.effectiveFrom || now, reviewedByAdminId: actor.id } });
    });
    await this.audit(actor, "AI_SALES_KNOWLEDGE_ACTIVATED", id, { status: current.status, version: current.version }, { status: active.status, version: active.version });
    this.log("ai.sales.knowledge_activated", actor.id, id, { documentKey: active.documentKey, version: active.version });
    return active;
  }

  async archiveKnowledge(actor: AdminIdentity, id: string) {
    const current = await this.prisma.aiSalesKnowledgeSource.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy tài liệu chính sách.");
    if (current.status === "ARCHIVED") return current;
    const updated = await this.prisma.aiSalesKnowledgeSource.update({ where: { id }, data: { status: "ARCHIVED", reviewedByAdminId: actor.id } });
    await this.audit(actor, "AI_SALES_KNOWLEDGE_ARCHIVED", id, { status: current.status, version: current.version }, { status: updated.status, version: updated.version });
    return updated;
  }

  async marketingProducts(searchInput?: string) {
    const search = typeof searchInput === "string" ? searchInput.trim().slice(0, 100) : "";
    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }],
      ...(search ? { AND: [{ OR: [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { category: { is: { name: { contains: search, mode: "insensitive" } } } },
        { gemstoneType: { is: { name: { contains: search, mode: "insensitive" } } } },
      ] }] } : {}),
    };
    const products = await this.prisma.product.findMany({
      where,
      select: { id: true, sku: true, name: true, slug: true, description: true, status: true, stock: true, category: { select: { name: true } }, gemstoneType: { select: { name: true } }, materialOption: { select: { name: true } }, variants: { where: { stock: { gt: 0 } }, select: { id: true, quality: true, beadSize: true, carat: true, gemstoneQuality: true, stock: true } } },
      orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      category: product.category?.name || null,
      gemstone: product.gemstoneType?.name || null,
      material: product.materialOption?.name || null,
      availableQuantity: product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock,
    }));
  }

  async createMarketingDraft(actor: AdminIdentity, body: unknown, idempotencyKey: unknown) {
    const brief = normalizeMarketingSubmission(body, idempotencyKey);
    const semantic = { channel: brief.channel, objective: brief.objective, productIds: brief.productIds, keywords: brief.keywords, callToAction: brief.callToAction };
    const fingerprint = fingerprintOf(semantic);
    const existing = await this.findExistingTask(actor.id, brief.idempotencyKey, "MARKETING_DRAFT_GENERATION", fingerprint);
    if (existing) return this.marketingTaskResponse(existing.id);

    const products = await this.prisma.product.findMany({
      where: { id: { in: brief.productIds }, status: "ACTIVE", OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }] },
      select: { id: true, sku: true, name: true, slug: true, description: true, stock: true, category: { select: { name: true, status: true } }, gemstoneType: { select: { name: true, status: true } }, materialOption: { select: { name: true, active: true } }, variants: { where: { stock: { gt: 0 } }, select: { quality: true, beadSize: true, carat: true, gemstoneQuality: true, stock: true } } },
    });
    if (products.length !== brief.productIds.length) throw new ConflictException("Một số sản phẩm đã ẩn, hết hàng hoặc không còn ở trạng thái ACTIVE. Tải lại danh sách rồi chọn lại.");
    const verifiedProducts = products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      slug: product.slug,
      category: product.category?.status === "ACTIVE" ? product.category.name : null,
      gemstone: product.gemstoneType?.status === "ACTIVE" ? product.gemstoneType.name : null,
      material: product.materialOption?.active ? product.materialOption.name : null,
      approvedDescription: (product.description || "").slice(0, 1_000),
      available: true,
      variants: product.variants.slice(0, 12).map((variant) => ({ quality: variant.quality, size: variant.beadSize, carat: variant.carat?.toString() || null, gemstoneQuality: variant.gemstoneQuality, available: variant.stock > 0 })),
      publicPath: `/san-pham/${encodeURIComponent(product.slug)}`,
    }));
    const input = {
      channel: brief.channel,
      objective: brief.objective,
      keywords: brief.keywords,
      call_to_action: brief.callToAction,
      products: verifiedProducts,
      requestFingerprint: fingerprint,
    } satisfies Prisma.InputJsonObject;
    const sourceFacts = verifiedProducts as unknown as Prisma.InputJsonArray;
    const title = `Marketing Agent · ${brief.channel} · ${products.map((product) => product.name).slice(0, 2).join(", ")}`.slice(0, 120);
    const task = await this.enqueueTask(actor, "MARKETING_DRAFT_GENERATION", title, input, brief.idempotencyKey, fingerprint, {
      channel: brief.channel,
      objective: brief.objective,
      sourceProductIds: brief.productIds,
      sourceFacts,
    });
    this.log("ai.marketing.draft_queued", actor.id, task.id, { channel: brief.channel, productCount: products.length });
    return this.marketingTaskResponse(task.id);
  }

  async listMarketingDrafts(statusInput?: string, limitInput?: string) {
    const validStatuses: AiMarketingDraftStatus[] = ["QUEUED", "GENERATING", "DRAFT", "APPROVED", "REJECTED", "FAILED", "CANCELLED"];
    if (statusInput && !validStatuses.includes(statusInput as AiMarketingDraftStatus)) throw new BadRequestException("Trạng thái bản nháp không hợp lệ.");
    const requestedLimit = Number(limitInput || 30);
    const take = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 30;
    return this.prisma.aiMarketingDraft.findMany({
      where: statusInput ? { status: statusInput as AiMarketingDraftStatus } : undefined,
      include: { createdBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } }, task: { select: { id: true, status: true, errorMessage: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async marketingDraft(id: string) {
    const draft = await this.prisma.aiMarketingDraft.findUnique({ where: { id }, include: { createdBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } }, task: { select: { id: true, status: true, errorMessage: true, createdAt: true } } } });
    if (!draft) throw new NotFoundException("Không tìm thấy bản nháp Marketing.");
    return draft;
  }

  async retryMarketingDraft(actor: AdminIdentity, id: string) {
    const current = await this.prisma.aiMarketingDraft.findUnique({ where: { id }, include: { task: { select: { id: true, status: true } } } });
    if (!current) throw new NotFoundException("Không tìm thấy bản nháp Marketing.");
    if (current.status !== "FAILED" || current.task.status !== "FAILED") throw new ConflictException("Chỉ có thể thử lại bản nháp đã thất bại.");
    await this.prisma.$transaction(async (transaction) => {
      const task = await transaction.aiTask.updateMany({ where: { id: current.taskId, status: "FAILED" }, data: { status: "QUEUED", errorCode: null, errorMessage: null, result: Prisma.JsonNull, completedAt: null, cancelledAt: null } });
      if (task.count !== 1) throw new ConflictException("Tác vụ vừa được cập nhật.");
      const draft = await transaction.aiMarketingDraft.updateMany({ where: { id, status: "FAILED" }, data: { status: "QUEUED", errorCode: null, reviewedByAdminId: null, reviewedAt: null, decisionNote: null } });
      if (draft.count !== 1) throw new ConflictException("Bản nháp vừa được cập nhật.");
    });
    try {
      await this.queue.enqueue(current.taskId, true);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.aiTask.updateMany({ where: { id: current.taskId, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi AI chưa sẵn sàng. Vui lòng thử lại.", completedAt: new Date() } }),
        this.prisma.aiMarketingDraft.updateMany({ where: { id, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE" } }),
      ]);
      throw error;
    }
    await this.audit(actor, "AI_MARKETING_DRAFT_RETRY_QUEUED", id, { status: current.status }, { status: "QUEUED" });
    this.log("ai.marketing.draft_retry_queued", actor.id, current.taskId, { draftId: id });
    return this.marketingTaskResponse(current.taskId);
  }

  async updateMarketingDraft(actor: AdminIdentity, id: string, body: unknown) {
    const expectedRevision = expectedMarketingRevision(body);
    const data = normalizeMarketingEdits(body);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.aiMarketingDraft.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy bản nháp Marketing.");
      if (current.revision !== expectedRevision) throw new ConflictException("Bản nháp đã được người khác cập nhật. Hãy tải lại trước khi tiếp tục.");
      if (!["DRAFT", "REJECTED", "APPROVED"].includes(current.status)) throw new ConflictException("Chỉ có thể chỉnh sửa nội dung đã được tạo xong.");
      const claimed = await tx.aiMarketingDraft.updateMany({
        where: { id, revision: expectedRevision, status: { in: ["DRAFT", "REJECTED", "APPROVED"] } },
        data: { ...data, status: "DRAFT", revision: { increment: 1 }, reviewedByAdminId: null, reviewedAt: null, decisionNote: null } as Prisma.AiMarketingDraftUpdateManyMutationInput,
      });
      if (claimed.count !== 1) throw new ConflictException("Bản nháp đã được người khác cập nhật. Hãy tải lại trước khi tiếp tục.");
      const saved = await tx.aiMarketingDraft.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        action: "AI_MARKETING_DRAFT_EDITED",
        entityType: "AI_PHASE4",
        entityId: id,
        before: { ...pickMarketingFields(current), status: current.status, revision: current.revision } as unknown as Prisma.InputJsonValue,
        after: { ...pickMarketingFields(saved), status: saved.status, revision: saved.revision } as unknown as Prisma.InputJsonValue,
      } });
      return saved;
    });
    return updated;
  }

  async decideMarketingDraft(actor: AdminIdentity, id: string, decision: "APPROVED" | "REJECTED", body: unknown) {
    const expectedRevision = expectedMarketingRevision(body);
    const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const note = typeof value.note === "string" ? value.note.trim().slice(0, 1000) || null : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.aiMarketingDraft.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Không tìm thấy bản nháp Marketing.");
      if (current.revision !== expectedRevision) throw new ConflictException("Bản nháp đã được người khác cập nhật. Hãy tải lại trước khi quyết định.");
      if (current.status !== "DRAFT") throw new ConflictException("Chỉ có thể duyệt hoặc từ chối nội dung ở trạng thái nháp.");
      const claimed = await tx.aiMarketingDraft.updateMany({
        where: { id, revision: expectedRevision, status: "DRAFT" },
        data: { status: decision, revision: { increment: 1 }, reviewedByAdminId: actor.id, reviewedAt: new Date(), decisionNote: note },
      });
      if (claimed.count !== 1) throw new ConflictException("Bản nháp đã được người khác cập nhật. Hãy tải lại trước khi quyết định.");
      const saved = await tx.aiMarketingDraft.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({ data: {
        adminId: actor.id,
        action: `AI_MARKETING_DRAFT_${decision}`,
        entityType: "AI_PHASE4",
        entityId: id,
        before: { status: current.status, revision: current.revision },
        after: { status: saved.status, revision: saved.revision, note },
      } });
      return saved;
    });
    this.log(`ai.marketing.draft_${decision.toLowerCase()}`, actor.id, id, { channel: updated.channel, revision: updated.revision });
    return updated;
  }

  private async findSalesCatalog(question: string, maxBudget: number | null) {
    const tokens = question.toLocaleLowerCase("vi-VN").match(/[\p{L}\p{N}]{3,}/gu) || [];
    const stopWords = new Set(["của", "tôi", "mình", "muốn", "tìm", "xem", "cho", "hỏi", "tư", "vấn", "gợi", "sản", "phẩm", "loại", "giá", "dưới", "trên", "khoảng", "một", "vài", "có", "thể", "nào", "không", "hay", "và", "với", "những", "nữa", "giúp", "bạn", "geme", "đá", "quý", "triệu", "nghìn"]);
    const terms = [...new Set(tokens.filter((term) => !stopWords.has(term)))].slice(0, 6);
    const textWhere: Prisma.ProductWhereInput[] = terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
      { category: { is: { name: { contains: term, mode: "insensitive" } } } },
      { gemstoneType: { is: { name: { contains: term, mode: "insensitive" } } } },
      { materialOption: { is: { name: { contains: term, mode: "insensitive" } } } },
    ]);
    const availableWhere: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      OR: [{ stock: { gt: 0 } }, { variants: { some: { stock: { gt: 0 } } } }],
      ...(textWhere.length ? { AND: [{ OR: textWhere }] } : {}),
    };
    const products = await this.prisma.product.findMany({
      where: availableWhere,
      select: { id: true, sku: true, name: true, slug: true, description: true, stock: true, price: true, category: { select: { name: true, status: true } }, gemstoneType: { select: { name: true, status: true } }, materialOption: { select: { name: true, active: true } }, variants: { where: { stock: { gt: 0 } }, select: { price: true, stock: true, quality: true, beadSize: true, carat: true, gemstoneQuality: true }, orderBy: { sortOrder: "asc" }, take: 12 } },
      orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
      take: 120,
    });
    const normalized = products.map((product) => {
      const livePrice = product.variants.length ? product.variants.reduce((lowest, variant) => Math.min(lowest, Number(variant.price)), Number.POSITIVE_INFINITY) : product.price === null ? null : Number(product.price);
      const availableQuantity = product.variants.length ? product.variants.reduce((sum, variant) => sum + variant.stock, 0) : product.stock;
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        category: product.category?.status === "ACTIVE" ? product.category.name : null,
        gemstone: product.gemstoneType?.status === "ACTIVE" ? product.gemstoneType.name : null,
        material: product.materialOption?.active ? product.materialOption.name : null,
        description: (product.description || "").slice(0, 500),
        price: Number.isFinite(livePrice as number) ? livePrice : null,
        availableQuantity,
        variants: product.variants.slice(0, 8).map((variant) => ({ price: Number(variant.price), availableQuantity: variant.stock, quality: variant.quality, size: variant.beadSize, carat: variant.carat?.toString() || null, gemstoneQuality: variant.gemstoneQuality })),
        publicPath: `/san-pham/${encodeURIComponent(product.slug)}`,
      };
    });
    return normalized.filter((product) => product.availableQuantity > 0 && (maxBudget === null || (product.price !== null && product.price <= maxBudget)) ).slice(0, 16);
  }

  private async findActiveKnowledge(question: string) {
    const now = new Date();
    const rows = await this.prisma.aiSalesKnowledgeSource.findMany({
      where: { status: { in: activeKnowledgeStatuses }, AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
      select: { id: true, title: true, topic: true, sourceLabel: true, content: true, version: true, documentKey: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 30,
    });
    const queryTokens = new Set((question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) || []).slice(0, 12));
    const scored = rows.map((row) => {
      const searchable = `${row.title} ${row.topic} ${row.content}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const score = [...queryTokens].reduce((sum, token) => sum + Number(searchable.includes(token)), 0);
      return { row, score };
    }).sort((a, b) => b.score - a.score);
    return scored.filter(({ score }) => score > 0).slice(0, 12).map(({ row }) => ({ id: row.id, title: row.title, topic: row.topic, source: row.sourceLabel, content: row.content.slice(0, 3_000), version: row.version, documentKey: row.documentKey }));
  }

  private async enqueueTask(
    actor: AdminIdentity,
    type: PhaseFourTaskType,
    title: string,
    input: Prisma.InputJsonObject,
    key: string,
    fingerprint: string,
    marketingDraft?: { channel: string; objective: string; sourceProductIds: string[]; sourceFacts: Prisma.InputJsonArray },
  ) {
    await this.queue.consumeCreateQuota(actor.id);
    let task;
    try {
      task = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id})::bigint)`;
        const active = await transaction.aiTask.count({ where: { requestedByAdminId: actor.id, status: { in: ["QUEUED", "RUNNING"] } } });
        const configured = Number(process.env.AI_STUDIO_ACTIVE_TASK_LIMIT);
        const activeLimit = Number.isInteger(configured) && configured >= 1 ? Math.min(configured, 25) : 5;
        if (active >= activeLimit) throw new ConflictException(`Mỗi tài khoản quản trị chỉ được có tối đa ${activeLimit} tác vụ AI đang chạy.`);
        return transaction.aiTask.create({
          data: {
            idempotencyKey: key,
            requestedByAdminId: actor.id,
            type,
            title,
            input,
            ...(marketingDraft ? { marketingDraft: { create: {
              createdByAdminId: actor.id,
              channel: marketingDraft.channel,
              objective: marketingDraft.objective,
              sourceProductIds: marketingDraft.sourceProductIds,
              sourceFacts: marketingDraft.sourceFacts,
              status: "QUEUED",
            } } } : {}),
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.findExistingTask(actor.id, key, type, fingerprint);
        if (raced) return type === "MARKETING_DRAFT_GENERATION" ? (raced as { id: string }) : raced;
      }
      throw error;
    }
    try {
      await this.queue.enqueue(task.id);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.aiTask.updateMany({ where: { id: task.id, status: "QUEUED" }, data: {
          status: "FAILED", errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Hàng đợi AI chưa sẵn sàng. Vui lòng thử lại.", completedAt: new Date(),
          ...(type === "SALES_ANSWER" ? { input: redactedSalesInput(input) } : {}),
        } }),
        ...(marketingDraft ? [this.prisma.aiMarketingDraft.updateMany({ where: { taskId: task.id, status: "QUEUED" }, data: { status: "FAILED", errorCode: "QUEUE_UNAVAILABLE" } })] : []),
      ]);
      throw error;
    }
    return task;
  }

  private async findExistingTask(actorId: string, key: string, type: PhaseFourTaskType, fingerprint: string) {
    const existing = await this.prisma.aiTask.findUnique({ where: { idempotencyKey: key }, include: { marketingDraft: { select: { id: true } } } });
    if (!existing) return null;
    const input = asRecord(existing.input);
    if (existing.requestedByAdminId !== actorId || existing.type !== type || input.requestFingerprint !== fingerprint) throw new ConflictException("Khóa idempotency đã được sử dụng cho yêu cầu khác.");
    return existing;
  }

  private async marketingTaskResponse(taskId: string) {
    const task = await this.prisma.aiTask.findUnique({ where: { id: taskId }, include: { marketingDraft: true } });
    if (!task?.marketingDraft) throw new NotFoundException("Không tìm thấy bản nháp được tạo từ tác vụ này.");
    return { task: { id: task.id, status: task.status, errorCode: task.errorCode, errorMessage: task.errorMessage }, draft: task.marketingDraft };
  }

  private async audit(actor: AdminIdentity, action: string, entityId: string, before: unknown, after: unknown) {
    await this.prisma.auditLog.create({ data: { adminId: actor.id, action, entityType: "AI_PHASE4", entityId, before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue, after: (after ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }

  private async log(event: string, adminId: string, taskId: string, fields: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ event, adminId, taskId, ...fields, at: new Date().toISOString() }));
  }
}

function normalizeIdempotencyKey(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 8 || key.length > 128) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho yêu cầu AI.");
  return key;
}

function fingerprintOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function redactedSalesInput(value: unknown): Prisma.InputJsonObject {
  const input = asRecord(value);
  const ids = (field: "catalog" | "knowledge") => Array.isArray(input[field])
    ? (input[field] as unknown[]).map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "").filter(Boolean).slice(0, 16)
    : [];
  return { redacted: true, sourceProductIds: ids("catalog"), policySourceIds: ids("knowledge"), requestFingerprint: typeof input.requestFingerprint === "string" ? input.requestFingerprint : "" };
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function pickMarketingFields(value: Record<string, unknown>) {
  return { title: value.title, caption: value.caption, body: value.body, callToAction: value.callToAction, seoTitle: value.seoTitle, seoDescription: value.seoDescription, altText: value.altText, hashtags: value.hashtags };
}
