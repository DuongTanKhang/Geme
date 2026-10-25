interface Env {
  GEME_MEDIA: R2Bucket;
}

const notFound = () => new Response("Not found", { status: 404 });
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);

function objectKeyFromPath(pathname: string) {
  if (!pathname.startsWith("/media/")) return null;
  const encodedKey = pathname.slice(1);
  let key: string;
  try {
    const decodedParts = encodedKey.split("/").map((part) => decodeURIComponent(part));
    if (decodedParts.some((part) => part.includes("/") || part.includes("\\"))) return null;
    key = decodedParts.join("/");
  } catch {
    return null;
  }
  const parts = key.split("/");
  if (parts[0] !== "media" || parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) return null;
  return key;
}

type ByteRange = { offset: number; length: number };
function parseRange(header: string | null, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return "invalid";
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return "invalid";
  let offset: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    offset = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    offset = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || offset >= size) return "invalid";
    end = Math.min(end, size - 1);
  }
  return { offset, length: end - offset + 1 };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const key = objectKeyFromPath(new URL(request.url).pathname);
    if (!key) return notFound();

    const rangeHeader = request.headers.get("Range");
    const metadata = rangeHeader || request.method === "HEAD" ? await env.GEME_MEDIA.head(key) : null;
    const object = metadata ? null : await env.GEME_MEDIA.get(key);
    const source = metadata || object;
    if (!source) return notFound();

    const contentType = source.httpMetadata?.contentType || "";
    const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
    // The Worker exposes only raster product media under `media/`, never PDFs,
    // SVG, AI originals, or private bucket paths.
    if (!imageTypes.has(normalizedContentType) && !videoTypes.has(normalizedContentType)) return notFound();

    const range = parseRange(rangeHeader, source.size);
    if (range === "invalid") {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${source.size}`, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    const rangedObject = range ? await env.GEME_MEDIA.get(key, { range: { offset: range.offset, length: range.length } }) : null;
    const bodyObject = request.method === "HEAD" ? null : (rangedObject || object);
    if (request.method !== "HEAD" && !bodyObject) return notFound();

    const headers = new Headers();
    source.writeHttpMetadata(headers);
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(range ? range.length : source.size));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", source.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Accept-Ranges", "bytes");
    if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${source.size}`);

    return new Response(request.method === "HEAD" ? null : bodyObject!.body, { status: range ? 206 : 200, headers });
  },
} satisfies ExportedHandler<Env>;
