import assert from "node:assert/strict";
import test from "node:test";
import { buildSePayReconciliationUrl, mapSePayApiTransaction } from "./sepay.service.js";

test("SePay reconciliation keeps a fixed cursor while advancing API pagination", () => {
  const endpoint = new URL("https://userapi.sepay.vn/v2/transactions");
  const firstPage = buildSePayReconciliationUrl(endpoint, "bank-account-id", {
    sinceId: "last-committed-id",
    from: null,
    page: 1,
  });
  const secondPage = buildSePayReconciliationUrl(endpoint, "bank-account-id", {
    sinceId: "last-committed-id",
    from: null,
    page: 2,
  });

  assert.equal(firstPage.searchParams.get("since_id"), "last-committed-id");
  assert.equal(secondPage.searchParams.get("since_id"), "last-committed-id");
  assert.equal(firstPage.searchParams.get("page"), "1");
  assert.equal(secondPage.searchParams.get("page"), "2");
  assert.equal(secondPage.searchParams.get("per_page"), "100");
  assert.equal(secondPage.searchParams.get("transaction_date_sort"), "asc");
});

test("first SePay reconciliation scan uses its fixed date window and paginates", () => {
  const endpoint = new URL("https://userapi.sepay.vn/v2/transactions");
  const secondPage = buildSePayReconciliationUrl(endpoint, "bank-account-id", {
    sinceId: null,
    from: "2026-10-26 10:00:00",
    page: 2,
  });

  assert.equal(secondPage.searchParams.get("since_id"), null);
  assert.equal(secondPage.searchParams.get("transaction_date_from"), "2026-10-26 10:00:00");
  assert.equal(secondPage.searchParams.get("page"), "2");
});

test("SePay API transaction mapping keeps the bank reference, incoming amount, and Vietnam timestamp", () => {
  const transaction = mapSePayApiTransaction({
    id: "e9f2e7e2-1d62-4a62-9c10-988a7e3bf302",
    transaction_date: "2026-11-02T10:11:12+07:00",
    account_number: "0854048744",
    va: null,
    transfer_type: "in",
    amount_in: 2_000,
    amount_out: 0,
    transaction_content: "GEME GME123456",
    reference_number: "FT2630201",
    code: "GEMEGME123456",
    bank_brand_name: "MB",
  });

  assert.ok(transaction);
  assert.equal(transaction.transactionId, "e9f2e7e2-1d62-4a62-9c10-988a7e3bf302");
  assert.equal(transaction.transferType, "in");
  assert.equal(Number(transaction.amount), 2_000);
  assert.equal(transaction.accountNumber, "0854048744");
  assert.equal(transaction.paymentCode, "GEMEGME123456");
  assert.equal(transaction.referenceCode, "FT2630201");
  assert.equal(transaction.transactionDate?.toISOString(), "2026-11-02T03:11:12.000Z");
});

test("SePay API transaction mapping uses local timestamps as Vietnam time and rejects invalid money", () => {
  const transaction = mapSePayApiTransaction({
    id: "a40e0061-e91e-4c67-a270-5211320acc42",
    transaction_date: "2026-11-02 10:11:12",
    transfer_type: "in",
    amount_in: "690000",
  });

  assert.ok(transaction);
  assert.equal(transaction.transactionDate?.toISOString(), "2026-11-02T03:11:12.000Z");
  assert.equal(Number(transaction.amount), 690_000);
  assert.equal(mapSePayApiTransaction({ id: "bad", transfer_type: "in", amount_in: "690000.50" }), null);
  assert.equal(mapSePayApiTransaction({ id: "bad", transfer_type: "in", amount_in: Number.MAX_SAFE_INTEGER + 1 }), null);
});
