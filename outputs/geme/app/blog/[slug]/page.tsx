import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getStoreBlogArticle, type StoreBlogPostSummary } from "../../lib/store-api";
import { BlogArticleReader } from "../article-reader";
import { BlogShareButtons } from "../share-buttons";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 5;

export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

const dateLabel = (date?: string | null) => date
  ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date)).replaceAll("/", ".")
  : "GEME Journal";

const readingTime = (content: string) => {
  const words = content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
};

const coverImage = (post: { coverImageUrl?: string | null; images?: Array<{ url: string; alt?: string | null }> }) =>
  post.coverImageUrl || post.images?.[0]?.url || null;

const optimizeInlineImages = (html: string) => html.replace(
  /(<img\b[^>]*\bsrc\s*=\s*)(["'])(\/(?:media|assets)\/[^"']+)\2/gi,
  (_match, prefix: string, quote: string, src: string) => `${prefix}${quote}/_next/image?url=${encodeURIComponent(src)}&w=1080&q=75${quote}`,
);

const coverAlt = (post: { title: string; coverImageUrl?: string | null; images?: Array<{ url: string; alt?: string | null }> }) => {
  const image = coverImage(post);
  return post.images?.find((item) => item.url === image)?.alt || post.title;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { article } = await getStoreBlogArticle(slug);
  const post = article?.post;
  if (!post) return { title: "Bài viết | GEME" };
  return { title: post.seoTitle || `${post.title} | GEME`, description: post.seoDescription || post.summary || undefined };
}

function RelatedPosts({ posts, currentSlug }: { posts: StoreBlogPostSummary[]; currentSlug: string }) {
  const items = posts.filter((post) => post.slug !== currentSlug).slice(0, 4);

  return <section className="blog-detail-related" aria-labelledby="blog-detail-related-title">
    <div className="blog-detail-related-heading">
      <h2 id="blog-detail-related-title">Đọc tiếp cùng GEME</h2>
      <Link href="/blog">Tất cả bài Journal <span aria-hidden="true">→</span></Link>
    </div>
    {items.length ? <div className="blog-detail-related-grid" data-count={items.length}>
      {items.map((item) => {
        const image = coverImage(item);
        return <Link className="blog-detail-related-card" href={`/blog/${encodeURIComponent(item.slug)}`} key={item.id}>
          {image ? <div className="blog-detail-related-image">
            <Image src={image} alt={item.images?.find((entry) => entry.url === image)?.alt || item.title} width={480} height={280} sizes="(max-width: 640px) 90vw, (max-width: 1000px) 45vw, 30vw"/>
          </div> : <div className="blog-detail-related-image blog-detail-related-image-empty" aria-hidden="true"/>}
          <span className="blog-detail-related-category">{item.category || "GEME Journal"}</span>
          <strong>{item.title}</strong>
          <time dateTime={item.publishedAt || item.createdAt}>{dateLabel(item.publishedAt || item.createdAt)}</time>
        </Link>;
      })}
    </div> : <p className="blog-detail-related-empty">Các câu chuyện mới sẽ được cập nhật tại GEME Journal.</p>}
  </section>;
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const { article } = await getStoreBlogArticle(slug);
  if (!article) notFound();
  const { post, posts } = article;
  const publishedAt = post.publishedAt || post.createdAt;
  const image = coverImage(post);

  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm bài viết..." activePage="blog"/>
    <main className="blog-page blog-article-page">
      <div className="blog-detail-container">
        <nav className="blog-detail-breadcrumbs" aria-label="Đường dẫn">
          <Link href="/">Trang chủ</Link><span aria-hidden="true">›</span>
          <Link href="/blog">Blog</Link><span aria-hidden="true">›</span>
          {post.category && <><Link href={`/blog?category=${encodeURIComponent(post.category)}`}>{post.category}</Link><span aria-hidden="true">›</span></>}
          <span aria-current="page">{post.title}</span>
        </nav>

        <section className={`blog-detail-hero${image ? "" : " is-text-only"}`} aria-label="Bìa bài viết">
          <div className="blog-detail-hero-copy">
            <p className="blog-detail-eyebrow"><span aria-hidden="true">✦</span> GEME JOURNAL / {post.category || "CÂU CHUYỆN GEME"}</p>
            <h1>{post.title}</h1>
            {post.summary && <p className="blog-detail-excerpt">{post.summary}</p>}
            <div className="blog-detail-meta">
              <span className="blog-detail-meta-rule" aria-hidden="true"/>
              <div>
                {publishedAt && <time dateTime={publishedAt}>{dateLabel(publishedAt)}</time>}
                <span aria-hidden="true">·</span>
                <span>{readingTime(post.content)} phút đọc</span>
                {post.author?.displayName && <><span aria-hidden="true">·</span><span>{post.author.displayName}</span></>}
              </div>
            </div>
          </div>
          {image && <figure className="blog-detail-cover">
            <Image className="blog-detail-cover-image" src={image} alt={coverAlt(post)} fill sizes="(max-width: 760px) 100vw, (max-width: 1470px) 53vw, 700px" preload/>
          </figure>}
        </section>

        <BlogArticleReader content={optimizeInlineImages(post.content)} summary={post.summary || null} tags={post.tags || []}/>

        <div className="blog-detail-share-row">
          <Link className="blog-detail-back" href="/blog"><span aria-hidden="true">←</span> Trở lại Journal</Link>
          <div><span>Chia sẻ bài viết:</span><BlogShareButtons title={post.title}/></div>
        </div>

        <RelatedPosts posts={posts} currentSlug={post.slug}/>
      </div>
    </main>
    <SiteFooter/>
  </>;
}
