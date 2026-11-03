import { ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const CALLBACK_PATH = "/api/v1/integrations/gmail/callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminReturnUrl: string;
  missing: string[];
  invalid: string[];
  configured: boolean;
};

export class GmailProviderError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryable: boolean) {
    super(code);
    this.name = "GmailProviderError";
  }
}

export type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
};

function validHttpsOrLocalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch { return false; }
}

export function gmailConfig(): GmailConfig {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI?.trim() || "";
  const adminReturnUrl = process.env.GMAIL_OAUTH_ADMIN_RETURN_URL?.trim() || "";
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!clientId) missing.push("GMAIL_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GMAIL_OAUTH_CLIENT_SECRET");
  if (!redirectUri) missing.push("GMAIL_OAUTH_REDIRECT_URI");
  else {
    if (!validHttpsOrLocalUrl(redirectUri)) invalid.push("GMAIL_OAUTH_REDIRECT_URI");
    try {
      const callback = new URL(redirectUri);
      if (callback.pathname !== CALLBACK_PATH || callback.search) invalid.push("GMAIL_OAUTH_REDIRECT_URI");
    } catch { invalid.push("GMAIL_OAUTH_REDIRECT_URI"); }
  }
  if (!adminReturnUrl) missing.push("GMAIL_OAUTH_ADMIN_RETURN_URL");
  else if (!validHttpsOrLocalUrl(adminReturnUrl)) invalid.push("GMAIL_OAUTH_ADMIN_RETURN_URL");
  if (!gmailEncryptionKeyConfigured()) {
    if (!process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY?.trim()) missing.push("GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY");
    else invalid.push("GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY");
  }
  return { clientId, clientSecret, redirectUri, adminReturnUrl, missing: [...new Set(missing)], invalid: [...new Set(invalid)], configured: missing.length === 0 && invalid.length === 0 };
}

function encryptionKey() {
  const raw = process.env.GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY?.trim() || "";
  const key = Buffer.from(raw, "base64");
  if (!raw || key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new ServiceUnavailableException("GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY chưa hợp lệ (cần khóa base64 32 byte). ");
  }
  return key;
}

export function gmailEncryptionKeyConfigured() {
  try { encryptionKey(); return true; } catch { return false; }
}

export function encryptGmailToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptGmailToken(value: string) {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new ServiceUnavailableException("Refresh token Gmail lưu trong database không hợp lệ.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException("Không giải mã được refresh token Gmail. Hãy giữ nguyên khóa mã hóa đã dùng khi kết nối.");
  }
}

export function gmailAuthorizationUrl(config: GmailConfig, state: string, codeChallenge: string) {
  if (!config.configured) throw new ServiceUnavailableException(`Cấu hình Gmail chưa đủ: ${[...config.missing, ...config.invalid].join(", ")}.`);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_MODIFY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function readProviderResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function providerCode(body: Record<string, unknown>) {
  const error = body.error;
  const detail = error && typeof error === "object" ? (error as Record<string, unknown>).status || (error as Record<string, unknown>).code : error;
  const candidate = typeof detail === "string" || typeof detail === "number" ? String(detail) : "GMAIL_PROVIDER_ERROR";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(candidate) ? candidate.toUpperCase() : "GMAIL_PROVIDER_ERROR";
}

export class GmailClient {
  async exchangeAuthorizationCode(code: string, codeVerifier: string, config = gmailConfig()): Promise<GoogleTokenResponse> {
    return this.tokenRequest(new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }));
  }

  async refreshAccessToken(refreshToken: string, config = gmailConfig()): Promise<GoogleTokenResponse> {
    return this.tokenRequest(new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }));
  }

  async getProfile(accessToken: string) {
    return this.apiRequest<{ emailAddress?: string; messagesTotal?: number; threadsTotal?: number; historyId?: string }>(accessToken, "/profile");
  }

  async apiRequest<T = Record<string, unknown>>(accessToken: string, path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`${GMAIL_API_ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new GmailProviderError("GMAIL_API_UNAVAILABLE", 503, true); });
    if (!response.ok) {
      const payload = await readProviderResponse(response);
      throw new GmailProviderError(providerCode(payload), response.status, response.status === 429 || response.status >= 500);
    }
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  }

  private async tokenRequest(form: URLSearchParams) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new GmailProviderError("GOOGLE_OAUTH_UNAVAILABLE", 503, true); });
    const payload = await readProviderResponse(response) as GoogleTokenResponse & Record<string, unknown>;
    if (!response.ok) throw new GmailProviderError(providerCode(payload), response.status, response.status === 429 || response.status >= 500);
    return payload;
  }
}

export function gmailCallbackReturnUrl(outcome: "connected" | "error" | "denied", config = gmailConfig()) {
  if (!config.adminReturnUrl || !validHttpsOrLocalUrl(config.adminReturnUrl)) return null;
  const target = new URL(config.adminReturnUrl);
  target.searchParams.set("gmail", outcome);
  return target.toString();
}
