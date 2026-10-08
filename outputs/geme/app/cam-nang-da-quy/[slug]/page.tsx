import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getGuideStone, guideStones } from "../stones";

export function generateStaticParams() {
  return guideStones.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const stone = getGuideStone(slug);
  if (!stone) return { title: "Không tìm thấy bài viết | GEME" };
  return { title: `${stone.name} — Cẩm nang đá quý | GEME`, description: stone.intro };
}

export default async function GemstoneArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stone = getGuideStone(slug);
  if (!stone) notFound();
  const related = guideStones.filter((item) => item.slug !== stone.slug).slice(0, 3);
  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm sản phẩm..." />
    <main className="stone-article-page">
      <nav className="stone-article-breadcrumb" aria-label="Đường dẫn"><a href="/">Trang chủ</a><span>›</span><a href="/cam-nang-da-quy">Cẩm nang đá quý</a><span>›</span><span>{stone.name}</span></nav>
      <header className="stone-article-hero">
        <div className="stone-article-hero-copy"><span className="eyebrow">GEMSTONE GUIDE · {stone.name.toLocaleUpperCase("vi")}</span><h1>{stone.name}</h1><p>{stone.headline}</p><div className="stone-article-hero-actions"><a className="stone-guide-outline-link" href="/da-quy">Khám phá đá quý <span>→</span></a><a className="stone-article-back-link" href="/cam-nang-da-quy">Tất cả các loại đá</a></div></div>
        {stone.image ? <img src={stone.image} alt={stone.name} /> : <div className={`stone-article-hero-art stone-guide-art-${stone.tone}`} role="img" aria-label={stone.name}><span>◇</span></div>}
      </header>
      <div className="stone-article-content">
        <article className="stone-article-body">
          <span className="eyebrow">CÂU CHUYỆN CỦA {stone.name.toLocaleUpperCase("vi")}</span>
          <h2>{stone.headline}</h2>
          <p className="stone-article-lead">{stone.intro}</p>
          {stone.story.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <div className="stone-article-source"><span>Đọc thêm thông tin về đá quý</span><a href={stone.sourceUrl} target="_blank" rel="noreferrer">Nguồn tham khảo gemology <span aria-hidden="true">↗</span></a></div>
        </article>
        <aside className="stone-article-facts" aria-label={`Thông tin về ${stone.name}`}>
          <span className="eyebrow">GHI NHỚ NHANH</span>
          <dl><div><dt>Đặc điểm</dt><dd>{stone.signature}</dd></div><div><dt>Màu sắc</dt><dd>{stone.colors}</dd></div><div><dt>Cách bảo quản</dt><dd>{stone.care}</dd></div></dl>
          <p>Quan sát từng viên dưới ánh sáng tự nhiên và tìm hiểu rõ thông tin xử lý khi lựa chọn đá quý.</p>
        </aside>
      </div>
      <section className="stone-article-related"><div className="stone-guide-section-heading"><span className="eyebrow">TIẾP TỤC KHÁM PHÁ</span><h2>Các loại đá quý khác</h2></div><div className="stone-guide-grid stone-article-related-grid">{related.map((item) => <article className="stone-guide-card" key={item.slug}><a className={`stone-guide-card-photo${item.image ? "" : ` stone-guide-art-${item.tone}`}`} href={`/cam-nang-da-quy/${item.slug}`} aria-label={`Đọc bài viết về ${item.name}`}><StoneArtwork stone={item} /></a><div className="stone-guide-card-copy"><h3><a href={`/cam-nang-da-quy/${item.slug}`}>{item.name}</a></h3><p>{item.summary}</p><a className="stone-guide-text-link" href={`/cam-nang-da-quy/${item.slug}`}>Xem chi tiết <span>→</span></a></div></article>)}</div></section>
    </main>
    <SiteFooter />
  </>;
}

function StoneArtwork({ stone }: { stone: (typeof guideStones)[number] }) {
  return stone.image ? <img src={stone.image} alt={stone.name} /> : <div className={`stone-guide-art stone-guide-art-${stone.tone}`} role="img" aria-label={stone.name}><span aria-hidden="true">◇</span></div>;
}
