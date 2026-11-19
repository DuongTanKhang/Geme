import assert from "node:assert/strict";
import test from "node:test";
import { findInventoryStockIssues, physicalSphereInventoryMatches, sumSphereWeights } from "./stock-reconciliation.js";

const weighted = {
  id: "p1", kind: "OTHER", sku: "CAU-TAT4", name: "Quả cầu Thạch Anh Trắng 4A", stock: 2, stockKg: 5.79,
  category: { name: "Quả cầu" }, sphereQuality: "4A", sphereStoneType: { name: "Thạch Anh Trắng", group: { name: "Thạch Anh" } },
  sphereItems: [{ weightKg: 2.84 }, { weightKg: 2.95 }],
};

test("consistent physical item count and decimal kilograms report clean", () => {
  assert.deepEqual(findInventoryStockIssues([weighted]), []);
  assert.equal(physicalSphereInventoryMatches(weighted), true);
  assert.equal(sumSphereWeights([{ weightKg: 2.84 }, { weightKg: 2.95 }]), 5.79);
});

test("inconsistent count and kg identify product and expected totals", () => {
  const [issue] = findInventoryStockIssues([{ ...weighted, stock: 3, stockKg: 5.8 }]);
  assert.equal(issue.sku, "CAU-TAT4");
  assert.equal(issue.expectedCount, 2);
  assert.equal(issue.expectedKg, 5.79);
  assert.equal(issue.problems.length, 2);
});

test("product and variant aggregates are checked", () => {
  const [issue] = findInventoryStockIssues([{ ...weighted, sphereItems: [], stock: 3, stockKg: 6, variants: [{ stock: 2, stockKg: 5.5 }] }]);
  assert.deepEqual(issue.problems, ["Tồn tổng không bằng tổng tồn biến thể.", "Tổng kg không bằng tổng kg biến thể."]);
});
