import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CUSTOMER_POLICY_DEFAULTS } from "./policy-defaults.js";

@Injectable()
export class CustomerPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const row = await this.prisma.siteSetting.upsert({
      where: { key: "customerPolicies" },
      create: { key: "customerPolicies", value: CUSTOMER_POLICY_DEFAULTS as any },
      update: {},
      select: { value: true, updatedAt: true },
    });
    const stored = Array.isArray(row.value) ? row.value as Array<Record<string, unknown>> : [];
    const bySlug = new Map(stored.map((item) => [String(item.slug || ""), item]));
    return CUSTOMER_POLICY_DEFAULTS.map((fallback) => {
      const item = bySlug.get(fallback.slug) || fallback;
      return {
        slug: fallback.slug,
        title: String(item.title || fallback.title),
        status: item.status === "PUBLISHED" ? "PUBLISHED" as const : "DRAFT" as const,
        content: typeof item.content === "string" ? item.content : fallback.content,
        updatedAt: row.updatedAt,
      };
    });
  }

  async save(input: unknown) {
    if (!Array.isArray(input)) throw new BadRequestException("Danh sách chính sách không hợp lệ.");
    const current = await this.list();
    const incoming = new Map(input
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => [String(item.slug || ""), item]));
    const allowed = new Set<string>(CUSTOMER_POLICY_DEFAULTS.map((item) => item.slug));
    const policies = current.map((policy) => {
      const item = incoming.get(policy.slug);
      if (!item) return { slug: policy.slug, title: policy.title, status: policy.status, content: policy.content };
      const title = String(item.title ?? policy.title).trim();
      const content = String(item.content ?? policy.content);
      if (!title || title.length > 180) throw new BadRequestException("Tên chính sách phải có tối đa 180 ký tự.");
      if (content.length > 100_000) throw new BadRequestException("Nội dung mỗi chính sách không được vượt quá 100.000 ký tự.");
      return { slug: policy.slug, title, status: item.status === "PUBLISHED" ? "PUBLISHED" as const : "DRAFT" as const, content };
    });
    for (const slug of incoming.keys()) if (!allowed.has(slug)) throw new BadRequestException("Có chính sách không hợp lệ trong yêu cầu.");
    await this.prisma.siteSetting.upsert({
      where: { key: "customerPolicies" },
      create: { key: "customerPolicies", value: policies as any },
      update: { value: policies as any },
    });
    return this.list();
  }

  async publicPolicy(slug: string) {
    const policy = (await this.list()).find((item) => item.slug === slug);
    if (!policy) throw new NotFoundException("Không tìm thấy chính sách.");
    if (policy.status !== "PUBLISHED") return { slug: policy.slug, title: policy.title, status: "DRAFT" as const, content: "" };
    return policy;
  }

  async registrationPrivacyPolicy() {
    const policy = await this.publicPolicy("bao-mat");
    if (!policy) throw new NotFoundException("Chưa có chính sách bảo mật.");
    return policy;
  }
}
