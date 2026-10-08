const baseValue = process.env.POS365_API_BASE_URL?.trim();
const username = process.env.POS365_USERNAME?.trim();
const password = process.env.POS365_PASSWORD;
if (!baseValue || !username || !password) throw new Error("POS365 chưa được cấu hình trong môi trường API.");
const base = new URL(baseValue);
const login = await fetch(new URL("/api/auth", base), {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ UserName: username, Password: password }),
  signal: AbortSignal.timeout(20000),
});
const session = await login.json().catch(() => ({}));
if (!login.ok || typeof session.SessionId !== "string") throw new Error(`POS365 login failed (${login.status}); no data was changed.`);
const headers = { accept: "application/json", cookie: `ss-id=${session.SessionId}` };

async function readAll(path) {
  const all = [];
  const size = 500;
  for (let skip = 0; skip < 100000;) {
    const url = new URL(path, base);
    url.searchParams.set("format", "json");
    url.searchParams.set("$top", String(size));
    url.searchParams.set("$skip", String(skip));
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const body = await response.json();
    const rows = Array.isArray(body?.results) ? body.results : Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    all.push(...rows);
    if (rows.length < size) return { rows: all, count: Number.isFinite(Number(body?.__count)) ? Number(body.__count) : all.length };
    skip += rows.length;
  }
  throw new Error(`${path} exceeds the paging safety limit`);
}

const resources = [
  ["products", "/api/products"],
  ["purchaseOrders", "/api/orderstock"],
  ["orders", "/api/orders"],
  ["inventoryCounts", "/api/inventorycount"],
];
const results = await Promise.all(resources.map(async ([key, path]) => {
  try { return [key, await readAll(path)]; }
  catch (error) { return [key, { error: error instanceof Error ? error.message : "Read failed", rows: [], count: null }]; }
}));
const data = Object.fromEntries(results.map(([key, value]) => [key, value]));
const skuInventoryCounts = await readAll("/api/inventorycount?ProductCode=HH-0002").catch(() => ({ rows: [], count: null, error: "read failed" }));
const orderRows = data.orders?.rows || [];
const orderDetails = await Promise.all(orderRows.map(async (order) => {
  const url = new URL("/api/orders/detail", base);
  url.searchParams.set("format", "json");
  url.searchParams.set("Includes", "Product");
  url.searchParams.set("OrderId", String(order.Id));
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) return { orderId: order.Id, error: `HTTP ${response.status}`, lines: [] };
  const body = await response.json();
  const rows = Array.isArray(body?.results) ? body.results : Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return { orderId: order.Id, code: String(order.Code || ""), status: order.Status ?? null, lines: rows.map((line) => ({ productId: line.ProductId ?? line.Product?.Id ?? null, productCode: String(line.Product?.Code || line.ProductCode || ""), productName: String(line.Product?.Name || line.ProductName || ""), quantity: line.Quantity ?? null })) };
}));
const matching = (row) => `${row.Code || ""} ${row.Name || ""}`.toLocaleLowerCase("en").includes("test") || String(row.Code || "").toLocaleUpperCase("en").startsWith("GEME-");
const output = Object.fromEntries(results.map(([key, value]) => [key, {
  total: value.count,
  ...(value.error ? { error: value.error } : {}),
  matchingTestOrGeme: (value.rows || []).filter(matching).map((row) => ({ id: row.Id ?? null, code: String(row.Code || ""), ...(key === "products" ? { name: String(row.Name || ""), onHand: row.OnHand ?? row.TotalOnHand ?? null, hidden: row.Hidden ?? null } : { status: row.Status ?? null }) })),
}]));
const testProduct = data.products?.rows?.find((row) => String(row.Code || "").trim().toUpperCase() === "HH-0002");
const testProductId = testProduct?.Id;
output.references = {
  testProductId: testProductId ?? null,
  testOrders: orderDetails.filter((order) => order.lines.some((line) => line.productId === testProductId)).map(({ orderId, code, status }) => ({ id: orderId, code, status })),
  orderLines: orderDetails.flatMap((order) => order.lines.filter((line) => line.productId === testProductId).map((line) => ({ orderId: order.orderId, orderCode: order.code, ...line }))),
  inventoryCounts: (data.inventoryCounts?.rows || []).map((row) => ({ id: row.Id, code: String(row.Code || ""), status: row.Status ?? null, lines: (row.InventoryCountDetails || []).filter((line) => line.ProductId === testProductId).map((line) => ({ productId: line.ProductId, productCode: String(line.Product?.Code || line.ProductCode || ""), productName: String(line.Product?.Name || line.ProductName || ""), actualCount: line.ActualCount ?? null, onHand: line.OnHand ?? null })) })),
  inventoryCountsByTestSku: { count: skuInventoryCounts.count, rows: (skuInventoryCounts.rows || []).map((row) => ({ id: row.Id, code: String(row.Code || ""), status: row.Status ?? null, detailProductIds: (row.InventoryCountDetails || []).map((line) => line.ProductId ?? line.Product?.Id ?? null) })) },
};
console.log(JSON.stringify(output));
