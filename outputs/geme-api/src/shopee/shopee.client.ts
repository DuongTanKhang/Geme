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
  enabled: boolean;
  configurationStatus: "ready" | "missing_configuration" | "invalid_configuration";
  missing: string[];
  invalid: string[];
  configured: boolean;
  partnerId: string;
  partnerKey: string;
  environment: ShopeeEnvironment;
  redirectUri: string;
  adminReturnUrl: string;
  initialSyncDays: number;
  pollIntervalMinutes: number;
  workerConcurrency: number;
};

export class ShopeeApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    readonly kind: "access_token_expired" | "reauthorization_required" | "application_configuration" | "other" = "other",
  ) {
    super(code);
    this.name = "ShopeeApiError";
  }
}

export function shopeeConfig(): ShopeeConfig {
  const enabledInput = process.env.SHOPEE_ENABLED?.trim().toLowerCase() || "false";
  const enabled = enabledInput === "true";
  const invalid: string[] = [];
  const missing: string[] = [];
  if (enabledInput !== "true" && enabledInput !== "false") invalid.push("SHOPEE_ENABLED");

  const environmentInput = process.env.SHOPEE_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
  const parsedEnvironment = shopeeEnvironment(environmentInput);
  if (!parsedEnvironment) invalid.push("SHOPEE_ENVIRONMENT");
  const environment: ShopeeEnvironment = parsedEnvironment || "sandbox";
  const partnerId = process.env.SHOPEE_PARTNER_ID?.trim() || "";
  const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim() || "";
  const redirectUri = process.env.SHOPEE_REDIRECT_URI?.trim() || "";
  const adminReturnUrl = process.env.SHOPEE_ADMIN_RETURN_URL?.trim() || "";
  const workerConcurrencyInput = process.env.SHOPEE_WORKER_CONCURRENCY?.trim() || "2";
  const initialDaysInput = process.env.SHOPEE_INITIAL_SYNC_DAYS?.trim() || "30";
  const pollInput = process.env.SHOPEE_POLL_INTERVAL_MINUTES?.trim() || "5";
  const initialDays = Number(initialDaysInput);
  const pollIntervalMinutes = Number(pollInput);
  const workerConcurrency = Number(workerConcurrencyInput);
  const production = environment === "production";
  const validCallback = validUrl(redirectUri, production) && safePath(redirectUri, "/api/v1/shopee/callback");
  const validReturn = validUrl(adminReturnUrl, production);

  if (!partnerId) missing.push("SHOPEE_PARTNER_ID");
  else if (!/^\d{1,16}$/.test(partnerId) || !Number.isSafeInteger(Number(partnerId)) || Number(partnerId) <= 0) invalid.push("SHOPEE_PARTNER_ID");
  if (!partnerKey) missing.push("SHOPEE_PARTNER_KEY");
  if (!redirectUri) missing.push("SHOPEE_REDIRECT_URI");
  else if (!validCallback) invalid.push("SHOPEE_REDIRECT_URI");
  if (!adminReturnUrl) missing.push("SHOPEE_ADMIN_RETURN_URL");
  else if (!validReturn) invalid.push("SHOPEE_ADMIN_RETURN_URL");
  if (!encryptionKeyConfigured()) {
    if (!process.env.SHOPEE_TOKEN_ENCRYPTION_KEY?.trim()) missing.push("SHOPEE_TOKEN_ENCRYPTION_KEY");
    else invalid.push("SHOPEE_TOKEN_ENCRYPTION_KEY");
  }
  if (!Number.isInteger(initialDays) || initialDays < 1 || initialDays > 365) invalid.push("SHOPEE_INITIAL_SYNC_DAYS");
  if (!Number.isInteger(pollIntervalMinutes) || pollIntervalMinutes < 5 || pollIntervalMinutes > 60) invalid.push("SHOPEE_POLL_INTERVAL_MINUTES");
  if (!Number.isInteger(workerConcurrency) || workerConcurrency < 1 || workerConcurrency > 8) invalid.push("SHOPEE_WORKER_CONCURRENCY");
  const configurationStatus = invalid.length ? "invalid_configuration" : missing.length ? "missing_configuration" : "ready";
  return {
    enabled,
    configurationStatus,
    missing,
    invalid,
    configured: enabled && configurationStatus === "ready",
    partnerId,
    partnerKey,
    environment,
    redirectUri,
    adminReturnUrl,
    initialSyncDays: Number.isInteger(initialDays) && initialDays >= 1 && initialDays <= 365 ? initialDays : 30,
    pollIntervalMinutes: Number.isInteger(pollIntervalMinutes) && pollIntervalMinutes >= 5 && pollIntervalMinutes <= 60 ? pollIntervalMinutes : 5,
    workerConcurrency: Number.isInteger(workerConcurrency) && workerConcurrency >= 1 && workerConcurrency <= 8 ? workerConcurrency : 2,
  };
}

export function shopeeSafeConfig(config = shopeeConfig()) {
  return {
    enabled: config.enabled,
    configurationStatus: config.configurationStatus,
    missing: config.missing,
    invalid: config.invalid,
    configured: config.configured,
    environment: config.environment,
    redirectUri: config.redirectUri || null,
    partnerConfigured: Boolean(config.partnerId && config.partnerKey),
    encryptionConfigured: encryptionKeyConfigured(),
    initialSyncDays: config.initialSyncDays,
    pollIntervalMinutes: config.pollIntervalMinutes,
    workerConcurrency: config.workerConcurrency,
  };
}

function validUrl(value: string, requireHttps: boolean) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (requireHttps && url.protocol !== "https:") return false;
    if (!requireHttps && url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return false;
    return Boolean(url.hostname);
  } catch { return false; }
}

function safePath(value: string, expectedPath: string) {
  try { const url = new URL(value); return url.pathname === expectedPath && !url.search; } catch { return false; }
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
    this.requireCredentials();
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
    const sign = signShopeeRequest({ partnerId: config.partnerId, partnerKey: config.partnerKey, path, timestamp });
    return this.postJson<{ access_token?: string; refresh_token?: string; expire_in?: number; refresh_token_expire_in?: number; shop_id?: number | string }>(
      `${shopeeApiOrigin(config.environment)}${path}?${new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), sign })}`,
      { code, shop_id: Number(shopId), partner_id: Number(config.partnerId) },
      "exchange",
    );
  }

  async refreshAccessToken(refreshToken: string, shopId: string) {
    const path = "/api/v2/auth/access_token/get";
    const config = this.requireCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    // Keep public-auth signing separate from the shop-scoped signature. Verify this contract in the authenticated app docs before production.
    const sign = signShopeeRequest({ partnerId: config.partnerId, partnerKey: config.partnerKey, path, timestamp });
    return this.postJson<{ access_token?: string; refresh_token?: string; expire_in?: number; refresh_token_expire_in?: number }>(
      `${shopeeApiOrigin(config.environment)}${path}?${new URLSearchParams({ partner_id: config.partnerId, timestamp: String(timestamp), sign })}`,
      { refresh_token: refreshToken, partner_id: Number(config.partnerId), shop_id: Number(shopId) },
      "refresh",
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
    return this.getJson<{ order_list?: Array<{ order_sn?: string; order_status?: string }>; more?: boolean; next_cursor?: string }>(`${this.apiUrl(path)}?${query}`, "shop");
  }

  async getOrderDetails(input: { accessToken: string; shopId: string; orderSnList: string[] }) {
    if (!input.orderSnList.length || input.orderSnList.length > 50) throw new Error("SHOPEE_ORDER_DETAIL_BATCH_INVALID");
    const path = "/api/v2/order/get_order_detail";
    const query = this.shopQuery(path, input.accessToken, input.shopId);
    query.set("order_sn_list", input.orderSnList.join(","));
    query.set("response_optional_fields", "item_list,total_amount,estimated_shipping_fee,actual_shipping_fee,recipient_address,pay_time,payment_method,shipping_carrier,cod,message_to_seller");
    return this.getJson<{ order_list?: ShopeeOrderDetail[] }>(`${this.apiUrl(path)}?${query}`, "shop");
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
    if (!config.enabled) throw new ServiceUnavailableException("Tích hợp Shopee đang tắt. Đặt SHOPEE_ENABLED=true để bật.");
    if (config.configurationStatus !== "ready") throw new ServiceUnavailableException(`Cấu hình Shopee chưa hợp lệ: ${[...config.missing, ...config.invalid].join(", ") || "không xác định"}.`);
    return config;
  }

  private async getJson<T>(url: string, context: "shop" | "exchange" | "refresh"): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new ShopeeApiError("SHOPEE_NETWORK_ERROR", true); }
    return this.parseResponse<T>(response, context);
  }

  private async postJson<T>(url: string, body: unknown, context: "shop" | "exchange" | "refresh" = "shop"): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new ShopeeApiError("SHOPEE_NETWORK_ERROR", true); }
    return this.parseResponse<T>(response, context);
  }

  private async parseResponse<T>(response: Response, context: "shop" | "exchange" | "refresh"): Promise<T> {
    const body = await response.json().catch(() => null) as ShopeeResponse<T> | null;
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = retryAfterHeader
      ? /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : Number.isNaN(Date.parse(retryAfterHeader)) ? undefined : Math.max(0, Math.ceil((Date.parse(retryAfterHeader) - Date.now()) / 1000))
      : undefined;
    const providerError = body && typeof body.error === "string" ? body.error.trim().toLowerCase() : "";
    if (providerError) {
      // Exact, path-aware codes only. Unknown Shopee errors remain generic and
      // cannot revoke a stored connection. Confirm this allowlist in the
      // authenticated app documentation before enabling production.
      if (context === "shop" && providerError === "error_access_token_expired") {
        throw new ShopeeApiError("SHOPEE_ACCESS_TOKEN_EXPIRED", true, response.status, retryAfter, "access_token_expired");
      }
      if (context === "refresh" && providerError === "error_access_token_expired") {
        throw new ShopeeApiError("SHOPEE_REFRESH_TOKEN_REJECTED", false, response.status, retryAfter, "reauthorization_required");
      }
      if (context === "shop" && ["error_shop_no_linked", "error_shop_access_expired", "error_access_denied"].includes(providerError)) {
        throw new ShopeeApiError("SHOPEE_REAUTH_REQUIRED", false, response.status, retryAfter, "reauthorization_required");
      }
      if (["error_sign", "error_partner_id_not_match", "error_shop_id_not_match"].includes(providerError)) {
        throw new ShopeeApiError("SHOPEE_APPLICATION_CONFIGURATION_MISMATCH", false, response.status, retryAfter, "application_configuration");
      }
    }
    if (!response.ok) {
      throw new ShopeeApiError(response.status === 429 ? "SHOPEE_RATE_LIMITED" : `SHOPEE_HTTP_${response.status}`, response.status === 429 || response.status >= 500, response.status, retryAfter);
    }
    if (!body || typeof body !== "object") throw new ShopeeApiError("SHOPEE_RESPONSE_INVALID", true);
    if (providerError) throw new ShopeeApiError("SHOPEE_API_ERROR", true, response.status, retryAfter);
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
  item_list?: Array<{ item_id?: number | string; model_id?: number | string; item_name?: string; item_sku?: string; model_sku?: string; model_name?: string; model_quantity_purchased?: number; model_original_price?: number | string; model_discounted_price?: number | string }>;
};
