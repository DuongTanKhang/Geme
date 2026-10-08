import type { Metadata } from "next";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBlogJournalPage } from "../lib/store-api";
import { BlogJournal } from "./journal";

export const metadata: Metadata = {
  title: "GEME Journal | Chuyện của đá, chuyện của người",
  description: "Góc nhìn GEME về đá quý thiên nhiên, phong cách và cách gìn giữ trang sức.",
};

type SearchValue = string | string[] | undefined;
type Props = { searchParams: Promise<{ category?: SearchValue; q?: SearchValue }> };

const firstValue = (value: SearchValue) => Array.isArray(value) ? value[0] || "" : value || "";
const journalCategories = ["Kiến thức đá quý", "Phong cách", "Chăm sóc trang sức", "Chuyện GEME"];

export default async function BlogPage({ searchParams }: Props) {
  const params = await searchParams;
  const initialSearch = firstValue(params.q).trim();
  const initialCategory = firstValue(params.category).trim();
  const page = await getStoreBlogJournalPage({ limit: 8, offset: 0, search: initialSearch, category: initialCategory });
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
