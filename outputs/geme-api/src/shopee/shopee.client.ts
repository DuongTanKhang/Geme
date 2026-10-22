import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  shopeeApiOrigin,
  shopeeAuthorizationOrigin,
  shopeeEnvironment,
  signShopeeRequest,
  type ShopeeEnvironment,
} from "./shopee.contract.js";

export type ShopeeConfig = {
  configured: boolean;
  partnerId: string;
  partnerKey: string;
  environment: ShopeeEnvironment;
  redirectUri: string;
  adminReturnUrl: string;
  initialSyncDays: number;
  pollIntervalMinutes: number;
};

export class ShopeeApiError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly status?: number, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "ShopeeApiError";
  }
}

export function shopeeConfig(): ShopeeConfig {
  const partnerId = process.env.SHOPEE_PARTNER_ID?.trim() || "";
  const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim() || "";
  const redirectUri = process.env.SHOPEE_REDIRECT_URI?.trim() || "";
  const adminReturnUrl = process.env.SHOPEE_ADMIN_RETURN_URL?.trim() || "";
  const initialDaysInput = Number(process.env.SHOPEE_INITIAL_SYNC_DAYS);
  const pollInput = Number(process.env.SHOPEE_POLL_INTERVAL_MINUTES);
  return {
    configured: Boolean(partnerId && partnerKey && redirectUri && encryptionKeyConfigured()),
    partnerId,
    partnerKey,
    environment: shopeeEnvironment(process.env.SHOPEE_ENVIRONMENT),
    redirectUri,
    adminReturnUrl,
    initialSyncDays: Number.isInteger(initialDaysInput) ? Math.max(1, Math.min(365, initialDaysInput)) : 30,
    pollIntervalMinutes: Number.isInteger(pollInput) ? Math.max(5, Math.min(60, pollInput)) : 5,
  };
}

function encryptionKey() {
  const raw = process.env.SHOPEE_TOKEN_ENCRYPTION_KEY?.trim() || "";
  const key = Buffer.from(raw, "base64");
  if (!raw || key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new ServiceUnavailableException("SHOPEE_TOKEN_ENCRYPTION_KEY chưa cấu hình đúng (cần khóa base64 32 byte).");
  }
  return key;
}

export function encryptionKeyConfigured() {
  try { encryptionKey(); return true; } catch { return false; }
}

export function encryptShopeeToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptShopeeToken(value: string) {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("SHOPEE_TOKEN_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

type ShopeeResponse<T> = { error?: string; message?: string; request_id?: string; response?: T; [key: string]: unknown };

export class ShopeeClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  authorizationUrl(state: string) {
    const config = shopeeConfig();
    if (!config.configured) throw new ServiceUnavailableException("Cần cấu hình Shopee Partner ID/Key, callback URL và khóa mã hóa phía backend trước khi kết nối.");
    const url = new URL("/auth", shopeeAuthorizationOrigin(config.environment));
    url.searchParams.set("partner_id", config.partnerId);
    url.searchParams.set("auth_type", "seller");
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, shopId: string) {
    const path = "/api/v2/auth/token/get";
    const config = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShopeeRequest({ partnerId: config.partnerId, partnerKey: config.partnerKey, path, timestamp, shopId });
    return this.postJson<{ access_token?: string; refresh_token?: string; expire_in?: number; refresh_token_expire_in?: number; shop_id?: number | string }>(
      `${shopeeApiOrigin(config.environment)}${path}?${new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), sign, shop_id: shopId })}`,
      { code, shop_id: Number(shopId), partner_id: Number(config.partnerId) },
    );
  }

  async refreshAccessToken(refreshToken: string, shopId: string) {
    const path = "/api/v2/auth/access_token/get";
    const config = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    // Shopee documents refresh as a public API: its signature excludes the access token and shop id.
    const sign = signShopeeRequest({ partnerId: config.partnerId, partnerKey: config.partnerKey, path, timestamp });
    return this.postJson<{ access_token?: string; refresh_token?: string; expire_in?: number; refresh_token_expire_in?: number }>(
      `${shopeeApiOrigin(config.environment)}${path}?${new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), sign })}`,
      { refresh_token: refreshToken, partner_id: Number(config.partnerId), shop_id: Number(shopId) },
    );
  }

  async getOrderList(input: { accessToken: string; shopId: string; from: number; to: number; cursor?: string }) {
    const path = "/api/v2/order/get_order_list";
    const query = this.shopQuery(path, input.accessToken, input.shopId);
    query.set("time_range_field", "update_time");
    query.set("time_from", String(input.from));
    query.set("time_to", String(input.to));
    query.set("page_size", "100");
    if (input.cursor) query.set("cursor", input.cursor);
    return this.getJson<{ order_list?: Array<{ order_sn?: string; order_status?: string }>; more?: boolean; next_cursor?: string }>(`${this.apiUrl(path)}?${query}`);
  }

  async getOrderDetails(input: { accessToken: string; shopId: string; orderSnList: string[] }) {
    if (!input.orderSnList.length || input.orderSnList.length > 50) throw new Error("SHOPEE_ORDER_DETAIL_BATCH_INVALID");
    const path = "/api/v2/order/get_order_detail";
    const query = this.shopQuery(path, input.accessToken, input.shopId);
    query.set("order_sn_list", input.orderSnList.join(","));
    query.set("response_optional_fields", "item_list,total_amount,estimated_shipping_fee,actual_shipping_fee,recipient_address,pay_time,payment_method,shipping_carrier,cod,message_to_seller");
    return this.getJson<{ order_list?: ShopeeOrderDetail[] }>(`${this.apiUrl(path)}?${query}`);
  }

  private shopQuery(path: string, accessToken: string, shopId: string) {
    const config = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShopeeRequest({ partnerId: config.partnerId, partnerKey: config.partnerKey, path, timestamp, accessToken, shopId });
    return new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), access_token: accessToken, shop_id: shopId, sign });
  }

  private apiUrl(path: string) {
    const config = this.requireCredentials();
    return `${shopeeApiOrigin(config.environment)}${path}`;
  }

  private requireCredentials() {
    const config = shopeeConfig();
    if (!config.partnerId || !config.partnerKey) throw new ServiceUnavailableException("Shopee Partner ID/Key chưa được cấu hình phía backend.");
    return config;
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new ShopeeApiError("SHOPEE_NETWORK_ERROR", true); }
    return this.parseResponse<T>(response);
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new ShopeeApiError("SHOPEE_NETWORK_ERROR", true); }
    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => null) as ShopeeResponse<T> | null;
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new ShopeeApiError(response.status === 429 ? "SHOPEE_RATE_LIMITED" : `SHOPEE_HTTP_${response.status}`, response.status === 429 || response.status >= 500, response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!body || typeof body !== "object") throw new ShopeeApiError("SHOPEE_RESPONSE_INVALID", true);
    if (typeof body.error === "string" && body.error) {
      const error = body.error.toLowerCase();
      const invalidAuth = /token|auth|permission|shop_no_linked|shop_access_expired/.test(error);
      throw new ShopeeApiError(invalidAuth ? "SHOPEE_REAUTH_REQUIRED" : "SHOPEE_API_ERROR", !invalidAuth);
    }
    if (body.response && typeof body.response === "object") return body.response;
    return body as T;
  }
}

export type ShopeeOrderDetail = {
  order_sn: string;
  order_status: string;
  currency?: string;
  total_amount?: number;
  estimated_shipping_fee?: number;
  actual_shipping_fee?: number;
  cod?: boolean;
  payment_method?: string;
  shipping_carrier?: string;
  create_time?: number;
  update_time?: number;
  pay_time?: number;
  recipient_address?: Record<string, unknown>;
  message_to_seller?: string;
  item_list?: Array<{ item_id?: number | string; model_id?: number | string; item_name?: string; item_sku?: string; model_sku?: string; model_name?: string; model_quantity_purchased?: number; item_price?: number; variation_discounted_price?: number }>;
};
