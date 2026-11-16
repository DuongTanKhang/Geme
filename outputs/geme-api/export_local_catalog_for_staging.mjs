import { writeFile } from "node:fs/promises";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
const tables = [
  "jewelry_stone_groups",
  "sphere_stone_groups",
  "sphere_stone_types",
  "material_options",
  "categories",
  "products",
  "product_images",
  "product_price_variants",
  "inventory_receipts",
  "inventory_receipt_items",
  "inventory_issues",
  "inventory_issue_items",
  "product_sphere_items",
  "inventory_movements",
  "media_assets",
  "product_media_assets",
];

try {
  const datasets = {};
  for (const table of tables) {
    const query = table === "media_assets"
      ? `SELECT COALESCE(json_agg(to_jsonb(m)), '[]'::json) AS rows
         FROM public.media_assets m
         WHERE m.id IN (SELECT DISTINCT media_asset_id FROM public.product_media_assets)`
      : `SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) AS rows FROM public."${table}" t`;
    const result = await pool.query(query);
    datasets[table] = result.rows[0].rows;
    if (table === "product_media_assets") {
      for (const row of datasets[table]) row.approved_by_admin_id = null;
    }
  }
  const output = "/tmp/geme-local-catalog-sync.json";
  await writeFile(output, JSON.stringify({
    releaseId: "local-sync-20261116T011524Z",
    exportedAt: new Date().toISOString(),
    datasets,
  }));
  console.log(JSON.stringify({ output, counts: Object.fromEntries(Object.entries(datasets).map(([table, rows]) => [table, rows.length])) }));
} finally {
  await pool.end();
}
