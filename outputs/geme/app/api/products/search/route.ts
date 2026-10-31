import { getStoreProducts } from "../../../lib/store-api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  if (query.length < 2) return Response.json({ products: [] });

  const result = await getStoreProducts({ search: query, limit: 8 });
  if (!result.connected) {
    return Response.json({ message: "Chưa kết nối được danh mục sản phẩm GEME." }, { status: 503 });
  }

  return Response.json({ products: result.products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    slug: product.slug,
    imageUrl: product.images.find((image) => image.isPrimary)?.url || product.images[0]?.url || "",
    price: product.price,
    isPremiumGemstone: product.isPremiumGemstone,
  })) });
}
