import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [legacyPath] = process.argv.slice(2);
if (!legacyPath) {
  throw new Error("Cách dùng: node scripts/audit-legacy-sphere-images.mjs <legacy-csv>");
}

for (const name of ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  if (!process.env[name]?.trim()) throw new Error(`Thiếu ${name}`);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}

function parseLegacyImages(csv) {
  const [headerLine, ...lines] = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  const idIndex = headers.indexOf("ID");
  const skuIndex = headers.indexOf("SKU");
  const imageIndex = headers.indexOf("Anh");
  if (idIndex < 0 || skuIndex < 0 || imageIndex < 0) throw new Error("CSV legacy thiếu cột ID, SKU hoặc Anh.");
  return lines.map((line) => {
    const fields = parseCsvLine(line);
    const image = fields[imageIndex]?.trim() ?? "";
    return {
      id: fields[idIndex]?.trim() ?? "",
      sku: fields[skuIndex]?.trim() ?? "",
      image,
      filename: path.basename(image.replace(/\\/g, "/")),
    };
  }).filter((row) => row.image);
}

async function listObjects(prefix) {
  const accountId = process.env.R2_ACCOUNT_ID.trim();
  const bucket = process.env.R2_BUCKET_NAME.trim();
  const accessKey = process.env.R2_ACCESS_KEY_ID.trim();
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256(new Uint8Array());
  let continuationToken = "";
  const keys = [];

  for (let page = 0; page < 100; page += 1) {
    const params = [["list-type", "2"], ["prefix", prefix]];
    if (continuationToken) params.push(["continuation-token", continuationToken]);
    params.sort(([left], [right]) => left.localeCompare(right));
    const query = params.map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = timestamp.slice(0, 8);
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = `GET\n/${encode(bucket)}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${day}/auto/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
    const dateKey = hmac(`AWS4${secret}`, day);
    const regionKey = hmac(dateKey, "auto");
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const response = await fetch(`https://${host}/${encode(bucket)}?${query}`, {
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": timestamp,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`R2 trả HTTP ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>(.*?)<\/Key>/gs)) keys.push(match[1].replaceAll("&amp;", "&"));
    continuationToken = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/s)?.[1] ?? "";
    if (!continuationToken) return keys;
  }
  throw new Error("R2 trả quá 100 trang dữ liệu; dừng để bảo vệ tiến trình.");
}

const rows = parseLegacyImages(await readFile(legacyPath, "utf8"));
const keys = await listObjects("legacy-product-images/");
const byFilename = new Map();
for (const key of keys) {
  const filename = path.basename(key).toLowerCase();
  const entries = byFilename.get(filename) ?? [];
  entries.push(key);
  byFilename.set(filename, entries);
}
const matched = [];
const missing = [];
for (const row of rows) {
  const keysForImage = byFilename.get(row.filename.toLowerCase()) ?? [];
  (keysForImage.length ? matched : missing).push({ ...row, r2Key: keysForImage[0] ?? null });
}
console.log(JSON.stringify({
  legacyRowsWithImage: rows.length,
  r2LegacyObjects: keys.length,
  matched: matched.length,
  missing: missing.length,
  matchedExamples: matched.slice(0, 10),
  missingExamples: missing.slice(0, 20),
}, null, 2));
