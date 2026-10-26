import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { compareNewArrivalsGroups, listedStoreCardPrice, newArrivalsModeCondition, newArrivalsProductOrder } from "./new-arrivals.rules.js";

type Query = Record<string, any>;
type Sort = "recommended" | "newest" | "best_selling" | "price_asc" | "price_desc";
type Mode = "all" | "tagged" | "published";
type Filter = { mode: Mode; sort: Sort; now: Date; recentDays: number; categoryIds: string[]; visibleCategoryIds: string[]; stoneGroupIds: string[]; sizes: string[]; search: string; minPrice: number | null; maxPrice: number | null };

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const readArray = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_GROUP = { id: "other", slug: "trang-suc-khac", name: "Trang sức khác", pinnedOrder: null as number | null, sortOrder: Number.MAX_SAFE_INTEGER };

@Injectable()
export class NewArrivalsService {
  constructor(private readonly prisma: PrismaService) {}

  private async recentDays() {
    const setting = await this.prisma.siteSetting.findUnique({ where: { key: "newArrivalsRecentDays" }, select: { value: true } });
    const value = Number(setting?.value);
    return Number.isInteger(value) && value >= 1 && value <= 365 ? value : 30;
  }

  private async filters(query: Query): Promise<Filter> {
    const modeValue = first(query.mode) || "all";
    const sortValue = first(query.sort) || "recommended";
    if (!(new Set(["all", "tagged", "published"])).has(modeValue)) throw new BadRequestException("mode phải là all, tagged hoặc published.");
    if (!(new Set(["recommended", "newest", "best_selling", "price_asc", "price_desc"])).has(sortValue)) throw new BadRequestException("sort không hợp lệ.");
    const [recentDays, categories] = await Promise.all([
      this.recentDays(),
      this.prisma.category.findMany({ select: { id: true, parentId: true, status: true } }),
    ]);
    const now = new Date();
    const requestedCategoryIds = readArray(query.categoryId);
    if (requestedCategoryIds.some((id) => !uuidPattern.test(id))) throw new BadRequestException("categoryId phải là UUID hợp lệ.");
    const categoryIds = new Set(requestedCategoryIds);
    let categoriesChanged = true;
    while (categoriesChanged) {
      categoriesChanged = false;
      for (const category of categories) if (category.parentId && categoryIds.has(category.parentId) && !categoryIds.has(category.id)) { categoryIds.add(category.id); categoriesChanged = true; }
    }
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const visibleCategoryIds = new Set<string>();
    for (const category of categories) {
      let current: (typeof category) | undefined = category;
      const seen = new Set<string>();
      let valid = true;
      while (current) {
        if (current.status !== "ACTIVE" || seen.has(current.id)) { valid = false; break; }
        seen.add(current.id);
        const parentId = current.parentId;
        current = parentId ? categoryById.get(parentId) : undefined;
        if (parentId && !current) { valid = false; break; }
      }
      if (valid) visibleCategoryIds.add(category.id);
    }
    const stoneGroupIds = [...new Set(readArray(query.stoneGroupIds ?? query.stoneGroupId))];
    if (stoneGroupIds.length > 40 || stoneGroupIds.some((id) => id !== "other" && !uuidPattern.test(id))) throw new BadRequestException("stoneGroupId không hợp lệ.");
    const sizes = [...new Set(readArray(query.size))];
    if (sizes.length > 40 || sizes.some((size) => size.length > 24 || /[\u0000-\u001f]/.test(size))) throw new BadRequestException("size không hợp lệ.");
    const numeric = (key: "minPrice" | "maxPrice") => {
      const raw = first(query[key]);
      if (raw === undefined || raw === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new BadRequestException(`${key} phải là số không âm.`);
      return value;
    };
    const minPrice = numeric("minPrice");
    const maxPrice = numeric("maxPrice");
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new BadRequestException("minPrice không được lớn hơn maxPrice.");
    return {
      // Legacy values are accepted so old links remain valid, but the result is
      // always scoped to products with an active New tag.
      mode: "tagged", sort: sortValue as Sort, now, recentDays,
      categoryIds: [...categoryIds], visibleCategoryIds: [...visibleCategoryIds], stoneGroupIds, sizes,
      search: (first(query.search) || "").trim().slice(0, 120), minPrice, maxPrice,
    };
  }

  private cte(filter: Filter, groupId?: string | null) {
    const fromDate = new Date(filter.now.getTime() - filter.recentDays * 24 * 60 * 60 * 1000);
    const salesJoin = filter.sort === "best_selling"
      ? Prisma.sql`LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(i."quantity"), 0)::int AS sold_quantity
          FROM "order_items" i JOIN "orders" o ON o."id" = i."order_id"
          WHERE i."product_sku" = "p"."sku"
            AND o."placed_at" >= ${new Date(filter.now.getTime() - 30 * 86_400_000)}
            AND o."placed_at" <= ${filter.now}
            AND o."status"::text <> 'CANCELLED'
        ) "sales" ON true`
      : Prisma.sql`LEFT JOIN LATERAL (SELECT 0::int AS sold_quantity) "sales" ON true`;
    const conditions: Prisma.Sql[] = [
        Prisma.sql`status = 'ACTIVE'`,
        Prisma.sql`kind = 'JEWELRY'`,
        Prisma.sql`(category_id IS NULL OR category_id = ANY(${filter.visibleCategoryIds}::uuid[]))`,
        Prisma.sql`(gemstone_type_id IS NULL OR gemstone_type_id = ANY(${filter.visibleCategoryIds}::uuid[]))`,
        Prisma.sql`(material_option_id IS NULL OR material_active = true)`,
        newArrivalsModeCondition(filter.mode, filter.now, fromDate),
      ];
      if (filter.categoryIds.length) conditions.push(Prisma.sql`category_id = ANY(${filter.categoryIds}::uuid[])`);
      const requestedStoneGroups = filter.stoneGroupIds.filter((id) => id !== "other");
      const includesOther = filter.stoneGroupIds.includes("other");
      if (requestedStoneGroups.length && includesOther) conditions.push(Prisma.sql`("priced"."group_id" IS NULL OR "priced"."group_id" = ANY(${requestedStoneGroups}::uuid[]))`);
      else if (requestedStoneGroups.length) conditions.push(Prisma.sql`"priced"."group_id" = ANY(${requestedStoneGroups}::uuid[])`);
      else if (includesOther || groupId === "other") conditions.push(Prisma.sql`"priced"."group_id" IS NULL`);
      else if (groupId) conditions.push(Prisma.sql`"priced"."group_id" = ${groupId}::uuid`);
      if (filter.sizes.length) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "product_price_variants" size_variant WHERE size_variant."product_id" = "priced"."id" AND size_variant."bead_size" = ANY(${filter.sizes}::text[]))`);
      if (filter.search) conditions.push(Prisma.sql`(name ILIKE ${`%${filter.search}%`} OR sku ILIKE ${`%${filter.search}%`})`);
      if (filter.minPrice !== null) conditions.push(Prisma.sql`"priced"."listed_price" >= ${filter.minPrice}`);
      if (filter.maxPrice !== null) conditions.push(Prisma.sql`"priced"."listed_price" <= ${filter.maxPrice}`);
    return Prisma.sql`
        WITH RECURSIVE category_ancestors AS (
          SELECT "id" AS category_id, "id" AS ancestor_id, "parent_id" AS parent_id, ARRAY["id"]::uuid[] AS path
          FROM "categories"
          UNION ALL
          SELECT ca.category_id, parent."id" AS ancestor_id, parent."parent_id", ca.path || parent."id"
          FROM category_ancestors ca
          JOIN "categories" parent ON parent."id" = ca.parent_id
          WHERE NOT parent."id" = ANY(ca.path)
        ), base AS (
          SELECT "p"."id", "p"."sku", "p"."name", "p"."slug", "p"."kind", "p"."category_id", "p"."gemstone_type_id", "p"."material_option_id",
            "p"."jewelry_stone_group_id", "p"."status", "p"."is_new", "p"."new_until", "p"."first_published_at", "p"."is_featured", "p"."is_premium_gemstone",
            "p"."price", "p"."original_price", "p"."stock", "p"."created_at", "p"."updated_at", "p"."cover_video_url",
            COALESCE("sales"."sold_quantity", 0) AS sold_quantity,
            "mo"."active" AS material_active,
            CASE
              WHEN "p"."jewelry_stone_group_id" IS NOT NULL THEN "direct_group"."id"
              WHEN "material_group"."id" IS NOT NULL AND "category_group"."id" IS NOT NULL AND "material_group"."id" <> "category_group"."id" THEN NULL
              ELSE COALESCE("material_group"."id", "category_group"."id")
            END AS group_id,
            CASE WHEN "p"."is_new" = true AND ("p"."new_until" IS NULL OR "p"."new_until" > ${filter.now}) THEN true ELSE false END AS new_label_active,
            ${listedStoreCardPrice()} AS listed_price,
            COALESCE("direct_group"."name", "material_group"."name", "category_group"."name") AS mapped_group_name,
            COALESCE("direct_group"."slug", "material_group"."slug", "category_group"."slug") AS mapped_group_slug,
            COALESCE("direct_group"."pinned_order", "material_group"."pinned_order", "category_group"."pinned_order") AS pinned_order,
            COALESCE("direct_group"."sort_order", "material_group"."sort_order", "category_group"."sort_order", 2147483647) AS group_sort_order,
            CASE WHEN EXISTS (SELECT 1 FROM "product_price_variants" av WHERE av."product_id" = "p"."id")
              THEN EXISTS (SELECT 1 FROM "product_price_variants" avs WHERE avs."product_id" = "p"."id" AND avs."stock" > 0)
              ELSE "p"."stock" > 0 END AS can_buy,
            COALESCE("promo"."discount_percent", 0) AS discount_percent
          FROM "products" "p"
          LEFT JOIN "material_options" "mo" ON "mo"."id" = "p"."material_option_id"
          LEFT JOIN "categories" "stone_category" ON "stone_category"."id" = "p"."gemstone_type_id"
          LEFT JOIN "jewelry_stone_groups" "direct_group" ON "direct_group"."id" = "p"."jewelry_stone_group_id" AND "direct_group"."active" = true
          LEFT JOIN "jewelry_stone_groups" "material_group" ON "material_group"."id" = "mo"."jewelry_stone_group_id" AND "material_group"."active" = true
          LEFT JOIN "jewelry_stone_groups" "category_group" ON "category_group"."id" = "stone_category"."jewelry_stone_group_id" AND "category_group"."active" = true
          ${salesJoin}
          LEFT JOIN LATERAL (
            SELECT MAX(promo."value") AS discount_percent
            FROM "promotions" promo
            JOIN "promotion_targets" included ON included."promotion_id" = promo."id" AND included."excluded" = false
            WHERE promo."visible" = true AND promo."status" = 'ACTIVE' AND promo."type" = 'PERCENTAGE'
              AND promo."starts_at" <= ${filter.now} AND promo."ends_at" >= ${filter.now}
              AND (included."product_id" = "p"."id" OR (included."category_id" IS NOT NULL AND EXISTS (
                SELECT 1 FROM category_ancestors ca WHERE ca.ancestor_id = included."category_id" AND ca.category_id IN ("p"."category_id", "p"."gemstone_type_id")
              )))
              AND NOT EXISTS (
                SELECT 1 FROM "promotion_targets" excluded
                WHERE excluded."promotion_id" = promo."id" AND excluded."excluded" = true
                  AND (excluded."product_id" = "p"."id" OR (excluded."category_id" IS NOT NULL AND EXISTS (
                    SELECT 1 FROM category_ancestors ca WHERE ca.ancestor_id = excluded."category_id" AND ca.category_id IN ("p"."category_id", "p"."gemstone_type_id")
                  )))
              )
          ) "promo" ON true
          WHERE "p"."kind" = 'JEWELRY' AND "p"."status" = 'ACTIVE'
        ), resolved AS (
          SELECT base.*, CASE WHEN listed_price IS NULL THEN NULL ELSE ROUND(listed_price * (1 - LEAST(discount_percent, 100) / 100)) END AS sale_price
          FROM base
        ), priced AS (
          SELECT * FROM resolved
        ), filtered AS (
          SELECT priced.*, group_id::text AS result_group_id,
            COALESCE(mapped_group_slug, '') AS result_group_slug
          FROM priced
          WHERE ${Prisma.join(conditions, " AND ")}
        )
    `;
  }

  private async filterFacets(now: Date) {
    const tagPredicate = Prisma.sql`p."kind" = 'JEWELRY' AND p."status" = 'ACTIVE' AND p."is_new" = true AND (p."new_until" IS NULL OR p."new_until" > ${now})`;
    const [categoryRows, stoneRows, sizeRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; count: number }>>`SELECT p."category_id"::text AS id, COUNT(*)::int AS count FROM "products" p WHERE ${tagPredicate} AND p."category_id" IS NOT NULL GROUP BY p."category_id"`,
      this.prisma.$queryRaw<Array<{ id: string | null; slug: string; name: string; count: number }>>`
        SELECT CASE
            WHEN p."jewelry_stone_group_id" IS NOT NULL THEN direct_group."id"::text
            WHEN material_group."id" IS NOT NULL AND category_group."id" IS NOT NULL AND material_group."id" <> category_group."id" THEN NULL
            ELSE COALESCE(material_group."id", category_group."id")::text
          END AS id,
          CASE
            WHEN p."jewelry_stone_group_id" IS NOT NULL THEN COALESCE(direct_group."slug", 'trang-suc-khac')
            WHEN material_group."id" IS NOT NULL AND category_group."id" IS NOT NULL AND material_group."id" <> category_group."id" THEN 'trang-suc-khac'
            ELSE COALESCE(material_group."slug", category_group."slug", 'trang-suc-khac')
          END AS slug,
          CASE
            WHEN p."jewelry_stone_group_id" IS NOT NULL THEN COALESCE(direct_group."name", 'Trang sức khác')
            WHEN material_group."id" IS NOT NULL AND category_group."id" IS NOT NULL AND material_group."id" <> category_group."id" THEN 'Trang sức khác'
            ELSE COALESCE(material_group."name", category_group."name", 'Trang sức khác')
          END AS name,
          COUNT(*)::int AS count
        FROM "products" p
        LEFT JOIN "material_options" mo ON mo."id" = p."material_option_id"
        LEFT JOIN "categories" stone_category ON stone_category."id" = p."gemstone_type_id"
        LEFT JOIN "jewelry_stone_groups" direct_group ON direct_group."id" = p."jewelry_stone_group_id" AND direct_group."active" = true
        LEFT JOIN "jewelry_stone_groups" material_group ON material_group."id" = mo."jewelry_stone_group_id" AND material_group."active" = true
        LEFT JOIN "jewelry_stone_groups" category_group ON category_group."id" = stone_category."jewelry_stone_group_id" AND category_group."active" = true
        WHERE ${tagPredicate} AND (p."material_option_id" IS NULL OR mo."active" = true)
        GROUP BY 1, 2, 3 ORDER BY count DESC, name ASC
      `,
      this.prisma.$queryRaw<Array<{ size: string; count: number }>>`
        SELECT pv."bead_size" AS size, COUNT(DISTINCT p."id")::int AS count
        FROM "product_price_variants" pv JOIN "products" p ON p."id" = pv."product_id"
        WHERE ${tagPredicate} AND NULLIF(BTRIM(pv."bead_size"), '') IS NOT NULL
        GROUP BY pv."bead_size" ORDER BY pv."bead_size" ASC
      `,
    ]);
    return {
      facets: {
        categories: categoryRows.map((row) => ({ id: row.id, count: Number(row.count) })),
        stones: stoneRows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, count: Number(row.count) })),
        sizes: sizeRows.map((row) => ({ size: row.size, count: Number(row.count) })),
      },
    };
  }

  private order(filter: Filter) {
    return newArrivalsProductOrder(filter.sort);
  }

  private async cards(ids: string[], activeNewById: Map<string, boolean>) {
    if (!ids.length) return [];
    const records = await this.prisma.product.findMany({
      where: { id: { in: ids }, kind: "JEWELRY", status: "ACTIVE" },
      select: {
        id: true, sku: true, name: true, slug: true, kind: true, categoryId: true, gemstoneTypeId: true,
        status: true, isNew: true, isFeatured: true, isPremiumGemstone: true, price: true, originalPrice: true,
        stock: true, createdAt: true, updatedAt: true, coverVideoUrl: true,
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 2, select: { url: true, alt: true, sortOrder: true, isPrimary: true } },
      },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return ids.flatMap((id) => {
      const record = byId.get(id);
      return record ? [{ ...record, newLabelActive: activeNewById.get(id) ?? false }] : [];
    });
  }

  async list(query: Query) {
    const filter = await this.filters(query);
    const pageValue = Number(first(query.groupPage) || 1);
    if (!Number.isInteger(pageValue) || pageValue < 1 || pageValue > 100_000) throw new BadRequestException("groupPage phải là số nguyên dương hợp lệ.");
    const groupPageSize = 12;
    const groupOffset = (pageValue - 1) * groupPageSize;
    const cte = await this.cte(filter);
    const [rows, facetResult] = await Promise.all([this.prisma.$queryRaw<Array<any>>(Prisma.sql`${cte}, ranked AS (
      SELECT *, COUNT(*) OVER(PARTITION BY COALESCE(result_group_id, 'other')) AS group_total,
        MAX(first_published_at) OVER(PARTITION BY COALESCE(result_group_id, 'other')) AS latest_published_at,
        ROW_NUMBER() OVER(PARTITION BY COALESCE(result_group_id, 'other') ORDER BY ${this.order(filter)}) AS product_rank
      FROM filtered
    ), group_summary AS (
      SELECT COALESCE(result_group_id, 'other') AS group_key, MAX(pinned_order) AS pinned_order,
        MAX(latest_published_at) AS latest_published_at, MIN(group_sort_order) AS group_sort_order,
        MAX(group_total) AS group_total
      FROM ranked GROUP BY COALESCE(result_group_id, 'other')
    ), group_ordered AS (
      SELECT *, ROW_NUMBER() OVER(ORDER BY
        CASE WHEN group_key = 'other' THEN 1 ELSE 0 END ASC,
        CASE WHEN group_key <> 'other' AND pinned_order IS NOT NULL THEN 0 ELSE 1 END ASC,
        pinned_order ASC NULLS LAST,
        CASE WHEN pinned_order IS NULL AND group_key <> 'other' THEN latest_published_at END DESC NULLS LAST,
        group_sort_order ASC, group_key ASC
      ) AS group_rank, COUNT(*) OVER() AS total_groups,
      SUM(group_total) OVER() AS total_products
      FROM group_summary
    )
    SELECT ranked.*, group_ordered.group_rank, group_ordered.total_groups, group_ordered.total_products
    FROM ranked JOIN group_ordered ON group_ordered.group_key = COALESCE(ranked.result_group_id, 'other')
    WHERE ranked.product_rank <= 8 AND group_ordered.group_rank > ${groupOffset} AND group_ordered.group_rank <= ${groupOffset + groupPageSize}
    ORDER BY group_ordered.group_rank ASC, ranked.product_rank ASC`), this.filterFacets(filter.now)]);
    const activeNewById = new Map<string, boolean>(rows.map((row) => [String(row.id), Boolean(row.new_label_active)]));
    const products = await this.cards(rows.map((row) => String(row.id)), activeNewById);
    const productsById = new Map(products.map((product: any) => [String(product.id), product]));
    const groups = new Map<string, any>();
    for (const row of rows) {
      const groupId = String(row.result_group_id || "other");
      if (!groups.has(groupId)) groups.set(groupId, {
        id: groupId === "other" ? null : groupId,
        slug: groupId === "other" ? FALLBACK_GROUP.slug : String(row.result_group_slug || ""),
        name: groupId === "other" ? FALLBACK_GROUP.name : String(row.mapped_group_name || ""),
        pinnedOrder: row.pinned_order === null ? null : Number(row.pinned_order),
        sortOrder: Number(row.group_sort_order) || 0,
        latestPublishedAt: row.latest_published_at || null,
        total: Number(row.group_total) || 0,
        products: [],
      });
      const product = productsById.get(String(row.id));
      if (product) groups.get(groupId).products.push(product);
    }
    const items = [...groups.values()].sort(compareNewArrivalsGroups).map(({ sortOrder: _sortOrder, ...group }) => ({ ...group, hasMore: group.total > group.products.length }));
    let totalGroups = Number(rows[0]?.total_groups || 0);
    let totalProducts = Number(rows[0]?.total_products || 0);
    if (!rows.length) {
      const totals = await this.prisma.$queryRaw<Array<{ total_groups: bigint; total_products: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*)::bigint AS total_groups, COALESCE(SUM(group_total), 0)::bigint AS total_products FROM (SELECT COALESCE(result_group_id, 'other') AS group_key, COUNT(*)::bigint AS group_total FROM filtered GROUP BY 1) groups`);
      totalGroups = Number(totals[0]?.total_groups || 0);
      totalProducts = Number(totals[0]?.total_products || 0);
    }
    return { mode: filter.mode, recentDays: filter.recentDays, ...facetResult, totalProducts, groups: items, pageInfo: { groupPage: pageValue, groupPageSize, totalGroups, hasNextGroup: groupOffset + items.length < totalGroups, nextGroupPage: groupOffset + items.length < totalGroups ? pageValue + 1 : null } };
  }

  async listPublicGroups() {
    return this.prisma.jewelryStoneGroup.findMany({ where: { active: true }, orderBy: [{ pinnedOrder: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { id: "asc" }], select: { id: true, slug: true, name: true, pinnedOrder: true, sortOrder: true } });
  }

  async groupProducts(slug: string, query: Query) {
    const group = slug === FALLBACK_GROUP.slug
      ? FALLBACK_GROUP
      : await this.prisma.jewelryStoneGroup.findFirst({ where: { slug, active: true }, select: { id: true, slug: true, name: true, pinnedOrder: true, sortOrder: true } });
    if (!group) throw new NotFoundException("Không tìm thấy nhóm đá đang hoạt động.");
    const filter = await this.filters(query);
    const page = Math.max(1, Math.min(100_000, Math.floor(Number(first(query.page)) || 1)));
    const cte = await this.cte(filter, group.id === "other" ? "other" : group.id);
    const order = this.order(filter);
    const [totalRows, facetResult] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`${cte} SELECT COUNT(*)::bigint AS total FROM filtered`),
      this.filterFacets(filter.now),
    ]);
    const total = Number(totalRows[0]?.total || 0);
    const offset = (page - 1) * 40;
    const rows = await this.prisma.$queryRaw<Array<any>>(Prisma.sql`${cte}, ranked AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY ${order}) AS row_number FROM filtered
    ) SELECT * FROM ranked WHERE row_number > ${offset} AND row_number <= ${offset + 40} ORDER BY row_number`);
    const activeNewById = new Map<string, boolean>(rows.map((row) => [String(row.id), Boolean(row.new_label_active)]));
    const products = await this.cards(rows.map((row) => String(row.id)), activeNewById);
    return { mode: filter.mode, recentDays: filter.recentDays, ...facetResult, group: { id: group.id === "other" ? null : group.id, slug: group.slug, name: group.name }, total, products, pageInfo: { page, pageSize: 40, hasNextPage: offset + products.length < total, nextPage: offset + products.length < total ? page + 1 : null } };
  }

  async listGroupsAdmin() {
    const [groupRecords, groupedCounts, unassignedCountRows, unresolved, conflictRows, conflictCountRows] = await Promise.all([
      this.prisma.jewelryStoneGroup.findMany({
        orderBy: [{ pinnedOrder: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }, { id: "asc" }],
        include: { _count: { select: { products: true } }, categories: { select: { id: true, name: true, slug: true, kind: true } }, materials: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.$queryRaw<Array<{ group_id: string | null; count: bigint }>>`SELECT CASE WHEN p.jewelry_stone_group_id IS NOT NULL THEN direct_group.id WHEN mg.id IS NOT NULL AND cg.id IS NOT NULL AND mg.id <> cg.id THEN NULL ELSE COALESCE(mg.id, cg.id) END AS group_id, COUNT(*)::bigint AS count FROM products p LEFT JOIN material_options m ON m.id = p.material_option_id LEFT JOIN categories c ON c.id = p.gemstone_type_id LEFT JOIN jewelry_stone_groups direct_group ON direct_group.id = p.jewelry_stone_group_id AND direct_group.active = true LEFT JOIN jewelry_stone_groups mg ON mg.id = m.jewelry_stone_group_id AND mg.active = true LEFT JOIN jewelry_stone_groups cg ON cg.id = c.jewelry_stone_group_id AND cg.active = true WHERE p.kind = 'JEWELRY' AND p.status <> 'ARCHIVED' GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM products p LEFT JOIN material_options m ON m.id = p.material_option_id LEFT JOIN categories c ON c.id = p.gemstone_type_id LEFT JOIN jewelry_stone_groups direct_group ON direct_group.id = p.jewelry_stone_group_id AND direct_group.active = true LEFT JOIN jewelry_stone_groups mg ON mg.id = m.jewelry_stone_group_id AND mg.active = true LEFT JOIN jewelry_stone_groups cg ON cg.id = c.jewelry_stone_group_id AND cg.active = true WHERE p.kind = 'JEWELRY' AND p.status <> 'ARCHIVED' AND ((p.jewelry_stone_group_id IS NOT NULL AND direct_group.id IS NULL) OR (p.jewelry_stone_group_id IS NULL AND mg.id IS NULL AND cg.id IS NULL))`,
      this.prisma.$queryRaw<Array<{ id: string; sku: string; name: string; category_group: string | null; material_group: string | null; issue: string }>>`SELECT p.id, p.sku, p.name, cg.name AS category_group, mg.name AS material_group, CASE WHEN p.jewelry_stone_group_id IS NOT NULL THEN 'Nhóm gán trực tiếp đang tạm dừng' ELSE 'Chưa có mapping loại đá' END AS issue FROM products p LEFT JOIN material_options m ON m.id = p.material_option_id LEFT JOIN categories c ON c.id = p.gemstone_type_id LEFT JOIN jewelry_stone_groups mg ON mg.id = m.jewelry_stone_group_id AND mg.active = true LEFT JOIN jewelry_stone_groups cg ON cg.id = c.jewelry_stone_group_id AND cg.active = true LEFT JOIN jewelry_stone_groups direct_group ON direct_group.id = p.jewelry_stone_group_id AND direct_group.active = true WHERE p.kind = 'JEWELRY' AND p.status <> 'ARCHIVED' AND ((p.jewelry_stone_group_id IS NOT NULL AND direct_group.id IS NULL) OR (p.jewelry_stone_group_id IS NULL AND mg.id IS NULL AND cg.id IS NULL)) ORDER BY p.sku ASC LIMIT 100`,
      this.prisma.$queryRaw<Array<{ id: string; sku: string; name: string; category_group: string; material_group: string }>>`SELECT p.id, p.sku, p.name, cg.name AS category_group, mg.name AS material_group FROM products p JOIN material_options m ON m.id = p.material_option_id JOIN categories c ON c.id = p.gemstone_type_id JOIN jewelry_stone_groups mg ON mg.id = m.jewelry_stone_group_id AND mg.active = true JOIN jewelry_stone_groups cg ON cg.id = c.jewelry_stone_group_id AND cg.active = true WHERE p.kind = 'JEWELRY' AND p.status <> 'ARCHIVED' AND p.jewelry_stone_group_id IS NULL AND mg.id <> cg.id ORDER BY p.sku ASC LIMIT 100`,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM products p JOIN material_options m ON m.id = p.material_option_id JOIN categories c ON c.id = p.gemstone_type_id JOIN jewelry_stone_groups mg ON mg.id = m.jewelry_stone_group_id AND mg.active = true JOIN jewelry_stone_groups cg ON cg.id = c.jewelry_stone_group_id AND cg.active = true WHERE p.kind = 'JEWELRY' AND p.status <> 'ARCHIVED' AND p.jewelry_stone_group_id IS NULL AND mg.id <> cg.id`,
    ]);
    const counts = new Map(groupedCounts.map((row) => [row.group_id, Number(row.count)]));
    const groups = groupRecords.map((group) => ({ ...group, _count: { products: counts.get(group.id) || 0 } }));
    return {
      groups,
      unassignedProducts: Number(unassignedCountRows[0]?.count || 0),
      unassignedPreview: unresolved,
      mappingConflicts: Number(conflictCountRows[0]?.count || 0),
      conflictPreview: conflictRows,
    };
  }

  async createGroup(input: Query, actor: { id: string; correlationId?: string }) {
    const name = String(input.name || "").trim().slice(0, 120);
    const slug = String(input.slug || name).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
    if (!name || !slug) throw new BadRequestException("Tên và slug nhóm đá không được để trống.");
    const sortOrder = Number(input.sortOrder ?? 0);
    const pinnedOrder = input.pinnedOrder == null || input.pinnedOrder === "" ? null : Number(input.pinnedOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || (pinnedOrder !== null && (!Number.isInteger(pinnedOrder) || pinnedOrder < 0))) throw new BadRequestException("Thứ tự nhóm phải là số nguyên không âm.");
    if (input.active !== undefined && ![true, false, "true", "false"].includes(input.active)) throw new BadRequestException("active phải là true hoặc false.");
    const active = input.active === undefined ? true : input.active === true || input.active === "true";
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.jewelryStoneGroup.create({ data: { name, slug, sortOrder, pinnedOrder, active } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "JEWELRY_STONE_GROUP_CREATED", entityType: "JEWELRY_STONE_GROUP", entityId: group.id, after: group as any } });
      return group;
    });
  }

  async updateGroup(id: string, input: Query, actor: { id: string; correlationId?: string }) {
    const data: Prisma.JewelryStoneGroupUpdateInput = {};
    if (input.name !== undefined) {
      const name = String(input.name).trim().slice(0, 120);
      if (!name) throw new BadRequestException("Tên nhóm đá không được để trống.");
      data.name = name;
    }
    if (input.slug !== undefined) {
      const slug = String(input.slug).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
      if (!slug) throw new BadRequestException("Slug nhóm đá không được để trống.");
      data.slug = slug;
    }
    if (input.active !== undefined) {
      if (!(input.active === true || input.active === false || input.active === "true" || input.active === "false")) throw new BadRequestException("active phải là true hoặc false.");
      data.active = input.active === true || input.active === "true";
    }
    for (const key of ["sortOrder", "pinnedOrder"] as const) if (input[key] !== undefined) {
      const value = input[key] === null || input[key] === "" ? null : Number(input[key]);
      if (value !== null && (!Number.isInteger(value) || value < 0)) throw new BadRequestException(`${key} phải là số nguyên không âm hoặc để trống.`);
      if (key === "pinnedOrder") data.pinnedOrder = value;
      else if (value === null) throw new BadRequestException("sortOrder không được để trống.");
      else data.sortOrder = value;
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.jewelryStoneGroup.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("Không tìm thấy nhóm đá.");
      const after = await tx.jewelryStoneGroup.update({ where: { id }, data });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "JEWELRY_STONE_GROUP_UPDATED", entityType: "JEWELRY_STONE_GROUP", entityId: id, before: before as any, after: after as any } });
      return after;
    });
  }

  async mapStoneSource(sourceType: string, sourceId: string, groupIdInput: unknown, actor: { id: string; correlationId?: string }) {
    if (!(sourceType === "category" || sourceType === "material")) throw new BadRequestException("sourceType phải là category hoặc material.");
    if (!uuidPattern.test(sourceId)) throw new BadRequestException("Mã nguồn mapping không hợp lệ.");
    const groupId = groupIdInput === null || groupIdInput === "" ? null : String(groupIdInput);
    if (groupId && !uuidPattern.test(groupId)) throw new BadRequestException("Mã nhóm đá không hợp lệ.");
    return this.prisma.$transaction(async (tx) => {
      if (groupId && !await tx.jewelryStoneGroup.findFirst({ where: { id: groupId, active: true }, select: { id: true } })) throw new BadRequestException("Chỉ có thể gán vào nhóm đá đang hoạt động.");
      const before = sourceType === "category"
        ? await tx.category.findUnique({ where: { id: sourceId } })
        : await tx.materialOption.findUnique({ where: { id: sourceId } });
      if (!before) throw new NotFoundException("Không tìm thấy danh mục/loại đá nguồn.");
      if (sourceType === "category" && ((before as any).kind !== "GEMSTONE" || (before as any).usage !== "GEMSTONE_TYPE")) throw new BadRequestException("Chỉ có thể ánh xạ danh mục thuộc taxonomy loại đá.");
      if (sourceType === "material" && ((before as any).scope !== "JEWELRY" || (before as any).kind !== "STONE")) throw new BadRequestException("Chỉ có thể ánh xạ nguồn loại đá thuộc trang sức.");
      const after = sourceType === "category"
        ? await tx.category.update({ where: { id: sourceId }, data: { jewelryStoneGroupId: groupId } })
        : await tx.materialOption.update({ where: { id: sourceId }, data: { jewelryStoneGroupId: groupId } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "JEWELRY_STONE_SOURCE_MAPPED", entityType: sourceType === "category" ? "CATEGORY" : "MATERIAL_OPTION", entityId: sourceId, before: before as any, after: after as any } });
      return after;
    });
  }

  async assignProductGroup(productId: string, groupIdInput: unknown, actor: { id: string; correlationId?: string }) {
    const groupId = groupIdInput === null || groupIdInput === "" ? null : String(groupIdInput);
    if (groupId && !uuidPattern.test(groupId)) throw new BadRequestException("Mã nhóm đá không hợp lệ.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId}::uuid FOR UPDATE`;
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, kind: true, jewelryStoneGroupId: true } });
      if (!product) throw new NotFoundException("Không tìm thấy sản phẩm.");
      if (product.kind !== "JEWELRY") throw new BadRequestException("Chỉ gán nhóm đá chính cho sản phẩm trang sức.");
      if (groupId && !await tx.jewelryStoneGroup.findFirst({ where: { id: groupId, active: true }, select: { id: true } })) throw new BadRequestException("Chỉ có thể gán vào nhóm đá đang hoạt động.");
      if (product.jewelryStoneGroupId === groupId) return tx.product.findUnique({ where: { id: productId }, include: { jewelryStoneGroup: true } });
      const result = await tx.product.update({ where: { id: productId }, data: { jewelryStoneGroupId: groupId }, include: { jewelryStoneGroup: true } });
      await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "PRODUCT_JEWELRY_STONE_GROUP_UPDATED", entityType: "PRODUCT", entityId: productId, before: { jewelryStoneGroupId: product.jewelryStoneGroupId }, after: { jewelryStoneGroupId: groupId } } });
      return result;
    });
  }

  async getRecentDaysAdmin() {
    return { newArrivalsRecentDays: await this.recentDays() };
  }

  async setRecentDaysAdmin(input: unknown, actor: { id: string; correlationId?: string }) {
    const value = Number((input as any)?.newArrivalsRecentDays);
    if (!Number.isInteger(value) || value < 1 || value > 365) throw new BadRequestException("Số ngày Vừa lên website phải là số nguyên từ 1 đến 365.");
    const key = "newArrivalsRecentDays";
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.siteSetting.findUnique({ where: { key } });
      const after = await tx.siteSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      if (Number(before?.value) !== value) await tx.auditLog.create({ data: { adminId: actor.id, correlationId: actor.correlationId, action: "NEW_ARRIVALS_RECENT_DAYS_UPDATED", entityType: "SITE_SETTING", entityId: key, before: before?.value as any, after: after.value as any } });
      return { newArrivalsRecentDays: value };
    });
  }
}
