import { headers } from "next/headers";
import { serializeJsonLd } from "../lib/seo";

export async function StructuredData({ value }: { value: Record<string, unknown> }) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(value) }} />;
}
