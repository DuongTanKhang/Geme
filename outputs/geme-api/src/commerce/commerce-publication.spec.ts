import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CommerceController } from "./commerce.controller.js";
import { CommerceService } from "./commerce.service.js";

function publicationFixture(overrides: Record<string, unknown> = {}) {
  const product = {
    id: "product-1",
    sku: "NSBAMQ01",
    name: "Kiềng Aquamarine",
    kind: "JEWELRY",
    status: "ACTIVE",
    isNew: false,
    category: { slug: "vong-kieng" },
    price: 2_000_000,
    stock: 5,
    images: [{ id: "image-1", url: "https://cdn.example.test/product.webp" }],
    variants: [{
      id: "variant-1",
      sku: "NSBAMQ01R02S54",
      shape: "ROUND",
      quality: "2A",
      beadSize: "54",
      price: 2_000_000,
      stock: 5,
      imageUrls: [],
      videoUrl: null,
      orderItems: [{ id: "order-item-1" }],
    }],
    ...overrides,
  };
  const updatePayloads: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  const tx = {
    product: {
      findUnique: async () => structuredClone(product),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updatePayloads.push(data);
        Object.assign(product, data);
        return product;
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditRows.push(data); return data; } },
  };
  const prisma = {
    $transaction: async (work: (value: typeof tx) => unknown) => work(tx),
    product: { findUnique: async () => product },
  };
  return { product, updatePayloads, auditRows, service: new CommerceService(prisma as any, { isSyncEnabled: () => false } as any, {} as any) };
}

test("hiding a legacy bangle changes only publication status and keeps its catalog and order data", async () => {
  const fixture = publicationFixture({
    status: "ACTIVE",
    variants: [{ id: "legacy-variant", sku: "LEGACY-R", shape: null, quality: "2A", beadSize: null, price: 0, stock: 0, imageUrls: [], videoUrl: null, orderItems: [{ id: "linked-order-item" }] }],
  });
  const before = structuredClone(fixture.product);

  const saved = await fixture.service.updateProductPublication("product-1", "HIDDEN", { id: "admin-1" }, "Ẩn dữ liệu cũ");

  assert.equal(saved.status, "HIDDEN");
  assert.deepEqual(fixture.updatePayloads, [{ status: "HIDDEN" }]);
  assert.equal(fixture.product.sku, before.sku);
  assert.deepEqual(fixture.product.images, before.images);
  assert.deepEqual(fixture.product.variants, before.variants);
  assert.deepEqual(fixture.auditRows[0].before, { status: "ACTIVE" });
});

test("publishing a complete bangle succeeds, while invalid legacy variants report SKU and missing fields", async () => {
  const complete = publicationFixture({ status: "HIDDEN" });
  assert.equal((await complete.service.updateProductPublication("product-1", "ACTIVE", { id: "admin-1" }, "Đủ hồ sơ để đăng bán")).status, "ACTIVE");

  const incomplete = publicationFixture({
    status: "HIDDEN",
    variants: [{ id: "legacy-variant", sku: "NSBAMQ01OLD", shape: null, quality: "Standard", beadSize: null, price: 2_000_000, stock: 5 }],
  });
  await assert.rejects(
    () => incomplete.service.updateProductPublication("product-1", "ACTIVE", { id: "admin-1" }, "Kiểm tra dữ liệu cũ"),
    (error: unknown) => error instanceof BadRequestException && /NSBAMQ01OLD/.test(error.message) && /dáng/.test(error.message) && /chất lượng/.test(error.message) && /size/.test(error.message),
  );
  assert.deepEqual(incomplete.updatePayloads, []);

  const missingPrice = publicationFixture({ status: "HIDDEN", variants: [{ id: "variant-no-price", sku: "NSBAMQ01R02S54", shape: "ROUND", quality: "2A", beadSize: "54", price: 0, stock: 5 }] });
  await assert.rejects(
    () => missingPrice.service.updateProductPublication("product-1", "ACTIVE", { id: "admin-1" }, "Kiểm tra giá bán"),
    (error: unknown) => error instanceof BadRequestException && /NSBAMQ01R02S54/.test(error.message) && /giá bán/.test(error.message),
  );
  assert.deepEqual(missingPrice.updatePayloads, []);
});

test("publishing still supports gemstone products and rejects invalid state values", async () => {
  const gemstone = publicationFixture({ id: "gem-1", sku: "GEM01", kind: "GEMSTONE", category: { slug: "aquamarine" }, status: "HIDDEN", price: 500_000, stock: 1, variants: [] });
  assert.equal((await gemstone.service.updateProductPublication("gem-1", "ACTIVE", { id: "admin-1" }, "Đá quý hợp lệ")).status, "ACTIVE");
  await assert.rejects(() => gemstone.service.updateProductPublication("gem-1", "DRAFT", { id: "admin-1" }, "Trạng thái sai"), BadRequestException);
  await assert.rejects(() => gemstone.service.updateProductPublication("gem-1", "HIDDEN", { id: "admin-1" }, "no"), BadRequestException);
});

function productEditFixture(status: "ACTIVE" | "HIDDEN") {
  const product: Record<string, any> = {
    id: "product-edit-1", sku: "NSBR01", name: "Nhẫn trước khi sửa", slug: "nhan-truoc-khi-sua",
    kind: "JEWELRY", categoryId: "category-1", status, price: 1_000_000, stock: 2,
    category: { pricingMode: "FIXED" }, variants: [], images: [],
  };
  const updatePayloads: Record<string, any>[] = [];
  const txProduct = {
    findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.status && select?.stock && select?.variants) return { status: product.status, stock: product.stock, variants: [] };
      return { sku: product.sku, name: product.name, kind: product.kind, categoryId: product.categoryId, price: product.price, category: product.category, variants: [] };
    },
    update: async ({ data }: { data: Record<string, any> }) => {
      updatePayloads.push(data);
      Object.assign(product, data);
      return product;
    },
    findUniqueOrThrow: async () => product,
  };
  const tx = { product: txProduct, productPriceVariant: { findMany: async () => [] } };
  const prisma = {
    product: {
      findUnique: async () => ({ sku: product.sku, slug: product.slug, status: product.status }),
      findUniqueOrThrow: async () => product,
    },
    category: { findUnique: async () => ({ slug: "nhan" }) },
    $transaction: async (work: (value: typeof tx) => unknown) => work(tx),
  };
  return { product, updatePayloads, service: new CommerceService(prisma as any, { isSyncEnabled: () => false } as any, {} as any) };
}

test("editing product content without a status field preserves its current publication state", async () => {
  for (const initialStatus of ["ACTIVE", "HIDDEN"] as const) {
    const fixture = productEditFixture(initialStatus);
    const saved = await fixture.service.saveProduct({
      sku: "NSBR01", name: "Nhẫn sau khi sửa", kind: "JEWELRY", categoryId: "category-1",
      price: 1_000_000, description: "Mô tả cập nhật", gallery: [],
    }, "product-edit-1");

    assert.equal(saved.status, initialStatus);
    assert.equal(fixture.product.status, initialStatus);
    assert.equal(fixture.updatePayloads[0].status, initialStatus);
    assert.equal(saved.name, "Nhẫn sau khi sửa");
  }
});

test("updating the new-product badge only changes isNew and does not validate or rewrite legacy variants", async () => {
  const fixture = publicationFixture({
    isNew: false,
    variants: [{ id: "legacy-variant", sku: "LEGACY-R", shape: null, quality: "Standard", beadSize: null, price: 0, stock: 0, imageUrls: [], videoUrl: null }],
  });
  const saved = await fixture.service.updateProductNewLabel("product-1", true, { id: "admin-1", correlationId: "request-1" });

  assert.equal(saved.isNew, true);
  assert.deepEqual(fixture.updatePayloads, [{ isNew: true }]);
  assert.equal(fixture.product.sku, "NSBAMQ01");
  assert.equal(fixture.product.variants[0].shape, null);
  assert.equal(fixture.product.variants[0].beadSize, null);
  assert.deepEqual(fixture.auditRows[0], {
    adminId: "admin-1",
    correlationId: "request-1",
    action: "PRODUCT_NEW_LABEL_UPDATED",
    entityType: "PRODUCT",
    entityId: "product-1",
    before: { isNew: false },
    after: { isNew: true },
  });
});

test("new-product badge endpoint accepts only a boolean and requires catalog.publish", async () => {
  let allowed = true;
  const permissions = { assertPermissions: async (_identity: unknown, required: string[]) => {
    assert.deepEqual(required, ["catalog.publish"]);
    if (!allowed) throw new ForbiddenException("Permission denied");
  } };
  const commerce = { updateProductNewLabel: async (_id: string, isNew: boolean) => ({ isNew }) };
  const controller = new CommerceController(commerce as any, {} as any, permissions as any, {} as any);
  const request = { adminIdentity: { id: "admin-1" } };

  assert.deepEqual(await controller.updateProductNewLabel(request as any, "product-1", { isNew: true }), { isNew: true });
  await assert.rejects(() => controller.updateProductNewLabel(request as any, "product-1", { isNew: "true" }), BadRequestException);
  await assert.rejects(() => controller.updateProductNewLabel(request as any, "product-1", { isNew: false, price: 1 }), BadRequestException);
  allowed = false;
  await assert.rejects(() => controller.updateProductNewLabel(request as any, "product-1", { isNew: false }), ForbiddenException);
});

test("publication endpoint requires publish permission and accepts only status plus reason", async () => {
  let allowed = true;
  const permissions = { assertPermissions: async (_identity: unknown, required: string[]) => {
    assert.deepEqual(required, ["catalog.publish"]);
    if (!allowed) throw new ForbiddenException("Permission denied");
  } };
  const commerce = { updateProductPublication: async (_id: string, status: string, _actor: unknown, reason: string) => ({ status, reason }) };
  const controller = new CommerceController(commerce as any, {} as any, permissions as any, {} as any);
  const request = { adminIdentity: { id: "admin-1" } };

  assert.deepEqual(await controller.updateProductPublication(request as any, "product-1", { status: "HIDDEN", reason: "Ẩn sản phẩm cũ" }), { status: "HIDDEN", reason: "Ẩn sản phẩm cũ" });
  await assert.rejects(() => controller.updateProductPublication(request as any, "product-1", { status: "HIDDEN", reason: "Ẩn sản phẩm", gallery: [] }), BadRequestException);
  allowed = false;
  await assert.rejects(() => controller.updateProductPublication(request as any, "product-1", { status: "HIDDEN", reason: "Ẩn sản phẩm" }), ForbiddenException);
});
