import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  absolutePublicImageUrl,
  absoluteSiteUrl,
  getPublicSiteUrl,
  plainText,
  serializeJsonLd,
  validDate,
} from "../app/lib/seo.ts";

const oldSiteUrl = process.env.GEME_SITE_URL;
const oldNodeEnv = process.env.NODE_ENV;
after(() => {
  if (oldSiteUrl === undefined) delete process.env.GEME_SITE_URL;
  else process.env.GEME_SITE_URL = oldSiteUrl;
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldNodeEnv;
});

test("canonical URLs use the configured public HTTPS origin", () => {
  process.env.GEME_SITE_URL = "https://geme.vn";
  assert.equal(absoluteSiteUrl("/san-pham/nhan-opal"), "https://geme.vn/san-pham/nhan-opal");
  assert.equal(getPublicSiteUrl().origin, "https://geme.vn");
});

test("production rejects missing, insecure, and local canonical origins", () => {
  process.env.NODE_ENV = "production";
  delete process.env.GEME_SITE_URL;
  assert.throws(() => getPublicSiteUrl(), /GEME_SITE_URL/);
  process.env.GEME_SITE_URL = "http://geme.vn";
  assert.throws(() => getPublicSiteUrl(), /HTTPS/);
  process.env.GEME_SITE_URL = "https://localhost:3000";
  assert.throws(() => getPublicSiteUrl(), /HTTPS/);
});

test("public image URLs accept paths and web origins, but reject non-web schemes", () => {
  process.env.NODE_ENV = "test";
  process.env.GEME_SITE_URL = "https://geme.vn";
  assert.equal(absolutePublicImageUrl("/media/opal.jpg"), "https://geme.vn/media/opal.jpg");
  assert.equal(absolutePublicImageUrl("https://media.geme.vn/opal.jpg"), "https://media.geme.vn/opal.jpg");
  assert.equal(absolutePublicImageUrl("data:image/png;base64,abc"), null);
});

test("metadata text strips markup and scripts, decodes common entities, and limits length", () => {
  assert.equal(plainText("<p>Opal&nbsp;&amp; <strong>GEME</strong></p><script>alert(1)</script>"), "Opal & GEME");
  assert.equal(plainText("A".repeat(10), 5), "AAAA…");
});

test("JSON-LD escapes tag openers and date validation rejects invalid values", () => {
  assert.equal(serializeJsonLd({ name: "<script>" }), '{"name":"\\u003cscript>"}');
  assert.equal(validDate("not a date"), undefined);
  assert.equal(validDate("2026-10-20")?.toISOString(), "2026-10-20T00:00:00.000Z");
});
