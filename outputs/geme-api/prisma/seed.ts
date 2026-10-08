import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hash } from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Thiếu DATABASE_URL.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const roots = [
    { id: "00000000-0000-4000-8000-000000000001", name: "Trang sức", slug: "trang-suc", kind: "JEWELRY" as const, sortOrder: 1 },
    { id: "00000000-0000-4000-8000-000000000002", name: "Đá quý", slug: "da-quy", kind: "GEMSTONE" as const, sortOrder: 2 },
  ];

  for (const root of roots) {
    await prisma.category.upsert({
      where: { slug: root.slug },
      update: { parentId: null, level: 1, kind: root.kind, usage: "PRODUCT_CATEGORY", pricingMode: "FIXED", sortOrder: root.sortOrder },
      create: { ...root, parentId: null, level: 1, usage: "PRODUCT_CATEGORY", pricingMode: "FIXED", status: "ACTIVE" },
    });
  }

  const categories = [
    { id: "00000000-0000-4000-8000-000000000010", name: "Nhẫn", slug: "nhan", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 1, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000011", name: "Vòng tay", slug: "vong-tay", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 2, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000012", name: "Dây chuyền", slug: "day-chuyen", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 3, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000013", name: "Hoa tai", slug: "hoa-tai", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 4, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000015", name: "Lắc tay", slug: "lac-tay", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 6, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000016", name: "Vòng cổ", slug: "vong-co", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 7, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000017", name: "Mặt dây chuyền", slug: "mat-day-chuyen", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 8, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000018", name: "Charm", slug: "charm", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 9, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000019", name: "Bộ trang sức", slug: "bo-trang-suc", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 10, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000020", name: "Nhẫn cưới", slug: "nhan-cuoi", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 11, parentSlug: "trang-suc" },
    { id: "00000000-0000-4000-8000-000000000021", name: "Vòng chuỗi đeo", slug: "vong-chuoi-deo", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 3, pricingMode: "QUALITY_AND_BEAD_SIZE" as const, sortOrder: 1, parentSlug: "vong-tay" },
    { id: "00000000-0000-4000-8000-000000000022", name: "Vòng chuỗi tay", slug: "vong-chuoi-tay", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 3, pricingMode: "QUALITY_AND_BEAD_SIZE" as const, sortOrder: 2, parentSlug: "vong-tay" },
    { id: "00000000-0000-4000-8000-000000000025", name: "Vòng chuỗi hạt", slug: "vong-chuoi-hat", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 3, pricingMode: "QUALITY_AND_BEAD_SIZE" as const, sortOrder: 3, parentSlug: "vong-tay" },
    { id: "00000000-0000-4000-8000-000000000023", name: "Kiềng đá", slug: "kieng-da", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 3, pricingMode: "QUALITY" as const, sortOrder: 4, parentSlug: "vong-tay" },
    { id: "00000000-0000-4000-8000-000000000024", name: "Vòng tay bạc", slug: "vong-tay-bac", kind: "JEWELRY" as const, usage: "PRODUCT_CATEGORY" as const, level: 3, pricingMode: "FIXED" as const, sortOrder: 5, parentSlug: "vong-tay" },
    { id: "00000000-0000-4000-8000-000000000031", name: "Mặt đá quý", slug: "mat-da", kind: "GEMSTONE" as const, usage: "PRODUCT_CATEGORY" as const, level: 2, pricingMode: "QUALITY" as const, sortOrder: 1, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000040", name: "Thạch anh tím", slug: "thach-anh-tim", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 1, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000041", name: "Moonstone", slug: "moonstone", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 2, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000042", name: "Ngọc bích", slug: "ngoc-bich", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 3, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000043", name: "Opal", slug: "opal", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 4, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000044", name: "Ruby", slug: "ruby", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 5, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000045", name: "Tourmaline", slug: "tourmaline", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 6, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000046", name: "Peridot", slug: "peridot", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 7, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000047", name: "Aquamarine", slug: "aquamarine", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 8, parentSlug: "da-quy" },
    { id: "00000000-0000-4000-8000-000000000048", name: "Topaz", slug: "topaz", kind: "GEMSTONE" as const, usage: "GEMSTONE_TYPE" as const, level: 2, pricingMode: "FIXED" as const, sortOrder: 9, parentSlug: "da-quy" },
  ];

  for (const category of categories) {
    const parent = await prisma.category.findUnique({ where: { slug: category.parentSlug }, select: { id: true } });
    if (!parent) throw new Error(`Không tìm thấy danh mục cha ${category.parentSlug}.`);
    const { id, parentSlug: _parentSlug, ...data } = category;
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { ...data, parentId: parent.id },
      create: { id, ...data, parentId: parent.id, status: "ACTIVE" },
    });
  }

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password || password.length < 12) {
    throw new Error("Để tạo admin bootstrap, cần ADMIN_EMAIL và ADMIN_PASSWORD dài ít nhất 12 ký tự.");
  }

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await hash(password, 12),
      displayName: "GEME Admin",
      role: "SUPER_ADMIN",
      isActive: true,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
