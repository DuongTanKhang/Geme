"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { StoreBlogPostSummary } from "../lib/store-api";

type JournalPost = StoreBlogPostSummary & { readingMinutes?: number };
type JournalPageResponse = { posts: JournalPost[]; total: number };

const journalBanner = "/assets/geme-journal-draft-4a5976e2550e-01-gemstone-story.png";
const articlesPerPage = 12;
const gemstoneStoryPattern = /đá quý|đá tự nhiên|viên đá|ngọc|opal|sapphire|ruby|emerald|aquamarine|thạch anh|moonstone|garnet|topaz|citrine|peridot|amethyst|tourmaline/i;

function imageFor(post: JournalPost) {
  return post.coverImageUrl || post.images?.[0]?.url || "";
}

function imageAlt(post: JournalPost) {
  return post.images?.[0]?.alt || post.title;
}

function articleHref(post: JournalPost) {
  return "/blog/" + encodeURIComponent(post.slug);
}

function publishedAt(post: JournalPost) {
  return post.publishedAt || post.createdAt;
}

function dateLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function isGemstoneStory(post: JournalPost) {
  return gemstoneStoryPattern.test([post.title, post.summary, post.category, ...(post.tags || [])].filter(Boolean).join(" "));
}

function JournalPhoto({ src, alt, sizes, preload = false }: { src: string; alt: string; sizes: string; preload?: boolean }) {
  return <Image src={src} alt={alt} fill sizes={sizes} preload={preload} />;
}

function EmptyArticlePhoto() {
  return <div className="journal-photo-unavailable" role="img" aria-label="Bài viết chưa có ảnh đại diện">GEME JOURNAL</div>;
}

export function BlogJournal({
  initialPosts,
  initialTotal,
  categories,
  connected,
  initialSearch,
  initialCategory,
}: {
  initialPosts: JournalPost[];
  initialTotal: number;
  categories: string[];
  connected: boolean;
  initialSearch: string;
  initialCategory: string;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [total, setTotal] = useState(initialTotal);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [activeSearch, setActiveSearch] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(connected ? "" : "Chưa kết nối được nguồn bài viết GEME.");
  const [newsletterMessage, setNewsletterMessage] = useState("");

  const loadPage = useCallback(async (search: string, category: string, offset: number, append: boolean) => {
    setLoading(true);
    setError("");
    if (!append) {
      setPosts([]);
      setTotal(0);
    }
    const params = new URLSearchParams({ limit: String(articlesPerPage), offset: String(offset) });
    if (search) params.set("q", search);
    if (category) params.set("category", category);
    try {
      const response = await fetch("/api/blog?" + params.toString(), { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json() as JournalPageResponse & { message?: string };
      if (!response.ok) throw new Error(result.message || "Không tải được bài viết. Vui lòng thử lại.");
      setPosts((current) => append ? [...current, ...result.posts] : result.posts);
      setTotal(result.total);
    } catch (reason) {
      if (!append) {
        setPosts([]);
        setTotal(0);
      }
      setError(reason instanceof Error ? reason.message : "Không tải được bài viết. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateUrl = (search: string, category: string, replace = false) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (category) params.set("category", category);
    const nextUrl = "/blog" + (params.size ? "?" + params.toString() : "");
    if (replace) window.history.replaceState({}, "", nextUrl);
    else window.history.pushState({}, "", nextUrl);
  };

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const search = (params.get("q") || "").trim();
      const category = (params.get("category") || "").trim();
      setSearchInput(search);
      setActiveSearch(search);
      setSelectedCategory(category);
      void loadPage(search, category, 0, false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [loadPage]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = searchInput.trim();
    setSearchInput(search);
    setActiveSearch(search);
    updateUrl(search, selectedCategory);
    void loadPage(search, selectedCategory, 0, false);
  };

  const chooseCategory = (category: string) => {
    setSelectedCategory(category);
    updateUrl(activeSearch, category);
    void loadPage(activeSearch, category, 0, false);
  };

  const clearFilters = () => {
    setSearchInput("");
    setActiveSearch("");
    setSelectedCategory("");
    setError("");
    updateUrl("", "");
    void loadPage("", "", 0, false);
  };

  const showMore = () => void loadPage(activeSearch, selectedCategory, posts.length, true);
  const isFiltered = Boolean(activeSearch || selectedCategory);
  const featuredPost = posts[0];
  const featureMatchesBanner = featuredPost ? isGemstoneStory(featuredPost) : false;
  const featurePhoto = featuredPost ? (featureMatchesBanner ? journalBanner : imageFor(featuredPost)) : "";
  const latestPosts = posts.slice(4, 7);
  const readingList = posts.slice(7);
  const hasMore = posts.length < total;

  const submitNewsletter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewsletterMessage("Chưa thể đăng ký: website chưa có dịch vụ nhận bản tin được kết nối.");
  };

  return <main className="blog-journal-page">
    <div className="journal-container">
      <header className="journal-masthead">
        <div className="journal-kicker-row">
          <span>GÓC NHÌN TỪ GEME</span>
          <span>TẠP CHÍ ĐÁ QUÝ &amp; TRANG SỨC</span>
        </div>
        <h1>GEME JOURNAL</h1>
        <div className="journal-subline">
          <p>Chuyện của đá. Chuyện của người.</p>
          <form className="journal-search" role="search" onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="journal-search-input">Tìm bài viết</label>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.2 4.2"/></svg>
            <input id="journal-search-input" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm bài viết…" />
            <button type="submit" aria-label="Tìm bài viết">Tìm</button>
          </form>
        </div>
      </header>

      <nav className="journal-categories" aria-label="Danh mục bài viết">
        <button type="button" className={!selectedCategory ? "is-active" : ""} aria-pressed={!selectedCategory} onClick={() => chooseCategory("")}>Tất cả</button>
        {categories.map((category) => <button type="button" key={category} className={selectedCategory === category ? "is-active" : ""} aria-pressed={selectedCategory === category} onClick={() => chooseCategory(category)}>{category}</button>)}
      </nav>

      {isFiltered ? <section className="journal-results" aria-labelledby="journal-results-title" aria-busy={loading}>
        <div className="journal-section-heading">
          <div>
            <span>{activeSearch ? "TÌM KIẾM" : "DANH MỤC"}</span>
            <h2 id="journal-results-title">{activeSearch ? "Kết quả bài viết" : selectedCategory}</h2>
          </div>
          <span>{total} bài viết</span>
        </div>
        <button className="journal-clear-filter" type="button" onClick={clearFilters}>Xóa tìm kiếm và bộ lọc</button>
        {error && <p className="journal-message journal-message-error" role="alert">{error}</p>}
        {!error && loading && posts.length === 0 && <p className="journal-message" role="status">Đang tìm bài viết…</p>}
        {!error && !loading && posts.length === 0 && <p className="journal-message">Chưa có bài viết phù hợp. Thử từ khóa khác hoặc xem tất cả bài viết.</p>}
        {posts.length > 0 && <div className="journal-result-list">{posts.map((post, index) => {
          const src = imageFor(post);
          return <article className="journal-result-row" key={post.id}>
            <span className="journal-result-number">{String(index + 1).padStart(2, "0")}</span>
            {src ? <Link className="journal-result-photo" href={articleHref(post)} aria-label={"Mở bài viết " + post.title}><JournalPhoto src={src} alt={imageAlt(post)} sizes="(max-width: 767px) 28vw, 140px" /></Link> : <EmptyArticlePhoto />}
            <div className="journal-result-copy">
              <span className="journal-overline">{post.category || "Chuyện GEME"}</span>
              <h3><Link href={articleHref(post)}>{post.title}</Link></h3>
              {post.summary && <p>{post.summary}</p>}
              <span className="journal-result-meta">{dateLabel(publishedAt(post))}{post.readingMinutes ? " · " + post.readingMinutes + " phút đọc" : ""}</span>
            </div>
            <Link className="journal-result-arrow" href={articleHref(post)} aria-label={"Đọc " + post.title}>→</Link>
          </article>;
        })}</div>}
        {hasMore && <button className="journal-load-more" type="button" onClick={showMore} disabled={loading}>{loading ? "Đang tải…" : "Xem thêm bài viết"} <span aria-hidden="true">→</span></button>}
      </section> : <>
        {featuredPost ? <>
          {!featureMatchesBanner && <figure className="journal-intro-banner" aria-label="Ảnh giới thiệu GEME Journal">
            <Image src={journalBanner} alt="Ảnh minh họa bằng AI về bàn tay dùng nhíp quan sát một viên đá xanh cạnh kính lúp." fill sizes="(max-width: 767px) 100vw, 92vw" preload />
          </figure>}
          <section className="journal-featured" aria-label="Bài viết tiêu điểm và trong số này">
            <article className="journal-feature-main">
              {featurePhoto ? <Link className="journal-feature-photo" href={articleHref(featuredPost)} aria-label={"Đọc " + featuredPost.title}>
                <JournalPhoto src={featurePhoto} alt={featureMatchesBanner ? "Bàn tay dùng nhíp giữ viên Emerald bên kính lúp và hai viên đá trên nền ngà" : imageAlt(featuredPost)} sizes="(max-width: 900px) 100vw, 70vw" preload={featureMatchesBanner} />
              </Link> : <EmptyArticlePhoto />}
              <div className="journal-feature-copy">
                <span className="journal-overline">TIÊU ĐIỂM · {featuredPost.category || "CHUYỆN GEME"}</span>
                <h2><Link href={articleHref(featuredPost)}>{featuredPost.title}</Link></h2>
                {featuredPost.summary && <p>{featuredPost.summary}</p>}
                <div className="journal-feature-meta">
                  <span>{featuredPost.readingMinutes ? featuredPost.readingMinutes + " phút đọc" : dateLabel(publishedAt(featuredPost))}</span>
                  <Link href={articleHref(featuredPost)}>Đọc câu chuyện <span aria-hidden="true">→</span></Link>
                </div>
              </div>
            </article>

            <aside className="journal-issue" aria-labelledby="journal-issue-title">
              <h2 id="journal-issue-title">Trong số này</h2>
              {posts.slice(1, 4).map((post, index) => <article className="journal-issue-item" key={post.id}>
                <span className="journal-issue-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <span className="journal-overline">{post.category || "CHUYỆN GEME"}</span>
                  <h3><Link href={articleHref(post)}>{post.title}</Link></h3>
                </div>
              </article>)}
              <p className="journal-issue-note">Một góc nhìn mới về thế giới đá quý.</p>
            </aside>
          </section>
        </> : <section className="journal-empty-feature" aria-label="GEME Journal">
          <div className="journal-empty-photo">
            <Image src={journalBanner} alt="Ảnh minh họa bằng AI về bàn tay dùng nhíp quan sát một viên đá xanh cạnh kính lúp." fill sizes="(max-width: 767px) 100vw, 70vw" preload />
          </div>
          <div className="journal-empty-copy">
            <span className="journal-overline">GEME JOURNAL</span>
            <h2>Những câu chuyện mới đang được biên tập.</h2>
            <p>{connected ? "Bài viết đã xuất bản sẽ xuất hiện tại đây." : "Hiện chưa kết nối được nguồn bài viết. Vui lòng quay lại sau."}</p>
          </div>
        </section>}

        {latestPosts.length > 0 && <section className="journal-new-pages" aria-labelledby="journal-new-pages-title">
          <div className="journal-section-heading">
            <div><h2 id="journal-new-pages-title">Những trang mới</h2></div>
            <span>Bài viết mới nhất</span>
          </div>
          <div className="journal-new-grid">
            <article className="journal-new-lead">
              {imageFor(latestPosts[0]) ? <Link className="journal-new-lead-photo" href={articleHref(latestPosts[0])}><JournalPhoto src={imageFor(latestPosts[0])} alt={imageAlt(latestPosts[0])} sizes="(max-width: 900px) 100vw, 45vw" /></Link> : <EmptyArticlePhoto />}
              <div className="journal-new-copy">
                <span className="journal-overline">{latestPosts[0].category || "CHUYỆN GEME"}</span>
                <h3><Link href={articleHref(latestPosts[0])}>{latestPosts[0].title}</Link></h3>
                {latestPosts[0].summary && <p>{latestPosts[0].summary}</p>}
                <span className="journal-read-time">{latestPosts[0].readingMinutes ? latestPosts[0].readingMinutes + " phút đọc" : dateLabel(publishedAt(latestPosts[0]))}</span>
              </div>
            </article>
            <div className="journal-new-stack">
              {latestPosts.slice(1, 3).map((post) => <article className="journal-new-row" key={post.id}>
                <div className="journal-new-row-copy">
                  <span className="journal-overline">{post.category || "CHUYỆN GEME"}</span>
                  <h3><Link href={articleHref(post)}>{post.title}</Link></h3>
                  {post.summary && <p>{post.summary}</p>}
                  <span className="journal-read-time">{post.readingMinutes ? post.readingMinutes + " phút đọc" : dateLabel(publishedAt(post))}</span>
                </div>
                {imageFor(post) ? <Link className="journal-new-row-photo" href={articleHref(post)}><JournalPhoto src={imageFor(post)} alt={imageAlt(post)} sizes="(max-width: 900px) 38vw, 25vw" /></Link> : <EmptyArticlePhoto />}
              </article>)}
            </div>
          </div>
        </section>}

        <section className="journal-belief" aria-label="Thông điệp GEME Journal">
          <p>Hiểu một viên đá,<br />để yêu vẻ đẹp của nó lâu hơn.</p>
          <span aria-hidden="true"></span>
          <small>GEME JOURNAL</small>
        </section>

        {readingList.length > 0 && <section className="journal-reading-list" aria-labelledby="journal-reading-title">
          <div className="journal-section-heading">
            <div><h2 id="journal-reading-title">Đọc tiếp cùng GEME</h2></div>
            <span>{total} bài viết</span>
          </div>
          <div>{readingList.map((post, index) => <article className="journal-reading-row" key={post.id}>
            <span className="journal-reading-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="journal-reading-category">{post.category || "Chuyện GEME"}</span>
            <h3><Link href={articleHref(post)}>{post.title}</Link></h3>
            <time dateTime={publishedAt(post)}>{dateLabel(publishedAt(post))}</time>
            <Link className="journal-result-arrow" href={articleHref(post)} aria-label={"Đọc " + post.title}>→</Link>
          </article>)}</div>
        </section>}
        {hasMore && <button className="journal-load-more" type="button" onClick={showMore} disabled={loading}>{loading ? "Đang tải…" : "Xem thêm bài viết"} <span aria-hidden="true">→</span></button>}
      </>}
    </div>

    <section className="journal-newsletter" aria-labelledby="journal-newsletter-title">
      <div className="journal-newsletter-inner">
        <h2 id="journal-newsletter-title">Thư từ GEME</h2>
        <p>Một chút kiến thức, một chút cảm hứng.<br />Gửi đến bạn qua email.</p>
        <form onSubmit={submitNewsletter}>
          <label className="sr-only" htmlFor="journal-newsletter-email">Email nhận bản tin</label>
          <input id="journal-newsletter-email" type="email" name="email" autoComplete="email" placeholder="Nhập email của bạn…" required aria-describedby="journal-newsletter-status" />
          <button type="submit" aria-label="Đăng ký nhận bản tin" title="Đăng ký nhận bản tin">→</button>
          <span id="journal-newsletter-status" className="journal-newsletter-status" role="status" aria-live="polite">{newsletterMessage}</span>
        </form>
      </div>
    </section>
  </main>;
}
