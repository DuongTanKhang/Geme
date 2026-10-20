import type { Metadata } from "next";
import { absoluteSiteUrl } from "../lib/seo";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBlogJournalPage } from "../lib/store-api";
import { BlogJournal } from "./journal";

type SearchValue = string | string[] | undefined;
type Props = { searchParams: Promise<{ category?: SearchValue; q?: SearchValue }> };

const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] || "" : value || "";
const journalCategories = ["Kiến thức đá quý", "Phong cách", "Chăm sóc trang sức", "Chuyện GEME"];

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const hasFilters = Boolean(firstValue(params.q).trim() || firstValue(params.category).trim());
  const title = "GEME Journal — Chuyện của đá, chuyện của người";
  const description = "Góc nhìn GEME về đá quý thiên nhiên, phong cách và cách gìn giữ trang sức.";
  return {
    title,
    description,
    alternates: { canonical: "/blog" },
    openGraph: { type: "website", siteName: "GEME", title, description, url: "/blog" },
    ...(hasFilters ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const params = await searchParams;
  const initialSearch = firstValue(params.q).trim();
  const initialCategory = firstValue(params.category).trim();
  const page = await getStoreBlogJournalPage({ limit: 8, offset: 0, search: initialSearch, category: initialCategory });
  if (!page.connected) throw new Error("Không thể tải GEME Journal từ API.");
  const categories = [...journalCategories];
  for (const item of page.categories || []) {
    if (item.name && !categories.some((name) => name.toLocaleLowerCase("vi") === item.name.toLocaleLowerCase("vi"))) categories.push(item.name);
  }

  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm bài viết..." activePage="blog" />
    <BlogJournal
      initialPosts={page.posts}
      initialTotal={page.total}
      categories={categories}
      connected={page.connected}
      initialSearch={initialSearch}
      initialCategory={initialCategory}
    />
    <SiteFooter variant="journal" />
  </>;
}
