const JEWELRY_SCOPE = "Trang sức";
const GEMSTONE_SCOPE = "Đá quý";

export type MaterialScope = typeof JEWELRY_SCOPE | typeof GEMSTONE_SCOPE;
export type MaterialOptionKind = "STONE";
export type MaterialOption = {
  id: string;
  name: string;
  scope: MaterialScope;
  kind: MaterialOptionKind;
  active: boolean;
  dependentProductCount?: number;
  imageUrl?: string;
  sortOrder?: number;
  appliedCategoryIds?: string[];
};
export type MaterialMutationValue = Partial<Omit<MaterialOption, "id" | "imageUrl">> & { imageUrl?: string | null };
export type MaterialSyncStatus = "connecting" | "connected" | "offline";

export const DEFAULT_MATERIALS: MaterialOption[] = [];

export function normalizeMaterialOptions(options: unknown): MaterialOption[] {
  if (!Array.isArray(options)) return DEFAULT_MATERIALS;
  return options.map((raw, index) => {
    const item = raw as Partial<Omit<MaterialOption, "scope">> & { kind?: string; scope?: string };
    const scope: MaterialScope = item.scope === GEMSTONE_SCOPE || item.scope === "GEMSTONE" ? GEMSTONE_SCOPE : JEWELRY_SCOPE;
    return {
      id: String(item.id ?? `MAT-${scope === JEWELRY_SCOPE ? "J" : "G"}-${index + 1}`),
      name: String(item.name ?? ""),
      scope,
      kind: "STONE" as const,
      active: item.active !== false,
      dependentProductCount: Number((item as any).dependentProductCount ?? (item as any)._count?.products) || 0,
      ...(typeof item.imageUrl === "string" ? { imageUrl: item.imageUrl } : {}),
      ...(Array.isArray(item.appliedCategoryIds) ? { appliedCategoryIds: item.appliedCategoryIds.filter((id): id is string => typeof id === "string") } : {}),
      sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : index,
    };
  }).filter((item) => item.name.trim().length > 0);
}
