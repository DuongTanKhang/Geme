/**
 * One-time, deliberately guarded local rebuild for the confirmed Quartz sphere
 * rows in the legacy SQL export.
 *
 * Run a non-mutating preflight first:
 *   pnpm exec tsx scripts/import-confirmed-white-quartz-spheres.once.mjs
 * Then execute only after the summary is checked:
 *   pnpm exec tsx scripts/import-confirmed-white-quartz-spheres.once.mjs --execute --replace-existing-white
 *
 * If a legacy image no longer exists in R2, inventory is still reconstructed
 * from the confirmed legacy rows, but that quality SKU remains DRAFT until an
 * operator attaches a verified cover image. Missing images stay unassigned and
 * are reported explicitly:
 *   pnpm exec tsx scripts/import-confirmed-white-quartz-spheres.once.mjs --execute --allow-missing-images
 *
 * By default this never calls POS365. Add --sync-pos only after a dry run has
 * confirmed the local R2 media and the POS365 connection are ready. It creates
 * replaces only the five previously imported White Quartz SKUs after validating
 * they have no orders, then records the confirmed Quartz inventory hierarchy,
 * links already-uploaded R2 media, and publishes the parents locally.
 */
import "dotenv/config";
import { CommerceService } from "../src/commerce/commerce.service.ts";
import { LoyaltyService } from "../src/loyalty/loyalty.service.ts";
import { MediaAssetsService } from "../src/media/media-assets.service.ts";
import { MediaStorageService } from "../src/media/media-storage.service.ts";
import { Pos365Service } from "../src/pos365/pos365.service.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";

const execute = process.argv.includes("--execute");
const allowMissingImages = process.argv.includes("--allow-missing-images");
const syncPos = process.argv.includes("--sync-pos");
const replaceExistingWhite = process.argv.includes("--replace-existing-white");
const legacyImagePrefix = "legacy-product-images";
const legacyWhiteSkus = ["CAU-TATB", "CAU-TAT1", "CAU-TAT3", "CAU-TAT4", "CAU-TAT5"];
const expectedProductCount = 11;

// All weights here are confirmed individual weights from the old SQL export.
// The three unresolved legacy rows remain listed in NOTE-QUY-UOC-QUA-CAU.md
// and intentionally are not present in this import.
const groups = [
  {
    sku: "CAU-TATB",
    name: "Quả cầu Thạch Anh Trắng – Cùi Dừa B",
    stoneType: "Thạch Anh Trắng",
    quality: "B",
    rows: [{ legacyId: "2434", weightKg: 1.13, price: 880000, image: "113kg-10-3713.jpg" }],
  },
  {
    sku: "CAU-TAT1",
    name: "Quả cầu Thạch Anh Trắng – Cùi Dừa",
    stoneType: "Thạch Anh Trắng",
    quality: "A",
    rows: [
      { legacyId: "2432", weightKg: 2.755, price: 1980000, image: "2755kg-1801.jpg" },
      { legacyId: "2433", weightKg: 2.76, price: 1990000, image: "276kg-7343.jpg" },
      { legacyId: "2435", weightKg: 3, price: 2160000, image: "3kg-7378.jpg" },
    ],
  },
  {
    sku: "CAU-TAT3",
    name: "Quả cầu Thạch Anh Trắng – Trong 3A",
    stoneType: "Thạch Anh Trắng",
    quality: "3A",
    rows: [
      { legacyId: "2385", weightKg: 0.475, price: 1200000, image: "0475kg-7-9870.jpg" },
      { legacyId: "2386", weightKg: 0.58, price: 1470000, image: "058kg-75-8613.jpg" },
      { legacyId: "2387", weightKg: 0.62, price: 1570000, image: "062kg-75-9621.jpg" },
    ],
  },
  {
    sku: "CAU-TAT4",
    name: "Quả cầu Thạch Anh Trắng – Trong 4A",
    stoneType: "Thạch Anh Trắng",
    quality: "4A",
    rows: [
      { legacyId: "2347", weightKg: 2.84, price: 12200000, image: "284kg-5860.jpg" },
      { legacyId: "2348", weightKg: 2.95, price: 12680000, image: "295kg-8118.jpg" },
      { legacyId: "2350", weightKg: 4.56, price: 19600000, image: "456kg-1404.jpg" },
    ],
  },
  {
    sku: "CAU-TAT5",
    name: "Quả cầu Thạch Anh Trắng – Trong 5A",
    stoneType: "Thạch Anh Trắng",
    quality: "5A",
    rows: [
      { legacyId: "556", weightKg: 1.79, price: 10068000, image: "d967696c6543b91de05247-1777.jpg" },
      { legacyId: "557", weightKg: 2.9, price: 16300000, image: "fd21e1f113ddcf8396cc44-5023.jpg" },
      { legacyId: "558", weightKg: 2.515, price: 14140000, image: "681f3d51717ead20f46f74-2775.jpg" },
      { legacyId: "559", weightKg: 2.516, price: 14140000, image: "2516-2-5422.jpg" },
      { legacyId: "560", weightKg: 3.66, price: 20580000, image: "366-2-1541.jpg" },
      { legacyId: "561", weightKg: 2.845, price: 16000000, image: "ab09675944769828c16762-7951.jpg" },
      { legacyId: "562", weightKg: 3.09, price: 17380000, image: "cau-thach-anh-trang-trong-5a-309kg-5682.jpg" },
      { legacyId: "563", weightKg: 3.093, price: 17380000, image: "3093-1999.jpg" },
      { legacyId: "564", weightKg: 3.18, price: 17880000, image: "318-2-1694.jpg" },
      { legacyId: "565", weightKg: 3.635, price: 20440000, image: "3635-2-1038.jpg" },
      { legacyId: "566", weightKg: 3.56, price: 20020000, image: "2f23496c7043ac1df55265-9012.jpg" },
      { legacyId: "567", weightKg: 3.095, price: 17400000, image: "de647ed427fbfba5a2ea77-2474.jpg" },
      { legacyId: "568", weightKg: 4.75, price: 26700000, image: "475-2-3662.jpg" },
      { legacyId: "569", weightKg: 2.655, price: 14930000, image: "2655-2-1911.jpg" },
      { legacyId: "6318", weightKg: 6.67, price: 32680000, image: "z7275303784504732eade6d9fc6cdd81a283ae29932ead-8591.jpg" },
      { legacyId: "6319", weightKg: 6.755, price: 33100000, image: "z7275303799448cd74ff016659076ea09621c66ad47358-7838.jpg" },
      { legacyId: "6320", weightKg: 4.5, price: 22050000, image: "z7275303808039fabd8b6cd7ecb883ac017a61bf2ce861-3366.jpg" },
      { legacyId: "6321", weightKg: 4.4, price: 21560000, image: "z7275303819934d630d5211ec2418f0c196fafdf5a1958-1755.jpg" },
      { legacyId: "6322", weightKg: 4.8, price: 23520000, image: "z7275303844207f10ac056b430ce4999f38806f69b37c9-7796.jpg" },
      { legacyId: "6323", weightKg: 5.1, price: 24990000, image: "z7275303844207f10ac056b430ce4999f38806f69b37c9-2379.jpg" },
    ],
  },
  {
    sku: "CAU-TAD1",
    name: "Quả cầu Thạch Anh Đen – A",
    stoneType: "Thạch Anh Đen",
    quality: "A",
    rows: [
      { legacyId: "1037", weightKg: 1.09, price: 938000, image: "16751d4775e5aabbf3f448-5249.jpg" },
      { legacyId: "1503", weightKg: 1.16, price: 999000, image: "116kg-a-4458.jpg" },
    ],
  },
  {
    sku: "CAU-TAD2",
    name: "Quả cầu Thạch Anh Đen – 2A",
    stoneType: "Thạch Anh Đen",
    quality: "2A",
    rows: [
      { legacyId: "614", weightKg: 5.31, price: 4960000, image: "a8c4a07944a898f6c1b99-6454.jpg" },
      { legacyId: "1500", weightKg: 1.01, price: 1100000, image: "101kg-6168.jpg" },
      { legacyId: "1509", weightKg: 1.25, price: 1380000, image: "125kg-2181.jpg" },
      { legacyId: "1512", weightKg: 1.78, price: 1800000, image: "178kg-4750.jpg" },
      { legacyId: "1514", weightKg: 1.88, price: 1900000, image: "188kg-4975.jpg" },
      { legacyId: "1515", weightKg: 1.635, price: 1660000, image: "1635kg-5576.jpg" },
      { legacyId: "1517", weightKg: 2.47, price: 2500000, image: "247kg-7724.jpg" },
      { legacyId: "1520", weightKg: 2.71, price: 2760000, image: "271kg-4706.jpg" },
      { legacyId: "1523", weightKg: 2.87, price: 2920000, image: "287kg-8965.jpg" },
      { legacyId: "1529", weightKg: 2.275, price: 2320000, image: "2275kg-5529.jpg" },
      { legacyId: "1530", weightKg: 3.05, price: 2850000, image: "305kg-4843.jpg" },
      { legacyId: "1531", weightKg: 4.18, price: 3900000, image: "418kg-2218.jpg" },
      { legacyId: "1532", weightKg: 4.35, price: 4060000, image: "435kg-6663.jpg" },
    ],
  },
  {
    sku: "CAU-TAH1",
    name: "Quả cầu Thạch Anh Hồng – A",
    stoneType: "Thạch Anh Hồng",
    quality: "A",
    rows: [{ legacyId: "1556", weightKg: 9.55, price: 5252000, image: "a-935kg-9812.jpg" }],
  },
  {
    sku: "CAU-TAH3",
    name: "Quả cầu Thạch Anh Hồng – 3A",
    stoneType: "Thạch Anh Hồng",
    quality: "3A",
    rows: [
      { legacyId: "615", weightKg: 16.15, price: 14130000, image: "341c3254c69a1ac4438b1-6110.jpg" },
      { legacyId: "1032", weightKg: 17.3, price: 15130000, image: "3a3026144bb694e8cda759-6911.jpg" },
      { legacyId: "1033", weightKg: 1.33, price: 1500000, image: "2018c478adda72842bcb50-4395.jpg" },
      { legacyId: "1034", weightKg: 1.48, price: 1550000, image: "6339fb5e92fc4da214ed49-6001.jpg" },
      { legacyId: "1035", weightKg: 10.04, price: 8780000, image: "c58d32265d8482dadb9553-8761.jpg" },
      { legacyId: "1557", weightKg: 1.27, price: 1440000, image: "127kg-1-4904.jpg" },
      { legacyId: "1558", weightKg: 1.31, price: 1490000, image: "131kg-1549.jpg" },
      { legacyId: "1559", weightKg: 1.4, price: 1590000, image: "14kg-4072.jpg" },
      { legacyId: "1560", weightKg: 1.42, price: 1600000, image: "142kg-1145.jpg" },
      { legacyId: "1561", weightKg: 2.22, price: 2330000, image: "222kg-8766.jpg" },
      { legacyId: "1562", weightKg: 3.38, price: 3250000, image: "338kg-3213.jpg" },
      { legacyId: "1563", weightKg: 4.55, price: 4380000, image: "455kg-3736.jpg" },
      { legacyId: "1564", weightKg: 4.9, price: 4700000, image: "49kg-7076.jpg" },
    ],
  },
  {
    sku: "CAU-TATI2",
    name: "Quả cầu Thạch Anh Tím Hoa Chanh – A+",
    stoneType: "Thạch Anh Tím",
    quality: "A+",
    rows: [
      { legacyId: "607", weightKg: 5.13, price: 10130000, image: "5e8e893c6fedb3b3eafc15-5671.jpg" }, { legacyId: "608", weightKg: 3.16, price: 6240000, image: "9bf0f4ccd3e00fbe56f16-3441.jpg" },
      { legacyId: "1565", weightKg: 0.88, price: 2080000, image: "088kg-2607.jpg" }, { legacyId: "1566", weightKg: 1.13, price: 2680000, image: "113kg-2168.jpg" },
      { legacyId: "1567", weightKg: 1.14, price: 2700000, image: "114kg-8356.jpg" }, { legacyId: "1568", weightKg: 1.015, price: 2400000, image: "1015kg-3193.jpg" },
      { legacyId: "1569", weightKg: 1.21, price: 2860000, image: "121kg-4890.jpg" }, { legacyId: "1570", weightKg: 1.26, price: 2980000, image: "126kg-8191.jpg" },
      { legacyId: "1571", weightKg: 1.81, price: 3900000, image: "181kg-1-5687.jpg" }, { legacyId: "1572", weightKg: 1.98, price: 4300000, image: "198kg-3658.jpg" },
      { legacyId: "1573", weightKg: 1.255, price: 2960000, image: "1255kg-1-9844.jpg" }, { legacyId: "1574", weightKg: 1.945, price: 4220000, image: "1945kg-5629.jpg" },
      { legacyId: "1575", weightKg: 1, price: 2370000, image: "1kg-5687.jpg" }, { legacyId: "1576", weightKg: 2.15, price: 4670000, image: "215kg-7966.jpg" },
      { legacyId: "1577", weightKg: 2.17, price: 4700000, image: "217kg-1-1182.jpg" }, { legacyId: "1578", weightKg: 2.27, price: 4930000, image: "227kg-2-2222.jpg" },
      { legacyId: "1579", weightKg: 3.81, price: 7520000, image: "381kg-1-2491.jpg" }, { legacyId: "1580", weightKg: 3.385, price: 6680000, image: "3385kg-3117.jpg" },
      { legacyId: "1581", weightKg: 5.28, price: 10430000, image: "a-528kg-2065.jpg" }, { legacyId: "2421", weightKg: 5.2, price: 10260000, image: "52kg-8738.jpg" },
    ],
  },
  {
    sku: "CAU-TAV03",
    name: "Quả cầu Thạch Anh Vàng – 3A",
    stoneType: "Thạch Anh Vàng",
    quality: "3A",
    rows: [
      { legacyId: "605", weightKg: 8.63, price: 11860000, image: "6f451608f2d92e8777c87-8138.jpg" }, { legacyId: "606", weightKg: 8.31, price: 11420000, image: "689828ffcc2e1070493f6-5350.jpg" },
      { legacyId: "1435", weightKg: 4.57, price: 6280000, image: "457kg-145cm-2002.jpg" }, { legacyId: "1436", weightKg: 4.83, price: 6600000, image: "483kg-15cm-3445.jpg" },
      { legacyId: "1437", weightKg: 4.92, price: 6760000, image: "492kg-15cm-1282.jpg" }, { legacyId: "1438", weightKg: 5.1, price: 7000000, image: "51kg-15cm-2352.jpg" },
      { legacyId: "1439", weightKg: 5.03, price: 6900000, image: "503kg-15cm-1225.jpg" }, { legacyId: "2286", weightKg: 1.54, price: 2540000, image: "154kg-105-8013.jpg" },
      { legacyId: "2292", weightKg: 1.79, price: 2950000, image: "179kg-11-2879.jpg" }, { legacyId: "2294", weightKg: 1.85, price: 2790000, image: "185kg-11-4030.jpg" },
      { legacyId: "2296", weightKg: 1.86, price: 2800000, image: "186kg-11-3751.jpg" }, { legacyId: "2297", weightKg: 2.28, price: 3450000, image: "228kg-115-6288.jpg" },
      { legacyId: "2298", weightKg: 3.45, price: 5200000, image: "345kg-13-8369.jpg" }, { legacyId: "2299", weightKg: 3.58, price: 5000000, image: "358kg-135-9204.jpg" },
      { legacyId: "2300", weightKg: 3.93, price: 5400000, image: "393kg-135-1347.jpg" },
    ],
  },
].map((group) => ({
  ...group,
  totalKg: Number(group.rows.reduce((sum, row) => sum + row.weightKg, 0).toFixed(3)),
  // Legacy values are per physical sphere. The parent sells by kg, so its
  // profile price is the weighted historical value per kg, rounded to VND.
  pricePerKg: Math.round(group.rows.reduce((sum, row) => sum + row.price, 0) / group.rows.reduce((sum, row) => sum + row.weightKg, 0)),
}));

const sumKg = (rows) => Number(rows.reduce((sum, row) => sum + row.weightKg, 0).toFixed(3));
const allRows = groups.flatMap((group) => group.rows);

if (groups.length !== expectedProductCount || groups.some((group) => !group.stoneType || !group.quality || !group.rows.length || group.totalKg <= 0)) {
  throw new Error("Dữ liệu import Cầu Thạch Anh không đủ Nhóm đá, Loại đá, Chất lượng hoặc kg. Dừng trước khi kết nối cơ sở dữ liệu.");
}

// Keep this recovery/import local unless the operator explicitly opts in to
// sending the completed receipt to POS365. This prevents a dry run or a normal
// local recovery from mutating POS by accident.
if (!syncPos) process.env.POS365_ENABLED = "false";

const prisma = new PrismaService();
const pos365 = new Pos365Service(prisma);
const storage = new MediaStorageService();
const media = new MediaAssetsService(prisma, storage);
const loyalty = new LoyaltyService(prisma);
const commerce = new CommerceService(prisma, pos365, media, loyalty);

try {
  await prisma.$connect();

  if (!storage.usesR2 || !storage.publicUrl("media/check.jpg")) {
    throw new Error("Local API chưa cấu hình R2 và MEDIA_PUBLIC_BASE_URL. Chưa tạo hay nhập bất kỳ sản phẩm nào.");
  }
  const r2Probe = await storage.headPublicObject(`${legacyImagePrefix}/r2-import-preflight-not-found`);
  if (![200, 404].includes(r2Probe.status)) {
    throw new Error(`R2 preflight thất bại HTTP ${r2Probe.status}. Chưa tạo hay nhập bất kỳ sản phẩm nào.`);
  }

  const imageChecks = await Promise.all(allRows.map(async (row) => ({
    image: row.image,
    status: (await storage.headPublicObject(`${legacyImagePrefix}/${row.image}`)).status,
  })));
  const missingImages = imageChecks.filter((row) => row.status !== 200);
  const presentImages = new Set(imageChecks.filter((row) => row.status === 200).map((row) => row.image));
  const groupsWithoutCover = groups.filter((group) => !group.rows.some((row) => presentImages.has(row.image)));
  if (missingImages.length && !allowMissingImages) {
    throw new Error(`R2 thiếu ${missingImages.length}/${allRows.length} ảnh Cầu Thạch Anh Trắng: ${missingImages.slice(0, 8).map((row) => `${row.image} (HTTP ${row.status})`).join(", ")}. Chưa tạo hay nhập bất kỳ sản phẩm nào.`);
  }

  const category = await prisma.category.findFirst({
    where: { name: "Quả cầu", status: "ACTIVE", usage: "PRODUCT_CATEGORY", kind: "OTHER", level: { gte: 2 } },
    select: { id: true, name: true, parentId: true },
  });
  if (!category) throw new Error("Chưa có danh mục Vật phẩm → Quả cầu đang hoạt động. Chưa tạo hay nhập bất kỳ sản phẩm nào.");
  const parent = category.parentId ? await prisma.category.findUnique({ where: { id: category.parentId }, select: { name: true } }) : null;
  if (parent?.name?.trim().toLocaleLowerCase("vi-VN") !== "vật phẩm") {
    throw new Error("Danh mục Quả cầu chưa nằm dưới Vật phẩm. Chưa tạo hay nhập bất kỳ sản phẩm nào.");
  }

  const admin = await prisma.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) throw new Error("Không có tài khoản quản trị đang hoạt động để ghi audit. Chưa tạo hay nhập bất kỳ sản phẩm nào.");

  const existing = await prisma.product.findMany({
    where: { sku: { in: groups.map((group) => group.sku) } },
    select: { id: true, sku: true, categoryId: true, status: true, stockKg: true, images: { select: { url: true } }, sphereItems: { select: { id: true } } },
  });
  const priorWhiteProducts = existing.filter((product) => legacyWhiteSkus.includes(product.sku));
  const conflictingProducts = existing.filter((product) => !legacyWhiteSkus.includes(product.sku));
  if (conflictingProducts.length) {
    throw new Error(`Đã thấy SKU Quartz mới tồn tại (${conflictingProducts.map((row) => row.sku).join(", ")}). Dừng để không nhập trùng.`);
  }
  if (priorWhiteProducts.length && !replaceExistingWhite) {
    throw new Error(`Đã thấy ${priorWhiteProducts.length} SKU Thạch Anh Trắng cũ (${priorWhiteProducts.map((row) => row.sku).join(", ")}). Chạy lại với --replace-existing-white sau khi đã kiểm tra tóm tắt.`);
  }
  if (priorWhiteProducts.length && priorWhiteProducts.length !== legacyWhiteSkus.length) {
    throw new Error(`Chỉ tìm thấy ${priorWhiteProducts.length}/${legacyWhiteSkus.length} SKU Trắng cũ. Dừng để không xóa một lô không đầy đủ.`);
  }

  let legacyWhiteReceipt = null;
  if (priorWhiteProducts.length) {
    const legacyWhiteDetails = await prisma.product.findMany({
      where: { sku: { in: legacyWhiteSkus } },
      select: {
        id: true,
        sku: true,
        orderItems: { select: { id: true } },
        inventoryReceiptItems: { select: { receiptId: true } },
        sphereItems: { select: { receiptId: true } },
      },
    });
    const ordered = legacyWhiteDetails.filter((product) => product.orderItems.length);
    if (ordered.length) {
      throw new Error(`Không thể thay lô Trắng cũ vì SKU đã phát sinh đơn hàng: ${ordered.map((product) => product.sku).join(", ")}.`);
    }
    const receiptIds = new Set(legacyWhiteDetails.flatMap((product) => [
      ...product.inventoryReceiptItems.map((item) => item.receiptId),
      ...product.sphereItems.map((item) => item.receiptId).filter(Boolean),
    ]));
    if (receiptIds.size !== 1) {
      throw new Error("Lô Trắng cũ không cùng một phiếu nhập duy nhất. Dừng để không xóa lịch sử ngoài phạm vi.");
    }
    const [receiptId] = [...receiptIds];
    legacyWhiteReceipt = await prisma.inventoryReceipt.findUnique({
      where: { id: receiptId },
      include: { items: { select: { productSku: true } } },
    });
    if (!legacyWhiteReceipt || legacyWhiteReceipt.items.length !== legacyWhiteSkus.length || legacyWhiteReceipt.items.some((item) => !legacyWhiteSkus.includes(item.productSku))) {
      throw new Error("Phiếu nhập Trắng cũ có dòng ngoài 5 SKU được phép thay. Dừng để bảo toàn lịch sử khác.");
    }
  }

  const rulesSetting = await prisma.siteSetting.findUnique({ where: { key: "inventory.skuRules" }, select: { value: true } });
  const priorRules = Array.isArray(rulesSetting?.value) ? rulesSetting.value : [];
  const categoryRule = priorRules.find((rule) => rule && rule.categoryId === category.id);
  if (categoryRule && String(categoryRule.prefix || "").toUpperCase() !== "CAU") {
    throw new Error(`Danh mục Quả cầu đang có tiền tố SKU ${categoryRule.prefix || "trống"}, khác CAU. Dừng để không tự thay đổi quy tắc mã.`);
  }

  const preflight = {
    mode: execute ? "EXECUTE" : "DRY_RUN",
    category: `${parent.name} → ${category.name}`,
    parentSkuPrefix: categoryRule?.prefix || "CAU (SKU legacy đã xác minh; không thay đổi quy tắc toàn cục)",
    groups: groups.map((group) => ({
      sku: group.sku,
      quality: group.quality,
      spheres: group.rows.length,
      totalKg: group.totalKg,
      pricePerKg: group.pricePerKg,
      imagesVerified: group.rows.filter((row) => presentImages.has(row.image)).length,
      imagesMissing: group.rows.filter((row) => !presentImages.has(row.image)).length,
    })),
    totalGroups: groups.length,
    totalSpheres: allRows.length,
    totalKg: sumKg(allRows),
    replacingWhiteReceipt: legacyWhiteReceipt?.receiptNo || null,
    imagesVerifiedInR2: presentImages.size,
    imagesMissingFromLegacySource: missingImages.length,
    draftUntilCoverImage: groupsWithoutCover.map((group) => group.sku),
    allowMissingImages,
    pos365Writes: syncPos,
  };
  console.log("SPHERE_PREFLIGHT " + JSON.stringify(preflight));
  if (!execute) {
    console.log("DRY_RUN_OK — không ghi dữ liệu. Thêm --execute sau khi kiểm tra tóm tắt.");
    process.exit(0);
  }

  if (legacyWhiteReceipt) {
    const oldProductIds = priorWhiteProducts.map((product) => product.id);
    await prisma.$transaction(async (tx) => {
      // Only records created by the replaced receipt are removed. Product-media
      // records cascade in PostgreSQL, but R2 objects are external and remain intact.
      await tx.inventoryMovement.deleteMany({
        where: { productId: { in: oldProductIds }, reference: legacyWhiteReceipt.receiptNo },
      });
      await tx.inventoryReceipt.delete({ where: { id: legacyWhiteReceipt.id } });
      await tx.product.deleteMany({ where: { id: { in: oldProductIds } } });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    console.log(`REPLACED_LEGACY_WHITE receipt=${legacyWhiteReceipt.receiptNo} skus=${legacyWhiteSkus.join(",")}`);
  }

  // The source SKUs are explicitly supplied and saved with allowLegacySku.
  // Receipt creation still verifies that the category has a prefix rule. Older
  // databases can contain archived invalid rules, so the Admin-wide validator
  // cannot safely rewrite the whole list. Append the single confirmed CAU rule
  // only when this category has none; preserve every historic entry verbatim.
  if (!categoryRule) {
    const cauRule = {
      categoryId: category.id,
      prefix: "CAU",
      skuFormat: "SEQUENTIAL",
      materialOptionIds: [],
      materialPrefixes: [],
    };
    await prisma.siteSetting.upsert({
      where: { key: "inventory.skuRules" },
      create: { key: "inventory.skuRules", value: [cauRule] },
      update: { value: [...priorRules, cauRule] },
    });
  }

  const receipt = await commerce.createInventoryReceipt({
    receivedAt: new Date().toISOString(),
    supplierName: "Đối chiếu SQL cũ",
    receiver: "Admin",
    warehouseName: "Kho chính",
    paymentMethod: "Không phát sinh",
    note: `Nhập Cầu Thạch Anh Trắng đã xác minh. Tồn và đơn vị bán theo kg; từng quả lưu chi tiết cân nặng.${syncPos ? " Đã yêu cầu đồng bộ phiếu nhập sang POS365." : " Chưa đồng bộ POS365 (chạy lại chỉ với cờ --sync-pos trước khi tạo phiếu nếu cần)."}`,
    items: groups.map((group) => ({
      quantity: 0,
      quantityKg: group.totalKg,
      unitCost: 0,
      sphereStoneGroupName: "Thạch Anh",
      sphereStoneTypeName: group.stoneType,
      sphereQuality: group.quality,
      sphereItems: group.rows.map((row, index) => ({
        label: `Quả ${index + 1} · ${row.weightKg.toFixed(3)} kg · SQL #${row.legacyId}`,
        weightKg: row.weightKg,
      })),
      newProduct: {
        name: group.name,
        kind: "OTHER",
        categoryId: category.id,
        sku: group.sku,
        legacySku: group.sku,
        allowLegacySku: true,
        price: group.pricePerKg,
      },
    })),
  });

  for (const group of groups) {
    const gallery = group.rows
      .filter((row) => presentImages.has(row.image))
      .map((row) => storage.publicUrl(`${legacyImagePrefix}/${row.image}`))
      .filter(Boolean);
    const saved = await commerce.updateProductFieldsBySku(group.sku, { gallery }, { id: admin.id });
    // A public product must have an actual cover. The new warehouse hierarchy
    // is still retained for SKUs whose old source image was never imported.
    if (gallery.length) await commerce.updateProductPublication(saved.id, "ACTIVE", { id: admin.id });
  }

  const imported = await prisma.product.findMany({
    where: { sku: { in: groups.map((group) => group.sku) } },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, status: true, price: true, stock: true, stockKg: true, categoryId: true, images: { select: { url: true } }, sphereItems: { select: { weightKg: true } } },
  });
  const verificationFailures = [];
  for (const group of groups) {
    const product = imported.find((row) => row.sku === group.sku);
    if (!product) { verificationFailures.push(`${group.sku}: không tạo được`); continue; }
    const hasVerifiedCover = group.rows.some((row) => presentImages.has(row.image));
    if (hasVerifiedCover && product.status !== "ACTIVE") verificationFailures.push(`${group.sku}: có ảnh R2 nhưng chưa hoạt động`);
    if (!hasVerifiedCover && product.status !== "DRAFT") verificationFailures.push(`${group.sku}: chưa có ảnh R2 nhưng không ở trạng thái nháp`);
    if (product.categoryId !== category.id) verificationFailures.push(`${group.sku}: sai danh mục`);
    if (Number(product.stockKg) !== group.totalKg) verificationFailures.push(`${group.sku}: tồn ${product.stockKg} kg, kỳ vọng ${group.totalKg} kg`);
    if (product.sphereItems.length !== group.rows.length) verificationFailures.push(`${group.sku}: ${product.sphereItems.length} quả, kỳ vọng ${group.rows.length}`);
    if (sumKg(product.sphereItems.map((item) => ({ weightKg: Number(item.weightKg) }))) !== group.totalKg) verificationFailures.push(`${group.sku}: tổng kg từng quả không khớp`);
    const expectedImageCount = group.rows.filter((row) => presentImages.has(row.image)).length;
    if (product.images.length !== expectedImageCount) verificationFailures.push(`${group.sku}: ${product.images.length} ảnh, kỳ vọng ${expectedImageCount} ảnh nguồn đã xác minh`);
  }
  const summary = {
    receiptNo: receipt.receiptNo,
    products: imported.length,
    active: imported.filter((product) => product.status === "ACTIVE").length,
    draftAwaitingVerifiedImage: imported.filter((product) => product.status === "DRAFT").map((product) => product.sku),
    totalKg: Number(imported.reduce((sum, product) => sum + Number(product.stockKg), 0).toFixed(3)),
    images: imported.reduce((sum, product) => sum + product.images.length, 0),
    physicalSpheres: imported.reduce((sum, product) => sum + product.sphereItems.length, 0),
    verificationFailures,
    pos365Writes: syncPos,
    pos365SyncStatus: receipt.pos365SyncStatus ?? null,
    pos365SyncError: receipt.pos365SyncError ?? null,
  };
  console.log("SPHERE_IMPORT_SUMMARY " + JSON.stringify(summary));
  if (verificationFailures.length) process.exitCode = 2;
} finally {
  media.onModuleDestroy();
  pos365.onModuleDestroy();
  await prisma.$disconnect();
}
