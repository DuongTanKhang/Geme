import { BadRequestException } from "@nestjs/common";

export const marketingChannels = ["THREADS", "FACEBOOK", "INSTAGRAM", "BLOG", "EMAIL", "BANNER"] as const;
export type MarketingChannel = (typeof marketingChannels)[number];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:\+?84|0)(?:[ .()-]*\d){8,10}\b/;
const privateOrderPattern = /(?:đơn\s*(?:hàng\s*)?(?:của\s*tôi|của\s*mình|#|mã)|tra\s*cứu\s*đơn|mã\s*đơn|mã\s*vận\s*đơn|theo\s*dõi\s*đơn|hoàn\s*tiền|refund|\bGME-[A-Z0-9]{6,}(?:-[A-Z0-9]{3,})?\b)/i;
const privateProfilePattern = /(?:địa\s*chỉ|ngày\s*sinh|căn\s*cước|cccd|số\s*tài\s*khoản)\s*(?:của\s*(?:tôi|mình)|là)\b/i;
const privateHandoffQuestion = "Khách cần nhân viên GEME hỗ trợ thông tin cá nhân hoặc đơn hàng riêng tư. Không tra cứu hay suy đoán; hướng dẫn khách liên hệ nhân viên.";

export function normalizeSalesSubmission(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Yêu cầu tư vấn không hợp lệ.");
  const value = body as Record<string, unknown>;
  const rawQuestion = typeof value.question === "string" ? value.question.trim() : "";
  if (rawQuestion.length < 4 || rawQuestion.length > 1200) throw new BadRequestException("Câu hỏi cần có từ 4 đến 1.200 ký tự.");
  const privateRequest = emailPattern.test(rawQuestion) || phonePattern.test(rawQuestion) || privateOrderPattern.test(rawQuestion) || privateProfilePattern.test(rawQuestion);
  const budgetValue = value.maxBudget;
  let maxBudget: number | null = null;
  if (budgetValue !== undefined && budgetValue !== null && budgetValue !== "") {
    maxBudget = typeof budgetValue === "number" ? budgetValue : Number(budgetValue);
    if (!Number.isSafeInteger(maxBudget) || maxBudget < 1 || maxBudget > 2_000_000_000) throw new BadRequestException("Ngân sách chưa hợp lệ.");
  }
  return {
    question: privateRequest ? privateHandoffQuestion : rawQuestion,
    privateRequest,
    maxBudget,
  };
}

export function normalizeMarketingSubmission(body: unknown, idempotencyKey: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Brief Marketing không hợp lệ.");
  const value = body as Record<string, unknown>;
  const channel = typeof value.channel === "string" ? value.channel.trim().toUpperCase() : "";
  if (!marketingChannels.includes(channel as MarketingChannel)) throw new BadRequestException("Kênh nội dung không được hỗ trợ.");
  const objective = typeof value.objective === "string" ? value.objective.trim() : "";
  if (objective.length < 3 || objective.length > 800) throw new BadRequestException("Mục tiêu cần có từ 3 đến 800 ký tự.");
  if (!Array.isArray(value.productIds) || value.productIds.length < 1 || value.productIds.length > 12) throw new BadRequestException("Chọn từ 1 đến 12 sản phẩm đang hoạt động.");
  const productIds = [...new Set(value.productIds.filter((item): item is string => typeof item === "string"))];
  if (productIds.length !== value.productIds.length || productIds.some((id) => !uuidPattern.test(id))) throw new BadRequestException("Danh sách sản phẩm không hợp lệ.");
  const key = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
  if (key.length < 8 || key.length > 128) throw new BadRequestException("Thiếu Idempotency-Key hợp lệ cho yêu cầu tạo nội dung.");
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 64)).filter(Boolean).slice(0, 12)
    : [];
  const callToAction = typeof value.callToAction === "string" ? value.callToAction.trim().slice(0, 240) : "";
  return { channel: channel as MarketingChannel, objective, productIds, keywords, callToAction, idempotencyKey: key };
}

export function validateKnowledgeDocument(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Tài liệu chính sách không hợp lệ.");
  const value = body as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const topic = typeof value.topic === "string" ? value.topic.trim() : "";
  const sourceLabel = typeof value.sourceLabel === "string" ? value.sourceLabel.trim() : "";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const documentKey = typeof value.documentKey === "string" ? value.documentKey.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,98}$/.test(documentKey)) throw new BadRequestException("Mã tài liệu chỉ được gồm chữ thường, số và dấu gạch nối.");
  if (!title || title.length > 180 || !topic || topic.length > 80 || !sourceLabel || sourceLabel.length > 200 || content.length < 10 || content.length > 20_000) {
    throw new BadRequestException("Tiêu đề, chủ đề, nguồn và nội dung chính sách chưa hợp lệ.");
  }
  const effectiveFrom = parseOptionalDate(value.effectiveFrom, "Ngày hiệu lực");
  const expiresAt = parseOptionalDate(value.expiresAt, "Ngày hết hiệu lực");
  if (effectiveFrom && expiresAt && expiresAt <= effectiveFrom) throw new BadRequestException("Ngày hết hiệu lực phải sau ngày hiệu lực.");
  return { documentKey, title, topic, sourceLabel, content, effectiveFrom, expiresAt };
}

export function normalizeMarketingEdits(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Nội dung chỉnh sửa không hợp lệ.");
  const value = body as Record<string, unknown>;
  const limits: Record<string, number> = { title: 180, caption: 1200, body: 12000, callToAction: 240, seoTitle: 180, seoDescription: 320, altText: 500 };
  const result: Record<string, string | string[]> = {};
  for (const [field, limit] of Object.entries(limits)) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string") throw new BadRequestException(`Trường ${field} không hợp lệ.`);
    const text = (value[field] as string).trim();
    if (text.length > limit || /<\/?(?:script|iframe|object|embed)\b/i.test(text)) throw new BadRequestException(`Trường ${field} vượt giới hạn hoặc chứa nội dung không hợp lệ.`);
    result[field] = text;
  }
  if (value.hashtags !== undefined) {
    if (!Array.isArray(value.hashtags) || value.hashtags.length > 12 || value.hashtags.some((tag) => typeof tag !== "string" || tag.length > 40)) {
      throw new BadRequestException("Danh sách hashtag không hợp lệ.");
    }
    result.hashtags = [...new Set((value.hashtags as string[]).map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean))];
  }
  if (!Object.keys(result).length) throw new BadRequestException("Không có nội dung nào để cập nhật.");
  return result;
}

function parseOptionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException(`${label} không hợp lệ.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${label} không hợp lệ.`);
  return date;
}
