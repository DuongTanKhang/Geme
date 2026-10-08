import { getStoreSiteSettings } from "../lib/store-api";

type FooterLink = { label: string; href: string };

const defaults = {
  brandDescription: "Natural Gemstones · Fine Jewelry · For You",
  address: "",
  phone: "",
  email: "support@geme.vn",
  openingHours: "08:00 - 22:00 (Tất cả các ngày)",
  aboutLinks: [
    { label: "Câu chuyện thương hiệu", href: "/ve-geme" },
    { label: "Chính sách bảo mật", href: "/ve-geme" },
    { label: "Điều khoản sử dụng", href: "/ve-geme" },
    { label: "Liên hệ", href: "/lien-he" },
  ],
  supportLinks: [
    { label: "Hướng dẫn mua hàng", href: "/san-pham" },
    { label: "Chính sách đổi trả", href: "/san-pham" },
    { label: "Bảo hành & chăm sóc", href: "/san-pham" },
    { label: "Câu hỏi thường gặp", href: "/san-pham" },
  ],
  socialLinks: [
    { label: "Facebook", href: "" },
    { label: "Instagram", href: "" },
    { label: "TikTok", href: "" },
    { label: "YouTube", href: "" },
  ],
  paymentMethods: ["VISA", "Mastercard", "MoMo", "ZaloPay"],
  copyright: "© 2025 GEME. All rights reserved.",
};

function links(value: unknown, fallback: FooterLink[]) {
  return Array.isArray(value) ? value.filter((item): item is FooterLink => Boolean(item && typeof item === "object" && "label" in item)).map((item) => ({ label: String(item.label), href: String(item.href || "#") })) : fallback;
}

function FooterSocialIcon({ label }: { label: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const platform = label.toLocaleLowerCase("vi");
  if (platform.includes("instagram")) return <svg {...common}><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.7" cy="6.5" r=".8" fill="currentColor" stroke="none" /></svg>;
  if (platform.includes("facebook")) return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.7 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2v2.2H8V13h2.7v8h3Z" /></svg>;
  if (platform.includes("tiktok")) return <svg {...common}><path d="M14 3v11.2a3.8 3.8 0 1 1-3.1-3.7" /><path d="M14 5c1 2.2 2.7 3.5 5 3.8" /></svg>;
  if (platform.includes("youtube")) return <svg {...common}><rect x="2.7" y="5" width="18.6" height="14" rx="4" /><path d="m10 9 5.2 3-5.2 3V9Z" fill="currentColor" stroke="none" /></svg>;
  return <span aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase("vi")}</span>;
}

export async function SiteFooter({ variant = "default" }: { variant?: "default" | "catalog" | "contact" | "journal" }) {
  const { settings } = await getStoreSiteSettings();
  const saved: Record<string, unknown> = settings.footerContent && typeof settings.footerContent === "object" ? settings.footerContent : {};
  const footer = { ...defaults, ...saved } as typeof defaults & Record<string, unknown>;
  const aboutLinks = links(saved.aboutLinks, defaults.aboutLinks).filter((item) =>
    !item.label.toLocaleLowerCase("vi").includes("cẩm nang đá quý") &&
    !item.href.toLocaleLowerCase("vi").startsWith("/cam-nang-da-quy"),
  );
  const supportLinks = links(saved.supportLinks, defaults.supportLinks);
  const socialLinks = variant === "contact"
    ? links(saved.socialLinks, []).filter((item) => /^https?:\/\//i.test(item.href))
    : links(saved.socialLinks, defaults.socialLinks);
  const paymentMethods = Array.isArray(saved.paymentMethods) ? saved.paymentMethods.map(String) : defaults.paymentMethods;
  const background = String(saved.backgroundImageUrl || "");

  const footerClass = variant === "catalog" ? " site-footer--catalog" : variant === "contact" ? " site-footer--contact" : variant === "journal" ? " site-footer--journal" : "";

  return <footer className={`site-footer${footerClass}`} style={variant !== "default" || !background ? undefined : { backgroundImage: `linear-gradient(90deg, rgb(249 248 245 / 96%), rgb(249 248 245 / 90%)), url("${background}")` }}>
    <div className="footer-main content-width">
      <div className="footer-brand"><a className="footer-wordmark" href="/">{saved.logoImageUrl ? <img src={String(saved.logoImageUrl)} alt="GEME"/> : <><span>✦</span> GEME</>}</a><div>{String(footer.brandDescription)}</div>{footer.address && <small>{String(footer.address)}</small>}{footer.phone && <a href={`tel:${String(footer.phone).replace(/[^+\d]/g, "")}`}>{String(footer.phone)}</a>}{footer.email && <a href={`mailto:${String(footer.email)}`}>{String(footer.email)}</a>}{footer.openingHours && <small>{String(footer.openingHours)}</small>}</div>
      <div className="footer-column"><strong>VỀ GEME</strong>{aboutLinks.map((item, index) => <a key={`about-${index}`} href={item.href}>{item.label}</a>)}</div>
      <div className="footer-column"><strong>HỖ TRỢ KHÁCH HÀNG</strong>{supportLinks.map((item, index) => <a key={`support-${index}`} href={item.href}>{item.label}</a>)}</div>
      <div className="footer-connect" id="lien-he"><strong>KẾT NỐI VỚI GEME</strong>{socialLinks.length ? <div className="socials">{socialLinks.map((item, index) => <a key={`social-${index}`} href={item.href || "#lien-he"} aria-label={item.label} target={item.href.startsWith("http") ? "_blank" : undefined} rel={item.href.startsWith("http") ? "noreferrer" : undefined}>{variant === "default" ? item.label.slice(0, 1) : <FooterSocialIcon label={item.label} />}</a>)}</div> : variant === "contact" ? <small className="footer-socials-unconfigured">Kênh mạng xã hội chưa được cấu hình.</small> : <div className="socials">{socialLinks.map((item, index) => <a key={`social-${index}`} href={item.href || "#lien-he"} aria-label={item.label}>{item.label.slice(0, 1)}</a>)}</div>}{variant !== "journal" && <form className="newsletter"><input type="email" placeholder="Nhập email của bạn" aria-label="Email nhận tin" /><button aria-label="Đăng ký nhận tin" type="button">→</button></form>}<div className="footer-payments" aria-label="Phương thức thanh toán">{paymentMethods.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div></div>
    </div>
    <div className="footer-bottom content-width"><span>{String(footer.copyright)}</span><span>Natural Gemstones <i>·</i> Fine Jewelry <i>·</i> For You</span></div>
  </footer>;
}
