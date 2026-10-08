import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, Sse } from "@nestjs/common";
import { CommerceService } from "./commerce.service.js";

type MediaResponse = { setHeader(name: string, value: string): void; end(data?: Uint8Array): void };

@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get("categories") categories() { return this.commerce.categories(); }
  @Post("categories") createCategory(@Body() body: Record<string, any>) { return this.commerce.createCategory(body); }
  @Patch("categories/:id") updateCategory(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateCategory(id, body); }
  @Delete("categories/:id") deleteCategory(@Param("id") id: string) { return this.commerce.deleteCategory(id); }

  @Get("products") products(@Query() query: Record<string, string>) { return this.commerce.products(query); }
  @Get("products/detail/:slug/related") relatedProducts(@Param("slug") slug: string, @Query("limit") limit?: string) { return this.commerce.relatedProducts(slug, limit); }
  @Get("products/detail/:slug") product(@Param("slug") slug: string) { return this.commerce.product(slug); }
  @Sse("products/events") productEvents() { return this.commerce.catalogEvents(); }
  @Post("products") createProduct(@Body() body: Record<string, any>) { return this.commerce.saveProduct(body); }
  @Patch("products/:id") updateProduct(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveProduct(body, id); }
  @Delete("products/:id") deleteProduct(@Param("id") id: string) { return this.commerce.deleteProduct(id); }
  @Patch("products/:id/unpublish") unpublishProduct(@Param("id") id: string) { return this.commerce.unpublishProduct(id); }
  @Get("inventory") inventory() { return this.commerce.inventory(); }
  @Get("inventory/movements") inventoryMovements(@Query("limit") limit?: string) { return this.commerce.inventoryMovements(limit); }
  @Get("inventory/sku-rules") inventorySkuRules() { return this.commerce.inventorySkuRules(); }
  @Patch("inventory/sku-rules") saveInventorySkuRules(@Body() body: Record<string, any>) { return this.commerce.saveInventorySkuRules(body); }
  @Get("inventory/sku-next") nextInventorySku(@Query("categoryId") categoryId?: string, @Query("materialOptionId") materialOptionId?: string, @Query("sequence") sequence?: string) { return this.commerce.nextInventorySku(categoryId || "", materialOptionId, sequence); }
  @Get("inventory/receipts/next-number") nextInventoryReceiptNumber(@Query("date") date?: string) { return this.commerce.nextInventoryReceiptNumber(date); }
  @Get("inventory/receipts") inventoryReceipts(@Query("limit") limit?: string) { return this.commerce.inventoryReceipts(limit); }
  @Get("inventory/receipts/:id") inventoryReceipt(@Param("id") id: string) { return this.commerce.inventoryReceipt(id); }
  @Post("inventory/receipts") createInventoryReceipt(@Body() body: Record<string, any>) { return this.commerce.createInventoryReceipt(body); }
  @Get("inventory/issues") inventoryIssues(@Query() query: Record<string, string>) { return this.commerce.inventoryIssues(query); }
  @Post("inventory/issues") createInventoryIssue(@Body() body: Record<string, any>) { return this.commerce.createInventoryIssue(body); }
  @Patch("inventory/products/:id/minimum-stock") minimumStock(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateMinimumStock(id, body.minimumStock); }
  @Post("inventory/movements") createInventoryMovement(@Body() body: Record<string, any>) { return this.commerce.createInventoryMovement(body); }

  @Get("customers") customers(@Query() query: Record<string, string>) { return this.commerce.customers(query); }
  @Post("customers") createCustomer(@Body() body: Record<string, any>) { return this.commerce.saveCustomer(body); }
  @Patch("customers/:id") updateCustomer(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.saveCustomer(body, id); }

  @Get("orders") orders() { return this.commerce.orders(); }
  @Post("orders") createOrder(@Body() body: Record<string, any>) { return this.commerce.createOrder(body); }
  @Patch("orders/:id/status") orderStatus(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.updateOrderStatus(id, body.status); }

  @Get("promotions/storefront") storefrontPromotions() { return this.commerce.storefrontPromotions(); }
  @Get("promotions") promotions() { return this.commerce.promotions(); }
  @Post("promotions") createPromotion(@Body() body: Record<string, any>) { return this.commerce.savePromotion(body); }
  @Patch("promotions/:id") updatePromotion(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePromotion(body, id); }
  @Delete("promotions/:id") deletePromotion(@Param("id") id: string) { return this.commerce.deletePromotion(id); }

  @Get("blog") posts(@Query() query: Record<string, string>) { return this.commerce.posts(query); }
  @Get("blog/article/:slug") blogArticle(@Param("slug") slug: string) { return this.commerce.blogArticle(slug); }
  @Get("blog/:slug") post(@Param("slug") slug: string) { return this.commerce.post(slug); }
  @Post("blog") createPost(@Body() body: Record<string, any>) { return this.commerce.savePost(body); }
  @Patch("blog/:id") updatePost(@Param("id") id: string, @Body() body: Record<string, any>) { return this.commerce.savePost(body, id); }
  @Delete("blog/:id") deletePost(@Param("id") id: string) { return this.commerce.deletePost(id); }

  @Get("media") mediaAssets() { return this.commerce.mediaAssets(); }
  @Post("media") saveMedia(@Body() body: Record<string, any>) { return this.commerce.saveMedia(body); }

  @Get("media/assets/:key")
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  async staticMedia(@Param("key") key: string, @Res() response: MediaResponse) {
    const asset = await this.commerce.mediaAssetByKey(key);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    response.end(Buffer.from(asset.data));
  }

  @Get("media/:id")
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  async media(@Param("id") id: string, @Res() response: MediaResponse) {
    const asset = await this.commerce.mediaAsset(id);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(asset.size));
    response.end(Buffer.from(asset.data));
  }

  @Get("settings") settings() { return this.commerce.settings(); }
  @Patch("settings") saveSettings(@Body() body: Record<string, unknown>) { return this.commerce.saveSettings(body); }
  @Get("reports/overview") report(@Query() query: Record<string, string>) { return this.commerce.report(query); }
}
