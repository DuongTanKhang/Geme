import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareNewArrivalsGroups,
  isNewLabelActive,
  listedStoreCardPrice,
  newArrivalsModeCondition,
  newArrivalsProductOrder,
  wasPublishedWithin,
} from "./new-arrivals.rules.js";

const now = new Date("2026-10-26T12:00:00.000Z");
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

test("new badge respects off, no-expiry, and the exact expiry boundary", () => {
  assert.equal(isNewLabelActive(false, null, now), false);
  assert.equal(isNewLabelActive(true, null, now), true);
  assert.equal(isNewLabelActive(true, new Date(now.getTime() + 1), now), true);
  assert.equal(isNewLabelActive(true, now, now), false);
  assert.equal(isNewLabelActive(true, new Date(now.getTime() - 1), now), false);
});

test("recent publication includes the lower boundary but excludes unknown and future dates", () => {
  assert.equal(wasPublishedWithin(from, from, now), true);
  assert.equal(wasPublishedWithin(now, from, now), true);
  assert.equal(wasPublishedWithin(new Date(from.getTime() - 1), from, now), false);
  assert.equal(wasPublishedWithin(new Date(now.getTime() + 1), from, now), false);
  assert.equal(wasPublishedWithin(null, from, now), false);
});

test("group ordering puts pinned groups first, uses recency only for unpinned groups, and keeps fallback last", () => {
  const groups = [
    { id: null, pinnedOrder: null, latestPublishedAt: now, sortOrder: Number.MAX_SAFE_INTEGER },
    { id: "late-pinned", pinnedOrder: 1, latestPublishedAt: new Date("2026-10-25T00:00:00Z"), sortOrder: 2 },
    { id: "early-pinned", pinnedOrder: 1, latestPublishedAt: new Date("2026-10-26T00:00:00Z"), sortOrder: 1 },
    { id: "older-unpinned", pinnedOrder: null, latestPublishedAt: new Date("2026-10-20T00:00:00Z"), sortOrder: 1 },
    { id: "newer-unpinned", pinnedOrder: null, latestPublishedAt: new Date("2026-10-25T00:00:00Z"), sortOrder: 10 },
    { id: "second-pinned", pinnedOrder: 2, latestPublishedAt: now, sortOrder: 0 },
  ];
  assert.deepEqual(groups.sort(compareNewArrivalsGroups).map((group) => group.id), [
    "early-pinned", "late-pinned", "second-pinned", "newer-unpinned", "older-unpinned", null,
  ]);
});

test("legacy all/tagged/published modes all require the active New tag", () => {
  const tagged = newArrivalsModeCondition("tagged", now, from);
  const published = newArrivalsModeCondition("published", now, from);
  const all = newArrivalsModeCondition("all", now, from);

  assert.match(tagged.sql, /is_new = true AND \(new_until IS NULL OR new_until > \?\)/);
  assert.deepEqual(tagged.values, [now]);
  assert.equal(published.sql, tagged.sql);
  assert.deepEqual(published.values, [now]);
  assert.equal(all.sql, tagged.sql);
  assert.deepEqual(all.values, [now]);
});

test("price ordering uses the same parent price rendered on a product card and puts contact prices last", () => {
  assert.equal(listedStoreCardPrice().sql, 'NULLIF("p"."price", 0)');
  const asc = newArrivalsProductOrder("price_asc");
  const desc = newArrivalsProductOrder("price_desc");
  const recommended = newArrivalsProductOrder("recommended");
  const bestSelling = newArrivalsProductOrder("best_selling");
  assert.match(asc.sql, /listed_price ASC NULLS LAST, id ASC/);
  assert.match(desc.sql, /listed_price DESC NULLS LAST, id ASC/);
  assert.doesNotMatch(asc.sql, /can_buy|new_label_active|first_published_at/);
  assert.match(recommended.sql, /can_buy DESC NULLS LAST[\s\S]*new_label_active DESC NULLS LAST[\s\S]*first_published_at DESC NULLS LAST/);
  assert.match(recommended.sql, /id ASC/);
  assert.match(bestSelling.sql, /sold_quantity DESC, can_buy DESC/);
});
