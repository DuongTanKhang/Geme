import { usesPhysicalItemInventory } from "./physical-item-inventory.js";

const KG_SCALE = 1000;
const kgTotal = (items: Array<{ weightKg: unknown }>) => Math.round(items.reduce((sum, item) => sum + (Number(item.weightKg) || 0), 0) * KG_SCALE) / KG_SCALE;

export type StockHealthProduct = {
  id: string;
  kind: string;
  sku: string;
  name: string;
  stock: number;
  stockKg?: unknown;
  category?: { name?: string | null } | null;
  sphereQuality?: string | null;
  sphereStoneType?: { name?: string | null; group?: { name?: string | null } | null } | null;
  sphereItems?: Array<{ weightKg: unknown }>;
  variants?: Array<{ stock: number; stockKg?: unknown }>;
};

export type StockHealthIssue = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  stoneGroup: string;
  stoneType: string;
  quality: string;
  problems: string[];
  expectedCount: number | null;
  actualCount: number;
  expectedKg: number | null;
  actualKg: number;
};

export function findInventoryStockIssues(products: StockHealthProduct[]): StockHealthIssue[] {
  const issues: StockHealthIssue[] = [];
  for (const product of products) {
    const physical = product.kind === "OTHER" && usesPhysicalItemInventory(product);
    const items = product.sphereItems || [];
    const variants = product.variants || [];
    const problems: string[] = [];
    let expectedCount: number | null = null;
    let expectedKg: number | null = null;
    let actualCount = Number(product.stock) || 0;
    let actualKg = Number(product.stockKg) || 0;

    if (variants.length) {
      expectedCount = variants.reduce((sum, item) => sum + (Number(item.stock) || 0), 0);
      if (actualCount !== expectedCount) problems.push("Tồn tổng không bằng tổng tồn biến thể.");
      if (physical) {
        expectedKg = Math.round(variants.reduce((sum, item) => sum + (Number(item.stockKg) || 0), 0) * KG_SCALE) / KG_SCALE;
        if (Math.abs(actualKg - expectedKg) >= 0.0005) problems.push("Tổng kg không bằng tổng kg biến thể.");
      }
    } else if (physical) {
      expectedCount = items.length;
      expectedKg = kgTotal(items);
      if (actualCount !== expectedCount) problems.push("Số lượng không bằng số món còn khả dụng.");
      if (Math.abs(actualKg - expectedKg) >= 0.0005) problems.push("Tổng kg không bằng tổng kg từng món.");
      if (items.some((item) => !(Number(item.weightKg) > 0))) problems.push("Có món còn tồn nhưng kg không hợp lệ.");
    }

    if (!problems.length) continue;
    issues.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category?.name || "Chưa phân danh mục",
      stoneGroup: product.sphereStoneType?.group?.name || "",
      stoneType: product.sphereStoneType?.name || "",
      quality: product.sphereQuality || "",
      problems,
      expectedCount,
      actualCount,
      expectedKg,
      actualKg,
    });
  }
  return issues;
}

export function sumSphereWeights(items: Array<{ weightKg: number }>) {
  return Math.round(items.reduce((sum, item) => sum + item.weightKg, 0) * KG_SCALE) / KG_SCALE;
}

export function availableSphereWeight(items: Array<{ weightKg: unknown }>) {
  return kgTotal(items);
}

export function physicalSphereInventoryMatches(product: { stock?: unknown; stockKg?: unknown; sphereItems?: Array<{ weightKg: unknown }> }) {
  return Number(product.stock) === (product.sphereItems || []).length
    && Math.abs((Number(product.stockKg) || 0) - availableSphereWeight(product.sphereItems || [])) < 0.0005;
}

export function weightedProductPublicationIssue(product: {
  stock?: unknown;
  stockKg?: unknown;
  sphereItems?: Array<{ label?: string | null; weightKg: unknown; price: unknown; imageUrls?: string[]; status?: unknown }>;
}) {
  const available = (product.sphereItems || []).filter((item) => String(item.status || "AVAILABLE") === "AVAILABLE");
  if (!available.length) return "chưa có món nào còn hàng.";
  const inventoryKg = availableSphereWeight(available);
  if (Number(product.stock) !== available.length || Math.abs((Number(product.stockKg) || 0) - inventoryKg) >= 0.0005) {
    return "tồn số lượng hoặc tổng kg chưa khớp danh sách từng món.";
  }
  const missingWeight = available.filter((item) => !(Number(item.weightKg) > 0));
  if (missingWeight.length) return `${missingWeight.length} món chưa có khối lượng hợp lệ.`;
  const missingPrice = available.filter((item) => !(Number(item.price) > 0));
  if (missingPrice.length) return `${missingPrice.length} món chưa có giá bán.`;
  const missingImage = available.filter((item) => !Array.isArray(item.imageUrls) || item.imageUrls.length === 0);
  if (missingImage.length) return `${missingImage.length} món chưa có ảnh.`;
  return null;
}
