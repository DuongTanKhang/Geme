import { PrismaService } from "../src/prisma/prisma.service.js";
import { Pos365Service } from "../src/pos365/pos365.service.js";

if (!process.argv.includes("--apply")) {
  console.log("Không ghi dữ liệu. Chạy lại với --apply để tạo một phiếu kiểm kê đồng bộ số dư hiện tại sang POS365.");
  process.exit(0);
}

const prisma = new PrismaService();
try {
  await prisma.$connect();
  const result = await new Pos365Service(prisma).syncCurrentInventory();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Không đồng bộ được tồn kho hiện tại sang POS365.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
