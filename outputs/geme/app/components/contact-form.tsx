"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeApiBaseUrl } from "../lib/api-base";

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1");
type ContactProfile = { name: string; email: string; phone: string };

export function ContactJumpLink() {
  function focusContactForm(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const firstField = document.querySelector<HTMLElement>('#contact-form input:not([name="website"]), #contact-form select, #contact-form textarea');
    const target = firstField || document.getElementById("contact-form");
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    firstField?.focus({ preventScroll: true });
  }

  return <a className="contact-cta-link" href="#contact-form" onClick={focusContactForm}>Liên hệ ngay <span aria-hidden="true">→</span></a>;
}

export function ContactForm({ supportEmail }: { supportEmail: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const idempotencyKey = useRef("");
  const profileHasName = Boolean(profile?.name && profile.name.length >= 2 && profile.name.length <= 120);
  const profileHasEmail = Boolean(profile?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email));
  const profileHasPhone = Boolean(profile?.phone && profile.phone.replace(/\D/g, "").length >= 9 && profile.phone.replace(/\D/g, "").length <= 15);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(6000) })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!active) return;
        const customer = result?.customer && typeof result.customer === "object" ? result.customer as Record<string, unknown> : null;
        setProfile(customer ? {
          name: typeof customer.name === "string" ? customer.name.trim() : "",
          email: typeof customer.email === "string" ? customer.email.trim() : "",
          phone: typeof customer.phone === "string" ? customer.phone.trim() : "",
        } : null);
      })
      .catch(() => { if (active) setProfile(null); })
      .finally(() => { if (active) setSessionResolved(true); });
    return () => { active = false; };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const nameInput = formData.get("name");
    const phoneInput = formData.get("phone");
    const emailInput = formData.get("email");
    const payload = {
      name: nameInput === null ? profile?.name || "" : String(nameInput).trim(),
      phone: phoneInput === null ? profile?.phone || "" : String(phoneInput).trim(),
      email: emailInput === null ? profile?.email || "" : String(emailInput).trim(),
      subject: String(formData.get("subject") || ""),
      message: String(formData.get("message") || ""),
      website: String(formData.get("website") || ""),
    };
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
    <div className="contact-section-heading"><h2>Gửi tin nhắn cho chúng tôi</h2><p>{profile
      ? profileHasEmail
        ? `Tên${profileHasName ? ` ${profile.name}` : ""} và email${profileHasEmail ? ` (${profile.email})` : ""} sẽ lấy từ tài khoản. Số điện thoại không bắt buộc.`
        : "Tên sẽ lấy từ tài khoản. Vui lòng nhập email để GEME phản hồi; số điện thoại không bắt buộc."
      : "Nhập họ tên và email để GEME phản hồi; số điện thoại không bắt buộc."}</p></div>
    <div className="contact-fields">
      {!sessionResolved ? <p className="contact-field-wide" role="status">Đang kiểm tra thông tin tài khoản…</p> : <>
        {(!profile || !profileHasName) && <label><span className="contact-field-label">Họ và tên <i>*</i></span><input id="contact-name" name="name" type="text" placeholder="Nhập họ và tên" autoComplete="name" defaultValue={profile?.name || ""} minLength={2} maxLength={120} required /></label>}
        {(!profile || !profileHasPhone) && <label><span className="contact-field-label">Số điện thoại <small>(không bắt buộc)</small></span><input id="contact-phone" name="phone" type="tel" placeholder="Nhập số điện thoại" autoComplete="tel" defaultValue={profile?.phone || ""} maxLength={32} /></label>}
        {(!profile || !profileHasEmail) && <label className="contact-field-wide"><span className="contact-field-label">Email <i>*</i></span><input id="contact-email" name="email" type="email" placeholder="Nhập email của bạn" autoComplete="email" defaultValue={profile?.email || ""} required /></label>}
        <label className="contact-field-wide"><span className="contact-field-label">Chủ đề <i>*</i></span><select id="contact-subject" name="subject" defaultValue="" required><option value="" disabled>Chọn chủ đề</option><option>Tư vấn sản phẩm</option><option>Đơn hàng và giao hàng</option><option>Đổi trả và bảo hành</option><option>Khác</option></select></label>
        <label className="contact-field-wide"><span className="contact-field-label">Nội dung tin nhắn <i>*</i></span><textarea id="contact-message" name="message" placeholder="Nhập nội dung tin nhắn..." rows={4} required /></label>
      </>}
      <label className="contact-honeypot" aria-hidden="true" tabIndex={-1}>Website<input name="website" type="text" autoComplete="off" tabIndex={-1} /></label>
      <button className="contact-submit" type="submit" disabled={submitting || !sessionResolved}>{submitting ? "Đang gửi…" : "Gửi tin nhắn"} <span aria-hidden="true">→</span></button>
      {message && <p className={`contact-form-note${sent ? " contact-form-success" : ""}`} role="status">{message}{!sent && <> Bạn cũng có thể <a href={`mailto:${supportEmail}`}>gửi email cho GEME</a>.</>}</p>}
    </div>
  </form>;
}
