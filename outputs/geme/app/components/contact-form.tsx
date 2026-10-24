"use client";

import { useRef, useState, type FormEvent } from "react";
import { normalizeApiBaseUrl } from "../lib/api-base";

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");

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
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const idempotencyKey = useRef("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(["name", "phone", "email", "subject", "message", "website"].map((key) => [key, String(formData.get(key) || "")]));
    if (!idempotencyKey.current) idempotencyKey.current = globalThis.crypto?.randomUUID?.() || `contact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSubmitting(true); setMessage(""); setSent(false);
    try {
      const response = await fetch(`${API_BASE}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "Không gửi được biểu mẫu. Vui lòng thử lại.");
      idempotencyKey.current = "";
      form.reset();
      setSent(true);
      setMessage("GEME đã nhận và lưu yêu cầu của bạn. Chúng tôi sẽ liên hệ sớm nhất có thể.");
    } catch (error) {
      setSent(false);
      setMessage(error instanceof Error ? error.message : "Không gửi được biểu mẫu. Vui lòng thử lại.");
    } finally { setSubmitting(false); }
  }

  return <form className="contact-form" id="contact-form" onSubmit={handleSubmit}>
    <div className="contact-section-heading"><h2>Gửi tin nhắn cho chúng tôi</h2><p>Hãy để lại thông tin, chúng tôi sẽ phản hồi sớm nhất có thể.</p></div>
    <div className="contact-fields">
      <label><span className="contact-field-label">Họ và tên <i>*</i></span><input id="contact-name" name="name" type="text" placeholder="Nhập họ và tên" autoComplete="name" required /></label>
      <label><span className="contact-field-label">Số điện thoại <i>*</i></span><input name="phone" type="tel" placeholder="Nhập số điện thoại" autoComplete="tel" required /></label>
      <label className="contact-field-wide"><span className="contact-field-label">Email <i>*</i></span><input name="email" type="email" placeholder="Nhập email của bạn" autoComplete="email" required /></label>
      <label className="contact-field-wide"><span className="contact-field-label">Chủ đề <i>*</i></span><select name="subject" defaultValue="" required><option value="" disabled>Chọn chủ đề</option><option>Tư vấn sản phẩm</option><option>Đơn hàng và giao hàng</option><option>Đổi trả và bảo hành</option><option>Khác</option></select></label>
      <label className="contact-field-wide"><span className="contact-field-label">Nội dung tin nhắn <i>*</i></span><textarea name="message" placeholder="Nhập nội dung tin nhắn..." rows={4} required /></label>
      <label className="contact-honeypot" aria-hidden="true" tabIndex={-1}>Website<input name="website" type="text" autoComplete="off" tabIndex={-1} /></label>
      <button className="contact-submit" type="submit" disabled={submitting}>{submitting ? "Đang gửi…" : "Gửi tin nhắn"} <span aria-hidden="true">→</span></button>
      {message && <p className={`contact-form-note${sent ? " contact-form-success" : ""}`} role="status">{message}{!sent && <> Bạn cũng có thể <a href={`mailto:${supportEmail}`}>gửi email cho GEME</a>.</>}</p>}
    </div>
  </form>;
}
