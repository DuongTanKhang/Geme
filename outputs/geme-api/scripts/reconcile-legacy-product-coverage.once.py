from __future__ import annotations

import csv
import json
import os
import pathlib
import re
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = pathlib.Path.cwd()
OLD_PATH = ROOT / "exports/legacy-products.csv"
DB_PATH = ROOT / "outputs/geme-api/import-data/current-products-source-reconciliation-20261115.json"
RECEIPT_PATH = ROOT / "outputs/geme-api/import-data/current-receipt-items-source-reconciliation-20261115.json"
OUT = ROOT / "outputs/geme-api/import-data/product-source-reconciliation-20261115"
OUT.mkdir(parents=True, exist_ok=True)
sys.stdout.reconfigure(errors="replace")


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


with OLD_PATH.open(encoding="utf-8-sig", newline="") as handle:
    old_rows = list(csv.DictReader(handle))
old_by_id = {str(row["ID"]).strip(): row for row in old_rows}
old_ids = set(old_by_id)
current = json.loads(DB_PATH.read_text(encoding="utf-8-sig"))
receipt_items = json.loads(RECEIPT_PATH.read_text(encoding="utf-8-sig")) if RECEIPT_PATH.exists() else []
current_by_id = {product["id"]: product for product in current}
current_by_sku: dict[str, list[dict]] = defaultdict(list)
current_by_name: dict[str, list[dict]] = defaultdict(list)
current_by_description: dict[str, list[dict]] = defaultdict(list)
receipt_name_to_products: dict[str, dict[str, dict]] = defaultdict(dict)
for product in current:
    if product.get("sku"):
        current_by_sku[str(product["sku"]).strip().upper()].append(product)
    current_by_name[norm(product.get("name"))].append(product)
    if product.get("description"):
        current_by_description[norm(product.get("description"))].append(product)
for line in receipt_items:
    product = current_by_id.get(line.get("productId"))
    key = norm(line.get("productName"))
    if product and key:
        receipt_name_to_products[key][product["id"]] = product

imported: dict[str, tuple[str, str]] = {}
coverage_method: dict[str, str] = {}
for row in old_rows:
    legacy_id = str(row["ID"]).strip()
    sku = str(row.get("SKU") or "").strip().upper()
    if sku and sku in current_by_sku:
        product = current_by_sku[sku][0]
        imported[legacy_id] = (product["sku"], product["name"])
        coverage_method[legacy_id] = "Exact SQL SKU in GEME"


def walk_mapping(value: object, file_label: str, parent_sku: str | None = None) -> None:
    if isinstance(value, dict):
        sku = str(value.get("sku") or value.get("SKU") or parent_sku or "").strip().upper()
        raw_id = value.get("legacyId", value.get("legacy_id", value.get("sqlId", value.get("SQL_ID"))))
        if raw_id is not None:
            legacy_id = str(raw_id).strip()
            if legacy_id in old_by_id and sku and sku in current_by_sku:
                product = current_by_sku[sku][0]
                imported[legacy_id] = (product["sku"], product["name"])
                coverage_method[legacy_id] = f"Import mapping ({file_label})"
        # Some approved manifests group multiple old SQL rows into one current SKU
        # and record those source row IDs in `sourceIds` instead of `legacyId`.
        source_ids = value.get("sourceIds")
        if isinstance(source_ids, list) and sku and sku in current_by_sku:
            product = current_by_sku[sku][0]
            for source_id in source_ids:
                legacy_id = str(source_id).strip()
                if legacy_id in old_by_id:
                    imported[legacy_id] = (product["sku"], product["name"])
                    coverage_method[legacy_id] = f"Import sourceIds mapping ({file_label})"
        for child in value.values():
            walk_mapping(child, file_label, sku or parent_sku)
    elif isinstance(value, list):
        for child in value:
            walk_mapping(child, file_label, parent_sku)


def excluded_dir(name: str) -> bool:
    low = name.lower()
    return low in {"backups", ".tmp", "node_modules", ".git", ".pnpm-store", "dist", "images", "import-images", ".staging-package", "product-source-reconciliation-20261115"}


json_files: list[pathlib.Path] = []
note_csv_files: list[pathlib.Path] = []
for base, dirs, files in os.walk(ROOT / "outputs"):
    dirs[:] = [name for name in dirs if not excluded_dir(name)]
    for name in files:
        path = pathlib.Path(base) / name
        low = name.lower()
        if low.endswith(".json") and any(token in low for token in ("plan", "manifest", "draft", "result")):
            json_files.append(path)
        if low.endswith(".csv") and any(token in low for token in ("note", "not-ready", "remaining", "legacy", "manifest", "import")):
            note_csv_files.append(path)

for path in json_files:
    try:
        walk_mapping(json.loads(path.read_text(encoding="utf-8-sig")), str(path.relative_to(ROOT)))
    except (OSError, ValueError, UnicodeDecodeError):
        continue

# Only use exact one-to-one product names/descriptions as a fallback for legacy rows with no direct SKU/map.
old_names: dict[str, list[str]] = defaultdict(list)
for row in old_rows:
    old_names[norm(row.get("TenSanPham"))].append(str(row["ID"]).strip())
for normalized, legacy_ids in old_names.items():
    if not normalized or len(legacy_ids) != 1 or legacy_ids[0] in imported:
        continue
    products = current_by_name.get(normalized, [])
    method = "Unique exact product name"
    if len(products) != 1:
        products = current_by_description.get(normalized, [])
        method = "Unique exact product description"
    if len(products) != 1:
        products = list(receipt_name_to_products.get(normalized, {}).values())
        method = "Unique exact inventory receipt name"
    if len(products) == 1:
        legacy_id = legacy_ids[0]
        product = products[0]
        imported[legacy_id] = (product.get("sku") or "", product.get("name") or "")
        coverage_method[legacy_id] = method

notes: dict[str, set[str]] = defaultdict(set)
note_file_hit_counts: dict[str, int] = {}
drafts: dict[str, set[str]] = defaultdict(set)
id_keys = {"id", "legacyid", "legacy_id", "sqlid", "sql_id", "oldid", "old_id", "idsanphamcu", "idcu"}
for path in note_csv_files:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except (OSError, UnicodeDecodeError, csv.Error):
        continue
    hits: set[str] = set()
    is_note = "note" in path.name.lower() or "not-ready" in path.name.lower()
    is_draft = "draft" in path.name.lower() and not is_note
    for row in rows:
        for key, value in row.items():
            k = re.sub(r"[^a-z0-9]+", "", str(key or "").lower())
            if k not in id_keys:
                continue
            legacy_id = str(value or "").strip()
            if legacy_id in old_ids:
                hits.add(legacy_id)
                if is_note:
                    notes[legacy_id].add(str(path.relative_to(ROOT)))
                elif is_draft:
                    drafts[legacy_id].add(str(path.relative_to(ROOT)))
    if hits:
        if is_note:
            note_file_hit_counts[str(path.relative_to(ROOT))] = len(hits)

report_rows = []
for legacy_id, row in old_by_id.items():
    if legacy_id in imported:
        disposition = "IN_GEME"
        gem_sku, gem_name = imported[legacy_id]
        detail = coverage_method[legacy_id]
    elif legacy_id in notes:
        disposition = "NOTE"
        gem_sku, gem_name = "", ""
        detail = " | ".join(sorted(notes[legacy_id]))
    elif legacy_id in drafts:
        disposition = "DRAFT_PLAN"
        gem_sku, gem_name = "", ""
        detail = " | ".join(sorted(drafts[legacy_id]))
    else:
        disposition = "UNACCOUNTED"
        gem_sku, gem_name = "", ""
        detail = "No current product match, import mapping, or row-level NOTE entry found"
    report_rows.append({
        "legacyId": legacy_id,
        "name": row.get("TenSanPham", ""),
        "legacySku": row.get("SKU", ""),
        "legacyCategory": row.get("DanhMuc", ""),
        "disposition": disposition,
        "matchMethod": detail,
        "gemeSku": gem_sku,
        "gemeName": gem_name,
    })

with (OUT / "all-legacy-products-reconciled.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(report_rows[0]))
    writer.writeheader()
    writer.writerows(report_rows)

for disposition, filename in (
    ("NOTE", "note-products.csv"),
    ("DRAFT_PLAN", "draft-plan-products.csv"),
    ("UNACCOUNTED", "unaccounted-products.csv"),
):
    with (OUT / filename).open("w", encoding="utf-8-sig", newline="") as handle:
        selected = [row for row in report_rows if row["disposition"] == disposition]
        writer = csv.DictWriter(handle, fieldnames=list(report_rows[0]))
        writer.writeheader()
        writer.writerows(selected)

summary = {
    "source": "exports/legacy-products.csv",
    "sourceRows": len(old_rows),
    "sourceUniqueIds": len(old_ids),
    "currentGemeProducts": len(current),
    "currentGemeUniqueSkus": len(current_by_sku),
    "dispositionCounts": dict(Counter(row["disposition"] for row in report_rows)),
    "matchMethods": dict(Counter(coverage_method.values())),
    "noteFiles": note_file_hit_counts,
    "draftPlanRows": len([row for row in report_rows if row["disposition"] == "DRAFT_PLAN"]),
    "unaccountedRows": len([row for row in report_rows if row["disposition"] == "UNACCOUNTED"]),
    "auditCaveat": "Exact SKU, verified import-plan legacyId-to-existing-SKU mappings, and unique exact names are counted as GEME. Row-level NOTE CSVs are counted separately. Remaining rows are unaccounted, not assumed imported.",
    "reportFiles": [
        "all-legacy-products-reconciled.csv",
        "note-products.csv",
        "draft-plan-products.csv",
        "unaccounted-products.csv",
    ],
}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
