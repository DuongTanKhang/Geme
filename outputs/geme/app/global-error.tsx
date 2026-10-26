"use client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function GlobalError({ retry }: GlobalErrorProps) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, background: "#fafaf7", color: "#173b33", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeContent: "center", justifyItems: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: ".2em" }}>GEME</p>
          <h1 style={{ margin: 0, fontFamily: "Georgia, serif", fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 400 }}>Trang đang gặp sự cố</h1>
          <p style={{ maxWidth: 440, margin: 0, color: "#68716c", lineHeight: 1.6 }}>Nội dung chưa thể tải lúc này. Vui lòng thử lại sau.</p>
          <button type="button" onClick={retry} style={{ minHeight: 44, padding: "0 20px", border: 0, background: "#103f35", color: "#fff", cursor: "pointer" }}>Thử lại</button>
        </main>
      </body>
    </html>
  );
}
