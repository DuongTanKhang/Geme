"use client";

import { useState, type FormEvent } from "react";

export function ContactJumpLink() {
  function focusContactForm(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const firstField = document.getElementById("contact-name");
    firstField?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    firstField?.focus({ preventScroll: true });
  }

  return <a className="contact-cta-link" href="#contact-name" onClick={focusContactForm}>Liên hệ ngay <span aria-hidden="true">→</span></a>;
}

export function ContactForm({ supportEmail }: { supportEmail: string }) {
  const [unavailable, setUnavailable] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUnavailable(true);
  }

  return <form className="contact-form" id="contact-form" onSubmit={handleSubmit}>
    <div className="contact-section-heading"><h2>Gửi tin nhắn cho chúng tôi</h2><p>Hãy để lại thông tin, chúng tôi sẽ phản hồi sớm nhất có thể.</p></div>
    <div className="contact-fields">
      <label><span className="contact-field-label">Họ và tên <i>*</i></span><input id="contact-name" name="name" type="text" placeholder="Nhập họ và tên" autoComplete="name" required /></label>
      <label><span className="contact-field-label">Số điện thoại <i>*</i></span><input name="phone" type="tel" placeholder="Nhập số điện thoại" autoComplete="tel" required /></label>
      <label className="contact-field-wide"><span className="contact-field-label">Email <i>*</i></span><input name="email" type="email" placeholder="Nhập email của bạn" autoComplete="email" required /></label>
      <label className="contact-field-wide"><span className="contact-field-label">Chủ đề <i>*</i></span><select name="subject" defaultValue="" required><option value="" disabled>Chọn chủ đề</option><option>Tư vấn sản phẩm</option><option>Đơn hàng và giao hàng</option><option>Đổi trả và bảo hành</option><option>Khác</option></select></label>
      <label className="contact-field-wide"><span className="contact-field-label">Nội dung tin nhắn <i>*</i></span><textarea name="message" placeholder="Nhập nội dung tin nhắn..." rows={4} required /></label>
      <button className="contact-submit" type="submit">Gửi tin nhắn <span aria-hidden="true">→</span></button>
      {unavailable && <p className="contact-form-note" role="status">Biểu mẫu hiện chưa được kết nối với hệ thống gửi tin nhắn. Bạn có thể <a href={`mailto:${supportEmail}`}>gửi email cho GEME</a> để được hỗ trợ.</p>}
    </div>
  </form>;
}
