"use client";

import { useState } from "react";

export function BlogShareButtons({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const share = (network: "facebook" | "pinterest") => {
    const url = encodeURIComponent(window.location.href);
    const target = network === "facebook"
      ? `https://www.facebook.com/sharer/sharer.php?u=${url}`
      : `https://www.pinterest.com/pin/create/button/?url=${url}&description=${encodeURIComponent(title)}`;
    window.open(target, "_blank", "noopener,noreferrer,width=720,height=640");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return <div className="blog-share-buttons">
    <button type="button" aria-label="Chia sẻ lên Facebook" onClick={() => share("facebook")}>f</button>
    <button type="button" aria-label="Chia sẻ lên Pinterest" onClick={() => share("pinterest")}>℘</button>
    <button type="button" aria-label="Sao chép liên kết bài viết" onClick={() => void copyLink()}>{copied ? "✓" : "↗"}</button>
    <span className="sr-only" aria-live="polite">{copied ? "Đã sao chép liên kết bài viết." : ""}</span>
  </div>;
}
