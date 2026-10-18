import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminShell from "./admin-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const token = (await cookies()).get("geme_admin_session")?.value;
  if (!token) redirect("/login");

  const apiBase = (process.env.GEME_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000/api/v1").replace(/\/+$/, "");
  try {
    const response = await fetch(`${apiBase}/admin/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401 || response.status === 403) redirect("/login");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    // Keep the authenticated shell available during a short API outage; its
    // requests remain protected server-side and show the existing offline state.
  }

  return <AdminShell />;
}
