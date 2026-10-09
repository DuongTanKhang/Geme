import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxyPos365(request: NextRequest, { params }: RouteContext) {
  const { path } = await params;
  if (!path?.length) {
    return NextResponse.json({ message: "Thiếu đường dẫn POS365." }, { status: 404 });
  }

  const apiBase = (
    process.env.GEME_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://127.0.0.1:4000/api/v1"
  ).replace(/\/+$/, "");
  const incomingUrl = new URL(request.url);
  const targetUrl = `${apiBase}/integrations/pos365/${path
    .map((segment) => encodeURIComponent(segment))
    .join("/")}${incomingUrl.search}`;

  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(hasBody && request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type") as string }
          : {}),
      },
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const headers = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { message: "Không kết nối được API GEME để kiểm tra POS365. Vui lòng thử lại." },
      { status: 502 },
    );
  }
}

export const GET = proxyPos365;
export const POST = proxyPos365;
