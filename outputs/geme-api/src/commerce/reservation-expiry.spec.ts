import assert from "node:assert/strict";
import test from "node:test";
import { getInventoryReservationExpiry } from "./reservation-expiry.js";

test("paid and COD orders keep their inventory hold until fulfillment or cancellation", () => {
  const now = new Date("2026-10-23T00:00:00.000Z");
  assert.equal(getInventoryReservationExpiry("COD", false, now, "30"), null);
  assert.equal(getInventoryReservationExpiry("BANK_TRANSFER", true, now, "30"), null);
});

test("unpaid non-COD orders receive the configured bounded TTL", () => {
  const now = new Date("2026-10-23T00:00:00.000Z");
  assert.equal(getInventoryReservationExpiry("BANK_TRANSFER", false, now, "45")?.toISOString(), "2026-10-23T00:45:00.000Z");
  assert.equal(getInventoryReservationExpiry("MOMO", false, now, "2")?.toISOString(), "2026-10-23T00:30:00.000Z");
});
