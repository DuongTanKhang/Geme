export type CatalogEditorialLayoutGroup =
  | { kind: "products"; start: number; end: number }
  | { kind: "pair"; placement: "after-4" | "after-12" | "after-18"; start: number; end: number; final?: boolean };

export function planCatalogEditorialLayout(productCount: number, availablePromos: ReadonlySet<string>): CatalogEditorialLayoutGroup[] {
  const groups: CatalogEditorialLayoutGroup[] = [];
  let ordinaryStart: number | null = null;
  let ordinaryEnd = 0;
  const addProducts = (start: number, end: number) => {
    const boundedStart = Math.max(0, Math.min(productCount, start));
    const boundedEnd = Math.max(boundedStart, Math.min(productCount, end));
    if (boundedStart === boundedEnd) return;
    if (ordinaryStart === null) ordinaryStart = boundedStart;
    ordinaryEnd = boundedEnd;
  };
  const flushProducts = () => {
    if (ordinaryStart === null) return;
    groups.push({ kind: "products", start: ordinaryStart, end: ordinaryEnd });
    ordinaryStart = null;
  };
  const addPair = (placement: "after-4" | "after-12" | "after-18", start: number, end: number, final = false) => {
    if (productCount < end || !availablePromos.has(placement)) {
      addProducts(start, Math.min(end, productCount));
      return;
    }
    flushProducts();
    groups.push({ kind: "pair", placement, start, end, ...(final ? { final: true } : {}) });
  };

  addProducts(0, 4);
  addPair("after-4", 4, 8);
  addProducts(8, 12);
  addPair("after-12", 12, 16);
  addPair("after-18", 16, 18, true);
  addProducts(18, productCount);
  flushProducts();
  return groups;
}
