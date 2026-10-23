import { Body, Controller, Delete, Get, Header, Headers, NotFoundException, Param, Patch, Post, Query, Req, Res, Sse, UseGuards, applyDecorators } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { AdminAuthService } from "../admin-auth/admin-auth.service.js";
import { AdminPermissionService, RequireAdminPermissions, type AdminPermission } from "../admin-auth/admin-permissions.js";
import { CommerceService } from "./commerce.service.js";
import { onlineOrderInput } from "./online-order-input.js";
import { MediaAssetsService } from "../media/media-assets.service.js";

type MediaResponse = { setHeader(name: string, value: string): void; end(data?: Uint8Array): void; redirect(status: number, url: string): unknown };
type AuthorizationRequest = { headers: { authorization?: string } };

const admin = (...permissions: AdminPermission[]) => permissions.length
  ? applyDecorators(UseGuards(AdminAuthGuard), RequireAdminPermissions(...permissions))
  : UseGuards(AdminAuthGuard);

@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService, private readonly adminAuth: AdminAuthService, private readonly adminPermissions: AdminPermissionService, private readonly mediaStore: MediaAssetsService) {}

  @Get("categories/public")
  @Header("Cache-Control", "no-store")
  publicCategories() { return this.commerce.categories(true); }

  @Get("categories")
  @admin("catalog.read")
  categories() { return this.commerce.categories(false); }
  @Post("categories") @admin("catalog.write") createCategory(@Body() body: Record<string, any>) { return this.commerce.createCategory(body); }
  @Patch("categories/:id") @admin("catalog.write") updateCategory(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateCategory(id, body); }
  @Delete("categories/:id") @admin("catalog.write") deleteCategory(@Param("id") id: string) { return this.commerce.deleteCategory(id); }

  @Get("products")
  products(@Query() query: Record<string, string>) {
    const publicQuery: Record<string, string> = {};
    for (const key of ["kind", "categoryId", "gemstoneTypeId", "materialOptionId", "new", "featured", "search", "limit", "offset"] as const) {
      if (typeof query[key] === "string") publicQuery[key] = query[key];
    }
    publicQuery.view = query.view === "sitemap" ? "sitemap" : query.view === "storefront" ? "storefront" : "storefront-list";
    return this.commerce.products(publicQuery);
  }

  @Get("admin/products") @admin("catalog.read") adminProducts(@Query() query: Record<string, string>) { return this.commerce.products(query); }
  // Keep static paths before the `:id` matcher so "events" isn't parsed as a UUID.
  @Sse("products/events") productEvents() { return this.commerce.catalogEvents(); }
  @Get("products/:id") @admin("catalog.read") adminProduct(@Param("id") id: string) { return this.commerce.adminProduct(id); }
  @Get("products/detail/:slug/related") relatedProducts(@Param("slug") slug: string, @Query("limit") limit?: string) { return this.commerce.relatedProducts(slug, limit); }
  @Get("products/detail/:slug") product(@Param("slug") slug: string) { return this.commerce.product(slug); }
  @Post("products") @admin("catalog.write") createProduct(@Body() body: Record<string, any>) { return this.commerce.saveProduct(body); }
  @Patch("products/by-sku/:sku") @admin("catalog.write") updateProductBySku(@Param("sku") sku: string, @Body() body: Record<string, any>) { return this.commerce.saveProductBySku(body, sku); }
  @Patch("products/:id") @admin("catalog.write") updateProduct(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveProduct(body, id); }
  @Delete("products/:id") @admin("catalog.write") deleteProduct(@Param("id") id: string, @Body() body?: Record<string, any>) { return this.commerce.deleteProduct(id, body); }
  @Patch("products/:id/unpublish") @admin("catalog.write") unpublishProduct(@Param("id") id: string) { return this.commerce.unpublishProduct(id); }

  @Get("inventory") @admin("inventory.read") inventory() { return this.commerce.inventory(); }
  @Get("inventory/movements") @admin("inventory.read") inventoryMovements(@Query("limit") limit?: string) { return this.commerce.inventoryMovements(limit); }
  @Get("inventory/sku-rules") @admin("inventory.read") inventorySkuRules() { return this.commerce.inventorySkuRules(); }
  @Patch("inventory/sku-rules") @admin("inventory.write") saveInventorySkuRules(@Body() body: Record<string, any>) { return this.commerce.saveInventorySkuRules(body); }
  @Get("inventory/sku-next") @admin("inventory.read") nextInventorySku(@Query("categoryId") categoryId?: string, @Query("materialOptionId") materialOptionId?: string, @Query("sequence") sequence?: string, @Query("bangleShape") bangleShape?: string, @Query("bangleQuality") bangleQuality?: string, @Query("bangleSizeMm") bangleSizeMm?: string) { return this.commerce.nextInventorySku(categoryId || "", materialOptionId, sequence, { bangleShape, bangleQuality, bangleSizeMm }); }
  @Get("inventory/receipts/next-number") @admin("inventory.read") nextInventoryReceiptNumber(@Query("date") date?: string) { return this.commerce.nextInventoryReceiptNumber(date); }
  @Get("inventory/receipts") @admin("inventory.read") inventoryReceipts(@Query("limit") limit?: string) { return this.commerce.inventoryReceipts(limit); }
  @Get("inventory/receipts/:id") @admin("inventory.read") inventoryReceipt(@Param("id") id: string) { return this.commerce.inventoryReceipt(id); }
  @Post("inventory/receipts") @admin("inventory.write") createInventoryReceipt(@Body() body: Record<string, any>) { return this.commerce.createInventoryReceipt(body); }
  @Get("inventory/issues") @admin("inventory.read") inventoryIssues(@Query() query: Record<string, string>) { return this.commerce.inventoryIssues(query); }
  @Post("inventory/issues") @admin("inventory.write") createInventoryIssue(@Body() body: Record<string, any>) { return this.commerce.createInventoryIssue(body); }
  @Post("inventory/reset/preview") @admin("inventory.read") inventoryResetPreview(@Body() body: Record<string, any>) { return this.commerce.inventoryResetPreview(body); }
  @Post("inventory/reset") @admin("inventory.write") resetInventory(@Body() body: Record<string, any>) { return this.commerce.resetInventory(body); }
  @Patch("inventory/products/:id/minimum-stock") @admin("inventory.write") minimumStock(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateMinimumStock(id, body.minimumStock); }
  @Post("inventory/movements") @admin("inventory.write") createInventoryMovement(@Body() body: Record<string, any>) { return this.commerce.createInventoryMovement(body); }

  @Get("customers") @admin("customers.read") customers(@Query() query: Record<string, string>) { return this.commerce.customers(query); }
  @Post("customers") @admin("customers.write") createCustomer(@Body() body: Record<string, any>) { return this.commerce.saveCustomer(body); }
  @Patch("customers/:id") @admin("customers.write") updateCustomer(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveCustomer(body, id); }

  @Get("orders") @admin("orders.read") orders(@Query() query: Record<string, string>) { return this.commerce.orders(query); }
  // Guest checkout remains public. POS orders use the separately protected admin route below.
  @Post("orders/quote") quoteStoreOrder(@Body() body: Record<string, any>) {
    return this.commerce.quoteOrder(onlineOrderInput(body));
  }
  @Post("orders") createStoreOrder(@Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.commerce.createOrder(onlineOrderInput(body), undefined, false, idempotencyKey);
  }
  @Post("admin/orders") @admin("orders.write") createAdminOrder(@Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) { return this.commerce.createOrder(body, undefined, true, idempotencyKey); }
  @Patch("orders/:id/status") @admin("orders.write") orderStatus(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateOrderStatus(id, body.status); }
  @Patch("orders/:id/payment") @admin("finance.manage") orderPayment(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.markOrderPaid(id, body.status); }
  @Post("orders/:id/email/retry") @admin("orders.write") retryOrderEmail(@Param("id") id: string) { return this.commerce.retryOrderConfirmationEmail(id); }

  @Get("promotions/storefront") storefrontPromotions() { return this.commerce.storefrontPromotions(); }
  @Get("promotions") @admin("content.read") promotions(@Query() query: Record<string, string>) { return this.commerce.promotions(query); }
  @Post("promotions") @admin("content.write") createPromotion(@Body() body: Record<string, any>) { return this.commerce.savePromotion(body); }
  @Patch("promotions/:id") @admin("content.write") updatePromotion(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePromotion(body, id); }
  @Delete("promotions/:id") @admin("content.write") deletePromotion(@Param("id") id: string) { return this.commerce.deletePromotion(id); }

  @Get("blog") posts(@Query() query: Record<string, string>) {
    const publicQuery: Record<string, string> = {};
    for (const key of ["search", "category", "limit", "offset"] as const) if (typeof query[key] === "string") publicQuery[key] = query[key];
    publicQuery.view = query.view === "sitemap" ? "sitemap" : query.view === "storefront-journal" ? "storefront-journal" : "storefront-list";
    return this.commerce.posts(publicQuery);
  }
  @Get("admin/blog") @admin("content.read") adminPosts(@Query() query: Record<string, string>) { return this.commerce.posts(query); }
  @Get("blog/article/:slug") blogArticle(@Param("slug") slug: string) { return this.commerce.blogArticle(slug); }
  @Get("blog/:slug") post(@Param("slug") slug: string) { return this.commerce.post(slug); }
  @Post("blog") @admin("content.write") createPost(@Body() body: Record<string, any>) { return this.commerce.savePost(body); }
  @Patch("blog/:id") @admin("content.write") updatePost(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePost(body, id); }
  @Delete("blog/:id") @admin("content.write") deletePost(@Param("id") id: string) { return this.commerce.deletePost(id); }

  @Get("media") @admin("content.read") mediaAssets() { return this.commerce.mediaAssets(); }
  @Post("media") @admin("content.write") saveMedia(@Body() body: Record<string, any>) { return this.commerce.saveMedia(body); }

  @Get("media/assets/:key")
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  async staticMedia(@Param("key") key: string, @Res() response: MediaResponse) {
    const asset = await this.mediaStore.findPublicByAssetKey(key);
    const publicUrl = this.mediaStore.publicDeliveryUrl(asset);
    if (publicUrl) {
      response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return response.redirect(302, publicUrl);
    }
    const bytes = await this.mediaStore.read(asset);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    response.end(bytes);
  }

  @Get("media/assets/:folder/:key")
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  async nestedStaticMedia(@Param("folder") folder: string, @Param("key") key: string, @Res() response: MediaResponse) {
    const asset = await this.mediaStore.findPublicByAssetKey(`${folder}/${key}`);
    const publicUrl = this.mediaStore.publicDeliveryUrl(asset);
    if (publicUrl) {
      response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return response.redirect(302, publicUrl);
    }
    const bytes = await this.mediaStore.read(asset);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    response.end(bytes);
  }

  @Get("media/:id")
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  async media(@Param("id") id: string, @Req() request: AuthorizationRequest, @Res() response: MediaResponse) {
    const asset = await this.mediaStore.findById(id);
    if (asset.isPrivate) {
      const identity = await this.adminAuth.authenticateAuthorization(request.headers.authorization);
      if (!identity) throw new NotFoundException("Không tìm thấy ảnh trong thư viện.");
      await this.adminPermissions.assertPermissions(identity, ["content.read"]);
    }
    const publicUrl = this.mediaStore.publicDeliveryUrl(asset);
    if (publicUrl) {
      response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return response.redirect(302, publicUrl);
    }
    const bytes = await this.mediaStore.read(asset);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    if (asset.isPrivate) response.setHeader("Cache-Control", "private, no-store");
    response.end(bytes);
  }

  @Get("settings/public") publicSettings() { return this.commerce.publicSettings(); }
  @Get("settings") @admin("settings.manage") settings() { return this.commerce.settings(); }
  @Patch("settings") @admin("settings.manage") saveSettings(@Body() body: Record<string, unknown>) { return this.commerce.saveSettings(body); }
  @Get("reports/storefront") storefrontReport() { return this.commerce.storefrontSalesOverview(); }
  @Get("reports/overview") @admin("dashboard.read") report(@Query() query: Record<string, string>) { return this.commerce.report(query); }
}
