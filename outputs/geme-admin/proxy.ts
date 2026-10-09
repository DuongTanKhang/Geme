import { NextRequest, NextResponse } from "next/server";

/**
 * Codex's local browser forwards `localhost` to the workspace app, while the
 * literal loopback address can resolve inside the browser container instead.
 * Keep ordinary local-browser navigation on the same working admin origin.
 */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return NextResponse.next();

  const host = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
  const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
  const isDocument = request.headers.get("sec-fetch-dest") === "document" || acceptsHtml;
  if (host !== "127.0.0.1" || !isDocument) return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.hostname = "localhost";
  return NextResponse.redirect(destination, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
