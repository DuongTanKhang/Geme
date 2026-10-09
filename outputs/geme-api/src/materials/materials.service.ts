import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import type { MaterialOption, MaterialOptionKind, MaterialOptionScope } from "../generated/prisma/client.js";
import { Observable, ReplaySubject, interval, map, merge } from "rxjs";
import { PrismaService } from "../prisma/prisma.service.js";
import { MaterialOptionInputDto, UpdateMaterialOptionDto } from "./dto/material-option.dto.js";

const slugify = (value: string) => value
  .trim()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[đĐ]/g, "d")
  .toLocaleLowerCase("vi")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const applicabilitySettingKey = "inventory.materialCategoryApplicability";

@Injectable()
export class MaterialsService implements OnModuleInit {
  private readonly changes = new ReplaySubject<MaterialOption[]>(1);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Prime the replay stream once. The old per-subscriber database snapshot
    // made every open browser query all material options again.
    await this.publish();
  }

  private async applicabilityMap(client: any = this.prisma): Promise<Record<string, string[]>> {
    const setting = await client.siteSetting.findUnique({ where: { key: applicabilitySettingKey }, select: { value: true } });
    if (!setting?.value || typeof setting.value !== "object" || Array.isArray(setting.value)) return {};
    return Object.fromEntries(Object.entries(setting.value as Record<string, unknown>)
      .filter(([, ids]) => Array.isArray(ids))
      .map(([id, ids]) => [id, [...new Set((ids as unknown[]).filter((value): value is string => typeof value === "string"))]]));
  }

  private async validateCategoryIds(client: any, scope: MaterialOptionScope, input: unknown): Promise<string[]> {
    if (!Array.isArray(input) || input.length > 200 || input.some((id) => typeof id !== "string" || !id.trim())) {
      throw new BadRequestException("Danh sách danh mục áp dụng không hợp lệ.");
    }
    const ids = [...new Set(input.map((id: string) => id.trim()))];
    if (ids.length !== input.length) throw new BadRequestException("Danh mục áp dụng đang bị trùng.");
    if (!ids.length) return ids;
    const expectedKind = scope === "GEMSTONE" ? "GEMSTONE" : "JEWELRY";
    const categories = await client.category.findMany({
      where: { id: { in: ids }, kind: expectedKind, usage: "PRODUCT_CATEGORY", level: { gt: 1 }, status: "ACTIVE" },
      select: { id: true },
    });
    if (categories.length !== ids.length) {
      throw new BadRequestException("Chỉ áp dụng loại đá cho danh mục sản phẩm đang hoạt động cùng nhóm.");
    }
    return ids;
  }

  private async saveApplicability(client: any, materialId: string, categoryIds: string[]) {
    const map = await this.applicabilityMap(client);
    map[materialId] = categoryIds;
    await client.siteSetting.upsert({
      where: { key: applicabilitySettingKey },
      create: { key: applicabilitySettingKey, value: map as any },
      update: { value: map as any },
    });
  }

  async list(scope?: MaterialOptionScope) {
    const [records, map] = await Promise.all([
      this.prisma.materialOption.findMany({
        ...(scope ? { where: { scope } } : {}),
        orderBy: [{ scope: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      }),
      this.applicabilityMap(),
    ]);
    return records.map((record) => Object.prototype.hasOwnProperty.call(map, record.id)
      ? { ...record, appliedCategoryIds: map[record.id] }
      : record);
  }

  events(): Observable<{ data: MaterialOption[] | ""; type?: string }> {
    const updates = this.changes.asObservable().pipe(map((data) => ({ data })));
    const keepAlive = interval(25_000).pipe(map(() => ({ type: "ping", data: "" as const })));
    return merge(updates, keepAlive);
  }

  private async publish() {
    this.changes.next(await this.list());
  }

  async create(input: MaterialOptionInputDto) {
    const scope = input.scope as MaterialOptionScope;
    const record = await this.prisma.$transaction(async (tx) => {
      const categoryIds = input.appliedCategoryIds === undefined ? undefined : await this.validateCategoryIds(tx, scope, input.appliedCategoryIds);
      const created = await tx.materialOption.create({
        data: {
          name: input.name.trim(),
          slug: slugify(input.name),
          scope,
          kind: (input.kind ?? "STONE") as MaterialOptionKind,
          active: input.active ?? true,
          imageUrl: input.imageUrl || null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      if (categoryIds) await this.saveApplicability(tx, created.id, categoryIds);
      return categoryIds ? { ...created, appliedCategoryIds: categoryIds } : created;
    });
    await this.publish();
    return record;
  }

  async update(id: string, input: UpdateMaterialOptionDto) {
    const current = await this.prisma.materialOption.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy mục chất liệu / loại đá.");
    const scope = (input.scope ?? current.scope) as MaterialOptionScope;
    const record = await this.prisma.$transaction(async (tx) => {
      const categoryIds = input.appliedCategoryIds === undefined ? undefined : await this.validateCategoryIds(tx, scope, input.appliedCategoryIds);
      const updated = await tx.materialOption.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim(), slug: slugify(input.name) } : {}),
          ...(input.scope !== undefined ? { scope } : {}),
          ...(input.kind !== undefined ? { kind: input.kind as MaterialOptionKind } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      if (categoryIds) await this.saveApplicability(tx, id, categoryIds);
      const applicability = await this.applicabilityMap(tx);
      return Object.prototype.hasOwnProperty.call(applicability, id)
        ? { ...updated, appliedCategoryIds: applicability[id] }
        : updated;
    });
    await this.publish();
    return record;
  }

  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.materialOption.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException("Không tìm thấy mục chất liệu / loại đá.");

      // Detach the option from products and SKU rules before deleting it. This also
      // keeps databases whose FK has not yet applied ON DELETE SET NULL usable.
      await tx.product.updateMany({ where: { materialOptionId: id }, data: { materialOptionId: null } });
      const setting = await tx.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
      if (Array.isArray(setting?.value)) {
        const rules = (setting.value as Array<Record<string, unknown>>).map((rule) => ({
          ...rule,
          ...(Array.isArray(rule.materialOptionIds)
            ? { materialOptionIds: rule.materialOptionIds.filter((materialId) => materialId !== id) }
            : {}),
          ...(Array.isArray(rule.materialPrefixes)
            ? { materialPrefixes: rule.materialPrefixes.filter((entry) => !entry || typeof entry !== "object" || (entry as Record<string, unknown>).materialOptionId !== id) }
            : {}),
        }));
        await tx.siteSetting.update({ where: { key: "inventory.skuRules" }, data: { value: rules as any } });
      }
      const applicability = await this.applicabilityMap(tx);
      if (Object.prototype.hasOwnProperty.call(applicability, id)) {
        delete applicability[id];
        await tx.siteSetting.upsert({
          where: { key: applicabilitySettingKey },
          create: { key: applicabilitySettingKey, value: applicability as any },
          update: { value: applicability as any },
        });
      }
      await tx.materialOption.delete({ where: { id } });
    });
    await this.publish();
    return { deleted: true };
  }

  async importLocalOptions(items: MaterialOptionInputDto[]) {
    await this.prisma.$transaction(async (transaction) => {
      for (const item of items) {
        const scope = item.scope as MaterialOptionScope;
        const slug = slugify(item.name);
        await transaction.materialOption.upsert({
          where: { scope_slug: { scope, slug } },
          create: {
            name: item.name.trim(), slug, scope,
            kind: (item.kind ?? "STONE") as MaterialOptionKind,
            active: item.active ?? true,
            imageUrl: item.imageUrl || null,
            sortOrder: item.sortOrder ?? 0,
          },
          update: {
            name: item.name.trim(), kind: (item.kind ?? "STONE") as MaterialOptionKind,
            active: item.active ?? true, imageUrl: item.imageUrl || null,
            sortOrder: item.sortOrder ?? 0,
          },
        });
      }
    });
    await this.publish();
    return this.list();
  }
}
