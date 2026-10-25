/**
 * Product and CMS media routes redirect to the public R2 CDN. The Next image
 * optimizer's internal request handler does not follow that rewrite redirect,
 * so proxy URLs must be loaded directly by the browser.
 */
export function isStoreMediaProxyUrl(source: string | null | undefined) {
  if (!source) return false;
  try {
    const pathname = source.startsWith("/") ? source.split(/[?#]/, 1)[0] : new URL(source).pathname;
    return pathname === "/media" || pathname.startsWith("/media/") || pathname === "/assets" || pathname.startsWith("/assets/");
  } catch {
    return false;
  }
}

/** Bump when the media proxy's delivery behavior changes so cached redirects/errors are bypassed. */
export function storeMediaDeliveryUrl(source: string | null | undefined) {
  if (!source || !isStoreMediaProxyUrl(source)) return source;
  const hashIndex = source.indexOf("#");
  const base = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}media-delivery=v2${hash}`;
}
