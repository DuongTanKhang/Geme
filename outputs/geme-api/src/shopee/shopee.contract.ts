import { createHmac, randomBytes, createHash } from "node:crypto";

export type ShopeeEnvironment = "production" | "sandbox";

export function shopeeEnvironment(value: string | undefined): ShopeeEnvironment {
  return value?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
}

export function shopeeApiOrigin(environment: ShopeeEnvironment) {
  return environment === "sandbox"
    ? "https://partner.test-stable.shopeemobile.com"
    : "https://partner.shopeemobile.com";
}

export function shopeeAuthorizationOrigin(environment: ShopeeEnvironment) {
  return environment === "sandbox"
    ? "https://open.test-stable.shopee.com"
    : "https://open.shopee.com";
}

export function signShopeeRequest(input: {
  partnerId: string;
  partnerKey: string;
  path: string;
  timestamp: number;
  accessToken?: string;
  shopId?: string;
}) {
  const baseString = `${input.partnerId}${input.path}${input.timestamp}${input.accessToken ?? ""}${input.shopId ?? ""}`;
  return createHmac("sha256", input.partnerKey).update(baseString, "utf8").digest("hex");
}

export function createShopeeState() {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: createHash("sha256").update(value).digest("hex") };
}

export function unixSecondsDate(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 4_102_444_800) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseShopeeAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function orderStatusCanAdvance(currentUpdatedAt: Date, incomingUpdatedAt: Date) {
  return incomingUpdatedAt.getTime() >= currentUpdatedAt.getTime();
}
