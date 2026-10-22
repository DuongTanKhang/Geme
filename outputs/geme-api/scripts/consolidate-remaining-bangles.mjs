import { PrismaClient } from "../dist/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const categorySlug = "vong-kieng";
const bangleGroups = {
  NSBLA: { materialSlug: "lapis", name: "Kiềng Lapis Lazuli", slug: "kieng-lapis-lazuli" },
  NSBMO: { materialSlug: "moonstone", name: "Kiềng Moonstone", slug: "kieng-moonstone" },
  NSBRB: { materialSlug: "ruby", name: "Kiềng Ruby Nam Phi", slug: "kieng-ruby-nam-phi" },
};
const expectedCounts = { NSBLA: 6, NSBMO: 10, NSBRB: 3 };
const shapeLabels = { R: "ROUND", O: "OVAL", SQ: "SQUARE" };
const shapeOrder = { OVAL: 0, ROUND: 1, SQUARE: 2 };
const apply = process.argv.includes("--apply");

function parseBangleSku(sku) {
  const match = String(sku).match(/^(NSB(?:LA|MO|RB))(SQ|O|R)(\d{2})S(\d{1,2})$/);
  if (!match) throw new Error(`SKU kiềng không đúng cấu trúc: ${sku}`);
  const [, baseSku, shapeCode, gradeCode, size] = match;
  const grade = Number(gradeCode);
  if (!Number.isInteger(grade) || grade < 1 || Number(size) < 1 || Number(size) > 99) {
    throw new Error(`Chất lượng hoặc size không hợp lệ trong SKU ${sku}`);
  }
  return {
    baseSku,
    shape: shapeLabels[shapeCode],
    quality: grade === 1 ? "A" : `${grade}A`,
    beadSize: size,
  };
}

function labelFor(variant) {
  const shape = { OVAL: "Oval", ROUND: "Tròn", SQUARE: "Vuông" }[variant.shape];
  return `${shape} · ${variant.quality} · ${variant.beadSize}mm`;
}

try {
  if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL; dừng mà không sửa dữ liệu.");

  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) throw new Error(`Không tìm thấy danh mục ${categorySlug}.`);

  const sourceProducts = await prisma.product.findMany({
    where: { categoryId: category.id, sku: { not: "NSBAF" } },
    include: {
      materialOption: { select: { id: true, slug: true } },
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      variants: { select: { id: true } },
    },
    orderBy: { sku: "asc" },
  });

  const groups = new Map();
  for (const product of sourceProducts) {
    if (product.status !== "DRAFT") throw new Error(`${product.sku} không còn ở trạng thái DRAFT; dừng để tránh ghi đè sản phẩm đang bán.`);
    if (product.variants.length) throw new Error(`${product.sku} đã có biến thể; dừng để không gộp trùng.`);
    if (!product.materialOption) throw new Error(`${product.sku} thiếu loại đá đã xác định.`);
    if (Number(product.price) <= 0 || product.stock < 0) throw new Error(`${product.sku} thiếu giá bán hợp lệ hoặc có tồn âm.`);

    const parsed = parseBangleSku(product.sku);
    const definition = bangleGroups[parsed.baseSku];
    if (!definition || product.materialOption.slug !== definition.materialSlug) {
      throw new Error(`${product.sku} không khớp quy tắc loại đá đã xác nhận.`);
    }
    const group = groups.get(parsed.baseSku) || { definition, rows: [] };
    group.rows.push({ product, parsed });
    groups.set(parsed.baseSku, group);
  }

  for (const [baseSku, expectedCount] of Object.entries(expectedCounts)) {
    const group = groups.get(baseSku);
    if (!group || group.rows.length !== expectedCount) {
      throw new Error(`${baseSku}: kỳ vọng ${expectedCount} SKU, thực tế ${group?.rows.length || 0}; dừng để rà soát.`);
    }
  }
  if (groups.size !== Object.keys(expectedCounts).length || sourceProducts.length !== 19) {
    throw new Error(`Kỳ vọng đúng 19 SKU thuộc Lapis/Moonstone/Ruby; database hiện có ${sourceProducts.length}. Không sửa dữ liệu.`);
  }

  const sourceIds = sourceProducts.map((product) => product.id);
  const sourceSkus = sourceProducts.map((product) => product.sku);
  const [skuCollisions, slugCollisions, variantCollisions, referenceCounts] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: Object.keys(bangleGroups) } }, select: { sku: true } }),
    prisma.product.findMany({ where: { slug: { in: Object.values(bangleGroups).map((group) => group.slug) } }, select: { slug: true } }),
    prisma.productPriceVariant.findMany({ where: { sku: { in: sourceSkus } }, select: { sku: true } }),
    Promise.all([
      prisma.orderItem.count({ where: { productId: { in: sourceIds } } }),
      prisma.customerFavorite.count({ where: { productId: { in: sourceIds } } }),
      prisma.productReview.count({ where: { productId: { in: sourceIds } } }),
      prisma.promotionTarget.count({ where: { productId: { in: sourceIds } } }),
      prisma.productMediaAsset.count({ where: { productId: { in: sourceIds } } }),
      prisma.aiImageItem.count({ where: { attachedProductId: { in: sourceIds } } }),
      prisma.aiImageBatch.count({ where: { targetProductId: { in: sourceIds } } }),
      prisma.socialPost.count({ where: { sourceProductId: { in: sourceIds } } }),
    ]),
  ]);
  if (skuCollisions.length || slugCollisions.length || variantCollisions.length) {
    throw new Error(`Mã cha/slug/SKU biến thể đã tồn tại: ${JSON.stringify({ skuCollisions, slugCollisions, variantCollisions })}`);
  }
  if (referenceCounts.some((count) => count > 0)) {
    throw new Error(`Có đơn hàng, yêu thích, đánh giá, khuyến mãi, AI hoặc bài mạng xã hội đang gắn với SKU cũ; dừng để xử lý tham chiếu an toàn. ${JSON.stringify(referenceCounts)}`);
  }

  const plans = [...groups.entries()].map(([baseSku, group]) => {
    const rows = group.rows.map(({ product, parsed }) => ({ product, ...parsed }));
    rows.sort((a, b) =>
      shapeOrder[a.shape] - shapeOrder[b.shape]
      || Number(a.quality.replace("A", "")) - Number(b.quality.replace("A", ""))
      || Number(a.beadSize) - Number(b.beadSize));
    const anchor = rows.find((row) => row.product.images.length > 0)?.product || rows[0].product;
    const price = Math.min(...rows.map((row) => Number(row.product.price)));
    const stock = rows.reduce((sum, row) => sum + row.product.stock, 0);
    const images = rows.flatMap((row) => row.product.images.map((image) => ({ ...image, sourceSku: row.product.sku })));
    return { baseSku, definition: group.definition, rows, anchor, price, stock, images };
  });

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    localProducts: sourceProducts.length,
    groups: plans.map((plan) => ({
      sku: plan.baseSku,
      name: plan.definition.name,
      variants: plan.rows.map((row) => ({ sku: row.product.sku, shape: row.shape, quality: row.quality, sizeMm: row.beadSize, price: Number(row.product.price), stock: row.product.stock, images: row.product.images.length })),
      totalStock: plan.stock,
      imageCount: plan.images.length,
      anchorSku: plan.anchor.sku,
    })),
  }, null, 2));

  if (!apply) process.exitCode = 0;
  else {
    const priceSyncStatus = String(process.env.POS365_ENABLED || "").toLowerCase() === "true" ? "PENDING" : "DISABLED";
    await prisma.$transaction(async (tx) => {
      const current = await tx.product.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, sku: true, status: true, stock: true, price: true },
      });
      if (current.length !== 19 || current.some((row) => row.status !== "DRAFT")) {
        throw new Error("Dữ liệu Kiềng đã thay đổi sau bước xem trước; hủy giao dịch.");
      }

      for (const plan of plans) {
        const variantBySku = new Map();
        for (const [sortOrder, row] of plan.rows.entries()) {
          const variant = await tx.productPriceVariant.create({
            data: {
              productId: plan.anchor.id,
              optionKey: `BANGLE::${row.shape}::${row.quality}::${row.beadSize}`,
              sku: row.product.sku,
              shape: row.shape,
              quality: row.quality,
              beadSize: row.beadSize,
              imageUrls: row.product.images.map((image) => image.url),
              videoUrl: row.product.coverVideoUrl,
              price: row.product.price,
              originalPrice: row.product.originalPrice,
              stock: row.product.stock,
              sortOrder,
            },
            select: { id: true, sku: true, shape: true, quality: true, beadSize: true },
          });
          variantBySku.set(row.product.sku, variant);
        }

        for (const row of plan.rows) {
          const variant = variantBySku.get(row.product.sku);
          const label = labelFor(variant);
          await tx.inventoryReceiptItem.updateMany({
            where: { productId: row.product.id },
            data: { productId: plan.anchor.id, variantId: variant.id, shape: variant.shape, quality: variant.quality, beadSize: variant.beadSize },
          });
          await tx.inventoryMovement.updateMany({
            where: { productId: row.product.id },
            data: { productId: plan.anchor.id, variantId: variant.id, variantLabel: label },
          });
          await tx.inventoryIssueItem.updateMany({
            where: { productId: row.product.id },
            data: { productId: plan.anchor.id, variantId: variant.id, variantLabel: label },
          });
        }

        let imageOrder = 0;
        for (const row of plan.rows) {
          for (const image of row.product.images) {
            await tx.productImage.update({
              where: { id: image.id },
              data: { productId: plan.anchor.id, sortOrder: imageOrder, isPrimary: imageOrder === 0 },
            });
            imageOrder += 1;
          }
        }

        const obsoleteIds = plan.rows.map((row) => row.product.id).filter((id) => id !== plan.anchor.id);
        if (obsoleteIds.length) await tx.product.deleteMany({ where: { id: { in: obsoleteIds } } });

        await tx.product.update({
          where: { id: plan.anchor.id },
          data: {
            sku: plan.baseSku,
            name: plan.definition.name,
            slug: plan.definition.slug,
            status: "ACTIVE",
            isNew: true,
            isFeatured: false,
            price: plan.price,
            originalPrice: null,
            stock: plan.stock,
            seoTitle: null,
            seoDescription: null,
            pos365PriceSyncStatus: priceSyncStatus,
            pos365PriceSyncAttempts: 0,
            pos365PriceSyncLastAttemptAt: null,
            pos365PriceSyncNextAttemptAt: priceSyncStatus === "PENDING" ? new Date() : null,
            pos365PriceSyncedAt: null,
            pos365PriceSyncError: null,
            createdAt: new Date(),
          },
        });
      }
    }, { maxWait: 10000, timeout: 120000 });
    console.log("Gộp hoàn tất; tồn kho, phiếu nhập, lịch sử điều chỉnh và ảnh đã được giữ theo SKU biến thể.");
  }
} finally {
  await prisma.$disconnect();
}
