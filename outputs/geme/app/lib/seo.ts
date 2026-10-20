const DEVELOPMENT_SITE_URL = "https://geme.vn";

export function getPublicSiteUrl(): URL {
  const configured = process.env.GEME_SITE_URL?.trim();
  const value = configured || (process.env.NODE_ENV === "production" ? "" : DEVELOPMENT_SITE_URL);
  if (!value) throw new Error("GEME_SITE_URL phải được cấu hình trước khi chạy production.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("GEME_SITE_URL phải là một URL hợp lệ, ví dụ https://geme.vn.");
  }

  const invalidHost = /(^localhost$|\.localhost$|\.local$|example\.(com|org|net)$)/i.test(parsed.hostname);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" || invalidHost) {
    throw new Error("GEME_SITE_URL phải là origin HTTPS công khai, không kèm đường dẫn, query hoặc thông tin đăng nhập.");
  }
  return new URL(parsed.origin);
}

export function absoluteSiteUrl(path: string): string {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return new URL(pathname, getPublicSiteUrl()).toString();
}

export function absolutePublicImageUrl(value?: string | null): string | null {
  const image = value?.trim();
  if (!image) return null;
  try {
    const url = new URL(image, getPublicSiteUrl());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function plainText(value?: string | null, maxLength = 320): string {
  if (!value) return "";
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export function validDate(value?: string | Date | null): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
