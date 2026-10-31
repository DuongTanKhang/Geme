import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionOrder, isOrderStateTerminal } from "./order-state.js";

test("order state machine permits forward progress, cancellation before dispatch, and idempotent repeats", () => {
  assert.equal(canTransitionOrder("PENDING_PAYMENT", "PENDING_CONFIRMATION"), true);
  assert.equal(canTransitionOrder("PENDING_PAYMENT", "CANCELLED"), true);
  assert.equal(canTransitionOrder("PENDING_CONFIRMATION", "PROCESSING"), true);
  assert.equal(canTransitionOrder("PROCESSING", "SHIPPING"), true);
  assert.equal(canTransitionOrder("SHIPPING", "DELIVERED"), true);
  assert.equal(canTransitionOrder("PROCESSING", "DELIVERED", "CARRIER"), true);
  assert.equal(canTransitionOrder("PENDING_CONFIRMATION", "CANCELLED"), true);
  assert.equal(canTransitionOrder("PROCESSING", "PROCESSING"), true);
});

test("order state machine rejects regressions, reopening cancelled orders, and direct cancellation after delivery", () => {
  assert.equal(canTransitionOrder("PENDING_CONFIRMATION", "PENDING_PAYMENT"), false);
  assert.equal(canTransitionOrder("SHIPPING", "PROCESSING"), false);
  assert.equal(canTransitionOrder("SHIPPING", "CANCELLED"), false);
  assert.equal(canTransitionOrder("DELIVERED", "CANCELLED"), false);
  assert.equal(canTransitionOrder("CANCELLED", "PROCESSING"), false);
  assert.equal(canTransitionOrder("PENDING_CONFIRMATION", "DELIVERED", "CARRIER"), false);
  assert.equal(isOrderStateTerminal("DELIVERED"), true);
  assert.equal(isOrderStateTerminal("CANCELLED"), true);
});
