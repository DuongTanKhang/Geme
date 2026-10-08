"use client";

import { useEffect, useRef, useState, type FocusEvent, type TouchEvent } from "react";

export type CollectionBannerSlide = {
  id: string;
  src: string;
  alt: string;
  position?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  ctaLabel?: string;
  href?: string;
  captionIndex?: number;
};

const defaultSlides: CollectionBannerSlide[] = [
  { id: "jewelry-1", src: "/assets/collection-jewelry-banner-1.png", alt: "Nhẫn Opal trên nền lụa và hoa trắng", position: "68% 50%", eyebrow: "COLLECTION / GEME", title: "Vẻ đẹp tự nhiên, dấu ấn riêng", description: "Mỗi thiết kế lưu giữ nét tinh tế của bạc và vẻ đẹp độc đáo từ đá quý thiên nhiên.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { id: "jewelry-2", src: "/assets/collection-jewelry-banner-2.png", alt: "Mặt dây đá xanh hình giọt nước trên nền vải sáng", position: "69% 50%", eyebrow: "COLLECTION / GEME", title: "Tất cả sản phẩm", description: "Trang sức bạc tinh tế kết hợp đá quý thiên nhiên, lưu giữ vẻ đẹp riêng trong từng khoảnh khắc.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { id: "jewelry-3", src: "/assets/collection-jewelry-banner-3.png", alt: "Đôi hoa tai đá xanh trên nền vải sáng", position: "68% 50%", eyebrow: "GEME / NATURAL GEMSTONES", title: "Sắc xanh đầy cuốn hút", description: "Những viên đá quý được chọn lọc để tôn lên vẻ đẹp riêng trong từng thiết kế.", ctaLabel: "Xem bộ sưu tập", href: "#san-pham" },
  { id: "jewelry-4", src: "/assets/collection-jewelry-banner-4.png", alt: "Vòng tay đá Ruby trên nền đá tự nhiên", position: "68% 50%", eyebrow: "GEME / FINE JEWELRY", title: "Sắc màu của riêng bạn", description: "Chọn sắc đá yêu thích và tìm thiết kế đồng hành cùng phong cách của bạn.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
  { id: "jewelry-5", src: "/assets/collection-jewelry-banner-5.png", alt: "Trâm hoa đá tím trên nền lụa và hoa trắng", position: "69% 50%", eyebrow: "COLLECTION / GEME", title: "Tinh tế trong từng chi tiết", description: "Dấu ấn thủ công và vẻ đẹp thiên nhiên gặp nhau trong những món trang sức GEME.", ctaLabel: "Khám phá trang sức", href: "#san-pham" },
];

function collectionHref(value?: string) {
  const href = value?.trim();
  if (!href || href === "/san-pham" || href === "./" || href === ".") return "#san-pham";
  return href;
}

export function CollectionBanner({ slides = defaultSlides }: { slides?: CollectionBannerSlide[] }) {
  const carouselRef = useRef<HTMLElement>(null);
  const touchStart = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const slideCount = slides.length;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    const updateVisibility = () => setVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, slideCount - 1)));
  }, [slideCount]);

  const autoplay = slideCount > 1 && !manuallyPaused && !hovered && !focused && visible && !reducedMotion;
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => setActive((index) => (index + 1) % slideCount), 2000);
    return () => window.clearTimeout(timer);
  }, [active, autoplay, slideCount]);

  const moveTo = (index: number) => setActive((index + slideCount) % slideCount);
  const move = (direction: -1 | 1) => moveTo(active + direction);
  const onFocusOut = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };
  const onTouchStart = (event: TouchEvent<HTMLElement>) => { touchStart.current = event.touches[0]?.clientX ?? null; };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start === null) return;
    const delta = event.changedTouches[0]?.clientX - start;
    if (Math.abs(delta) > 48) move(delta < 0 ? 1 : -1);
  };

  if (!slideCount) return null;

  return <section
    ref={carouselRef}
    className="jewelry-collection-banner"
    aria-label="Bộ sưu tập trang sức GEME"
    aria-roledescription="carousel"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={onFocusOut}
    onTouchStart={onTouchStart}
    onTouchEnd={onTouchEnd}
  >
    <div className="jewelry-collection-banner-viewport">
      <div className="jewelry-collection-banner-track" style={{ transform: `translate3d(-${active * 100}%, 0, 0)` }}>
        {slides.map((slide, index) => {
          const isActive = index === active;
          const fallbackSlide = defaultSlides[slide.captionIndex ?? index] || defaultSlides[0];
          const title = slide.title || fallbackSlide.title || "Tất cả sản phẩm";
          const description = slide.description || fallbackSlide.description || "Trang sức bạc tinh tế kết hợp đá quý thiên nhiên, lưu giữ vẻ đẹp riêng trong từng khoảnh khắc.";
          const ctaLabel = slide.ctaLabel || fallbackSlide.ctaLabel || "Khám phá trang sức";
          return <article
            className="jewelry-collection-banner-slide"
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${String(index + 1).padStart(2, "0")} / ${String(slideCount).padStart(2, "0")}`}
            aria-hidden={!isActive}
            inert={!isActive}
          >
            <div className="jewelry-collection-banner-copy">
              <span className="jewelry-collection-banner-eyebrow">{slide.eyebrow || fallbackSlide.eyebrow || "COLLECTION / GEME"}</span>
              {isActive ? <h1>{title}</h1> : <h2>{title}</h2>}
              <p>{description}</p>
              <a className="jewelry-collection-banner-cta" href={collectionHref(slide.href)}>{ctaLabel}<span aria-hidden="true">→</span></a>
              {slideCount > 1 && <div className="jewelry-collection-banner-controls" aria-label="Điều khiển trình chiếu">
                <button type="button" className="jewelry-banner-step" onClick={() => move(-1)} aria-label="Slide trước">‹</button>
                <span className="jewelry-banner-count" aria-live="polite">{String(active + 1).padStart(2, "0")} / {String(slideCount).padStart(2, "0")}</span>
                <button type="button" className="jewelry-banner-step" onClick={() => move(1)} aria-label="Slide sau">›</button>
                <button type="button" className="jewelry-banner-toggle" onClick={() => setManuallyPaused((paused) => !paused)} aria-label={manuallyPaused ? "Tiếp tục trình chiếu" : "Tạm dừng trình chiếu"} title={manuallyPaused ? "Tiếp tục" : "Tạm dừng"}>{manuallyPaused ? <span aria-hidden="true">▶</span> : <span aria-hidden="true">Ⅱ</span>}</button>
                <div className="jewelry-banner-progress" aria-label="Chọn slide">
                  {slides.map((item, dotIndex) => <button type="button" key={item.id} className={dotIndex === active ? "is-active" : ""} aria-label={`Đến slide ${String(dotIndex + 1).padStart(2, "0")}`} aria-current={dotIndex === active ? "true" : undefined} onClick={() => moveTo(dotIndex)}><span /></button>)}
                </div>
              </div>}
            </div>
            <div className="jewelry-collection-banner-media">
              <img
                src={slide.src}
                alt={slide.alt || fallbackSlide.alt}
                width={1440}
                height={260}
                sizes="(max-width: 767px) 100vw, 54vw"
                style={{ objectPosition: slide.position || fallbackSlide.position || "68% 50%" }}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                decoding="async"
              />
            </div>
          </article>;
        })}
      </div>
    </div>
  </section>;
}
