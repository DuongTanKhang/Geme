interface Env {
  GEME_MEDIA: R2Bucket;
}

const notFound = () => new Response("Not found", { status: 404 });

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const key = objectKeyFromPath(new URL(request.url).pathname);
    if (!key) return notFound();

    const object = await env.GEME_MEDIA.get(key);
    if (!object) return notFound();

    const contentType = object.httpMetadata?.contentType || "";
    const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
    // This gateway is for product photography. It cannot expose PDFs, private
    // AI originals, or executable SVG content even if one is put in the bucket.
    if (!normalizedContentType.startsWith("image/") || normalizedContentType === "image/svg+xml") return notFound();

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(object.size));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
} satisfies ExportedHandler<Env>;
