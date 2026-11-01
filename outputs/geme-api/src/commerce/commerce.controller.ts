import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Headers, NotFoundException, Param, Patch, Post, Query, Req, Res, Sse, UseGuards, applyDecorators } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { AdminAuthService } from "../admin-auth/admin-auth.service.js";
import { AdminPermissionService, RequireAdminPermissions, type AdminPermission } from "../admin-auth/admin-permissions.js";
import type { AdminIdentity } from "../admin-auth/admin-auth.service.js";
import { CommerceService } from "./commerce.service.js";
import { onlineOrderInput, onlineOrderQuoteInput } from "./online-order-input.js";
import { MediaAssetsService } from "../media/media-assets.service.js";
import { SePayBankAccountService } from "../sepay/sepay-bank-account.service.js";

type MediaResponse = { setHeader(name: string, value: string): void; end(data?: Uint8Array): void; redirect(status: number, url: string): unknown };
type AuthorizationRequest = { headers: { authorization?: string } };
type AdminRequest = { adminIdentity: AdminIdentity };

const admin = (...permissions: AdminPermission[]) => permissions.length
  ? applyDecorators(UseGuards(AdminAuthGuard), RequireAdminPermissions(...permissions))
  : UseGuards(AdminAuthGuard);

@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService, private readonly adminAuth: AdminAuthService, private readonly adminPermissions: AdminPermissionService, private readonly mediaStore: MediaAssetsService, private readonly sepayBankAccount: SePayBankAccountService) {}

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
  @Post("products") @admin("catalog.read") async createProduct(@Req() request: AdminRequest, @Body() body: Record<string, any>) { await this.assertProductMutation(request.adminIdentity, body, "create"); return this.commerce.saveProduct(body); }
  @Patch("products/by-sku/:sku") @admin("catalog.read") async updateProductBySku(@Req() request: AdminRequest, @Param("sku") sku: string, @Body() body: Record<string, any>) {
    const full = await this.assertProductMutation(request.adminIdentity, body);
    return full ? this.commerce.saveProductBySku(body, sku) : this.commerce.updateProductFieldsBySku(sku, body, request.adminIdentity);
  }
  @Patch("products/:id") @admin("catalog.read") async updateProduct(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any>) {
    const full = await this.assertProductMutation(request.adminIdentity, body);
    return full ? this.commerce.saveProduct(body, id) : this.commerce.updateProductFields(id, body, request.adminIdentity);
  }
  @Delete("products/:id") @admin("catalog.read") async deleteProduct(@Req() request: AdminRequest, @Param("id") id: string, @Body() body?: Record<string, any>) { await this.assertProductMutation(request.adminIdentity, body || {}, "delete"); return this.commerce.deleteProduct(id, body, request.adminIdentity); }
  @Patch("products/:id/unpublish") @admin("catalog.read") async unpublishProduct(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any> = {}) { await this.assertProductMutation(request.adminIdentity, body, "publish"); return this.commerce.updateProductPublication(id, "HIDDEN", request.adminIdentity, body.reason); }
  @Patch("products/:id/publication") @admin("catalog.read") async updateProductPublication(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any>) { await this.assertProductMutation(request.adminIdentity, body, "publish"); return this.commerce.updateProductPublication(id, body.status, request.adminIdentity, body.reason); }
  @Patch("products/:id/new-label") @admin("catalog.publish") async updateProductNewLabel(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: Record<string, any>) {
    if (!body || typeof body.isNew !== "boolean" || Object.keys(body).some((key) => !["isNew", "newUntil"].includes(key))) throw new BadRequestException("Chỉ gửi isNew dạng true/false và tùy chọn newUntil (ISO-8601 hoặc null) để cập nhật nhãn sản phẩm mới.");
    await this.adminPermissions.assertPermissions(request.adminIdentity, ["catalog.publish"]);
    return this.commerce.updateProductNewLabel(id, body.isNew, body.newUntil, request.adminIdentity);
  }

  private async assertProductMutation(identity: AdminIdentity, body: Record<string, any>, operation: "write" | "create" | "delete" | "publish" = "write"): Promise<boolean> {
    const required = new Set<string>();
    if (operation === "create") {
      required.add("catalog.write");
      if (body.status === "ACTIVE") required.add("catalog.publish");
      await this.adminPermissions.assertPermissions(identity, [...required]);
      return true;
    }
    if (operation === "delete") {
      required.add("catalog.delete");
      // Deletion currently removes exact matching SKU rows from POS365 as part
      // of the same user action, so both scopes are mandatory.
      required.add("integrations.manage");
      await this.adminPermissions.assertPermissions(identity, [...required]);
      return false;
    }
    if (operation === "publish") {
      required.add("catalog.publish");
      if (Object.keys(body).some((key) => !["status", "reason"].includes(key))) throw new BadRequestException("Chỉ gửi trạng thái xuất bản và lý do vào endpoint này.");
      await this.adminPermissions.assertPermissions(identity, [...required]);
      return false;
    }

    const contentFields = new Set(["name", "description", "fullDescription", "coverVideoUrl", "technicalImageUrl", "technicalVideoUrl", "gallery", "seoTitle", "seoDescription"]);
    const priceFields = new Set(["price", "originalPrice"]);
    const fullFields = new Set(["sku", "kind", "categoryId", "gemstoneTypeId", "materialOptionId", "weightGrams", "lengthCm", "widthCm", "heightCm", "isNew", "isFeatured", "featured", "published"]);
    let usesContent = false;
    let usesPrice = false;
    let needsFullCatalog = false;
    for (const key of Object.keys(body)) {
      if (contentFields.has(key)) { usesContent = true; continue; }
      if (priceFields.has(key)) { usesPrice = true; continue; }
      if (key === "priceVariants") {
        if (!Array.isArray(body.priceVariants)) throw new BadRequestException("Danh sách biến thể không hợp lệ.");
        for (const row of body.priceVariants as Array<Record<string, unknown>>) {
          const keys = Object.keys(row || {});
          if (keys.some((field) => !["id", "sku", "price", "originalPrice", "imageUrls", "videoUrl"].includes(field))) needsFullCatalog = true;
          if (keys.some((field) => ["price", "originalPrice"].includes(field))) usesPrice = true;
          if (keys.some((field) => ["imageUrls", "videoUrl"].includes(field))) usesContent = true;
        }
        continue;
      }
      if (["stock", "minimumStock", "variants"].includes(key)) throw new BadRequestException("Không được sửa tồn kho qua hồ sơ sản phẩm. Dùng mục Quản lý tồn kho để tạo phiếu có kiểm toán.");
      if (key === "status") {
        if (Object.keys(body).length === 1) throw new BadRequestException("Dùng endpoint publication riêng và gửi status cùng lý do.");
        required.add("catalog.publish");
        needsFullCatalog = true;
        continue;
      }
      if (["isNew", "isFeatured", "featured", "published"].includes(key)) required.add("catalog.publish");
      if (fullFields.has(key) || !contentFields.has(key)) needsFullCatalog = true;
    }
    if (usesContent) required.add("catalog.content.write");
    if (usesPrice) required.add("catalog.price.write");
    if (needsFullCatalog) required.add("catalog.write");
    if (!required.size) throw new BadRequestException("Không có trường sản phẩm hợp lệ để cập nhật.");
    await this.adminPermissions.assertPermissions(identity, [...required]);
    return needsFullCatalog;
  }

  @Get("inventory") @admin("inventory.read") inventory() { return this.commerce.inventory(); }
  @Get("inventory/movements") @admin("inventory.read") inventoryMovements(@Query("limit") limit?: string) { return this.commerce.inventoryMovements(limit); }
  @Get("inventory/sku-rules") @admin("inventory.read") inventorySkuRules() { return this.commerce.inventorySkuRules(); }
  @Patch("inventory/sku-rules") @admin("inventory.write") saveInventorySkuRules(@Body() body: Record<string, any>) { return this.commerce.saveInventorySkuRules(body); }
  @Get("inventory/sku-next") @admin("inventory.read") nextInventorySku(@Query("categoryId") categoryId?: string, @Query("materialOptionId") materialOptionId?: string, @Query("sequence") sequence?: string, @Query("bangleShape") bangleShape?: string, @Query("bangleQuality") bangleQuality?: string, @Query("bangleSizeMm") bangleSizeMm?: string) { return this.commerce.nextInventorySku(categoryId || "", materialOptionId, sequence, { bangleShape, bangleQuality, bangleSizeMm }); }
  @Get("inventory/receipts/next-number") @admin("inventory.read") nextInventoryReceiptNumber(@Query("date") date?: string) { return this.commerce.nextInventoryReceiptNumber(date); }
  @Get("inventory/receipts") @admin("inventory.read") inventoryReceipts(@Query("limit") limit?: string) { return this.commerce.inventoryReceipts(limit); }
  @Get("inventory/receipts/:id") @admin("inventory.read") inventoryReceipt(@Param("id") id: string) { return this.commerce.inventoryReceipt(id); }
  @Post("inventory/receipts") @admin("inventory.write") createInventoryReceipt(@Body() body: Record<string, any>) { return this.commerce.createInventoryReceipt(body); }
  @Post("inventory/receipts/reconcile-pos") @admin("inventory.write") reconcileInventoryReceiptsFromPos(@Body("receiptIds") receiptIds: unknown) { return this.commerce.reconcileInventoryReceiptsFromPos(receiptIds); }
  @Get("inventory/issues") @admin("inventory.read") inventoryIssues(@Query() query: Record<string, string>) { return this.commerce.inventoryIssues(query); }
  @Post("inventory/issues") @admin("inventory.write") createInventoryIssue(@Body() body: Record<string, any>) { return this.commerce.createInventoryIssue(body); }
  @Post("inventory/reset/preview") @admin("inventory.read") inventoryResetPreview(@Body() body: Record<string, any>) { return this.commerce.inventoryResetPreview(body); }
  @Post("inventory/reset") @admin("inventory.write") resetInventory(@Body() body: Record<string, any>) { return this.commerce.resetInventory(body); }
  @Patch("inventory/products/:id/minimum-stock") @admin("inventory.write") minimumStock(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateMinimumStock(id, body.minimumStock); }
  @Post("inventory/movements") @admin("inventory.write") createInventoryMovement(@Req() request: AdminRequest, @Body() body: Record<string, any>) { return this.commerce.createInventoryMovement(body, request.adminIdentity); }

  @Get("notifications") @admin("dashboard.read") notifications(@Req() request: AdminRequest, @Query() query: Record<string, string>) { return this.commerce.adminNotifications(request.adminIdentity.id, query); }
  @Patch("notifications/read-all") @admin("dashboard.read") markAllNotificationsRead(@Req() request: AdminRequest) { return this.commerce.markAllAdminNotificationsRead(request.adminIdentity.id); }
  @Patch("notifications/:id/read") @admin("dashboard.read") markNotificationRead(@Req() request: AdminRequest, @Param("id") id: string) { return this.commerce.markAdminNotificationRead(id, request.adminIdentity.id); }

  @Get("customers") @admin("customers.read") customers(@Query() query: Record<string, string>) { return this.commerce.customers(query); }
  @Post("customers") @admin("customers.write") createCustomer(@Body() body: Record<string, any>) { return this.commerce.saveCustomer(body); }
  @Patch("customers/:id") @admin("customers.write") updateCustomer(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveCustomer(body, id); }

  @Get("orders") @admin("orders.read") orders(@Query() query: Record<string, string>) { return this.commerce.orders(query); }
  @Get("orders/:code/payment-status")
  @Header("Cache-Control", "private, no-store, max-age=0")
  publicOrderPaymentStatus(@Param("code") code: string, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.commerce.publicOrderPaymentStatus(code, idempotencyKey);
  }
  // Guest checkout remains public. POS orders use the separately protected admin route below.
  @Post("orders/quote") quoteStoreOrder(@Body() body: Record<string, any>) {
    return this.commerce.quoteOrder(onlineOrderQuoteInput(body));
  }
  @Post("orders") createStoreOrder(@Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.commerce.createOrder(onlineOrderInput(body), undefined, false, idempotencyKey);
  }
  @Post("admin/orders") @admin("orders.write") createAdminOrder(@Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) { return this.commerce.createOrder(body, undefined, true, idempotencyKey); }
  @Patch("orders/:id/status") @admin("orders.write") orderStatus(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, any>) { return this.commerce.updateOrderStatus(id, body.status, request.adminIdentity, body.reason); }
  @Patch("orders/:id/payment") @admin("finance.manage") orderPayment(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.markOrderPaid(id, body.status); }
  @Post("orders/:id/payments") @admin("finance.manage") recordOrderPayment(@Param("id") id: string, @Req() request: AdminRequest, @Body() body: Record<string, any>, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.commerce.recordOrderPayment(id, request.adminIdentity, body, idempotencyKey);
  }
  @Post("orders/:id/payments/confirm-pos365") @admin("finance.manage") confirmBankTransferFromPos365(@Param("id") id: string, @Req() request: AdminRequest, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.commerce.confirmBankTransferFromPos365(id, request.adminIdentity, idempotencyKey);
  }
  @Post("orders/:id/email/retry") @admin("orders.write") retryOrderEmail(@Param("id") id: string) { return this.commerce.retryOrderConfirmationEmail(id); }

  @Get("promotions/storefront") storefrontPromotions() { return this.commerce.storefrontPromotions(); }
  @Get("promotions") @admin("promotions.read") promotions(@Query() query: Record<string, string>) { return this.commerce.promotions(query); }
  @Post("promotions") @admin("promotions.write") createPromotion(@Body() body: Record<string, any>) { return this.commerce.savePromotion(body); }
  @Patch("promotions/:id") @admin("promotions.write") updatePromotion(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePromotion(body, id); }
  @Delete("promotions/:id") @admin("promotions.write") deletePromotion(@Param("id") id: string) { return this.commerce.deletePromotion(id); }

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
    // Public SKU image objects are served by the media Worker through a strict
    // `product-images/{SKU}/{SKU}-{sequence}.{image}` allowlist. Redirecting
    // here avoids requiring API-side R2 credentials just to render a catalog
    // image; private assets still pass the authorization check above and are
    // never given a public delivery URL.
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

  @Get("settings/public") async publicSettings() {
    const settings = await this.commerce.publicSettings();
    const bankQr = await this.sepayBankAccount.getPublicQrSettings();
    if (bankQr) settings.bankQr = bankQr;
    return settings;
  }
  @Get("settings") @admin("settings.manage") settings() { return this.commerce.settings(); }
  @Patch("settings") @admin("settings.manage") saveSettings(@Body() body: Record<string, unknown>) { return this.commerce.saveSettings(body); }
  @Get("reports/storefront") storefrontReport() { return this.commerce.storefrontSalesOverview(); }
  @Get("reports/overview") @admin("dashboard.read") report(@Query() query: Record<string, string>) { return this.commerce.report(query); }
}
