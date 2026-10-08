import { getStoreBlogJournalPage } from "../../lib/store-api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitValue = Number(url.searchParams.get("limit") || 12);
  const offsetValue = Number(url.searchParams.get("offset") || 0);
  const page = await getStoreBlogJournalPage({
    limit: Number.isFinite(limitValue) ? limitValue : 12,
    offset: Number.isFinite(offsetValue) ? offsetValue : 0,
    search: url.searchParams.get("q") || "",
    category: url.searchParams.get("category") || "",
  });

  if (!page.connected) {
    return Response.json({ message: "Chưa kết nối được nguồn bài viết GEME." }, { status: 503 });
  }

  return Response.json({ posts: page.posts, total: page.total, categories: page.categories });
}
