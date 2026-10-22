import { createHmac, randomBytes, createHash } from "node:crypto";

export type ShopeeEnvironment = "production" | "sandbox";

export function shopeeEnvironment(value: string | undefined): ShopeeEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "sandbox" || normalized === "production") return normalized;
  return null;
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

export function shopeeTokenExpiry(value: unknown, now = Date.now()): Date | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 31_536_000 || !Number.isFinite(now)) return null;
  return new Date(now + seconds * 1000);
}

type ContractResult<T> = { ok: true; value: T } | { ok: false; code: string };

export function validateShopeeOrderListPage(value: unknown): ContractResult<{ orderSns: string[]; more: boolean; cursor: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "SHOPEE_ORDER_LIST_INVALID" };
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.order_list) || typeof page.more !== "boolean") return { ok: false, code: "SHOPEE_ORDER_LIST_INVALID" };
  const orderSns: string[] = [];
  for (const item of page.order_list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, code: "SHOPEE_ORDER_ID_MISSING" };
    const orderSn = (item as Record<string, unknown>).order_sn;
    if (typeof orderSn !== "string" || !orderSn.trim()) return { ok: false, code: "SHOPEE_ORDER_ID_MISSING" };
    orderSns.push(orderSn.trim());
  }
  const cursor = typeof page.next_cursor === "string" ? page.next_cursor.trim() : "";
  if (page.more && !cursor) return { ok: false, code: "SHOPEE_CURSOR_MISSING" };
  return { ok: true, value: { orderSns, more: page.more, cursor } };
}

export function validateShopeeCursor(more: boolean, cursor: string, current: string | undefined, seen: Set<string>): boolean {
  return !more || Boolean(cursor && cursor !== current && !seen.has(cursor));
}

export function validateShopeeOrderDetails(value: unknown, requestedOrderSns: string[]): ContractResult<Array<Record<string, unknown>>> {
  if (!Array.isArray(value)) return { ok: false, code: "SHOPEE_ORDER_DETAIL_LIST_INVALID" };
  const requested = new Set(requestedOrderSns);
  const received = new Set<string>();
  const details: Array<Record<string, unknown>> = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false, code: "SHOPEE_ORDER_DETAIL_SET_INVALID" };
    const detail = candidate as Record<string, unknown>;
    const orderSn = detail.order_sn;
    if (typeof orderSn !== "string" || !requested.has(orderSn) || received.has(orderSn)) return { ok: false, code: "SHOPEE_ORDER_DETAIL_SET_INVALID" };
    if (typeof detail.order_status !== "string" || !detail.order_status.trim() || !unixSecondsDate(detail.create_time) || !unixSecondsDate(detail.update_time) || !Array.isArray(detail.item_list) || detail.item_list.length === 0) {
      return { ok: false, code: "SHOPEE_ORDER_DETAIL_INCOMPLETE" };
    }
    received.add(orderSn);
    details.push(detail);
  }
  if (received.size !== requested.size) return { ok: false, code: "SHOPEE_ORDER_DETAIL_MISSING" };
  return { ok: true, value: details };
}

export function parseShopeeAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) <= 999_999_999_999.99 ? amount : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export function orderStatusCanAdvance(currentUpdatedAt: Date, incomingUpdatedAt: Date) {
  return incomingUpdatedAt.getTime() >= currentUpdatedAt.getTime();
}
