import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("production commerce migrations expose safe settlement columns", { skip: !enabled }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const columns = await client.query(`
      SELECT table_name, column_name, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN ('cod_reconciliation_batches', 'cod_reconciliation_items', 'payment_refunds', 'payments', 'contact_inquiries', 'audit_logs')
    `);
    const byKey = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
    assert.ok((byKey.get("cod_reconciliation_batches.status")?.character_maximum_length || 0) >= 32);
    assert.ok(byKey.has("cod_reconciliation_batches.remitted_total"));
    assert.ok(byKey.has("cod_reconciliation_items.remitted_amount"));
    assert.ok(byKey.has("cod_reconciliation_items.remittance_variance"));
    assert.equal(byKey.get("payment_refunds.return_id")?.is_nullable, "YES");
    assert.ok(byKey.has("payment_refunds.external_reference"));
    assert.ok(byKey.has("payment_refunds.request_key"));
    assert.ok(byKey.has("payment_refunds.request_hash"));
    assert.ok(byKey.has("payments.idempotency_key"));
    assert.ok(byKey.has("contact_inquiries.idempotency_key"));
    assert.ok(byKey.has("audit_logs.correlation_id"));
  } finally {
    await client.end();
  }
});

test("PostgreSQL idempotency uniqueness prevents concurrent duplicate contact inserts", { skip: !enabled }, async () => {
  const connectionString = process.env.DATABASE_URL!;
  const key = `ci-${randomUUID()}`;
  const a = new Client({ connectionString });
  const b = new Client({ connectionString });
  await Promise.all([a.connect(), b.connect()]);
  const insert = (client: Client) => client.query(`
    INSERT INTO contact_inquiries (id, idempotency_key, request_hash, name, email, phone, subject, message)
    VALUES ($1::uuid, $2, $3, 'Integration Test', 'integration@example.invalid', '0912345678', 'Khác', 'Integration test message body')
  `, [randomUUID(), key, "0".repeat(64)]);
  try {
    const outcomes = await Promise.allSettled([insert(a), insert(b)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    assert.equal((rejected.reason as { code?: string })?.code, "23505");
  } finally {
    await a.query("DELETE FROM contact_inquiries WHERE idempotency_key = $1", [key]);
    await Promise.all([a.end(), b.end()]);
  }
});
