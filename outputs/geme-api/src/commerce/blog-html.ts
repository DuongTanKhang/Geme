import sanitizeHtml from "sanitize-html";

const safeBlogTags = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
  "h1", "h2", "h3", "blockquote", "div", "span", "a", "img", "figure",
  "figcaption", "hr", "table", "thead", "tbody", "tr", "th", "td",
];

const safeBlogHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: safeBlogTags,
  allowedAttributes: {
    a: ["href", "target", "title", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

/** Server-side allowlist; sanitize old database rows on reads as well as writes. */
export function sanitizeBlogHtml(value: unknown) {
  return sanitizeHtml(typeof value === "string" ? value : "", safeBlogHtmlOptions);
}
