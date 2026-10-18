import { Body, Controller, Delete, Get, Header, NotFoundException, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { AdminAuthService } from "../admin-auth/admin-auth.service.js";
import { CommerceService } from "./commerce.service.js";
import { onlineOrderInput } from "./online-order-input.js";
import { MediaAssetsService } from "../media/media-assets.service.js";

type MediaResponse = { setHeader(name: string, value: string): void; end(data?: Uint8Array): void; redirect(status: number, url: string): unknown };
type AuthorizationRequest = { headers: { authorization?: string } };

const admin = () => UseGuards(AdminAuthGuard);

@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService, private readonly adminAuth: AdminAuthService, private readonly mediaStore: MediaAssetsService) {}

  @Get("categories/public")
  @Header("Cache-Control", "no-store")
  publicCategories() { return this.commerce.categories(true); }

  @Get("categories")
  @admin()
  categories() { return this.commerce.categories(false); }
  @Post("categories") @admin() createCategory(@Body() body: Record<string, any>) { return this.commerce.createCategory(body); }
  @Patch("categories/:id") @admin() updateCategory(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateCategory(id, body); }
  @Delete("categories/:id") @admin() deleteCategory(@Param("id") id: string) { return this.commerce.deleteCategory(id); }

  @Get("products")
  products(@Query() query: Record<string, string>) {
    const publicQuery: Record<string, string> = {};
    for (const key of ["kind", "categoryId", "gemstoneTypeId", "materialOptionId", "new", "featured", "search", "limit"] as const) {
      if (typeof query[key] === "string") publicQuery[key] = query[key];
    }
    publicQuery.view = query.view === "storefront" ? "storefront" : "storefront-list";
    return this.commerce.products(publicQuery);
  }

  @Get("admin/products") @admin() adminProducts(@Query() query: Record<string, string>) { return this.commerce.products(query); }
  @Get("products/:id") @admin() adminProduct(@Param("id") id: string) { return this.commerce.adminProduct(id); }
  @Get("products/detail/:slug/related") relatedProducts(@Param("slug") slug: string, @Query("limit") limit?: string) { return this.commerce.relatedProducts(slug, limit); }
  @Get("products/detail/:slug") product(@Param("slug") slug: string) { return this.commerce.product(slug); }
  @Sse("products/events") productEvents() { return this.commerce.catalogEvents(); }
  @Post("products") @admin() createProduct(@Body() body: Record<string, any>) { return this.commerce.saveProduct(body); }
  @Patch("products/by-sku/:sku") @admin() updateProductBySku(@Param("sku") sku: string, @Body() body: Record<string, any>) { return this.commerce.saveProductBySku(body, sku); }
  @Patch("products/:id") @admin() updateProduct(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveProduct(body, id); }
  @Delete("products/:id") @admin() deleteProduct(@Param("id") id: string, @Body() body?: Record<string, any>) { return this.commerce.deleteProduct(id, body); }
  @Patch("products/:id/unpublish") @admin() unpublishProduct(@Param("id") id: string) { return this.commerce.unpublishProduct(id); }

  @Get("inventory") @admin() inventory() { return this.commerce.inventory(); }
  @Get("inventory/movements") @admin() inventoryMovements(@Query("limit") limit?: string) { return this.commerce.inventoryMovements(limit); }
  @Get("inventory/sku-rules") @admin() inventorySkuRules() { return this.commerce.inventorySkuRules(); }
  @Patch("inventory/sku-rules") @admin() saveInventorySkuRules(@Body() body: Record<string, any>) { return this.commerce.saveInventorySkuRules(body); }
  @Get("inventory/sku-next") @admin() nextInventorySku(@Query("categoryId") categoryId?: string, @Query("materialOptionId") materialOptionId?: string, @Query("sequence") sequence?: string) { return this.commerce.nextInventorySku(categoryId || "", materialOptionId, sequence); }
  @Get("inventory/receipts/next-number") @admin() nextInventoryReceiptNumber(@Query("date") date?: string) { return this.commerce.nextInventoryReceiptNumber(date); }
  @Get("inventory/receipts") @admin() inventoryReceipts(@Query("limit") limit?: string) { return this.commerce.inventoryReceipts(limit); }
  @Get("inventory/receipts/:id") @admin() inventoryReceipt(@Param("id") id: string) { return this.commerce.inventoryReceipt(id); }
  @Post("inventory/receipts") @admin() createInventoryReceipt(@Body() body: Record<string, any>) { return this.commerce.createInventoryReceipt(body); }
  @Get("inventory/issues") @admin() inventoryIssues(@Query() query: Record<string, string>) { return this.commerce.inventoryIssues(query); }
  @Post("inventory/issues") @admin() createInventoryIssue(@Body() body: Record<string, any>) { return this.commerce.createInventoryIssue(body); }
  @Post("inventory/reset/preview") @admin() inventoryResetPreview(@Body() body: Record<string, any>) { return this.commerce.inventoryResetPreview(body); }
  @Post("inventory/reset") @admin() resetInventory(@Body() body: Record<string, any>) { return this.commerce.resetInventory(body); }
  @Patch("inventory/products/:id/minimum-stock") @admin() minimumStock(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateMinimumStock(id, body.minimumStock); }
  @Post("inventory/movements") @admin() createInventoryMovement(@Body() body: Record<string, any>) { return this.commerce.createInventoryMovement(body); }

  @Get("customers") @admin() customers(@Query() query: Record<string, string>) { return this.commerce.customers(query); }
  @Post("customers") @admin() createCustomer(@Body() body: Record<string, any>) { return this.commerce.saveCustomer(body); }
  @Patch("customers/:id") @admin() updateCustomer(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveCustomer(body, id); }

  @Get("orders") @admin() orders(@Query() query: Record<string, string>) { return this.commerce.orders(query); }
  // Guest checkout remains public. POS orders use the separately protected admin route below.
  @Post("orders") createStoreOrder(@Body() body: Record<string, any>) {
    return this.commerce.createOrder(onlineOrderInput(body));
  }
  @Post("admin/orders") @admin() createAdminOrder(@Body() body: Record<string, any>) { return this.commerce.createOrder(body, undefined, true); }
  @Patch("orders/:id/status") @admin() orderStatus(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateOrderStatus(id, body.status); }
  @Patch("orders/:id/payment") @admin() orderPayment(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.markOrderPaid(id, body.status); }

  @Get("promotions/storefront") storefrontPromotions() { return this.commerce.storefrontPromotions(); }
  @Get("promotions") @admin() promotions(@Query() query: Record<string, string>) { return this.commerce.promotions(query); }
  @Post("promotions") @admin() createPromotion(@Body() body: Record<string, any>) { return this.commerce.savePromotion(body); }
  @Patch("promotions/:id") @admin() updatePromotion(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePromotion(body, id); }
  @Delete("promotions/:id") @admin() deletePromotion(@Param("id") id: string) { return this.commerce.deletePromotion(id); }

  @Get("blog") posts(@Query() query: Record<string, string>) {
    const publicQuery: Record<string, string> = {};
    for (const key of ["search", "category", "limit", "offset"] as const) if (typeof query[key] === "string") publicQuery[key] = query[key];
    publicQuery.view = query.view === "storefront-journal" ? "storefront-journal" : "storefront-list";
    return this.commerce.posts(publicQuery);
  }
  @Get("admin/blog") @admin() adminPosts(@Query() query: Record<string, string>) { return this.commerce.posts(query); }
  @Get("blog/article/:slug") blogArticle(@Param("slug") slug: string) { return this.commerce.blogArticle(slug); }
  @Get("blog/:slug") post(@Param("slug") slug: string) { return this.commerce.post(slug); }
  @Post("blog") @admin() createPost(@Body() body: Record<string, any>) { return this.commerce.savePost(body); }
  @Patch("blog/:id") @admin() updatePost(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePost(body, id); }
  @Delete("blog/:id") @admin() deletePost(@Param("id") id: string) { return this.commerce.deletePost(id); }

  @Get("media") @admin() mediaAssets() { return this.commerce.mediaAssets(); }
  @Post("media") @admin() saveMedia(@Body() body: Record<string, any>) { return this.commerce.saveMedia(body); }

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
    if (asset.isPrivate && !(await this.adminAuth.authenticateAuthorization(request.headers.authorization))) {
      throw new NotFoundException("Không tìm thấy ảnh trong thư viện.");
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
  @Get("settings") @admin() settings() { return this.commerce.settings(); }
  @Patch("settings") @admin() saveSettings(@Body() body: Record<string, unknown>) { return this.commerce.saveSettings(body); }
  @Get("reports/storefront") storefrontReport() { return this.commerce.storefrontSalesOverview(); }
  @Get("reports/overview") @admin() report(@Query() query: Record<string, string>) { return this.commerce.report(query); }
}
