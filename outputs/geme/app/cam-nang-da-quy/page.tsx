import type { Metadata } from "next";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { guideStones } from "./stones";

export const metadata: Metadata = {
  title: "Cẩm nang đá quý | GEME",
  description: "Khám phá đặc điểm, màu sắc và cách chăm sóc các loại đá quý cùng GEME.",
};

function StoneArtwork({ stone, className = "" }: { stone: (typeof guideStones)[number]; className?: string }) {
  return stone.image
    ? <img className={className} src={stone.image} alt={stone.name} loading="lazy" decoding="async" />
    : <div className={`stone-guide-art stone-guide-art-${stone.tone} ${className}`} role="img" aria-label={stone.name}><span aria-hidden="true">◇</span></div>;
}

export default function GemstoneGuidePage() {
  const featured = guideStones[0];
  return <>
    <SiteHeader searchPlaceholder="Tìm kiếm sản phẩm..." />
    <main className="stone-guide-page">
      <section className="stone-guide-hero" aria-labelledby="stone-guide-title">
        <img src="/assets/blog-opal-detail-hero.png" alt="Đá opal trên nền đá tự nhiên" />
        <div className="stone-guide-hero-copy">
          <span className="eyebrow">GEMSTONE GUIDE</span>
          <h1 id="stone-guide-title">Khám phá thế giới<br />đá quý</h1>
          <p>Mỗi viên đá mang một vẻ đẹp riêng, được tạo nên qua thời gian và những điều kiện tự nhiên khác nhau. Cùng GEME tìm hiểu màu sắc, đặc điểm và cách chăm sóc đá quý.</p>
        </div>
      </section>

      <div className="stone-guide-layout">
        <section className="stone-guide-main">
          <div className="stone-guide-intro">
            <span className="eyebrow">KHÁM PHÁ CÁC LOẠI ĐÁ QUÝ</span>
            <h2>Mỗi loại đá – một câu chuyện</h2>
            <p>Từ ánh màu chuyển động của Opal đến sắc xanh dịu của Aquamarine, mỗi loại đá được nhận biết qua những đặc điểm riêng. Hãy khám phá vẻ đẹp và cách chăm sóc phù hợp cho từng loại.</p>
          </div>

          <article className="stone-guide-featured">
            <a className="stone-guide-feature-photo" href={`/cam-nang-da-quy/${featured.slug}`} aria-label={`Đọc về ${featured.name}`}><StoneArtwork stone={featured} /></a>
            <div className="stone-guide-feature-copy">
              <span className="eyebrow">NỔI BẬT</span>
              <h2>{featured.name}</h2>
              <h3>{featured.subtitle}</h3>
              <p>{featured.intro}</p>
              <a className="stone-guide-outline-link" href={`/cam-nang-da-quy/${featured.slug}`}>Khám phá {featured.name}<span>→</span></a>
            </div>
            <dl className="stone-guide-feature-facts">
              <div><dt><span aria-hidden="true">✧</span>Đặc điểm</dt><dd>{featured.signature}</dd></div>
              <div><dt><span aria-hidden="true">◉</span>Màu sắc</dt><dd>{featured.colors}</dd></div>
              <div><dt><span aria-hidden="true">♧</span>Cách bảo quản</dt><dd>{featured.care}</dd></div>
            </dl>
          </article>

          <section className="stone-guide-catalog" aria-labelledby="stone-guide-catalog-title">
            <div className="stone-guide-section-heading"><span className="eyebrow">GEMSTONE DIRECTORY</span><h2 id="stone-guide-catalog-title">Các loại đá quý</h2></div>
            <div className="stone-guide-grid">
              {guideStones.map((stone) => <article className="stone-guide-card" id={`stone-${stone.slug}`} key={stone.slug}>
                <a className={`stone-guide-card-photo${stone.image ? "" : ` stone-guide-art-${stone.tone}`}`} href={`/cam-nang-da-quy/${stone.slug}`} aria-label={`Đọc bài viết về ${stone.name}`}><StoneArtwork stone={stone} /></a>
                <div className="stone-guide-card-copy"><h3><a href={`/cam-nang-da-quy/${stone.slug}`}>{stone.name}</a></h3><p>{stone.summary}</p><a className="stone-guide-text-link" href={`/cam-nang-da-quy/${stone.slug}`}>Xem chi tiết <span>→</span></a></div>
              </article>)}
            </div>
          </section>
        </section>
      </div>

      <section className="stone-guide-cta">
        <img src="/assets/blog-opal-detail-story.png" alt="Ánh sáng trên viên đá opal" />
        <div className="stone-guide-cta-copy"><span className="eyebrow">BẠN ĐANG TÌM LOẠI ĐÁ NÀO?</span><h2>Để GEME giúp bạn<br />khám phá thêm</h2><p>Tìm hiểu từng loại đá, chọn sắc màu bạn yêu thích và khám phá các thiết kế đá quý của GEME.</p><a className="stone-guide-outline-link" href="/da-quy">Khám phá mặt đá quý <span>→</span></a></div>
      </section>
      <p className="stone-guide-disclaimer">Thông tin trong cẩm nang mang tính giới thiệu chung. Đặc tính và cách chăm sóc có thể khác nhau tùy từng viên đá và phương pháp xử lý.</p>
    </main>
    <SiteFooter />
  </>;
}
