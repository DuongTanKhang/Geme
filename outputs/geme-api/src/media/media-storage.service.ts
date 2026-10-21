import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Uint8Array, value: string) => createHmac("sha256", key).update(value).digest();
const encodePathPart = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly provider = (process.env.MEDIA_STORAGE_PROVIDER || "database").trim().toLowerCase();
  private readonly publicBaseUrl = (process.env.MEDIA_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  private readonly privateBucket = (process.env.R2_PRIVATE_BUCKET_NAME || "").trim();

  constructor() {
    if (this.provider !== "database" && this.provider !== "r2") {
      throw new Error("MEDIA_STORAGE_PROVIDER must be either 'database' or 'r2'.");
    }
  }

  get usesR2() {
    return this.provider === "r2";
  }

  get usesPrivateR2() {
    return this.usesR2 && Boolean(this.privateBucket);
  }

  publicUrl(objectKey: string) {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl}/${objectKey.split("/").map(encodePathPart).join("/")}`;
  }

  async putPublicObject(objectKey: string, bytes: Uint8Array, mimeType: string) {
    const response = await this.request("PUT", objectKey, bytes, mimeType);
    if (!response.ok) {
      this.logger.error(`R2 upload failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể lưu media vào object storage. Vui lòng thử lại.");
    }
  }

  async getPublicObject(objectKey: string) {
    const response = await this.request("GET", objectKey);
    if (!response.ok) {
      this.logger.error(`R2 read failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể đọc media từ object storage.");
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async headPublicObject(objectKey: string) {
    return this.request("HEAD", objectKey);
  }

  async putPrivateObject(objectKey: string, bytes: Uint8Array, mimeType: string) {
    if (!this.privateBucket) throw new ServiceUnavailableException("R2_PRIVATE_BUCKET_NAME chưa được cấu hình.");
    const response = await this.request("PUT", objectKey, bytes, mimeType, this.privateBucket);
    if (!response.ok) {
      this.logger.error(`R2 private upload failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể lưu media riêng tư vào object storage.");
    }
  }

  async getPrivateObject(objectKey: string) {
    if (!this.privateBucket) throw new ServiceUnavailableException("R2_PRIVATE_BUCKET_NAME chưa được cấu hình.");
    const response = await this.request("GET", objectKey, undefined, undefined, this.privateBucket);
    if (!response.ok) {
      this.logger.error(`R2 private read failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể đọc media riêng tư từ object storage.");
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async deletePrivateObject(objectKey: string) {
    if (!this.privateBucket) throw new ServiceUnavailableException("R2_PRIVATE_BUCKET_NAME chưa được cấu hình.");
    const response = await this.request("DELETE", objectKey, undefined, undefined, this.privateBucket);
    if (!response.ok && response.status !== 404) {
      this.logger.error(`R2 private delete failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể dọn media riêng tư khỏi object storage.");
    }
  }

  async deletePublicObject(objectKey: string) {
    const response = await this.request("DELETE", objectKey);
    if (!response.ok && response.status !== 404) {
      this.logger.error(`R2 delete failed with HTTP ${response.status}.`);
      throw new ServiceUnavailableException("Không thể dọn media khỏi object storage.");
    }
  }

  private async request(method: "GET" | "HEAD" | "PUT" | "DELETE", objectKey: string, body?: Uint8Array, mimeType?: string, selectedBucket?: string) {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const bucket = selectedBucket || process.env.R2_BUCKET_NAME?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException("R2 chưa được cấu hình đầy đủ trên API.");
    }

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const canonicalPath = `/${encodePathPart(bucket)}/${objectKey.split("/").map(encodePathPart).join("/")}`;
    const url = `https://${host}${canonicalPath}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = hash(body || new Uint8Array());
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = `${method}\n${canonicalPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${shortDate}/auto/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonicalRequest)}`;
    const dateKey = hmac(`AWS4${secretAccessKey}`, shortDate);
    const regionKey = hmac(dateKey, "auto");
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (mimeType) headers["Content-Type"] = mimeType;

    try {
      return await fetch(url, { method, headers, ...(body ? { body: Buffer.from(body) } : {}) });
    } catch (error) {
      this.logger.error("R2 request could not reach Cloudflare.", error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException("Không kết nối được object storage. Vui lòng thử lại.");
    }
  }
}
