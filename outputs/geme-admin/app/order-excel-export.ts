type ExcelOrderLine = {
  productName?: string;
  productSku?: string;
  quality?: string | null;
  beadSize?: string | null;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  weightGrams?: number | null;
};

export type ExcelOrder = {
  id: string;
  date?: string;
  time?: string;
  placedAt?: string;
  customer?: string;
  phone?: string;
  email?: string;
  address?: string;
  salesChannel?: string;
  status?: string;
  payment?: string;
  paymentStatus?: string;
  paymentCaptured?: number;
  paymentRefunded?: number;
  paymentBalance?: number;
  subtotal?: number;
  discountAmount?: number;
  shippingFee?: number;
  total?: number;
  items?: ExcelOrderLine[];
};

type ExportFilters = {
  dateFrom?: string;
  dateTo?: string;
  channel?: string;
  status?: string;
  payment?: string;
  shipping?: string;
  search?: string;
};

export type ProductExportRow = {
  id: string;
  name: string;
  productType?: string;
  category?: string | null;
  subcategory?: string | null;
  status?: string;
  price?: number;
  stock?: number;
  stockKg?: number | null;
  priceVariants?: Array<{ sku?: string | null; quality?: string; shape?: string | null; beadSize?: string; carat?: number | string | null; gemstoneQuality?: string | null; price?: number; stock?: number }>;
  sphereQuality?: string | null;
  sphereItems?: Array<{ id?: string; label?: string | null; weightKg?: number | string | null; price?: number | string | null; status?: string | null }>;
  gallery?: string[];
  image?: string;
};

export type InventoryExportRow = {
  id: string;
  sku: string;
  name: string;
  kind: "JEWELRY" | "GEMSTONE" | "OTHER";
  category?: { id?: string; name?: string } | null;
  status?: string;
  stock: number;
  stockKg?: number | string | null;
  availableStock?: number;
  availableStockKg?: number | string | null;
  reservedStock?: number;
  reservedStockKg?: number | string | null;
  onHandStock?: number;
  onHandStockKg?: number | string | null;
  minimumStock?: number;
  soldThisMonth?: number;
  price?: number | string | null;
  sphereQuality?: string | null;
  sphereStoneType?: { id?: string; name?: string; group?: { id?: string; name?: string } | null } | null;
  sphereItems?: Array<{ id?: string; label?: string | null; weightKg: number | string; price?: number | string | null; status?: string; sortOrder?: number }>;
  variants?: Array<{ id?: string; sku?: string | null; shape?: string | null; quality: string; beadSize?: string | null; carat?: number | string | null; gemstoneQuality?: string | null; price?: number | string | null; stock: number; stockKg?: number | string | null }>;
  materialOption?: { name?: string; kind?: string } | null;
  gemstoneType?: { name?: string } | null;
  isWeightBased?: boolean;
};

type ProductExportFilters = { catalogKind?: string; category?: string; stoneType?: string; status?: string; search?: string };
type InventoryExportFilters = { category?: string; kind?: string; stoneType?: string; status?: string; search?: string };

type Cell = string | number | null | { formula: string; value: number };
type SheetData = {
  name: string;
  rows: Cell[][];
  widths: number[];
  rowHeights?: Record<number, number>;
  merges?: string[];
  autoFilter?: string;
  frozenRows?: number;
  cellStyles?: Record<string, number>;
  rowStyles?: Record<number, number>;
};

const xmlEscape = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

function colName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function excelDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25569;
}

function fallbackExcelDate(value?: string) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / 86_400_000 + 25569 : null;
}

function humanDate(value?: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Tất cả";
}

function paymentLabel(value?: string) {
  const labels: Record<string, string> = {
    BANK_TRANSFER: "Chuyển khoản",
    COD: "COD",
    MOMO: "MoMo",
    CREDIT_CARD: "Thẻ ngân hàng",
    OTHER: "Khác",
    CASH: "Tiền mặt",
    "Tiền mặt tại quầy": "Tiền mặt tại quầy",
    "QR tại cửa hàng": "QR tại cửa hàng",
    "COD (thu khi giao)": "COD",
  };
  return labels[String(value || "")] || String(value || "Chưa xác định").replaceAll("_", " ");
}

function paymentStatusLabel(value?: string) {
  const labels: Record<string, string> = {
    PAID: "Đã thanh toán",
    PENDING: "Chờ thanh toán",
    PARTIALLY_PAID: "Thanh toán một phần",
    REFUNDED: "Đã hoàn tiền",
    PARTIALLY_REFUNDED: "Hoàn tiền một phần",
    FAILED: "Thanh toán lỗi",
  };
  return labels[String(value || "")] || String(value || "Chưa xác định");
}

function orderProductSummary(order: ExcelOrder) {
  return (order.items || []).map(item => {
    const variant = [item.quality, item.beadSize].filter(Boolean).join(" · ");
    return [item.productSku, item.productName || "Sản phẩm", variant, `× ${Number(item.quantity) || 0}`].filter(Boolean).join(" · ");
  }).join("; ") || "—";
}

function orderCreatedLabel(order: ExcelOrder) {
  const time = String(order.time || "").trim();
  return [order.date || "", time].filter(Boolean).join(" ") || "—";
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = crc32(content);
    const local = new Uint8Array(30 + name.length + content.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, content.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(content, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, content.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralLength = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralLength, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  const allParts = [...localParts, ...centralParts, end];
  const totalLength = allParts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of allParts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function cellXml(address: string, value: Cell, styleId = 0) {
  const style = styleId ? ` s="${styleId}"` : "";
  if (value == null || value === "") return `<c r="${address}"${style}/>`;
  if (typeof value === "object") return `<c r="${address}"${style}><f>${xmlEscape(value.formula)}</f><v>${value.value}</v></c>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${address}"${style}><v>${value}</v></c>`;
  return `<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetData) {
  const maxColumns = Math.max(...sheet.rows.map(row => row.length));
  const end = `${colName(maxColumns - 1)}${sheet.rows.length}`;
  const cols = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rowsXml = sheet.rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const height = sheet.rowHeights?.[rowNumber];
    const rowHeight = height ? ` ht="${height}" customHeight="1"` : "";
    const cells = row.map((value, colIndex) => {
      const address = `${colName(colIndex)}${rowNumber}`;
      const style = sheet.cellStyles?.[address] ?? sheet.rowStyles?.[rowNumber] ?? 0;
      return cellXml(address, value, style);
    }).join("");
    return `<row r="${rowNumber}"${rowHeight}>${cells}</row>`;
  }).join("");
  const freeze = sheet.frozenRows ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.frozenRows}" topLeftCell="A${sheet.frozenRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.frozenRows + 1}" sqref="A${sheet.frozenRows + 1}"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const autoFilter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : "";
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/>${freeze}<sheetFormatPr defaultRowHeight="22"/><cols>${cols}</cols><sheetData>${rowsXml}</sheetData>${autoFilter}${merges}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function xlsxFiles(sheets: SheetData[]) {
  const contentOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const worksheetFiles = sheets.map((sheet, index) => ({ path: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet) }));
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0 &quot;₫&quot;"/><numFmt numFmtId="165" formatCode="0.000&quot; kg&quot;"/></numFmts><fonts count="6"><font><sz val="10"/><name val="Arial"/><color rgb="FF26332F"/></font><font><b/><sz val="16"/><name val="Arial"/><color rgb="FF0F4B3F"/></font><font><i/><sz val="10"/><name val="Arial"/><color rgb="FFB38A4A"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FF0F4B3F"/></font><font><b/><sz val="15"/><name val="Arial"/><color rgb="FF26332F"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFFFFFF"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F2EF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F1E8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F4B3F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1D6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4F2E9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE8E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E2DD"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FFB38A4A"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="17"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="4" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return [
    { path: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentOverrides}</Types>` },
    { path: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { path: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>` },
    { path: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { path: "xl/styles.xml", content: styles.replace('<cellXfs count="17">', '<cellXfs count="19">').replace('</cellXfs>', '<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>') },
    ...worksheetFiles,
  ];
}

function statusStyle(status: string | undefined, stripe: number) {
  if (status === "Đang hoạt động" || status === "Còn hàng") return 13;
  if (status === "Hết hàng" || status === "Đã hủy") return 14;
  if (status === "Tạm ẩn" || status === "Bản nháp" || status === "Sắp hết") return 12;
  return stripe;
}

function priceVariantLabel(variant: NonNullable<ProductExportRow["priceVariants"]>[number]) {
  return [variant.shape, variant.quality, variant.beadSize ? `${variant.beadSize} mm` : null, variant.carat != null ? `${variant.carat} ct` : null, variant.gemstoneQuality ? `Chất lượng ${variant.gemstoneQuality}` : null].filter(Boolean).join(" · ") || "Tiêu chuẩn";
}

function inventoryKindLabel(kind: InventoryExportRow["kind"]) {
  return kind === "GEMSTONE" ? "Đá quý" : kind === "OTHER" ? "Vật phẩm" : "Trang sức";
}

function inventoryStoneLabel(product: InventoryExportRow) {
  return product.kind === "GEMSTONE"
    ? product.gemstoneType?.name || product.materialOption?.name || ""
    : product.sphereStoneType?.name || (product.materialOption?.kind === "STONE" ? product.materialOption.name : "");
}

function inventoryStatusLabel(status?: string) {
  const labels: Record<string, string> = { AVAILABLE: "Còn hàng", RESERVED: "Đang giữ", SOLD: "Đã bán", INACTIVE: "Không hoạt động" };
  return labels[String(status || "").toUpperCase()] || status || "Chưa xác định";
}

function reportFilterNote(filters: Record<string, string | undefined>) {
  const active = Object.entries(filters).filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}: ${value}`);
  return active.length ? `Bộ lọc: ${active.join(" · ")}` : "Bộ lọc: Tất cả";
}

function createProductReportSheets(products: ProductExportRow[], filters: ProductExportFilters): SheetData[] {
  const categories = new Map<string, { count: number; kg: number; kgCount: number }>();
  for (const product of products) {
    const key = product.category || "Chưa phân loại";
    const current = categories.get(key) || { count: 0, kg: 0, kgCount: 0 };
    current.count += 1;
    if (product.stockKg != null) {
      current.kg += Number(product.stockKg) || 0;
      current.kgCount += 1;
    }
    categories.set(key, current);
  }
  const activeCount = products.filter(product => product.status === "Đang hoạt động").length;
  const hiddenCount = products.filter(product => product.status === "Tạm ẩn").length;
  const draftCount = products.filter(product => product.status === "Bản nháp").length;
  const titleSuffix = filters.catalogKind ? ` · ${filters.catalogKind}` : "";
  const summaryRows: Cell[][] = Array.from({ length: Math.max(15, 9 + categories.size) }, () => Array<Cell>(8).fill(null));
  summaryRows[0][0] = "BÁO CÁO SẢN PHẨM";
  summaryRows[1][0] = `Mẫu áp dụng cho danh sách đang xem${titleSuffix} · ${products.length} sản phẩm`;
  summaryRows[3][0] = "Tổng sản phẩm"; summaryRows[3][2] = "Đang hoạt động"; summaryRows[3][4] = "Tạm ẩn"; summaryRows[3][6] = "Bản nháp";
  summaryRows[4][0] = products.length; summaryRows[4][2] = activeCount; summaryRows[4][4] = hiddenCount; summaryRows[4][6] = draftCount;
  summaryRows[7][0] = "Danh mục"; summaryRows[7][1] = "Sản phẩm"; summaryRows[7][2] = "Tổng kg";
  summaryRows[7][4] = "Trạng thái"; summaryRows[7][5] = "Sản phẩm"; summaryRows[7][6] = "Ghi chú";
  [...categories.entries()].forEach(([category, data], index) => { const row = 8 + index; summaryRows[row][0] = category; summaryRows[row][1] = data.count; summaryRows[row][2] = data.kgCount ? data.kg : null; });
  [["Đang hoạt động", activeCount, "Hiển thị trên website"], ["Tạm ẩn", hiddenCount, "Ẩn khỏi storefront"], ["Bản nháp", draftCount, "Chưa đăng bán"]].forEach((values, index) => { const row = 8 + index; summaryRows[row][4] = values[0]; summaryRows[row][5] = values[1]; summaryRows[row][6] = values[2]; });
  const filterNoteRow = Math.max(15, 10 + categories.size);
  while (summaryRows.length < filterNoteRow) summaryRows.push(Array<Cell>(8).fill(null));
  summaryRows[filterNoteRow - 1][0] = reportFilterNote({ Danh_mục: filters.category, Loại_đá: filters.stoneType, Trạng_thái: filters.status, Từ_khóa: filters.search });
  const summaryStyles: Record<string, number> = { A1: 1, A2: 2, A4: 3, C4: 3, E4: 3, G4: 3, A5: 4, C5: 4, E5: 4, G5: 4, A8: 5, B8: 5, C8: 5, E8: 5, F8: 5, G8: 5, [`A${filterNoteRow}`]: 2 };
  for (let index = 0; index < Math.max(categories.size, 3); index += 1) for (const col of ["A", "B", "C", "E", "F", "G"]) summaryStyles[`${col}${9 + index}`] = index % 2 ? 6 : 7;
  for (let index = 0; index < categories.size; index += 1) summaryStyles[`C${9 + index}`] = index % 2 ? 16 : 15;

  const productHeaders = ["Mã SKU", "Tên sản phẩm", "Ngành hàng", "Danh mục", "Loại đá / chất liệu", "Trạng thái", "Giá cha (₫)", "Tồn (món/cái)", "Tồn (kg)", "Số biến thể", "Số ảnh"];
  const productRows: Cell[][] = products.map(product => [
    product.id, product.name, product.productType || "—", product.category || "—", product.subcategory || "—", product.status || "Chưa xác định", Number(product.price) || 0, Number(product.stock) || 0, product.stockKg == null ? null : Number(product.stockKg), (product.priceVariants || []).length || (product.sphereItems || []).length, (product.gallery || []).length || (product.image ? 1 : 0),
  ]);
  const productDataRows: Cell[][] = [productHeaders, ...productRows];
  const productStyleMap: Record<string, number> = {};
  for (let col = 0; col < productHeaders.length; col += 1) productStyleMap[`${colName(col)}4`] = 5;
  productRows.forEach((row, index) => {
    const excelRow = index + 5;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < productHeaders.length; col += 1) productStyleMap[`${colName(col)}${excelRow}`] = stripe;
    productStyleMap[`F${excelRow}`] = statusStyle(String(row[5] || ""), stripe);
    productStyleMap[`G${excelRow}`] = index % 2 ? 9 : 8;
    if (row[8] != null) productStyleMap[`I${excelRow}`] = index % 2 ? 16 : 15;
  });
  const productSheetRows: Cell[][] = [["DANH SÁCH SẢN PHẨM", null, null, null, null, null, null, null, null, null, null], [reportFilterNote({ Ngành_hàng: filters.catalogKind, Danh_mục: filters.category, Loại_đá: filters.stoneType, Trạng_thái: filters.status, Từ_khóa: filters.search }), null, null, null, null, null, null, null, null, null, null], Array<Cell>(11).fill(null), ...productDataRows];

  const variantHeaders = ["SKU sản phẩm", "Tên sản phẩm", "Ngành hàng", "Danh mục", "Phân loại / biến thể", "Mã / tên món hoặc biến thể", "Giá từng lựa chọn (₫)", "Tồn (món/cái)", "Khối lượng từng món (kg)", "Trạng thái giá / tồn", "Trạng thái sản phẩm"];
  const variantRows: Cell[][] = [];
  for (const product of products) {
    const sphereItems = product.sphereItems || [];
    if (sphereItems.length) {
      sphereItems.forEach((item, index) => variantRows.push([
        product.id, product.name, product.productType || "Vật phẩm", product.category || "—", `${product.sphereQuality || "Chất lượng chưa gán"} · ${item.label || `Món ${index + 1}`}`, item.label || `Món ${index + 1}`, Number(item.price) > 0 ? Number(item.price) : null, 1, item.weightKg == null ? null : Number(item.weightKg), Number(item.price) > 0 ? "Đã có giá riêng" : "Chưa có giá riêng", product.status || "—",
      ]));
      continue;
    }
    // Physical quality SKUs keep their parent price at zero. Never export that parent value
    // as an individual item's sale price when the item records are not present in this payload.
    if (product.sphereQuality) {
      variantRows.push([product.id, product.name, product.productType || "Vật phẩm", product.category || "—", product.sphereQuality, "Chưa tải danh sách từng món", null, Number(product.stock) || 0, null, "Chưa có dữ liệu giá từng món", product.status || "—"]);
      continue;
    }
    const priceVariants = product.priceVariants || [];
    if (priceVariants.length) {
      priceVariants.forEach(variant => variantRows.push([
        product.id, product.name, product.productType || "—", product.category || "—", priceVariantLabel(variant), variant.sku || "—", Number(variant.price) > 0 ? Number(variant.price) : null, Number(variant.stock) || 0, null, Number(variant.price) > 0 ? "Đã có giá" : "Chưa có giá", product.status || "—",
      ]));
    } else {
      variantRows.push([product.id, product.name, product.productType || "—", product.category || "—", "Giá hồ sơ", "—", Number(product.price) || 0, Number(product.stock) || 0, product.stockKg == null ? null : Number(product.stockKg), "Đã có giá hồ sơ", product.status || "—"]);
    }
  }
  const variantStyles: Record<string, number> = { A1: 1, A2: 2 };
  for (let col = 0; col < variantHeaders.length; col += 1) variantStyles[`${colName(col)}4`] = 5;
  variantRows.forEach((row, index) => {
    const excelRow = index + 5;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < variantHeaders.length; col += 1) variantStyles[`${colName(col)}${excelRow}`] = stripe;
    variantStyles[`G${excelRow}`] = index % 2 ? 9 : 8;
    if (row[8] != null) variantStyles[`I${excelRow}`] = index % 2 ? 16 : 15;
    variantStyles[`J${excelRow}`] = String(row[9] || "").startsWith("Chưa") ? 12 : stripe;
    variantStyles[`K${excelRow}`] = statusStyle(String(row[10] || ""), stripe);
  });
  const variantSheetRows: Cell[][] = [["BIẾN THỂ VÀ GIÁ", null, null, null, null, null, null, null, null, null, null], ["Giá Vật Phẩm lấy đúng từ giá từng món; nếu thiếu dữ liệu món thì để trống và ghi rõ, không lấy giá cha thay thế.", null, null, null, null, null, null, null, null, null, null], Array<Cell>(11).fill(null), variantHeaders, ...variantRows];
  return [
    { name: "Tổng quan", rows: summaryRows, widths: [22, 14, 22, 4, 22, 14, 25, 4], rowHeights: { 1: 30, 2: 22, 4: 26, 5: 36, 8: 26 }, merges: ["A4:B4", "C4:D4", "E4:F4", "G4:H4", "A5:B5", "C5:D5", "E5:F5", "G5:H5", `A${filterNoteRow}:H${filterNoteRow}`], cellStyles: summaryStyles },
    { name: "Sản phẩm", rows: productSheetRows, widths: [18, 40, 16, 18, 24, 18, 18, 17, 18, 16, 12], rowHeights: { 1: 30, 2: 22, 4: 34 }, cellStyles: productStyleMap, autoFilter: `A4:K${Math.max(4 + products.length, 4)}`, frozenRows: 4 },
    { name: "Biến thể và giá", rows: variantSheetRows, widths: [18, 40, 16, 18, 36, 25, 24, 17, 22, 24, 18], rowHeights: { 1: 30, 2: 22, 4: 36 }, cellStyles: variantStyles, autoFilter: `A4:K${Math.max(4 + variantRows.length, 4)}`, frozenRows: 4 },
  ];
}

function createInventoryReportSheets(products: InventoryExportRow[], filters: InventoryExportFilters): SheetData[] {
  const weighted = products.filter(product => product.kind === "OTHER" && product.isWeightBased);
  const availableProducts = products.filter(product => (Number(product.availableStock ?? product.stock) || 0) > 0);
  const outProducts = products.filter(product => (Number(product.stock) || 0) <= 0 || (product.isWeightBased && (Number(product.stockKg) || 0) <= 0));
  const categoryMap = new Map<string, InventoryExportRow[]>();
  products.forEach(product => {
    const category = product.category?.name || "Chưa phân loại";
    categoryMap.set(category, [...(categoryMap.get(category) || []), product]);
  });
  const availableKg = weighted.reduce((sum, product) => sum + Number(product.availableStockKg ?? product.stockKg ?? 0), 0);
  const summaryRows: Cell[][] = Array.from({ length: Math.max(15, 9 + categoryMap.size) }, () => Array<Cell>(8).fill(null));
  summaryRows[0][0] = "BÁO CÁO TỒN KHO";
  summaryRows[1][0] = `Theo bộ lọc hiện tại · ${products.length} SKU · Vật Phẩm theo kg có bảng phân cấp riêng`;
  summaryRows[3][0] = "Tổng SKU"; summaryRows[3][2] = "Còn hàng"; summaryRows[3][4] = "Hết hàng"; summaryRows[3][6] = "Tồn Vật Phẩm (kg)";
  summaryRows[4][0] = products.length; summaryRows[4][2] = availableProducts.length; summaryRows[4][4] = outProducts.length; summaryRows[4][6] = availableKg;
  summaryRows[7][0] = "Danh mục"; summaryRows[7][1] = "SKU"; summaryRows[7][2] = "Khả dụng (cái)"; summaryRows[7][3] = "Khả dụng (kg)";
  summaryRows[7][5] = "Kiểm tra Vật Phẩm"; summaryRows[7][6] = "Số lượng"; summaryRows[7][7] = "Ghi chú";
  [...categoryMap.entries()].forEach(([category, rows], index) => {
    const row = 8 + index;
    summaryRows[row][0] = category;
    summaryRows[row][1] = rows.length;
    summaryRows[row][2] = rows.filter(product => !product.isWeightBased).reduce((sum, product) => sum + Number(product.availableStock ?? product.stock ?? 0), 0);
    summaryRows[row][3] = rows.filter(product => product.isWeightBased).reduce((sum, product) => sum + Number(product.availableStockKg ?? product.stockKg ?? 0), 0);
  });
  const listedPieces = weighted.flatMap(product => product.sphereItems || []);
  const pricedPieces = listedPieces.filter(item => Number(item.price) > 0).length;
  [
    ["SKU theo kg", weighted.length, "SKU"],
    ["Món khả dụng", weighted.reduce((sum, product) => sum + Number(product.availableStock ?? product.stock ?? 0), 0), "món"],
    ["Món đã có giá", pricedPieces, "món"],
    ["Món thiếu giá", listedPieces.length - pricedPieces, "món"],
  ].forEach((rowValues, index) => { const row = 8 + index; summaryRows[row][5] = rowValues[0]; summaryRows[row][6] = rowValues[1]; summaryRows[row][7] = rowValues[2]; });
  const filterRow = Math.max(15, 10 + categoryMap.size);
  while (summaryRows.length < filterRow) summaryRows.push(Array<Cell>(8).fill(null));
  summaryRows[filterRow - 1][0] = reportFilterNote({ Nhóm: filters.kind, Danh_mục: filters.category, Loại_đá: filters.stoneType, Trạng_thái: filters.status, Từ_khóa: filters.search });
  const summaryStyles: Record<string, number> = { A1: 1, A2: 2, A4: 3, C4: 3, E4: 3, G4: 3, A5: 4, C5: 4, E5: 4, G5: 17, [`A${filterRow}`]: 2 };
  for (const col of ["A", "B", "C", "D", "F", "G", "H"]) summaryStyles[`${col}8`] = 5;
  for (let index = 0; index < Math.max(categoryMap.size, 3); index += 1) for (const col of ["A", "B", "C", "D", "F", "G", "H"]) summaryStyles[`${col}${9 + index}`] = index % 2 ? 6 : 7;
  for (let index = 0; index < categoryMap.size; index += 1) {
    const row = 9 + index;
    if ([...categoryMap.values()][index]?.some(product => product.isWeightBased)) summaryStyles[`D${row}`] = index % 2 ? 16 : 15;
  }
  for (let row = 9; row <= 12; row += 1) for (const col of ["F", "G", "H"]) summaryStyles[`${col}${row}`] = row % 2 ? 7 : 6;
  summaryStyles.H11 = 7; summaryStyles.H12 = 7;

  const stockHeaders = ["Sản phẩm", "SKU", "Nhóm", "Danh mục", "Nhóm đá", "Loại đá", "Chất lượng", "Khả dụng (món/cái)", "Đang giữ (món/cái)", "Tồn thực (món/cái)", "Khả dụng (kg)", "Đang giữ (kg)", "Tồn thực (kg)", "Giá cha (₫)", "Trạng thái"];
  const stockData: Cell[][] = products.map(product => [
    product.name, product.sku, inventoryKindLabel(product.kind), product.category?.name || "—", product.sphereStoneType?.group?.name || "—", inventoryStoneLabel(product) || "—", product.sphereQuality || "—",
    Number(product.availableStock ?? product.stock) || 0, Number(product.reservedStock) || 0, Number(product.onHandStock ?? product.stock) || 0,
    product.isWeightBased ? Number(product.availableStockKg ?? product.stockKg) || 0 : null, product.isWeightBased ? Number(product.reservedStockKg) || 0 : null, product.isWeightBased ? Number(product.onHandStockKg ?? product.stockKg) || 0 : null,
    Number(product.price) || 0, product.status || "—",
  ]);
  const stockStyles: Record<string, number> = {};
  for (let col = 0; col < stockHeaders.length; col += 1) stockStyles[`${colName(col)}4`] = 5;
  stockData.forEach((row, index) => {
    const excelRow = index + 5; const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < stockHeaders.length; col += 1) stockStyles[`${colName(col)}${excelRow}`] = stripe;
    stockStyles[`N${excelRow}`] = index % 2 ? 9 : 8;
    stockStyles[`O${excelRow}`] = statusStyle(String(row[14] || ""), stripe);
    for (const col of ["K", "L", "M"]) if (row[10 + ["K", "L", "M"].indexOf(col)] != null) stockStyles[`${col}${excelRow}`] = index % 2 ? 16 : 15;
  });
  const stockSheetRows: Cell[][] = [["TỒN KHO SẢN PHẨM", ...Array<Cell>(14).fill(null)], [reportFilterNote({ Nhóm: filters.kind, Danh_mục: filters.category, Loại_đá: filters.stoneType, Trạng_thái: filters.status, Từ_khóa: filters.search }), ...Array<Cell>(14).fill(null)], Array<Cell>(15).fill(null), stockHeaders, ...stockData];

  type PhysicalGroup = { category: string; stoneGroup: string; stoneType: string; products: InventoryExportRow[] };
  const groupMap = new Map<string, PhysicalGroup>();
  weighted.forEach(product => {
    const category = product.category?.name || "Vật phẩm chưa phân danh mục";
    const stoneGroup = product.sphereStoneType?.group?.name || "Nhóm đá chưa xác định";
    const stoneType = product.sphereStoneType?.name || inventoryStoneLabel(product) || "Loại đá chưa xác định";
    const key = `${category}\u0000${stoneGroup}\u0000${stoneType}`;
    const group = groupMap.get(key) || { category, stoneGroup, stoneType, products: [] };
    group.products.push(product); groupMap.set(key, group);
  });
  const hierarchyRows: Cell[][] = [];
  const hierarchyMeta: Array<{ level: string; kg: number; count: number }> = [];
  const addLevelRow = (level: string, category: string, stoneGroup: string, stoneType: string, quality: string, sku: string, rows: InventoryExportRow[]) => {
    const pieces = rows.reduce((sum, product) => sum + Number(product.availableStock ?? product.stock ?? 0), 0);
    const kg = rows.reduce((sum, product) => sum + Number(product.availableStockKg ?? product.stockKg ?? 0), 0);
    const onHand = rows.reduce((sum, product) => sum + Number(product.onHandStockKg ?? product.stockKg ?? 0), 0);
    hierarchyRows.push([level, category, stoneGroup, stoneType, quality, sku, pieces, kg, onHand]);
    hierarchyMeta.push({ level, kg, count: pieces });
  };
  const categories = new Map<string, PhysicalGroup[]>();
  [...groupMap.values()].forEach(group => categories.set(group.category, [...(categories.get(group.category) || []), group]));
  for (const [category, groups] of categories) {
    const categoryProducts = groups.flatMap(group => group.products);
    addLevelRow("Danh mục", category, "", "", "", "", categoryProducts);
    const stones = new Map<string, PhysicalGroup[]>();
    groups.forEach(group => stones.set(group.stoneGroup, [...(stones.get(group.stoneGroup) || []), group]));
    for (const [stoneGroup, types] of stones) {
      const groupProducts = types.flatMap(group => group.products);
      addLevelRow("Nhóm đá", category, stoneGroup, "", "", "", groupProducts);
      for (const group of types) {
        addLevelRow("Loại đá", category, stoneGroup, group.stoneType, "", "", group.products);
        for (const product of group.products) addLevelRow("Chất lượng SKU", category, stoneGroup, group.stoneType, product.sphereQuality || "Chất lượng chưa gán", product.sku, [product]);
      }
    }
  }
  const hierarchyHeaders = ["Cấp", "Danh mục", "Nhóm đá", "Loại đá", "Chất lượng", "SKU", "Số món khả dụng", "Khả dụng (kg)", "Tồn thực (kg)"];
  const hierarchyStyles: Record<string, number> = { A1: 1, A2: 2 };
  hierarchyRows.forEach((row, index) => {
    const excelRow = index + 5; const level = hierarchyMeta[index].level;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < hierarchyHeaders.length; col += 1) hierarchyStyles[`${colName(col)}${excelRow}`] = stripe;
    if (level === "Danh mục") for (let col = 0; col < hierarchyHeaders.length; col += 1) hierarchyStyles[`${colName(col)}${excelRow}`] = 13;
    else if (level === "Nhóm đá" || level === "Loại đá") for (let col = 0; col < hierarchyHeaders.length; col += 1) hierarchyStyles[`${colName(col)}${excelRow}`] = 6;
    hierarchyStyles[`H${excelRow}`] = index % 2 ? 16 : 15;
    hierarchyStyles[`I${excelRow}`] = index % 2 ? 16 : 15;
  });
  hierarchyHeaders.forEach((_, col) => hierarchyStyles[`${colName(col)}4`] = 5);
  const hierarchySheetRows: Cell[][] = [["VẬT PHẨM THEO CẤP TỒN KHO", null, null, null, null, null, null, null, null], ["Danh mục → nhóm đá → loại đá → chất lượng SKU · Tổng khả dụng kg cộng từ món khả dụng", null, null, null, null, null, null, null, null], Array<Cell>(9).fill(null), hierarchyHeaders, ...hierarchyRows];

  const pieceHeaders = ["Danh mục", "Nhóm đá", "Loại đá", "Chất lượng", "SKU chất lượng", "Mã / tên món", "Khối lượng món (kg)", "Giá bán món (₫)", "Tình trạng giá", "Trạng thái món", "Tính trong khả dụng", "Tính trong tồn thực"];
  const pieceRows: Cell[][] = [];
  const pieceStatusStyles: Record<number, number> = {};
  for (const product of weighted) {
    const category = product.category?.name || "Vật phẩm chưa phân danh mục";
    const stoneGroup = product.sphereStoneType?.group?.name || "Nhóm đá chưa xác định";
    const stoneType = product.sphereStoneType?.name || inventoryStoneLabel(product) || "Loại đá chưa xác định";
    (product.sphereItems || []).forEach((item, index) => {
      const available = !item.status || item.status === "AVAILABLE";
      const onHand = !["SOLD", "INACTIVE"].includes(String(item.status || "").toUpperCase());
      const rowIndex = pieceRows.length;
      pieceRows.push([category, stoneGroup, stoneType, product.sphereQuality || "Chất lượng chưa gán", product.sku, item.label || `Món ${index + 1}`, Number(item.weightKg) || 0, Number(item.price) > 0 ? Number(item.price) : null, Number(item.price) > 0 ? "Đã có giá" : "Chưa có giá", inventoryStatusLabel(item.status), available ? "Có" : "Không", onHand ? "Có" : "Không"]);
      pieceStatusStyles[rowIndex] = available ? 13 : 12;
    });
  }
  const pieceStyles: Record<string, number> = { A1: 1, A2: 2 };
  pieceHeaders.forEach((_, col) => pieceStyles[`${colName(col)}4`] = 5);
  pieceRows.forEach((row, index) => {
    const excelRow = index + 5; const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < pieceHeaders.length; col += 1) pieceStyles[`${colName(col)}${excelRow}`] = stripe;
    pieceStyles[`G${excelRow}`] = index % 2 ? 16 : 15;
    if (row[7] != null) pieceStyles[`H${excelRow}`] = index % 2 ? 9 : 8;
    pieceStyles[`I${excelRow}`] = String(row[8] || "").startsWith("Chưa") ? 12 : 13;
    pieceStyles[`J${excelRow}`] = pieceStatusStyles[index] || stripe;
  });
  const pieceSheetRows: Cell[][] = [["TỪNG MÓN VẬT PHẨM", null, null, null, null, null, null, null, null, null, null, null], ["Giá bán lấy từ giá riêng của món trong hồ sơ. Ô giá trống được đánh dấu Chưa có giá; không thay bằng giá cha SKU.", null, null, null, null, null, null, null, null, null, null, null], Array<Cell>(12).fill(null), pieceHeaders, ...pieceRows];

  return [
    { name: "Tổng quan", rows: summaryRows, widths: [22, 13, 17, 19, 4, 23, 14, 22], rowHeights: { 1: 30, 2: 22, 4: 26, 5: 36, 8: 26 }, merges: ["A4:B4", "C4:D4", "E4:F4", "G4:H4", "A5:B5", "C5:D5", "E5:F5", "G5:H5", `A${filterRow}:H${filterRow}`], cellStyles: summaryStyles },
    { name: "Tồn kho", rows: stockSheetRows, widths: [36, 19, 16, 22, 22, 24, 22, 20, 20, 20, 19, 19, 19, 20, 18], rowHeights: { 1: 30, 2: 22, 4: 38 }, cellStyles: stockStyles, autoFilter: `A4:O${Math.max(4 + products.length, 4)}`, frozenRows: 4 },
    { name: "Phân cấp Vật Phẩm", rows: hierarchySheetRows, widths: [19, 22, 22, 26, 23, 20, 18, 20, 20], rowHeights: { 1: 30, 2: 22, 4: 34 }, cellStyles: hierarchyStyles, autoFilter: `A4:I${Math.max(4 + hierarchyRows.length, 4)}`, frozenRows: 4 },
    { name: "Từng món Vật Phẩm", rows: pieceSheetRows, widths: [24, 23, 26, 23, 20, 22, 22, 22, 18, 18, 19, 19], rowHeights: { 1: 30, 2: 22, 4: 38 }, cellStyles: pieceStyles, autoFilter: `A4:L${Math.max(4 + pieceRows.length, 4)}`, frozenRows: 4 },
  ];
}

function buildSheets(orders: ExcelOrder[], filters: ExportFilters): SheetData[] {
  const count = orders.length;
  const orderLastRow = Math.max(count + 4, 5);
  const groupedStatus = new Map<string, { count: number; total: number }>();
  const groupedPayment = new Map<string, { count: number; paid: number }>();
  for (const order of orders) {
    const status = order.status || "Chưa xác định";
    const statusGroup = groupedStatus.get(status) || { count: 0, total: 0 };
    statusGroup.count += 1;
    statusGroup.total += Number(order.total) || 0;
    groupedStatus.set(status, statusGroup);
    const method = paymentLabel(order.payment);
    const paymentGroup = groupedPayment.get(method) || { count: 0, paid: 0 };
    paymentGroup.count += 1;
    paymentGroup.paid += Number(order.paymentCaptured) || 0;
    groupedPayment.set(method, paymentGroup);
  }
  const statusOrder = ["Chờ thanh toán", "Chờ xác nhận", "Đang xử lý", "Đang giao", "Đã giao", "Đã hủy"];
  const statuses = [...statusOrder.filter(status => groupedStatus.has(status)), ...[...groupedStatus.keys()].filter(status => !statusOrder.includes(status))];
  const paymentMethods = [...groupedPayment.keys()].sort((a, b) => a.localeCompare(b, "vi"));
  const successfulOrders = orders.filter(order => order.status === "Đã giao");
  const total = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const paid = orders.reduce((sum, order) => sum + (Number(order.paymentCaptured) || 0), 0);
  const outstanding = orders.reduce((sum, order) => sum + Math.max(0, Number(order.paymentBalance ?? ((Number(order.total) || 0) - (Number(order.paymentCaptured) || 0))) || 0), 0);
  const from = humanDate(filters.dateFrom);
  const to = humanDate(filters.dateTo);
  const subtitle = `Dữ liệu theo bộ lọc hiện tại · ${from} – ${to} · ${count} đơn`;
  const filterNotes = [
    `Ngày: ${from} – ${to}`,
    filters.channel ? `Kênh: ${filters.channel}` : "",
    filters.status ? `Trạng thái: ${filters.status}` : "",
    filters.payment ? `Thanh toán: ${paymentLabel(filters.payment)}` : "",
    filters.shipping ? `Vận chuyển: ${filters.shipping}` : "",
    filters.search ? `Từ khóa: ${filters.search}` : "",
  ].filter(Boolean).join(" · ") || "Tất cả điều kiện lọc đang để mặc định";

  const maxBreakdownRows = Math.max(statuses.length, paymentMethods.length);
  const noteRow = Math.max(15, 10 + maxBreakdownRows);
  const successTitleRow = noteRow + 2;
  const successHeaderRow = successTitleRow + 1;
  const successStartRow = successHeaderRow + 1;
  const overviewRows: Cell[][] = Array.from({ length: successHeaderRow + successfulOrders.length }, () => Array<Cell>(9).fill(null));
  overviewRows[0][0] = "BÁO CÁO ĐƠN HÀNG";
  overviewRows[1][0] = subtitle;
  overviewRows[3][0] = "Đơn hàng";
  overviewRows[3][2] = "Tổng giá trị đơn";
  overviewRows[3][4] = "Đã thu";
  overviewRows[3][6] = "Còn phải thu";
  overviewRows[4][0] = { formula: `COUNTA('Đơn hàng'!A5:A${orderLastRow})`, value: count };
  overviewRows[4][2] = { formula: `SUM('Đơn hàng'!M5:M${orderLastRow})`, value: total };
  overviewRows[4][4] = { formula: `SUM('Đơn hàng'!N5:N${orderLastRow})`, value: paid };
  overviewRows[4][6] = { formula: `SUM('Đơn hàng'!O5:O${orderLastRow})`, value: outstanding };
  overviewRows[7][0] = "Trạng thái đơn";
  overviewRows[7][1] = "Số đơn";
  overviewRows[7][2] = "Tổng giá trị đơn (₫)";
  overviewRows[7][4] = "Thanh toán";
  overviewRows[7][5] = "Số đơn";
  overviewRows[7][6] = "Đã thu (₫)";
  statuses.forEach((status, index) => {
    const row = 8 + index;
    const group = groupedStatus.get(status)!;
    overviewRows[row] = [status, group.count, group.total, null, null, null, null, null];
  });
  paymentMethods.forEach((method, index) => {
    const row = 8 + index;
    const group = groupedPayment.get(method)!;
    overviewRows[row][4] = method;
    overviewRows[row][5] = group.count;
    overviewRows[row][6] = group.paid;
  });
  overviewRows[noteRow - 1][0] = `Điều kiện lọc: ${filterNotes}`;
  overviewRows[successTitleRow - 1][0] = `DANH SÁCH ĐƠN THÀNH CÔNG · ${successfulOrders.length} đơn đã giao`;
  const successfulHeaders = ["Mã đơn", "Kênh bán", "Khách hàng", "Điện thoại", "Sản phẩm", "Tổng tiền (₫)", "Thanh toán", "Trạng thái", "Thời gian"];
  overviewRows[successHeaderRow - 1] = successfulHeaders;
  successfulOrders.forEach((order, index) => {
    const rowIndex = successStartRow - 1 + index;
    overviewRows[rowIndex] = [order.id, salesChannelLabel(order.salesChannel), order.customer || "—", order.phone || "—", orderProductSummary(order), Number(order.total) || 0, paymentLabel(order.payment), order.status || "Đã giao", orderCreatedLabel(order)];
  });
  const overviewStyles: Record<string, number> = {
    A1: 1, A2: 2,
    A4: 3, C4: 3, E4: 3, G4: 3,
    A5: 4, C5: 17, E5: 17, G5: 17,
  };
  for (let index = 0; index < maxBreakdownRows; index += 1) {
    const row = 9 + index;
    for (const col of ["A", "B", "C", "E", "F", "G"]) overviewStyles[`${col}${row}`] = index % 2 ? 6 : 7;
    if (statuses[index]) overviewStyles[`C${row}`] = index % 2 ? 9 : 8;
    if (paymentMethods[index]) overviewStyles[`G${row}`] = index % 2 ? 9 : 8;
  }
  overviewStyles.A8 = overviewStyles.B8 = overviewStyles.C8 = 5;
  overviewStyles.E8 = overviewStyles.F8 = overviewStyles.G8 = 5;
  overviewStyles[`A${noteRow}`] = 2;
  overviewStyles[`A${successTitleRow}`] = 1;
  for (let col = 0; col < successfulHeaders.length; col += 1) overviewStyles[`${colName(col)}${successHeaderRow}`] = 5;
  successfulOrders.forEach((_, index) => {
    const row = successStartRow + index;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < successfulHeaders.length; col += 1) overviewStyles[`${colName(col)}${row}`] = stripe;
    overviewStyles[`E${row}`] = 18;
    overviewStyles[`F${row}`] = index % 2 ? 9 : 8;
    overviewStyles[`H${row}`] = 13;
  });

  const orderHeaders = [
    "Mã đơn", "Ngày tạo", "Kênh bán", "Khách hàng", "Điện thoại", "Trạng thái đơn",
    "Thanh toán", "Trạng thái thanh toán", "Số mặt hàng", "Tiền hàng (₫)",
    "Giảm giá (₫)", "Phí giao hàng (₫)", "Tổng đơn (₫)", "Đã thu (₫)", "Còn phải thu (₫)",
  ];
  const orderData: Cell[][] = orders.map(order => [
    order.id,
    excelDate(order.placedAt) ?? fallbackExcelDate(order.date),
    salesChannelLabel(order.salesChannel),
    order.customer || "—",
    order.phone || "—",
    order.status || "Chưa xác định",
    paymentLabel(order.payment),
    paymentStatusLabel(order.paymentStatus),
    (order.items || []).length,
    Number(order.subtotal) || 0,
    Number(order.discountAmount) || 0,
    Number(order.shippingFee) || 0,
    Number(order.total) || 0,
    Number(order.paymentCaptured) || 0,
    Math.max(0, Number(order.paymentBalance ?? ((Number(order.total) || 0) - (Number(order.paymentCaptured) || 0))) || 0),
  ]);
  const orderRows: Cell[][] = [["DANH SÁCH ĐƠN HÀNG", null, null, null, null, null, null, null, null, null, null, null, null, null, null], [subtitle, null, null, null, null, null, null, null, null, null, null, null, null, null, null], Array<Cell>(15).fill(null), orderHeaders, ...orderData];
  const orderCellStyles: Record<string, number> = {};
  for (let col = 0; col < orderHeaders.length; col += 1) orderCellStyles[`${colName(col)}4`] = 5;
  const statusStyle: Record<string, number> = { "Chờ thanh toán": 12, "Chờ xác nhận": 12, "Đang xử lý": 11, "Đang giao": 11, "Đã giao": 13, "Đã hủy": 14 };
  orders.forEach((order, index) => {
    const row = index + 5;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < orderHeaders.length; col += 1) orderCellStyles[`${colName(col)}${row}`] = stripe;
    orderCellStyles[`B${row}`] = index % 2 ? 11 : 10;
    for (const col of ["J", "K", "L", "M", "N", "O"]) orderCellStyles[`${col}${row}`] = index % 2 ? 9 : 8;
    orderCellStyles[`F${row}`] = statusStyle[order.status || ""] || stripe;
  });
  orderCellStyles.A1 = 1;
  orderCellStyles.A2 = 2;

  const itemHeaders = ["Mã đơn", "SKU", "Sản phẩm", "Chất lượng / kích thước", "SL", "Đơn giá (₫)", "Thành tiền (₫)", "Khối lượng (kg)"];
  const itemData: Cell[][] = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const variant = [item.quality, item.beadSize].filter(Boolean).join(" · ");
      itemData.push([
        order.id,
        item.productSku || "—",
        item.productName || "Sản phẩm",
        variant || "—",
        Number(item.quantity) || 0,
        Number(item.unitPrice) || 0,
        Number(item.lineTotal) || 0,
        item.weightGrams == null ? null : Number(item.weightGrams) / 1000,
      ]);
    }
  }
  const itemRows: Cell[][] = [["CHI TIẾT SẢN PHẨM TRONG ĐƠN", null, null, null, null, null, null, null], ["Mỗi dòng là một mặt hàng; dùng Mã đơn để đối chiếu sheet Đơn hàng", null, null, null, null, null, null, null], Array<Cell>(8).fill(null), itemHeaders, ...itemData];
  const itemCellStyles: Record<string, number> = {};
  for (let col = 0; col < itemHeaders.length; col += 1) itemCellStyles[`${colName(col)}4`] = 5;
  itemData.forEach((_, index) => {
    const row = index + 5;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < itemHeaders.length; col += 1) itemCellStyles[`${colName(col)}${row}`] = stripe;
    itemCellStyles[`F${row}`] = index % 2 ? 9 : 8;
    itemCellStyles[`G${row}`] = index % 2 ? 9 : 8;
    itemCellStyles[`H${row}`] = index % 2 ? 16 : 15;
  });
  itemCellStyles.A1 = 1;
  itemCellStyles.A2 = 2;

  const successfulDetailHeaders = ["Mã đơn", "Kênh bán", "Khách hàng", "Điện thoại", "Sản phẩm", "Tổng tiền (₫)", "Thanh toán", "Trạng thái thanh toán", "Trạng thái đơn", "Thời gian"];
  const successfulRows: Cell[][] = [["DANH SÁCH ĐƠN THÀNH CÔNG", null, null, null, null, null, null, null, null, null], [`Đã giao thành công · Theo bộ lọc hiện tại · ${successfulOrders.length} đơn`, null, null, null, null, null, null, null, null, null], Array<Cell>(10).fill(null), successfulDetailHeaders, ...successfulOrders.map(order => [order.id, salesChannelLabel(order.salesChannel), order.customer || "—", order.phone || "—", orderProductSummary(order), Number(order.total) || 0, paymentLabel(order.payment), paymentStatusLabel(order.paymentStatus), order.status || "Đã giao", orderCreatedLabel(order)])];
  const successfulStyles: Record<string, number> = { A1: 1, A2: 2 };
  for (let col = 0; col < successfulDetailHeaders.length; col += 1) successfulStyles[`${colName(col)}4`] = 5;
  successfulOrders.forEach((order, index) => {
    const row = index + 5;
    const stripe = index % 2 ? 6 : 7;
    for (let col = 0; col < successfulDetailHeaders.length; col += 1) successfulStyles[`${colName(col)}${row}`] = stripe;
    successfulStyles[`E${row}`] = 18;
    successfulStyles[`F${row}`] = index % 2 ? 9 : 8;
    successfulStyles[`H${row}`] = 13;
    successfulStyles[`I${row}`] = statusStyle[order.status || "Đã giao"] || stripe;
  });

  return [
    { name: "Tổng quan", rows: overviewRows, widths: [21, 16, 23, 18, 52, 20, 22, 20, 22], rowHeights: { 1: 30, 2: 22, 4: 26, 5: 36, 8: 26, [successTitleRow]: 30, [successHeaderRow]: 34 }, merges: ["A4:B4", "C4:D4", "E4:F4", "G4:I4", "A5:B5", "C5:D5", "E5:F5", "G5:I5", `A${noteRow}:I${noteRow}`, `A${successTitleRow}:I${successTitleRow}`], cellStyles: overviewStyles },
    { name: "Đơn thành công", rows: successfulRows, widths: [21, 16, 23, 18, 52, 20, 22, 22, 20, 24], rowHeights: { 1: 30, 2: 22, 4: 34 }, cellStyles: successfulStyles, autoFilter: `A4:J${Math.max(4 + successfulOrders.length, 4)}`, frozenRows: 4 },
    { name: "Đơn hàng", rows: orderRows, widths: [19, 14, 16, 23, 17, 18, 20, 23, 13, 18, 18, 20, 18, 18, 20], rowHeights: { 1: 30, 2: 22, 4: 34 }, cellStyles: orderCellStyles, autoFilter: `A4:O${Math.max(4 + count, 4)}`, frozenRows: 4 },
    { name: "Chi tiết sản phẩm", rows: itemRows, widths: [19, 19, 34, 28, 9, 19, 19, 18], rowHeights: { 1: 30, 2: 22, 4: 34 }, cellStyles: itemCellStyles, autoFilter: `A4:H${Math.max(4 + itemData.length, 4)}`, frozenRows: 4 },
  ];
}

function downloadWorkbook(sheets: SheetData[], filename: string) {
  const bytes = zipStore(xlsxFiles(sheets));
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportOrdersExcel(orders: ExcelOrder[], filters: ExportFilters = {}) {
  downloadWorkbook(buildSheets(orders, filters), `geme-bao-cao-don-hang_${filters.dateFrom || "tat-ca"}_${filters.dateTo || "tat-ca"}.xlsx`);
}

export function exportProductsExcel(products: ProductExportRow[], filters: ProductExportFilters = {}) {
  const suffix = filters.catalogKind ? `-${filters.catalogKind}` : "";
  downloadWorkbook(createProductReportSheets(products, filters), `geme-bao-cao-san-pham${suffix}.xlsx`);
}

export function exportInventoryExcel(products: InventoryExportRow[], filters: InventoryExportFilters = {}) {
  downloadWorkbook(createInventoryReportSheets(products, filters), `geme-bao-cao-ton-kho-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function salesChannelLabel(value?: string) {
  const labels: Record<string, string> = {
    WEBSITE: "Website",
    DIRECT: "Bán trực tiếp",
    STORE: "Bán trực tiếp",
    SHOPEE: "Shopee",
    FACEBOOK: "Facebook",
    INSTAGRAM: "Instagram",
    TIKTOK: "TikTok",
  };
  const key = String(value || "").trim().toUpperCase();
  return labels[key] || String(value || "Kênh chưa xác định").replaceAll("_", " ");
}
