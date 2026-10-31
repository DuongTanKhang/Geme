import assert from "node:assert/strict";
import test from "node:test";
import { MaterialsService } from "./materials.service.js";

test("materials list reports only active product categories for each jewelry stone", async () => {
  const options = [
    { id: "topaz", name: "Topaz", slug: "topaz", scope: "JEWELRY", kind: "STONE", active: true, sortOrder: 1, _count: { products: 2 } },
    { id: "opal", name: "Opal", slug: "opal", scope: "JEWELRY", kind: "STONE", active: true, sortOrder: 2, _count: { products: 1 } },
    { id: "silver", name: "Bạc", slug: "bac", scope: "JEWELRY", kind: "MATERIAL", active: true, sortOrder: 3, _count: { products: 0 } },
  ];
  let productQuery: Record<string, unknown> | undefined;
  const prisma = {
    materialOption: { findMany: async () => options },
    siteSetting: { findUnique: async () => ({ value: { topaz: ["necklace-category", "ring-category"] } }) },
    product: {
      findMany: async (query: Record<string, unknown>) => {
        productQuery = query;
        return [
          { materialOptionId: "topaz", categoryId: "necklace-category" },
          { materialOptionId: "topaz", categoryId: "ring-category" },
          { materialOptionId: "opal", categoryId: "ring-category" },
        ];
      },
    },
  };

  const records = await new MaterialsService(prisma as never).list();

  assert.deepEqual(records.find((item) => item.id === "topaz")?.availableCategoryIds, ["necklace-category", "ring-category"]);
  assert.deepEqual(records.find((item) => item.id === "opal")?.availableCategoryIds, ["ring-category"]);
  assert.deepEqual(records.find((item) => item.id === "silver")?.availableCategoryIds, undefined);
  assert.deepEqual(records.find((item) => item.id === "topaz")?.appliedCategoryIds, ["necklace-category", "ring-category"]);
  assert.deepEqual(productQuery?.where, {
    kind: "JEWELRY",
    status: "ACTIVE",
    materialOptionId: { in: ["topaz", "opal"] },
    categoryId: { not: null },
    category: { is: { kind: "JEWELRY", usage: "PRODUCT_CATEGORY", status: "ACTIVE" } },
  });
});
