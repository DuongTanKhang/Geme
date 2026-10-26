import { Prisma } from "../generated/prisma/client.js";

export type NewArrivalsMode = "all" | "tagged" | "published";
export type NewArrivalsSort = "recommended" | "newest" | "best_selling" | "price_asc" | "price_desc";

export type NewArrivalsGroupOrder = {
  id: string | null;
  pinnedOrder: number | null;
  latestPublishedAt: Date | string | null;
  sortOrder: number;
};

export function compareNewArrivalsGroups(a: NewArrivalsGroupOrder, b: NewArrivalsGroupOrder) {
  if (a.id === null) return b.id === null ? 0 : 1;
  if (b.id === null) return -1;
  const aPinned = a.pinnedOrder !== null;
  const bPinned = b.pinnedOrder !== null;
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  if (aPinned && bPinned && a.pinnedOrder !== b.pinnedOrder) return a.pinnedOrder! - b.pinnedOrder!;
  if (!aPinned && !bPinned) {
    const aLatest = a.latestPublishedAt ? new Date(a.latestPublishedAt).getTime() : 0;
    const bLatest = b.latestPublishedAt ? new Date(b.latestPublishedAt).getTime() : 0;
    if (aLatest !== bLatest) return bLatest - aLatest;
  }
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

export function isNewLabelActive(isNew: boolean, newUntil: Date | string | null | undefined, now: Date) {
  if (!isNew) return false;
  if (newUntil == null) return true;
  const deadline = newUntil instanceof Date ? newUntil.getTime() : Date.parse(newUntil);
  return Number.isFinite(deadline) && deadline > now.getTime();
}

export function wasPublishedWithin(firstPublishedAt: Date | string | null | undefined, from: Date, now: Date) {
  if (firstPublishedAt == null) return false;
  const publishedAt = firstPublishedAt instanceof Date ? firstPublishedAt.getTime() : Date.parse(firstPublishedAt);
  return Number.isFinite(publishedAt) && publishedAt >= from.getTime() && publishedAt <= now.getTime();
}

/** Keep the SQL list predicate and its fixed-clock contract tests in one place. */
export function newArrivalsModeCondition(_mode: NewArrivalsMode, now: Date, _from: Date) {
  // New Arrivals is deliberately based only on the explicit New tag. A recent
  // publication date must never make an old product appear in this collection.
  return Prisma.sql`(is_new = true AND (new_until IS NULL OR new_until > ${now}))`;
}

export function newArrivalsProductOrder(sort: NewArrivalsSort) {
  switch (sort) {
    case "newest":
      return Prisma.sql`first_published_at DESC NULLS LAST, id ASC`;
    case "best_selling":
      return Prisma.sql`sold_quantity DESC, can_buy DESC NULLS LAST, first_published_at DESC NULLS LAST, id ASC`;
    case "price_asc":
      return Prisma.sql`listed_price ASC NULLS LAST, id ASC`;
    case "price_desc":
      return Prisma.sql`listed_price DESC NULLS LAST, id ASC`;
    case "recommended":
    default:
      return Prisma.sql`can_buy DESC NULLS LAST, new_label_active DESC NULLS LAST, first_published_at DESC NULLS LAST, id ASC`;
  }
}

export function listedStoreCardPrice() {
  // Trang sức filters and StoreProductCard use the product's base price before
  // promotions. Keep New Arrivals price filters and ordering consistent.
  return Prisma.sql`NULLIF("p"."price", 0)`;
}
