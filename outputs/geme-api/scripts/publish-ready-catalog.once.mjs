import fs from "node:fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/app.module.js";
import { CommerceService } from "../dist/commerce/commerce.service.js";
import { PrismaService } from "../dist/prisma/prisma.service.js";

const report = JSON.parse(fs.readFileSync("import-data/catalog-publication-readiness-20261115.json", "utf8"));
const targets = report.products.filter((product) => product.status === "DRAFT" && product.ready);
if (targets.length !== Number(report.summary.readyDraft)) throw new Error("Readiness report changed; re-run the full catalog audit before publishing.");
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const db = app.get(PrismaService);
  const commerce = app.get(CommerceService);
  const actor = await db.adminUser.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!actor) throw new Error("No active admin actor for audit log.");
  const correlationId = `catalog-publish-ready-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const activated = [];
  for (const product of targets) {
    const saved = await commerce.updateProductPublication(product.id, "ACTIVE", { id: actor.id, correlationId }, "Đăng bán: đã kiểm tra có ảnh, giá hợp lệ và tồn kho.");
    activated.push({ sku: product.sku, name: product.name, kind: product.kind, status: saved.status });
  }
  console.log(JSON.stringify({ localOnly: true, activated: activated.length, products: activated }, null, 2));
} finally {
  await app.close();
}
