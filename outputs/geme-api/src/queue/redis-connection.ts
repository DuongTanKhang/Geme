/**
 * Shared Redis connection configuration for independent BullMQ workflows.
 * Keep this outside feature modules so disabling one queue does not break others.
 */
export function redisConnectionOptions(worker = false) {
  const configuredUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379/2";
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("REDIS_URL phải là URL Redis hợp lệ.");
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL chỉ hỗ trợ redis:// hoặc rediss://.");
  }
  const dbText = url.pathname.replace(/^\//, "");
  const db = dbText ? Number(dbText) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("REDIS_URL có database không hợp lệ.");

  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    enableReadyCheck: true,
    maxRetriesPerRequest: worker ? null : 1,
  };
}
