"use client";

import { useEffect, useState, type FormEvent } from "react";

type AccountMode = "login" | "register";
type SavedProfile = { name?: string; email?: string; phone?: string };
type AccountProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  defaultAddress: string | null;
  avatarUrl: string | null;
  orderCount: number;
};
type AccountOrder = { id: string; date: string; status: string; title: string; image?: string | null; price: number };

function postLoginDestination() {
  if (typeof window === "undefined") return "/tai-khoan";
  const requested = new URLSearchParams(window.location.search).get("next")?.trim() || "";
  if (!requested.startsWith("/") || requested.startsWith("//")) return "/tai-khoan";
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin || ["/dang-nhap", "/dang-ky"].includes(destination.pathname)) return "/tai-khoan";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/tai-khoan";
  }
}

async function readAvatarDataUrl(file: File) {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error("Chọn ảnh PNG, JPG hoặc WebP nhỏ hơn 8 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không xử lý được ảnh đại diện.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không nén được ảnh đại diện.")), "image/webp", 0.84));
    if (blob.size > 2 * 1024 * 1024) throw new Error("Ảnh sau khi nén vẫn vượt quá 2 MB.");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không đọc được ảnh đại diện."));
      reader.onerror = () => reject(new Error("Không đọc được ảnh đại diện."));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

function redirectToLoginForCurrentPage() {
  const currentPage = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/dang-nhap?next=${encodeURIComponent(currentPage)}`);
}

function AccountIcon({ name }: { name: "orders" | "heart" | "pin" | "user" | "lock" | "grid" | "gift" | "calendar" | "star" }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "heart") return <svg {...props}><path d="M20.8 8.8c0 5-8.8 10.3-8.8 10.3S3.2 13.8 3.2 8.8A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8.8 2.3Z" /></svg>;
  if (name === "user") return <svg {...props}><circle cx="12" cy="7.5" r="3.2" /><path d="M5.3 20v-1.6a6.7 6.7 0 0 1 13.4 0V20Z" /></svg>;
  if (name === "lock") return <svg {...props}><rect x="4" y="10" width="16" height="11" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></svg>;
  if (name === "pin") return <svg {...props}><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>;
  if (name === "calendar") return <svg {...props}><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4m9-4v4M4 9h16m-12 4h2m4 0h2m-8 4h2" /></svg>;
  if (name === "star") return <svg {...props}><path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2L3.1 9.5l6.2-.9L12 3Z" /></svg>;
  if (name === "gift") return <svg {...props}><path d="M3 10h18v11H3zM2 6h20v4H2zM12 6v15m0-15H8.5a2.5 2.5 0 1 1 2.4-3.1L12 6Zm0 0h3.5a2.5 2.5 0 1 0-2.4-3.1L12 6Z" /></svg>;
  if (name === "grid") return <svg {...props}><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></svg>;
  return <svg {...props}><path d="M5 3.5h14v17l-7-4-7 4v-17Z" /><path d="m12 6 1 2 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6L11 8l1-2Z" /></svg>;
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{hidden ? <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.7 4.5 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.2 6.2C4.1 7.5 2.8 9.7 2.5 11c.8 1.5 4.5 6 9.5 6 1 0 2-.2 2.8-.5" /></> : <><path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></>}</svg>;
}

export function AuthPage({ mode }: { mode: AccountMode }) {
  const isRegister = mode === "register";
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingEmailVerification, setPendingEmailVerification] = useState("");
  const [email, setEmail] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [lifetimeMinutes, setLifetimeMinutes] = useState(5);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (!isRegister) {
      const prefilledEmail = new URLSearchParams(window.location.search).get("email")?.trim();
      if (prefilledEmail) setEmail(prefilledEmail);
    }
  }, [isRegister]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = window.setTimeout(() => setResendCountdown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submittedEmail = email.trim().toLowerCase();
    const password = String(values.get("password") || "");

    if (isRegister && password.length < 10) {
      setMessage("Mật khẩu cần tối thiểu 10 ký tự.");
      setSubmitted(false);
      return;
    }
    if (isRegister && password.length > 128) {
      setMessage("Mật khẩu không được vượt quá 128 ký tự.");
      setSubmitted(false);
      return;
    }
    if (isRegister && (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password))) {
      setMessage("Mật khẩu cần có chữ hoa, chữ thường, số và ký tự đặc biệt.");
      setSubmitted(false);
      return;
    }

    if (isRegister && password !== values.get("confirm-password")) {
      setMessage("Mật khẩu xác nhận chưa khớp. Vui lòng kiểm tra lại.");
      setSubmitted(false);
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: isRegister ? String(values.get("name") || "").trim() : undefined,
          email: submittedEmail,
          phone: isRegister ? String(values.get("phone") || "").trim() : undefined,
          password,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (isRegister && response.status >= 500) {
          setPendingEmailVerification(submittedEmail);
          setMessage("Chưa nhận được xác nhận từ máy chủ gửi thư. Bạn có thể yêu cầu gửi lại mã nếu tài khoản đã được tạo.");
          setSubmitted(false);
          return;
        }
        throw new Error(result.message || "Không thể xử lý yêu cầu.");
      }
      if (isRegister) {
        setPendingEmailVerification(submittedEmail);
        setCodeLength(Number(result.codeLength) || 6);
        setLifetimeMinutes(Number(result.lifetimeMinutes) || 5);
        setResendCountdown(Math.max(0, Number(result.resendCooldownSeconds) || 0));
        setOtpInput("");
        setMessage(result.message || "Mã xác nhận đã được gửi. Hãy kiểm tra email của bạn.");
        setSubmitted(true);
        return;
      }
      window.location.assign(postLoginDestination());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không kết nối được máy chủ xác thực.");
      setSubmitted(false);
    } finally {
      setBusy(false);
    }
  }

  async function verifyRegistrationEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpInput.length !== codeLength) {
      setMessage(`Vui lòng nhập đủ ${codeLength} chữ số.`);
      setSubmitted(false);
      return;
    }

    setBusy(true);
    setMessage("");
    setSubmitted(false);
    try {
      const response = await fetch("/api/auth/verify-email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmailVerification, otp: otpInput }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Không xác minh được mã.");
      window.location.assign(`/dang-nhap?email=${encodeURIComponent(pendingEmailVerification)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xác minh được mã. Mã bạn vừa nhập vẫn được giữ lại.");
    } finally {
      setBusy(false);
    }
  }

  async function resendRegistrationCode() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmailVerification }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Chưa gửi lại được mã.");
      setCodeLength(Number(result.codeLength) || codeLength);
      setLifetimeMinutes(Number(result.lifetimeMinutes) || lifetimeMinutes);
      setResendCountdown(Math.max(0, Number(result.resendCooldownSeconds) || 0));
      setMessage(result.message || "Đã xử lý yêu cầu gửi lại mã. Hãy kiểm tra hộp thư và thư rác.");
      setSubmitted(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không gửi lại được mã. Vui lòng thử lại sau.");
      setSubmitted(false);
    } finally {
      setBusy(false);
    }
  }

  const accountHeading = pendingEmailVerification ? "Xác nhận email" : isRegister ? "Đăng ký" : "Đăng nhập";
  const accountIntro = pendingEmailVerification
    ? "Nhập mã OTP để hoàn tất đăng ký tài khoản GEME."
    : isRegister
      ? "Tạo tài khoản để tiếp tục hành trình cùng GEME."
      : "Thật vui khi được gặp lại bạn.";

  return <main className="account-page auth-page">
    <section className="auth-main" aria-label="Tài khoản GEME">
      <div className="auth-visual">
        <img src="/assets/category-jewelry-final.jpg" alt="Nhẫn Opal bạc trên nền vải sáng và hoa trắng" />
        <div className="auth-visual-copy">
          <div className="auth-visual-message">
            <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
            <h1>{isRegister ? <>Chào mừng bạn<br />đến với GEME</> : <>Chào mừng bạn<br />trở lại GEME</>}</h1>
            <p>{isRegister ? "Tạo tài khoản để lưu lại những thiết kế bạn yêu thích và nhận các ưu đãi dành riêng cho bạn." : "Tiếp tục hành trình khám phá những viên đá quý độc đáo cùng GEME."}</p>
          </div>
          <p className="auth-visual-quote"><span aria-hidden="true">✧</span><i>More than just jewelry.<br />It’s a story of you.</i></p>
        </div>
      </div>
      <section className="auth-panel" aria-labelledby="auth-heading">
        <div className="auth-form-card">
          <span className="auth-eyebrow">TÀI KHOẢN GEME</span>
          <h2 id="auth-heading">{accountHeading}</h2>
          <p className="auth-intro">{accountIntro}</p>
          {!pendingEmailVerification && <nav className="auth-tabs" aria-label="Tài khoản"><a aria-current={!isRegister ? "page" : undefined} className={!isRegister ? "is-active" : ""} href="/dang-nhap">Đăng nhập</a><a aria-current={isRegister ? "page" : undefined} className={isRegister ? "is-active" : ""} href="/dang-ky">Đăng ký</a></nav>}
        {pendingEmailVerification ? <form className="account-form" autoComplete="off" onSubmit={verifyRegistrationEmail}>
          <p className="auth-code-destination">Email nhận mã: <strong>{pendingEmailVerification}</strong>. Mã có hiệu lực trong {lifetimeMinutes} phút và chỉ dùng một lần. Nếu chưa nhận được, hãy kiểm tra thư rác hoặc gửi lại mã.</p>
          <label>Mã xác nhận<input name="otp" type="text" inputMode="numeric" autoCapitalize="off" spellCheck={false} autoComplete="one-time-code" pattern={`[0-9]{${codeLength}}`} maxLength={codeLength} placeholder={`Nhập mã ${codeLength} chữ số`} value={otpInput} onChange={(event) => setOtpInput(event.target.value.replace(/\D/g, "").slice(0, codeLength))} required /></label>
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "ĐANG XÁC NHẬN..." : "XÁC NHẬN"}</button>
          <button className="text-button" type="button" onClick={resendRegistrationCode} disabled={busy || resendCountdown > 0}>{resendCountdown > 0 ? `Gửi lại mã sau ${resendCountdown} giây` : "Gửi lại mã"}</button>
          {message && <div className={`auth-feedback${submitted ? " is-success" : ""}`} role="status">{message}</div>}
        </form> : <form className="account-form" onSubmit={handleSubmit}>
          {isRegister && <><p className="auth-field-help">Nếu bạn đã tạo hồ sơ tại cửa hàng, nhập đúng số điện thoại để dùng họ tên đã lưu. Nếu chưa có hồ sơ, hãy nhập thêm họ tên.</p><label>Họ và tên (nếu chưa tạo hồ sơ tại cửa hàng)<input name="name" autoComplete="name" placeholder="Nhập họ tên của bạn" /></label><label>Số điện thoại<input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="Nhập số điện thoại đã đăng ký tại cửa hàng" required /></label></>}
          <label>Email<input name="email" autoComplete="username" type="email" placeholder="Nhập email của bạn" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Mật khẩu<span className="account-password-field"><input name="password" autoComplete={isRegister ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} placeholder="Nhập mật khẩu" minLength={isRegister ? 10 : 8} maxLength={isRegister ? 128 : undefined} required /><button type="button" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShowPassword((value) => !value)}><EyeIcon hidden={!showPassword} /></button></span>{isRegister && <small className="auth-field-help">Tối thiểu 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</small>}</label>
          {isRegister && <label>Xác nhận mật khẩu<input name="confirm-password" autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Nhập lại mật khẩu" minLength={10} maxLength={128} required /></label>}
          {!isRegister && <div className="auth-form-options"><label className="auth-checkbox"><input type="checkbox" name="remember" /> Ghi nhớ đăng nhập</label><button type="button" className="text-button" onClick={() => setMessage("Chức năng đặt lại mật khẩu chưa được cấu hình trong AEGIS.")}>Quên mật khẩu?</button></div>}
          {isRegister && <label className="auth-checkbox auth-terms"><input type="checkbox" required /> Tôi đồng ý với điều khoản sử dụng và chính sách bảo mật của GEME.</label>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "ĐANG XỬ LÝ..." : isRegister ? "TẠO TÀI KHOẢN" : "ĐĂNG NHẬP"}</button>
          {message && <div className={`auth-feedback${submitted ? " is-success" : ""}`} role="status">{message}{submitted && <a href="/dang-nhap">Đến trang đăng nhập →</a>}</div>}
        </form>}
        {!pendingEmailVerification && <p className="auth-switch">{isRegister ? "Đã có tài khoản? " : "Chưa có tài khoản? "}<a href={isRegister ? "/dang-nhap" : "/dang-ky"}>{isRegister ? "Đăng nhập" : "Đăng ký ngay"}</a></p>}
        <p className="auth-demo-note">Tài khoản được xác thực bởi AEGIS; phiên đăng nhập được lưu bằng cookie bảo mật.</p>
      </div>
      </section>
    </section>
  </main>;
}

const accountTabs = [
  ["overview", "Tổng quan", "grid"], ["orders", "Đơn hàng của tôi", "orders"], ["favorites", "Sản phẩm yêu thích", "heart"], ["addresses", "Địa chỉ giao hàng", "pin"], ["profile", "Thông tin tài khoản", "user"], ["password", "Đổi mật khẩu", "lock"],
] as const;

const orderStatusLabels: Record<string, string> = {
  PENDING_CONFIRMATION: "Chờ xác nhận",
  PROCESSING: "Đang xử lý",
  SHIPPING: "Đang giao",
  DELIVERED: "Đã giao",
  CANCELLED: "Đã hủy",
};

export function ProfilePage() {
  const [tab, setTab] = useState("overview");
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultAddress, setDefaultAddress] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (accountTabs.some(([id]) => id === requestedTab)) setTab(requestedTab!);

    let cancelled = false;
    async function loadAccount() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (response.status === 401) {
          redirectToLoginForCurrentPage();
          return;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Không tải được tài khoản.");
        if (cancelled) return;
        const customer = result.customer as AccountProfile;
        setProfile(customer);
        setName(customer.name || "");
        setEmail(customer.email || "");
        setPhone(customer.phone || "");
        setDefaultAddress(customer.defaultAddress || "");
        setAvatarPreview(customer.avatarUrl || "");

        const ordersResponse = await fetch("/api/account/orders", { cache: "no-store" });
        if (ordersResponse.ok) {
          const orderRows = await ordersResponse.json();
          if (!cancelled) setOrders(Array.isArray(orderRows) ? orderRows : []);
        }
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Không tải được thông tin tài khoản.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAccount();
    return () => { cancelled = true; };
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/account/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, defaultAddress, ...(avatarDataUrl ? { avatarDataUrl } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Không lưu được thông tin.");
      setProfile(result as AccountProfile);
      setName(result.name || "");
      setPhone(result.phone || "");
      setDefaultAddress(result.defaultAddress || "");
      setAvatarPreview(result.avatarUrl || "");
      setAvatarDataUrl("");
      setNotice("Thông tin cá nhân đã được lưu.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không lưu được thông tin.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { window.location.assign("/dang-nhap"); }
  }

  async function selectAvatar(file?: File) {
    if (!file) return;
    setAvatarBusy(true);
    setNotice("");
    try {
      const dataUrl = await readAvatarDataUrl(file);
      setAvatarDataUrl(dataUrl);
      setAvatarPreview(dataUrl);
      setNotice("Ảnh đã chọn. Bấm Lưu thay đổi để cập nhật ảnh đại diện.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không đọc được ảnh đại diện.");
    } finally {
      setAvatarBusy(false);
    }
  }

  return <main className="account-page profile-page">
    <section className="account-hero profile-hero"><img src="/assets/collection-jewelry-banner-1.png" alt="Bộ sưu tập trang sức GEME" /><div className="account-hero-copy"><span className="eyebrow">TÀI KHOẢN CỦA TÔI</span><h1>Xin chào, {name ? `${name.split(" ")[0]}!` : "bạn!"}</h1><p>Quản lý đơn hàng và thông tin tài khoản GEME của bạn.</p></div></section>
    <div className="profile-layout content-width">
      <aside className="profile-sidebar"><div className="profile-identity"><div className="profile-avatar">{avatarPreview ? <img src={avatarPreview} alt="Ảnh đại diện"/> : <AccountIcon name="user" />}</div><div><strong>{name || "Khách hàng"}</strong><span>{email || "Đang tải tài khoản..."}</span></div></div><nav aria-label="Khu vực tài khoản">{accountTabs.map(([id, label, icon]) => <button type="button" key={id} onClick={() => { setTab(id); setNotice(""); }} className={tab === id ? "is-current" : ""} aria-current={tab === id ? "page" : undefined}><AccountIcon name={icon} />{label}</button>)}<button type="button" className="profile-logout" onClick={logout} disabled={busy}><span aria-hidden="true">↪</span>Đăng xuất</button></nav></aside>
      <section className="profile-main" aria-live="polite">
        {notice && <p className="profile-notice" role="status">{notice}</p>}
        {loading && <p className="profile-orders-empty">Đang tải thông tin tài khoản...</p>}
        {!loading && !profile && <p className="profile-orders-empty">Không tải được hồ sơ khách hàng.</p>}
        {!loading && profile && <>
          {tab === "overview" && <>
            <div className="profile-stats"><div><AccountIcon name="calendar" /><strong>{profile.orderCount}</strong><span>Đơn hàng</span></div><div><AccountIcon name="heart" /><strong>0</strong><span>Sản phẩm yêu thích</span></div><div><AccountIcon name="star" /><strong>0</strong><span>Điểm thưởng</span></div><div><AccountIcon name="gift" /><strong>0</strong><span>Ưu đãi đang có</span></div></div>
            <section className="profile-panel"><div className="profile-panel-heading"><h2>Đơn hàng gần đây</h2><button type="button" onClick={() => setTab("orders")}>Xem tất cả <span>→</span></button></div><OrderList openOrder={openOrder} setOpenOrder={setOpenOrder} orders={orders.slice(0, 5)} /></section>
          </>}
          {tab === "orders" && <section className="profile-panel"><div className="profile-panel-heading"><h2>Đơn hàng của tôi</h2><span>{orders.length} đơn hàng</span></div><OrderList openOrder={openOrder} setOpenOrder={setOpenOrder} orders={orders} /></section>}
          {tab === "favorites" && <section className="profile-panel"><div className="profile-panel-heading"><h2>Sản phẩm yêu thích</h2><span>0 sản phẩm</span></div><div className="profile-favorites-empty">Bạn chưa có sản phẩm yêu thích.</div></section>}
          {tab === "addresses" && <section className="profile-panel profile-edit-panel"><div className="profile-panel-heading"><h2>Địa chỉ giao hàng mặc định</h2><span>Được dùng khi đặt hàng</span></div><form className="profile-form" onSubmit={saveProfile}><label>Số điện thoại<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Nhập số điện thoại" /></label><label>Địa chỉ giao hàng<textarea value={defaultAddress} onChange={(event) => setDefaultAddress(event.target.value)} placeholder="Nhập địa chỉ giao hàng" rows={3} /></label><button type="submit" disabled={busy}>{busy ? "ĐANG LƯU..." : "LƯU THAY ĐỔI"}</button></form></section>}
          {tab === "profile" && <section className="profile-panel profile-edit-panel"><div className="profile-panel-heading"><h2>Thông tin tài khoản</h2><span>Email đăng nhập đã xác minh bởi AEGIS</span></div><div className="profile-avatar-editor"><div className="profile-avatar profile-avatar-large">{avatarPreview ? <img src={avatarPreview} alt="Ảnh đại diện xem trước"/> : <AccountIcon name="user" />}</div><label>Ảnh đại diện<input type="file" accept="image/png,image/jpeg,image/webp" disabled={avatarBusy || busy} onChange={(event) => { void selectAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/><small>{avatarBusy ? "Đang xử lý ảnh…" : "PNG, JPG hoặc WebP. Ảnh sẽ được thu nhỏ và nén trước khi lưu."}</small></label></div><form className="profile-form" onSubmit={saveProfile}><label>Họ và tên<input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="name" required /></label><label>Email<input type="email" value={email} readOnly /></label><label>Số điện thoại<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Nhập số điện thoại" autoComplete="tel" /></label><label>Địa chỉ giao hàng<textarea value={defaultAddress} onChange={(event) => setDefaultAddress(event.target.value)} placeholder="Nhập địa chỉ giao hàng" rows={3} /></label><button type="submit" disabled={busy || avatarBusy}>{busy ? "ĐANG LƯU..." : "LƯU THAY ĐỔI"}</button></form></section>}
          {tab === "password" && <section className="profile-panel profile-edit-panel"><div className="profile-panel-heading"><h2>Đổi mật khẩu</h2><span>Bảo vệ tài khoản của bạn</span></div><p className="profile-address-empty">Luồng đổi mật khẩu chưa được bật trên AEGIS. Hãy liên hệ GEME để được hỗ trợ.</p></section>}
        </>}
      </section>
    </div>
  </main>;
}

function OrderList({ orders, openOrder, setOpenOrder }: { orders: AccountOrder[]; openOrder: string | null; setOpenOrder: (id: string | null) => void }) {
  return <div className="profile-orders">{orders.length ? orders.map((order) => <article className="profile-order" key={order.id}>{order.image && <img src={order.image} alt="" />}<div className="profile-order-info"><strong>{order.id}</strong><span>{new Date(order.date).toLocaleDateString("vi-VN")} · {orderStatusLabels[order.status] || order.status}</span><small>{order.title}</small></div><strong className="profile-order-price">{Number(order.price).toLocaleString("vi-VN")} ₫</strong><button type="button" onClick={() => setOpenOrder(openOrder === order.id ? null : order.id)}>{openOrder === order.id ? "Thu gọn" : "Xem chi tiết"}</button>{openOrder === order.id && <p className="profile-order-detail">{order.title}</p>}</article>) : <p className="profile-orders-empty">Chưa có đơn hàng.</p>}</div>;
}
