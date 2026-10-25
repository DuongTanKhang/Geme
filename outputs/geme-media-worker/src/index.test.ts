import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.ts";

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
function fixture(contentType = "video/mp4") {
  const calls: Array<{ op: string; key: string; range?: { offset: number; length: number } }> = [];
  const metadata = {
    size: bytes.length,
    httpEtag: '"test-etag"',
    httpMetadata: { contentType },
    writeHttpMetadata(headers: Headers) { headers.set("Content-Type", contentType); },
  };
  const bucket = {
    async head(key: string) { calls.push({ op: "head", key }); return metadata; },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      calls.push({ op: "get", key, range: options?.range });
      const selected = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
      return { ...metadata, body: new ReadableStream({ start(controller) { controller.enqueue(selected); controller.close(); } }) };
    },
  };
  return { env: { GEME_MEDIA: bucket } as never, calls };
}

test("allows public raster images and video with immutable cache headers", async () => {
  for (const contentType of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "video/mp4", "video/webm"]) {
    const { env } = fixture(contentType);
    const response = await worker.fetch(new Request("https://media.example.test/media/abc." + contentType.split("/")[1]), env);
    assert.equal(response.status, 200, contentType);
    assert.equal(response.headers.get("content-type"), contentType);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
  }
});

test("serves single byte ranges and suffix ranges for video seek", async () => {
  const first = fixture();
  const response = await worker.fetch(new Request("https://media.example.test/media/clip.mp4", { headers: { Range: "bytes=2-5" } }), first.env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("content-length"), "4");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5]);
  assert.deepEqual(first.calls.map((call) => call.op), ["head", "get"]);

  const suffix = fixture();
  const suffixResponse = await worker.fetch(new Request("https://media.example.test/media/clip.mp4", { headers: { Range: "bytes=-3" } }), suffix.env);
  assert.equal(suffixResponse.status, 206);
  assert.equal(suffixResponse.headers.get("content-range"), "bytes 7-9/10");
  assert.deepEqual([...new Uint8Array(await suffixResponse.arrayBuffer())], [7, 8, 9]);
});

test("HEAD returns metadata and no body", async () => {
  const { env, calls } = fixture("video/webm");
  const response = await worker.fetch(new Request("https://media.example.test/media/clip.webm", { method: "HEAD" }), env);
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.deepEqual(calls.map((call) => call.op), ["head"]);
});

test("rejects unsupported ranges, PDF, SVG, private prefixes, and invalid paths", async () => {
  const invalidRange = fixture();
  const rangeResponse = await worker.fetch(new Request("https://media.example.test/media/clip.mp4", { headers: { Range: "bytes=20-30" } }), invalidRange.env);
  assert.equal(rangeResponse.status, 416);
  assert.equal(rangeResponse.headers.get("content-range"), "bytes */10");
  assert.deepEqual(invalidRange.calls.map((call) => call.op), ["head"]);

  for (const type of ["application/pdf", "image/svg+xml"]) {
    const { env } = fixture(type);
    assert.equal((await worker.fetch(new Request("https://media.example.test/media/file"), env)).status, 404);
  }
  const privatePrefix = fixture();
  assert.equal((await worker.fetch(new Request("https://media.example.test/private-media/original.png"), privatePrefix.env)).status, 404);
  assert.equal(privatePrefix.calls.length, 0);
  for (const path of ["/products/file.jpg", "/media/%2e%2e%2fsecret", "/media/a%5cb.jpg", "/media/%E0%A4%A"]) {
    const { env, calls } = fixture();
    assert.equal((await worker.fetch(new Request("https://media.example.test" + path), env)).status, 404, path);
    assert.equal(calls.length, 0, path);
  }
});

test("rejects methods other than GET and HEAD", async () => {
  const { env, calls } = fixture();
  const response = await worker.fetch(new Request("https://media.example.test/media/file.jpg", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(calls.length, 0);
});
