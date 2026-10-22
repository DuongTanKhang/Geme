import assert from "node:assert/strict";
import test from "node:test";
import { SocialService } from "./social.service.js";

const idFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const records = Array.from({ length: 180 }, (_, index) => ({
  id: idFor(index + 1),
  updatedAt: new Date(Date.UTC(2026, 0, 1) - index * 1000),
  title: `post-${String(index).padStart(3, "0")}`,
  status: "DRAFT",
  targets: [],
}));

function mockSocialService() {
  const service = Object.create(SocialService.prototype) as SocialService & { prisma: any; safePost: (post: unknown) => unknown };
  service.safePost = (post) => post;
  service.prisma = {
    socialPost: {
      findMany: async (query: any) => {
        let rows = [...records];
        if (query.where?.status) rows = rows.filter((row) => row.status === query.where.status);
        const search = query.where?.OR?.[0]?.title?.contains;
        if (search) rows = rows.filter((row) => row.title.toLowerCase().includes(String(search).toLowerCase()));
        const cursor = query.where?.AND?.[0]?.OR;
        if (cursor) {
          const olderThan = cursor[0].updatedAt.lt as Date;
          const sameDate = cursor[1].updatedAt as Date;
          const smallerId = cursor[1].id.lt as string;
          rows = rows.filter((row) => row.updatedAt < olderThan || (row.updatedAt.getTime() === sameDate.getTime() && row.id < smallerId));
        }
        rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id));
        return rows.slice(0, query.take);
      },
    },
    socialPostTarget: { findMany: async () => [] },
  };
  return service;
}

test("server search can find a matching post older than the first 100 rows", async () => {
  const service = mockSocialService();
  const page = await service.listPosts(undefined, "post-149", "25") as { items: Array<{ title: string }>; hasMore: boolean };
  assert.deepEqual(page.items.map((post) => post.title), ["post-149"]);
  assert.equal(page.hasMore, false);
});

test("updatedAt/id cursor pages remain stable and contain no duplicate posts", async () => {
  const service = mockSocialService();
  const first = await service.listPosts(undefined, undefined, "25") as { items: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
  assert.equal(first.items.length, 25);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const second = await service.listPosts(undefined, undefined, "25", first.nextCursor!) as { items: Array<{ id: string }>; nextCursor: string | null; hasMore: boolean };
  const combined = [...first.items, ...second.items].map((post) => post.id);
  assert.equal(combined.length, 50);
  assert.equal(new Set(combined).size, 50);
  assert.ok(first.items.at(-1)!.id > second.items[0]!.id || records.find((post) => post.id === first.items.at(-1)!.id)!.updatedAt > records.find((post) => post.id === second.items[0]!.id)!.updatedAt);
});

test("calendar queries its own bounded target range without depending on the content list", async () => {
  const service = mockSocialService();
  const from = "2026-10-01T00:00:00.000Z";
  const to = "2026-11-01T00:00:00.000Z";
  const result = await service.calendar(from, to, "UNKNOWN");
  assert.deepEqual(result, []);
  await assert.rejects(service.calendar(from, "2027-03-01T00:00:00.000Z"), /Khoảng thời gian/);
});
