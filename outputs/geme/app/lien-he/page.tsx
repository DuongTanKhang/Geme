import { ContactForm, ContactJumpLink } from "../components/contact-form";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getStoreSiteSettings } from "../lib/store-api";

type ContactIconName = "location" | "phone" | "mail" | "chat";
type SupportIconName = "gem" | "shield" | "return" | "help";

function ContactIcon({ name }: { name: ContactIconName }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.4" /></svg>;
  if (name === "phone") return <svg {...common}><path d="M7 3H4.8A1.8 1.8 0 0 0 3 4.8C3 13.7 10.3 21 19.2 21a1.8 1.8 0 0 0 1.8-1.8V17l-5-2-1.5 2c-3.2-1.2-5.6-3.6-6.8-6.8l2-1.5-2-5Z" /></svg>;
  if (name === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m4 7 8 6 8-6" /></svg>;
  return <svg {...common}><path d="M4 11.5a7.5 7.5 0 0 1 7.5-7.5h1a7.5 7.5 0 0 1 0 15H9l-4 2 .8-4.2A7.4 7.4 0 0 1 4 11.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
}

function SocialIcon({ label }: { label: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const platform = label.toLocaleLowerCase("vi");
  if (platform.includes("instagram")) return <svg {...common}><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.7" cy="6.5" r=".8" fill="currentColor" stroke="none" /></svg>;
  if (platform.includes("facebook")) return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.7 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2v2.2H8V13h2.7v8h3Z" /></svg>;
  if (platform.includes("tiktok")) return <svg {...common}><path d="M14 3v11.2a3.8 3.8 0 1 1-3.1-3.7" /><path d="M14 5c1 2.2 2.7 3.5 5 3.8" /></svg>;
  if (platform.includes("youtube")) return <svg {...common}><rect x="2.7" y="5" width="18.6" height="14" rx="4" /><path d="m10 9 5.2 3-5.2 3V9Z" fill="currentColor" stroke="none" /></svg>;
  if (platform.includes("messenger")) return <svg {...common}><path d="M12 3.2c-5.2 0-9.2 3.7-9.2 8.5 0 2.5 1.1 4.6 3 6.1v3l3.1-1.7c1 .3 2 .5 3.1.5 5.2 0 9.2-3.7 9.2-8.5s-4-7.9-9.2-7.9Z" /><path d="m7.7 13.6 3.2-3.4 2.5 2 3-2-3.2 3.5-2.5-2-3 1.9Z" fill="currentColor" stroke="none" /></svg>;
  return <span aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase("vi")}</span>;
}

function SupportIcon({ name }: { name: SupportIconName }) {
  const common = { viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "gem") return <svg {...common}><path d="m5 11 5-7h12l5 7-11 16L5 11Z" /><path d="M5 11h22M10 4l6 23 6-23" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M16 3 26 7v8c0 7-5 11-10 14C11 26 6 22 6 15V7l10-4Z" /><path d="m11 16 3 3 7-8" /></svg>;
  if (name === "return") return <svg {...common}><path d="M26 12a10 10 0 0 0-17-6L6 9" /><path d="M6 4v5h5M6 20a10 10 0 0 0 17 2l3-3" /><path d="M26 28v-5h-5" /></svg>;
  return <svg {...common}><circle cx="16" cy="16" r="12" /><path d="M12.8 12a3.3 3.3 0 1 1 5.7 2.3c-1.5 1.5-2.5 2-2.5 4.2M16 23h.01" /></svg>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function socialItems(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ label: string; href: string }>;
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const label = displayText(item.label);
    const href = displayText(item.href);
    return label && /^https?:\/\//i.test(href) ? [{ label, href }] : [];
  });
}

export default async function ContactPage() {
  const { settings } = await getStoreSiteSettings();
  const footer = asRecord(settings.footerContent);
  const address = displayText(settings.address ?? footer.address);
  const addressNote = displayText(settings.addressNote ?? footer.addressNote);
  const phone = displayText(settings.phone ?? footer.phone);
  const email = displayText(settings.supportEmail ?? footer.email) || "support@geme.vn";
  const supportHours = displayText(settings.openingHours ?? footer.openingHours) || "08:00 - 22:00 (Tất cả các ngày)";
  const socials = socialItems(footer.socialLinks ?? settings.socialLinks);
  const heroImage = "/images/home/geme/01-hero-opal.webp";
  const directionsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "";
  const mapEmbedUrl = address ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed` : "";
  const helpTopics: Array<{ icon: SupportIconName; title: string; copy: string; href: string }> = [
    { icon: "gem", title: "Thông tin sản phẩm", copy: "Chất liệu, ý nghĩa, cách bảo quản...", href: "/san-pham" },
    { icon: "shield", title: "Chính sách mua hàng", copy: "Đặt hàng, thanh toán, giao hàng...", href: "/san-pham" },
    { icon: "return", title: "Đổi trả & bảo hành", copy: "Quy định đổi trả, bảo hành sản phẩm...", href: "/san-pham" },
    { icon: "help", title: "Câu hỏi thường gặp", copy: "Giải đáp các thắc mắc phổ biến...", href: `mailto:${email}` },
  ];

  return <><SiteHeader /><main className="contact-page">
    <section className="contact-hero" aria-labelledby="contact-title">
      <div className="contact-hero-copy"><div className="contact-hero-copy-inner"><span>GEME / LIÊN HỆ</span><h1 id="contact-title">Kết nối cùng GEME</h1><p>Chúng tôi luôn sẵn sàng lắng nghe và đồng hành cùng bạn trên hành trình khám phá vẻ đẹp của đá quý tự nhiên.</p></div></div>
      <div className="contact-hero-photo"><img src={heroImage} alt="Mặt dây chuyền Opal bạc GEME trên nền xám ngà" width="1681" height="936" fetchPriority="high" /></div>
    </section>

    <section className="contact-main contact-container" aria-label="Thông tin và biểu mẫu liên hệ">
      <div className="contact-information"><div className="contact-section-heading"><h2>Thông tin liên hệ</h2><p>Kết nối với GEME qua các kênh dưới đây.</p></div>
        <div className="contact-details">
          <article className="contact-detail"><span className="contact-detail-icon"><ContactIcon name="location" /></span><div><h3>Địa chỉ</h3><p>{address || "Địa chỉ cửa hàng chưa được cấu hình."}</p><p className="contact-detail-note">{addressNote || (address ? "Vui lòng liên hệ trước khi ghé thăm." : "Vui lòng xác nhận địa điểm với GEME trước khi ghé thăm.")}</p></div></article>
          <article className="contact-detail"><span className="contact-detail-icon"><ContactIcon name="phone" /></span><div><h3>Điện thoại</h3><p>{phone ? <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a> : "Số điện thoại chưa được cấu hình."}</p><p className="contact-detail-note">{supportHours}</p></div></article>
          <article className="contact-detail"><span className="contact-detail-icon"><ContactIcon name="mail" /></span><div><h3>Email</h3><p><a href={`mailto:${email}`}>{email}</a></p><p className="contact-detail-note">Phản hồi trong vòng 24h</p></div></article>
          <article className="contact-detail contact-detail-social"><span className="contact-detail-icon"><ContactIcon name="chat" /></span><div><h3>Mạng xã hội</h3>{socials.length ? <div className="contact-socials">{socials.map((item) => <a href={item.href} aria-label={item.label} key={`${item.label}-${item.href}`} target="_blank" rel="noreferrer"><SocialIcon label={item.label} /></a>)}</div> : <p className="contact-detail-note">Thông tin mạng xã hội chưa được cấu hình.</p>}</div></article>
        </div>
      </div>
      <ContactForm supportEmail={email} />
    </section>

    <section className="contact-location" id="vi-tri" aria-labelledby="contact-location-title">
      <div className="contact-location-heading contact-container"><h2 id="contact-location-title">Vị trí của chúng tôi</h2><div><p>{address || "Địa chỉ cửa hàng chưa được cấu hình."}</p><p>{addressNote || "Vui lòng liên hệ trước khi đến để được hỗ trợ tốt nhất."}</p></div>{directionsUrl ? <a href={directionsUrl} target="_blank" rel="noreferrer">Xem đường đi <span aria-hidden="true">→</span></a> : <span className="contact-directions-unavailable">Chưa có địa chỉ bản đồ</span>}</div>
      {mapEmbedUrl ? <iframe className="contact-map" title="Bản đồ địa chỉ GEME" src={mapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="contact-map contact-map-empty" role="status"><p>Bản đồ sẽ hiển thị sau khi GEME cấu hình địa chỉ chính xác.</p></div>}
    </section>

    <section className="contact-help" aria-labelledby="contact-help-title"><div className="contact-container"><div className="contact-section-heading"><h2 id="contact-help-title">Hỗ trợ nhanh</h2><p>Những chủ đề phổ biến bạn có thể cần.</p></div><div className="contact-help-grid">{helpTopics.map((topic) => <a href={topic.href} className="contact-help-card" key={topic.title}><SupportIcon name={topic.icon} /><h3>{topic.title}</h3><p>{topic.copy}</p><span>Xem chi tiết <b aria-hidden="true">→</b></span></a>)}</div></div></section>

    <section className="contact-cta"><div className="contact-cta-inner contact-container"><h2>Vẫn còn thắc mắc?</h2><p>Đội ngũ của GEME luôn sẵn sàng hỗ trợ bạn tìm kiếm sản phẩm phù hợp và giải đáp mọi câu hỏi.</p><ContactJumpLink /></div></section>
  </main><SiteFooter variant="contact" /></>;
}
