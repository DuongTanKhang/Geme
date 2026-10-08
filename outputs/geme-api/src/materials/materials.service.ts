import { Injectable, NotFoundException } from "@nestjs/common";
import type { MaterialOption, MaterialOptionKind, MaterialOptionScope } from "../generated/prisma/client.js";
import { Observable, ReplaySubject, concat, defer, from, map } from "rxjs";
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

@Injectable()
export class MaterialsService {
  private readonly changes = new ReplaySubject<MaterialOption[]>(1);

  constructor(private readonly prisma: PrismaService) {}

  list(scope?: MaterialOptionScope) {
    return this.prisma.materialOption.findMany({
      ...(scope ? { where: { scope } } : {}),
      orderBy: [{ scope: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
  }

  events(): Observable<{ data: MaterialOption[] }> {
    const snapshot = defer(() => from(this.list())).pipe(map((data) => ({ data })));
    return concat(snapshot, this.changes.asObservable().pipe(map((data) => ({ data }))));
  }

  private async publish() {
    this.changes.next(await this.list());
  }

  async create(input: MaterialOptionInputDto) {
    const record = await this.prisma.materialOption.create({
      data: {
        name: input.name.trim(),
        slug: slugify(input.name),
        scope: input.scope as MaterialOptionScope,
        kind: (input.kind ?? "STONE") as MaterialOptionKind,
        active: input.active ?? true,
        imageUrl: input.imageUrl || null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    await this.publish();
    return record;
  }

  async update(id: string, input: UpdateMaterialOptionDto) {
    const current = await this.prisma.materialOption.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Không tìm thấy mục chất liệu / loại đá.");
    const record = await this.prisma.materialOption.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim(), slug: slugify(input.name) } : {}),
        ...(input.scope !== undefined ? { scope: input.scope as MaterialOptionScope } : {}),
        ...(input.kind !== undefined ? { kind: input.kind as MaterialOptionKind } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
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
