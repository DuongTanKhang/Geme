import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreBanner, getStoreSiteSettings } from "../lib/store-api";

const values = [
  { icon: "✧", title: "Vẻ đẹp độc bản", copy: "Mỗi viên đá đều là duy nhất và không thể thay thế." },
  { icon: "◇", title: "Giá trị bền vững", copy: "Đá quý là tài sản tự nhiên có giá trị lâu dài." },
  { icon: "♧", title: "Chọn lọc kỹ lưỡng", copy: "Chỉ những viên đá chất lượng cao nhất được sử dụng." },
  { icon: "♡", title: "Tinh tế trong thiết kế", copy: "Tôn vinh vẻ đẹp tự nhiên bằng những thiết kế tối giản, hiện đại." },
];

const principles = [
  ["01", "Chất lượng đá", "Màu sắc, độ trong, độ bền và độ hiếm."],
  ["02", "Thiết kế", "Tối giản, tinh tế, dễ dùng hàng ngày."],
  ["03", "Nguồn gốc", "Minh bạch, có kiểm định rõ ràng."],
  ["04", "Giá trị người dùng", "Phù hợp với phong cách và cá tính riêng."],
];

export default async function AboutPage() {
  const { settings } = await getStoreSiteSettings();
  const heroImage = getStoreBanner(settings, "Về GEME - Hero", "/images/home/geme/09-lifestyle-ring.webp");
  const storyImage = getStoreBanner(settings, "Về GEME - Câu chuyện", "/assets/about-geme-intro.png");
  const purposeImage = getStoreBanner(settings, "Về GEME - Sứ mệnh", "/assets/about-geme-opal.png");

  return <>
    <SiteHeader />
    <main className="about-page">
      <section className="about-hero">
        <div className="about-hero-copy">
          <span className="eyebrow">GEME / VỀ CHÚNG TÔI</span>
          <h1>Không chỉ là trang sức, đó là những câu chuyện đến từ thiên nhiên.</h1>
          <p>GEME là nơi những viên đá quý được chọn lọc kỹ lưỡng, trở thành trang sức mang theo vẻ đẹp tự nhiên, sự tinh tế và dấu ấn cá nhân của mỗi người.</p>
          <a href="#hanh-trinh">Khám phá hành trình của GEME <span aria-hidden="true">→</span></a>
        </div>
        <div className="about-hero-media">
          <img src={heroImage} alt="Nhẫn Moonstone bạc trong hình ảnh thương hiệu GEME" fetchPriority="high" />
        </div>
      </section>

      <section className="about-intro about-container" id="hanh-trinh">
        <img src={storyImage} alt="Bộ sưu tập trang sức đá quý GEME giữa hoa trắng và đá tự nhiên" />
        <div className="about-intro-copy">
          <span className="eyebrow">NATURAL STONES · FOR YOUR STORY</span>
          <h2>GEME là ai?</h2>
          <p>GEME là thương hiệu trang sức đá quý cao cấp, được thành lập với mong muốn mang vẻ đẹp của thiên nhiên vào cuộc sống thường ngày thông qua những thiết kế tinh tế và bền vững.</p>
          <p>Chúng tôi tin rằng mỗi viên đá quý đều mang trong mình một câu chuyện riêng, và mỗi món trang sức không chỉ là phụ kiện, mà còn là một phần câu chuyện của người sở hữu.</p>
          <span className="about-signature">Natural Stones<br />for Your Story <b aria-hidden="true">✧</b></span>
        </div>
      </section>

      <section className="about-values">
        <div className="about-values-inner about-container">
          <div className="about-values-intro">
            <div className="about-values-lead">
              <span className="eyebrow">ĐIỀU GEME TIN TƯỞNG</span>
              <h2>Vì sao GEME chọn đá quý?</h2>
            </div>
            <div className="about-values-description">
              <p>Đá quý là món quà kỳ diệu của tự nhiên, được hình thành qua hàng triệu năm. Mỗi viên đá đều mang một vẻ đẹp riêng, không trùng lặp, như chính mỗi người đều là duy nhất.</p>
              <a href="/san-pham">Khám phá các loại đá quý <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div className="about-value-list">
            {values.map((value) => <article key={value.title}>
              <span className="about-value-icon" aria-hidden="true">{value.icon}</span>
              <h3>{value.title}</h3>
              <p>{value.copy}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section className="about-purpose about-container">
        <div className="about-purpose-copy">
          <span className="eyebrow">SỨ MỆNH CỦA GEME</span>
          <h2>GEME theo đuổi điều gì?</h2>
          <p>GEME không chỉ là một thương hiệu trang sức, mà còn là một hành trình lan tỏa giá trị của sự tinh khiết, ý thức về thiên nhiên và cái đẹp bền vững.</p>
          <ul>
            <li>Mang đến những thiết kế vượt thời gian.</li>
            <li>Lan tỏa vẻ đẹp và giá trị của đá quý.</li>
            <li>Xây dựng một cộng đồng yêu cái đẹp tinh tế và bền vững.</li>
          </ul>
        </div>
        <img src={purposeImage} alt="Viên Opal thiên nhiên nhiều sắc màu trên nền đá sáng" />
      </section>

      <section className="about-selection">
        <div className="about-container about-selection-copy">
          <span className="eyebrow">TÂM HUYẾT TRONG TỪNG CHI TIẾT</span>
          <h2>Cách GEME lựa chọn sản phẩm</h2>
          <p>Chúng tôi tuyển chọn từng viên đá dựa trên 4 tiêu chí:</p>
          <div className="about-principles">
            {principles.map(([number, title, copy]) => <article key={number}>
              <span>{number}</span>
              <b aria-hidden="true">✧</b>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section className="about-closing">
        <div className="about-container about-closing-inner">
          <p>Tinh hoa từ thiên nhiên, đồng hành cùng bạn.</p>
        </div>
      </section>
    </main>
    <SiteFooter variant="catalog" />
  </>;
}
