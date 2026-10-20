import type { MetadataRoute } from "next";
import { getStoreSitemapBlogPosts, getStoreSitemapProducts, requireStoreApi } from "./lib/store-api";
import { guideStones } from "./cam-nang-da-quy/stones";
import { absoluteSiteUrl, validDate } from "./lib/seo";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 500;
const MAX_URLS_PER_SITEMAP = 50_000;

async function allPublicProducts() {
  const products: Array<{ slug: string; createdAt?: string; updatedAt?: string }> = [];
  for (let offset = 0; offset < MAX_URLS_PER_SITEMAP; offset += PAGE_SIZE) {
    const result = requireStoreApi(await getStoreSitemapProducts(PAGE_SIZE, offset), "danh sách sản phẩm cho sitemap");
    const entries = result.data || [];
    products.push(...entries);
    if (entries.length < PAGE_SIZE) return products;
  }
  throw new Error("Sitemap sản phẩm đã chạm giới hạn 50.000 URL; cần chia thành nhiều sitemap trước khi có thêm sản phẩm.");
}

async function allPublishedArticles() {
  const posts: Array<{ slug: string; createdAt?: string; updatedAt?: string; publishedAt?: string | null }> = [];
  for (let offset = 0; offset < MAX_URLS_PER_SITEMAP; offset += PAGE_SIZE) {
    const result = requireStoreApi(await getStoreSitemapBlogPosts(PAGE_SIZE, offset), "danh sách bài viết cho sitemap");
    const entries = result.data || [];
    posts.push(...entries);
    if (entries.length < PAGE_SIZE) return posts;
  }
  throw new Error("Sitemap bài viết đã chạm giới hạn 50.000 URL; cần chia thành nhiều sitemap trước khi có thêm bài viết.");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, posts] = await Promise.all([allPublicProducts(), allPublishedArticles()]);
  const staticPaths = ["/", "/san-pham", "/da-quy", "/new-arrivals", "/blog", "/ve-geme", "/lien-he", "/cam-nang-da-quy"];
  const entries: MetadataRoute.Sitemap = staticPaths.map((path) => ({ url: absoluteSiteUrl(path) }));

  for (const stone of guideStones) entries.push({ url: absoluteSiteUrl(`/cam-nang-da-quy/${encodeURIComponent(stone.slug)}`) });
  for (const product of products) {
    if (!product.slug) continue;
    entries.push({ url: absoluteSiteUrl(`/san-pham/${encodeURIComponent(product.slug)}`), lastModified: validDate(product.updatedAt || product.createdAt) });
  }
  for (const post of posts) {
    if (!post.slug) continue;
    entries.push({ url: absoluteSiteUrl(`/blog/${encodeURIComponent(post.slug)}`), lastModified: validDate(post.updatedAt || post.publishedAt || post.createdAt) });
  }

  const unique = new Map(entries.map((entry) => [entry.url, entry]));
  if (unique.size > MAX_URLS_PER_SITEMAP) throw new Error("Sitemap GEME vượt giới hạn 50.000 URL; hãy tách sitemap theo loại nội dung.");
  return [...unique.values()];
}
