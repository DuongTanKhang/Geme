/** Weighted vật phẩm tracked both as aggregate kg and individual physical items. */
export function usesPhysicalItemInventory(product: { sku?: unknown; name?: unknown; category?: { name?: unknown } | null }) {
  const sku = String(product.sku || "").trim().toUpperCase();
  const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
  const name = normalize(product.name);
  const category = normalize(product.category?.name);
  const weightedCategories = new Set([
    "soi",
    "bong",
    "tim",
    "bat tu bao",
    "mam",
    "chop ma nao",
    "nui da",
  ]);
  return /^(?:CAU|TRU|H)(?:[-\s]|$)/.test(sku)
    || name.includes("qua cau") || category.includes("qua cau")
    || /^tru(?:\s|$)/.test(name) || category === "tru"
    || name.includes("hoc") || category === "hoc"
    || ["tui tien", "trung", "kim tu thap"].includes(category)
    || weightedCategories.has(category);
}
