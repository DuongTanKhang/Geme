import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { CommerceService } from "./commerce.service.js";

function serviceWithRows(rows: Array<Record<string, unknown>>) {
  let sql = "";
  const prisma = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      sql = Array.from(parts).join("?");
      return rows;
    },
  };
  return { service: Object.assign(Object.create(CommerceService.prototype), { prisma }) as CommerceService, readSql: () => sql };
}

test("gross profit report maps period rows and reports lines without a known purchase cost", async () => {
  const { service, readSql } = serviceWithRows([
    { bucket: "2026-10-01", revenue: "1200000", cost: "400000", profit: "800000", soldQuantity: 2, missingCostLines: 1, missingCostRevenue: "300000", returnedQuantity: 0 },
    { bucket: "2026-10-02", revenue: "-100000", cost: "0", profit: "-100000", soldQuantity: 0, missingCostLines: 0, missingCostRevenue: "0", returnedQuantity: 1 },
  ]);
  const report = await service.grossProfitReport({ grain: "day", from: "2026-10-01T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" });
  assert.equal(report.grain, "day");
  assert.equal(report.revenue, 1_100_000);
  assert.equal(report.cost, 400_000);
  assert.equal(report.profit, 700_000);
  assert.equal(report.soldQuantity, 2);
  assert.equal(report.missingCostLines, 1);
  assert.equal(report.missingCostRevenue, 300_000);
  assert.equal(report.returnedQuantity, 1);
  assert.match(readSql(), /Asia\/Ho_Chi_Minh/);
  assert.match(readSql(), /inventory_receipt_items/);
  assert.match(readSql(), /status::text IN \('PROCESSING','SHIPPING','DELIVERED'\)/);
});

test("gross profit report rejects unsupported periods before querying", async () => {
  const { service } = serviceWithRows([]);
  await assert.rejects(service.grossProfitReport({ grain: "year" }), BadRequestException);
  await assert.rejects(service.grossProfitReport({ grain: "month", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" }), BadRequestException);
});
