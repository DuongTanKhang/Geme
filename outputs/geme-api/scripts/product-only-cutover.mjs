import pg from "pg";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";

const { Client } = pg;

// This is intentionally a narrow data allowlist. Never add customer, order,
// payment, return, reservation, review, favorite, or loyalty tables here.
const TABLES = [
  { name: "admin_users" },
  { name: "admin_permission_grants" },
  { name: "jewelry_stone_groups" },
  { name: "sphere_stone_groups" },
  { name: "categories", orderBy: "level ASC, id ASC" },
  { name: "material_options" },
  { name: "sphere_stone_types" },
  // Copy only reviewed, portable site/product content. Runtime secrets and
  // environment-specific configuration belong in the host's protected .env.
  { name: "site_settings", where: "key IN ('customerPolicies', 'inventory.skuRules', 'inventory.materialCategoryApplicability', 'banners', 'footerContent', 'catalogEditorialPromos', 'newArrivalsMedia', 'shopMenuEditorial', 'blogCategories', 'bankQr', 'address', 'addressNote', 'phone', 'supportEmail', 'openingHours', 'socialLinks')", orderBy: "key ASC" },
  { name: "products" },
  { name: "product_images" },
  { name: "product_price_variants" },
  { name: "inventory_receipts" },
  // Media assets back product, blog, banner/footer, and Admin media-library
  // content. The referenced R2 objects are verified/copied separately.
  { name: "media_assets", where: "id IN (SELECT DISTINCT media_asset_id FROM public.product_media_assets) OR source_key LIKE 'assets/%' OR source_key LIKE 'blog/%'" },
  { name: "product_sphere_items" },
  { name: "product_media_assets" },
  { name: "inventory_movements", where: "reference IS NULL OR reference NOT IN (SELECT code FROM public.orders)" },
  { name: "inventory_receipt_items" },
  { name: "inventory_issues" },
  { name: "inventory_issue_items" },
  { name: "blog_posts" },
  { name: "blog_post_images" },
  { name: "admin_calendar_events" },
];
const EMPTY_TARGET_TABLES = [
  "customers", "product_reviews", "customer_favorites", "orders", "order_items", "payments", "payment_refunds",
  "order_returns", "order_return_items", "inventory_reservations", "marketing_sessions", "loyalty_point_transactions",
  "promotion_usages", "contact_inquiries", "sepay_webhook_events", "order_email_outbox",
  "shopee_imported_orders", "shopee_imported_order_items",
];

const sourceUrl = process.env.PRODUCT_MIGRATION_SOURCE_DATABASE_URL;
const targetUrl = process.env.PRODUCT_MIGRATION_TARGET_DATABASE_URL;
const resetAdminEmail = process.env.PRODUCT_MIGRATION_ADMIN_EMAIL;
const resetAdminPassword = process.env.PRODUCT_MIGRATION_ADMIN_PASSWORD;
const apply = process.argv.includes("--apply");
const pageSize = 100;

if (!sourceUrl || !targetUrl) {
  throw new Error("Set PRODUCT_MIGRATION_SOURCE_DATABASE_URL and PRODUCT_MIGRATION_TARGET_DATABASE_URL; values are never printed.");
}
if (sourceUrl === targetUrl) throw new Error("Source and target database URLs must be different.");
if (apply && process.env.CONFIRM_PRODUCT_ONLY_IMPORT !== "YES") {
  throw new Error("Import blocked. Set CONFIRM_PRODUCT_ONLY_IMPORT=YES and pass --apply after verifying a production backup.");
}
if (apply && (!resetAdminEmail || !resetAdminPassword || resetAdminPassword.length < 12 || resetAdminPassword.length > 256)) {
  throw new Error("Import blocked. Set PRODUCT_MIGRATION_ADMIN_EMAIL and PRODUCT_MIGRATION_ADMIN_PASSWORD (12–256 characters) to reset one imported Admin account; values are never printed.");
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const source = new Client({ connectionString: sourceUrl, application_name: "geme-product-only-export" });
const target = new Client({ connectionString: targetUrl, application_name: "geme-product-only-import" });

async function readActiveReservations() {
  const result = await source.query(
    `SELECT id, product_id, variant_id, sphere_item_id, quantity, quantity_kg::text AS quantity_kg
     FROM public.inventory_reservations WHERE status = 'ACTIVE' ORDER BY created_at, id`,
  );
  return result.rows;
}

async function restoreActiveReservation(client, reservation) {
  const productId = reservation.product_id;
  const quantity = Number(reservation.quantity);
  const quantityKg = reservation.quantity_kg === null ? null : Number(reservation.quantity_kg);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || (quantityKg !== null && (!Number.isFinite(quantityKg) || quantityKg < 0))) {
    throw new Error(`Invalid reserved stock in record ${reservation.id}; no reservation data was copied.`);
  }

  if (reservation.sphere_item_id) {
    if (quantity !== 1 || quantityKg === null || quantityKg <= 0) {
      throw new Error(`Invalid reserved sphere quantity in record ${reservation.id}; reconcile it in test before cutover.`);
    }
    const sphere = await client.query(
      `SELECT weight_kg::text AS weight_kg FROM public.product_sphere_items
       WHERE id = $1 AND product_id = $2 AND status = 'RESERVED' FOR UPDATE`,
      [reservation.sphere_item_id, productId],
    );
    if (sphere.rowCount !== 1 || Math.abs(Number(sphere.rows[0].weight_kg) - quantityKg) > 0.0005) {
      throw new Error(`Reserved sphere item ${reservation.sphere_item_id} has a weight mismatch; reconcile it in test before cutover.`);
    }
    const claimed = await client.query(
      `UPDATE public.product_sphere_items SET status = 'AVAILABLE', updated_at = now()
       WHERE id = $1 AND product_id = $2 AND status = 'RESERVED'`,
      [reservation.sphere_item_id, productId],
    );
    if (claimed.rowCount !== 1) throw new Error(`Reserved sphere item ${reservation.sphere_item_id} is not in RESERVED state.`);
  }

  if (reservation.variant_id) {
    const updatedVariant = await client.query(
      `UPDATE public.product_price_variants SET stock = stock + $1,
       stock_kg = stock_kg + COALESCE($2::numeric, 0), updated_at = now()
       WHERE id = $3 AND product_id = $4`,
      [quantity, quantityKg, reservation.variant_id, productId],
    );
    if (updatedVariant.rowCount !== 1) throw new Error(`Reserved variant ${reservation.variant_id} is missing from the imported catalog.`);
  }
  const beforeResult = await client.query(
    `SELECT stock, stock_kg::text AS stock_kg FROM public.products WHERE id = $1 FOR UPDATE`,
    [productId],
  );
  if (beforeResult.rowCount !== 1) throw new Error(`Reserved product ${productId} is missing from the imported catalog.`);
  const before = beforeResult.rows[0];
  const afterResult = await client.query(
    `UPDATE public.products SET stock = stock + $1,
       stock_kg = stock_kg + COALESCE($2::numeric, 0),
       sold_out_at = NULL, updated_at = now()
     WHERE id = $3 RETURNING stock, stock_kg::text AS stock_kg`,
    [quantity, quantityKg, productId],
  );
  const after = afterResult.rows[0];
  await client.query(
    `INSERT INTO public.inventory_movements
     (id, product_id, variant_id, sphere_item_id, product_name, product_sku, variant_label, type, quantity, quantity_kg,
      stock_before, stock_after, stock_before_kg, stock_after_kg, reference, note, created_at)
     SELECT $1, p.id, $2, $3, p.name, COALESCE(v.sku, p.sku),
       CASE WHEN $3::uuid IS NOT NULL THEN concat(COALESCE(p.sphere_quality, 'Vật phẩm'), ' · ', COALESCE($4::text, '0'), ' kg') ELSE NULL END,
       'IN', $5, $4::numeric, $6, $7, $8::numeric, $9::numeric, 'PRODUCT-CUTOVER',
       'Trả tồn đơn giữ chỗ không chuyển sang production', now()
     FROM public.products p LEFT JOIN public.product_price_variants v ON v.id = $2 WHERE p.id = $10`,
    [randomUUID(), reservation.variant_id, reservation.sphere_item_id, quantityKg, quantity,
      before.stock, after.stock, before.stock_kg, after.stock_kg, productId],
  );
}

async function columns(client, table) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  if (!result.rowCount) throw new Error(`Required table public.${table} is missing.`);
  return result.rows.map((row) => row.column_name);
}

async function tableCount(client, table, where) {
  const result = await client.query(`SELECT count(*)::bigint AS count FROM public.${quote(table)}${where ? ` WHERE ${where}` : ""}`);
  return Number(result.rows[0].count);
}

async function assertStockConsistency(client) {
  const mismatches = await client.query(`
    SELECT p.sku, 'sphere item count/kg' AS check_name
    FROM public.products p
    JOIN public.sphere_stone_types st ON st.id = p.sphere_stone_type_id
    LEFT JOIN public.product_sphere_items si ON si.product_id = p.id AND si.status = 'AVAILABLE'
    GROUP BY p.id, p.sku, p.stock, p.stock_kg
    HAVING p.stock <> count(si.id)
       OR abs(p.stock_kg - COALESCE(sum(si.weight_kg), 0)) > 0.0005
    UNION ALL
    SELECT p.sku, 'product/variant count' AS check_name
    FROM public.products p
    JOIN public.product_price_variants v ON v.product_id = p.id
    GROUP BY p.id, p.sku, p.stock
    HAVING p.stock <> COALESCE(sum(v.stock), 0)
    UNION ALL
    SELECT p.sku, 'product/variant kg' AS check_name
    FROM public.products p
    JOIN public.product_price_variants v ON v.product_id = p.id
    WHERE p.kind = 'OTHER'
    GROUP BY p.id, p.sku, p.stock_kg
    HAVING abs(p.stock_kg - COALESCE(sum(v.stock_kg), 0)) > 0.0005
    LIMIT 30
  `);
  if (mismatches.rowCount) {
    const summary = mismatches.rows.map((row) => `${row.sku}: ${row.check_name}`).join(", ");
    throw new Error(`Stock totals do not match after import; transaction rolled back. ${summary}`);
  }
}

async function ensureCompatibleSchemas() {
  const schema = new Map();
  for (const { name } of TABLES) {
    const sourceColumns = await columns(source, name);
    const targetColumns = await columns(target, name);
    if (sourceColumns.join("\0") !== targetColumns.join("\0")) {
      throw new Error(`Schema mismatch in ${name}; deploy the same reviewed migrations to both databases before import.`);
    }
    schema.set(name, sourceColumns);
  }
  return schema;
}

try {
  await source.connect();
  await target.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const schema = await ensureCompatibleSchemas();
  const plan = [];
  for (const table of TABLES) {
    const sourceCount = await tableCount(source, table.name, table.where);
    const targetCount = await tableCount(target, table.name, table.where);
    plan.push({ table: table.name, source: sourceCount, target: targetCount });
    if (targetCount !== 0) throw new Error(`Target table ${table.name} is not empty (${targetCount} rows). Import only into the fresh production database.`);
  }
  for (const name of EMPTY_TARGET_TABLES) {
    const targetCount = await tableCount(target, name);
    if (targetCount !== 0) throw new Error(`Target privacy table ${name} is not empty (${targetCount} rows). Import only into the fresh production database.`);
  }

  const activeReservations = await readActiveReservations();
  const adminResetTargetCount = resetAdminEmail
    ? Number((await source.query("SELECT count(*)::bigint AS count FROM public.admin_users WHERE lower(email) = lower($1)", [resetAdminEmail])).rows[0].count)
    : 0;
  if (apply && adminResetTargetCount !== 1) {
    throw new Error("Import blocked. The selected Admin email must match exactly one source admin_users record.");
  }
  const orphanReservedItems = await tableCount(
    source,
    "product_sphere_items",
    `status = 'RESERVED' AND id NOT IN (SELECT sphere_item_id FROM public.inventory_reservations WHERE status = 'ACTIVE' AND sphere_item_id IS NOT NULL)`,
  );
  if (orphanReservedItems) throw new Error(`Found ${orphanReservedItems} RESERVED sphere items without an ACTIVE reservation; reconcile these in test before cutover.`);

  console.log(JSON.stringify({ mode: apply ? "IMPORT" : "PLAN ONLY", tables: plan, activeReservationsNotCopied: activeReservations.length, orphanReservedSphereItems: orphanReservedItems, adminPasswordResetTargetCount, customerOrderTablesIncluded: false }, null, 2));
  if (!apply) {
    console.log("No rows changed. Add --apply only after checking the counts, R2 accessibility, and verified production backups.");
  } else {
    await target.query("BEGIN");
    await target.query("SELECT pg_advisory_xact_lock(hashtext('geme-product-only-cutover-v1'))");
    for (const table of TABLES) {
      const tableName = quote(table.name);
      const names = schema.get(table.name);
      const columnSql = names.map(quote).join(", ");
      const orderBy = table.orderBy || "id ASC";
      const where = table.where ? ` WHERE ${table.where}` : "";
      let offset = 0;
      while (true) {
        const rows = await source.query(
          `SELECT * FROM public.${tableName}${where} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
          [pageSize, offset],
        );
        if (!rows.rowCount) break;
        const placeholders = [];
        const values = [];
        for (const row of rows.rows) {
          const rowPlaceholders = [];
          for (const column of names) {
            values.push(row[column]);
            rowPlaceholders.push(`$${values.length}`);
          }
          placeholders.push(`(${rowPlaceholders.join(", ")})`);
        }
        await target.query(`INSERT INTO public.${tableName} (${columnSql}) VALUES ${placeholders.join(", ")}`, values);
        offset += rows.rowCount;
      }
    }
    for (const reservation of activeReservations) await restoreActiveReservation(target, reservation);
    const adminPasswordHash = await hash(resetAdminPassword, 12);
    const resetAdmin = await target.query(
      `UPDATE public.admin_users SET password_hash = $1, auth_version = auth_version + 1,
       failed_login_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE lower(email) = lower($2)`,
      [adminPasswordHash, resetAdminEmail],
    );
    if (resetAdmin.rowCount !== 1) throw new Error("Admin password reset did not update exactly one imported account; transaction rolled back.");
    await assertStockConsistency(target);
    await target.query("COMMIT");

    const imported = [];
    for (const table of TABLES) imported.push({ table: table.name, imported: await tableCount(target, table.name) });
    console.log(JSON.stringify({ result: "COMMITTED", tables: imported }, null, 2));
    console.log("Verify stock totals and product media against the source snapshot before opening production traffic.");
  }
  await source.query("COMMIT");
} catch (error) {
  try { await target.query("ROLLBACK"); } catch {}
  try { await source.query("ROLLBACK"); } catch {}
  throw error;
} finally {
  await Promise.allSettled([source.end(), target.end()]);
}
