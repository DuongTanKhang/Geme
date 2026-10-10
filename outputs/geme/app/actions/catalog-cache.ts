"use server";

import { updateTag } from "next/cache";

let lastCatalogInvalidationAt = 0;

export async function invalidateStorefrontCatalog() {
  // Many open storefront tabs can receive the same SSE event at once. One
  // invalidation is enough for their subsequent router.refresh() requests.
  const now = Date.now();
  if (now - lastCatalogInvalidationAt < 750) return;
  lastCatalogInvalidationAt = now;
  updateTag("storefront-catalog");
}
