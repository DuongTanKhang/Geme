import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const nextCli = resolve("node_modules/next/dist/bin/next");
const server = spawn(process.execPath, [nextCli, "dev", ...process.argv.slice(2)], { stdio: "inherit" });
const origin = (process.env.NEXT_DEV_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "");
const apiBase = (process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1").replace(/\/$/, "");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));

async function warmBlogRoute() {
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null) return;
    try {
      const response = await fetch(`${origin}/blog`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) {
    console.warn("[blog-warmup] Storefront did not become ready; skipping article prewarm.");
    return;
  }

  await warmAuthRoutes();

  try {
    const response = await fetch(`${apiBase}/blog?view=storefront-list&limit=1`, { signal: AbortSignal.timeout(5000) });
    const value = response.ok ? await response.json() : [];
    const posts = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
    const slug = posts.find((post) => typeof post?.slug === "string")?.slug;
    if (!slug) {
      console.info("[blog-warmup] No published articles to prewarm.");
      return;
    }
    const articleResponse = await fetch(`${origin}/blog/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(30000) });
    if (articleResponse.ok) console.info(`[blog-warmup] Article route ready: /blog/${slug}`);
    else console.warn(`[blog-warmup] Article route warmup returned ${articleResponse.status}.`);
  } catch (error) {
    console.warn(`[blog-warmup] Could not prewarm the article route: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function warmAuthRoutes() {
  const warmups = [
    ["register", { email: "", password: "", phone: "" }],
    ["login", { email: "", password: "" }],
  ];

  for (const [route, body] of warmups) {
    try {
      const response = await fetch(`${origin}/api/auth/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 400) console.info(`[auth-warmup] /api/auth/${route} ready.`);
      else console.warn(`[auth-warmup] /api/auth/${route} returned ${response.status}.`);
    } catch (error) {
      console.warn(`[auth-warmup] Could not prewarm /api/auth/${route}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}

void warmBlogRoute();
