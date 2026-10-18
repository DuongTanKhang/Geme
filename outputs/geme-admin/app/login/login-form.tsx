"use client";

import { FormEvent, useState } from "react";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Email hoặc mật khẩu không đúng.");
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đăng nhập được. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return <section className="admin-login-card">
    <span className="admin-login-mark">G</span>
    <p className="admin-login-eyebrow">GEME · ADMIN</p>
    <h1>Đăng nhập quản trị</h1>
    <p className="admin-login-description">Sử dụng tài khoản quản trị đã được cấp để tiếp tục.</p>
    <form onSubmit={submit}>
      <label>Tài khoản hoặc email<input type="text" autoComplete="username" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Mật khẩu<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="admin-login-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Đang xác thực…" : "Đăng nhập"}</button>
    </form>
  </section>;
}
