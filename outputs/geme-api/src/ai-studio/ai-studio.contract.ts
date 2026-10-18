export const AI_TASK_TYPES = [
  "CONTENT_DRAFT",
  "IMAGE_GENERATION",
  "PRODUCT_PUBLICATION_PROPOSAL",
] as const;

export type AiTaskKind = (typeof AI_TASK_TYPES)[number];

const taskTypeLabels: Record<AiTaskKind, string> = {
  CONTENT_DRAFT: "Bản nháp nội dung",
  IMAGE_GENERATION: "Yêu cầu tạo ảnh",
  PRODUCT_PUBLICATION_PROPOSAL: "Đề xuất xuất bản sản phẩm",
};

export type NormalizedAiTask = {
  type: AiTaskKind;
  title: string;
  prompt: string;
  idempotencyKey: string;
};

export class AiTaskInputError extends Error {}

export function normalizeAiTaskSubmission(body: unknown, keyHeader: unknown): NormalizedAiTask {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AiTaskInputError("Nội dung yêu cầu không hợp lệ.");
  }
  const value = body as Record<string, unknown>;
  const allowedKeys = new Set(["type", "title", "prompt"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new AiTaskInputError("AI Studio chỉ nhận loại tác vụ, tiêu đề và yêu cầu văn bản.");
  }

  const type = value.type;
  if (typeof type !== "string" || !AI_TASK_TYPES.includes(type as AiTaskKind)) {
    throw new AiTaskInputError("Loại tác vụ AI không được hỗ trợ.");
  }
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (!prompt || prompt.length > 5000) {
    throw new AiTaskInputError("Yêu cầu cần có từ 1 đến 5.000 ký tự.");
  }
  const suppliedTitle = typeof value.title === "string" ? value.title.trim() : "";
  if (suppliedTitle.length > 120) throw new AiTaskInputError("Tiêu đề tối đa 120 ký tự.");
  const idempotencyKey = typeof keyHeader === "string" ? keyHeader.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new AiTaskInputError("Thiếu khóa Idempotency-Key hợp lệ.");
  }

  const kind = type as AiTaskKind;
  return {
    type: kind,
    title: suppliedTitle || taskTypeLabels[kind],
    prompt,
    idempotencyKey,
  };
}

export function isTaskType(value: string): value is AiTaskKind {
  return AI_TASK_TYPES.includes(value as AiTaskKind);
}
