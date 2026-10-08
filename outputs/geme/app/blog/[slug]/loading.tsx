import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export default function BlogArticleLoading() {
  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm bài viết..." activePage="blog"/>
    <main className="blog-page blog-article-page" aria-busy="true" aria-label="Đang mở bài viết">
      <section className="blog-detail-hero blog-detail-hero-loading"><div className="blog-detail-hero-copy">
        <span className="blog-loading-bar blog-loading-short"/><span className="blog-loading-bar blog-loading-title"/><span className="blog-loading-bar blog-loading-title"/><span className="blog-loading-bar blog-loading-meta"/>
      </div></section>
      <div className="blog-detail-layout"><article className="blog-detail-article">
        <span className="blog-loading-bar blog-loading-paragraph"/><span className="blog-loading-bar blog-loading-paragraph"/><span className="blog-loading-bar blog-loading-paragraph blog-loading-narrow"/>
      </article></div>
    </main>
    <SiteFooter/>
  </>;
}
