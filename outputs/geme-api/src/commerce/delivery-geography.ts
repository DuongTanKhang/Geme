type HistoricDistrict = { key: string; label: string; aliases: string[] };

export const HCMC_HISTORIC_DISTRICTS: HistoricDistrict[] = [
  { key: "district-1", label: "Quận 1", aliases: ["1", "01"] },
  { key: "district-3", label: "Quận 3", aliases: ["3", "03"] },
  { key: "district-4", label: "Quận 4", aliases: ["4", "04"] },
  { key: "district-5", label: "Quận 5", aliases: ["5", "05"] },
  { key: "district-6", label: "Quận 6", aliases: ["6", "06"] },
  { key: "district-7", label: "Quận 7", aliases: ["7", "07"] },
  { key: "district-8", label: "Quận 8", aliases: ["8", "08"] },
  { key: "district-10", label: "Quận 10", aliases: ["10"] },
  { key: "district-11", label: "Quận 11", aliases: ["11"] },
  { key: "district-12", label: "Quận 12", aliases: ["12"] },
  { key: "binh-thanh", label: "Bình Thạnh", aliases: ["binh thanh"] },
  { key: "binh-tan", label: "Bình Tân", aliases: ["binh tan"] },
  { key: "go-vap", label: "Gò Vấp", aliases: ["go vap"] },
  { key: "phu-nhuan", label: "Phú Nhuận", aliases: ["phu nhuan"] },
  { key: "tan-binh", label: "Tân Bình", aliases: ["tan binh"] },
  { key: "tan-phu", label: "Tân Phú", aliases: ["tan phu"] },
  { key: "thu-duc", label: "TP. Thủ Đức", aliases: ["thu duc"] },
  { key: "binh-chanh", label: "Bình Chánh", aliases: ["binh chanh"] },
  { key: "can-gio", label: "Cần Giờ", aliases: ["can gio"] },
  { key: "cu-chi", label: "Củ Chi", aliases: ["cu chi"] },
  { key: "hoc-mon", label: "Hóc Môn", aliases: ["hoc mon"] },
  { key: "nha-be", label: "Nhà Bè", aliases: ["nha be"] },
];

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[đĐ]/g, "d")
  .toLocaleLowerCase("vi")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const titleCase = (value: string) => value
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("vi")
  .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase("vi"));

export type ParsedDeliveryArea = {
  isHcmc: boolean;
  districtKey: string;
  districtLabel: string;
  wardKey: string;
  wardLabel: string;
};

export function parseHcmcDeliveryArea(addressInput: unknown): ParsedDeliveryArea {
  const address = String(addressInput || "").trim();
  const normalized = normalize(address);
  const isHcmc = /(?:^|\s)(?:tp|thanh pho) ho chi minh(?: city)?(?:$|\s)|(?:^|\s)ho chi minh(?: city)?(?:$|\s)|(?:^|\s)(?:tp\s*)?hcmc?(?:$|\s)|(?:^|\s)sai gon(?:$|\s)/.test(normalized);
  if (!isHcmc) return { isHcmc: false, districtKey: "outside-hcmc", districtLabel: "Ngoài TP. Hồ Chí Minh / chưa xác định", wardKey: "unknown-ward", wardLabel: "Chưa rõ phường" };

  const districtMatch = normalized.match(/(?:^|\s)(?:quan|q)\s*(\d{1,2})(?:$|\s)/);
  let district = districtMatch
    ? ([2, 9].includes(Number(districtMatch[1]))
      ? HCMC_HISTORIC_DISTRICTS.find((item) => item.key === "thu-duc")
      : HCMC_HISTORIC_DISTRICTS.find((item) => item.key === `district-${Number(districtMatch[1])}`))
    : undefined;

  if (!district) {
    const names = [...HCMC_HISTORIC_DISTRICTS].filter((item) => !item.key.startsWith("district-")).sort((a, b) => b.aliases[0].length - a.aliases[0].length);
    for (const item of names) {
      const escaped = item.aliases[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = item.key === "thu-duc"
        ? new RegExp(`(?:tp|thanh pho)?\\s*${escaped}(?:$|\\s)`, "i")
        : new RegExp(`(?:quan|q|huyen|h)?\\s*${escaped}(?:$|\\s)`, "i");
      if (pattern.test(normalized)) { district = item; break; }
    }
  }

  const wardPart = address.split(/[,;\n]/).map((part) => part.trim()).find((part) => /^(?:phường|phuong|p\.?|ward)\s*/i.test(part));
  let wardLabel = "Chưa rõ phường";
  if (wardPart) {
    const match = wardPart.match(/^(?:phường|phuong|p\.?|ward)\s*(.+)$/i);
    const candidate = String(match?.[1] || "").replace(/\s+(?:quận|quan|q\.?|huyện|huyen|thành phố|thanh pho|tp\.?|tỉnh|tinh)\b.*$/i, "").trim().replace(/[.\s]+$/g, "");
    if (candidate) wardLabel = /^\d{1,3}$/.test(candidate) ? `Phường ${Number(candidate)}` : `Phường ${titleCase(candidate)}`;
  }

  return {
    isHcmc: true,
    districtKey: district?.key || "unknown-district",
    districtLabel: district?.label || "Chưa rõ quận/huyện",
    wardKey: normalize(wardLabel).replace(/\s+/g, "-") || "unknown-ward",
    wardLabel,
  };
}
