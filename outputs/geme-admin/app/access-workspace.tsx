"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./access-workspace.module.css";

type Row = Record<string, any>;
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<any> };
const labels: Record<string, string> = {
  "dashboard.read": "Xem tổng quan", "catalog.read": "Xem sản phẩm, danh mục và loại đá", "catalog.write": "Sửa danh mục sản phẩm",
  "catalog.content.write": "Sửa tên, mô tả và nội dung sản phẩm", "catalog.price.write": "Sửa giá sản phẩm", "catalog.publish": "Ẩn hoặc đăng sản phẩm", "catalog.delete": "Xóa sản phẩm",
  "content.read": "Xem nội dung, bài viết và khuyến mãi", "content.write": "Sửa nội dung, bài viết và khuyến mãi",
  "orders.read": "Xem đơn hàng", "orders.write": "Cập nhật đơn hàng", "customers.read": "Xem khách hàng", "customers.write": "Sửa khách hàng",
  "inventory.read": "Xem tồn kho và lịch sử", "inventory.write": "Nhập, xuất và điều chỉnh kho", "returns.read": "Xem phiếu trả hàng",
  "returns.manage": "Tạo và xử lý phiếu trả hàng", "finance.read": "Xem thanh toán và bảng COD", "finance.manage": "Ghi nhận hoàn tiền và đối soát COD",
  "audit.read": "Xem nhật ký quản trị", "access.manage": "Quản lý quyền tài khoản", "settings.manage": "Sửa cài đặt cửa hàng",
  "integrations.read": "Xem kết nối POS và marketplace", "integrations.manage": "Quản lý kết nối và đồng bộ POS/marketplace",
  "shipping.read": "Xem vận đơn", "shipping.manage": "Tạo vận đơn và nhãn giao hàng", "social.read": "Xem nội dung mạng xã hội",
  "social.draft": "Soạn nội dung mạng xã hội", "social.approve": "Duyệt nội dung mạng xã hội", "social.publish": "Đăng và quản lý lịch đăng", "social.connect": "Kết nối hoặc ngắt kết nối Meta",
  "social.manage": "Quyền cũ: soạn, duyệt, đăng và kết nối mạng xã hội", "ai-studio.read": "Xem AI Studio", "ai-studio.draft": "Tạo và sửa bản nháp AI",
  "ai-studio.approve": "Duyệt nội dung và ảnh AI", "ai-studio.manage": "Quyền cũ: tạo và duyệt tác vụ AI",
};

export default function AccessWorkspace({ request }: Props) {
  const [users, setUsers] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState("");
  const [effects, setEffects] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => users.find((user) => user.id === selectedId), [users, selectedId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [list, permissionData] = await Promise.all([request("auth/users"), request("auth/permissions")]);
      setUsers(Array.isArray(list) ? list : []); setCatalog(permissionData.permissions || []); setDefaults(permissionData.defaults || {});
      setSelectedId((current) => current && list.some((user: Row) => user.id === current) ? current : list[0]?.id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được phân quyền."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const grant of selected?.permissionGrants || []) next[grant.permission] = grant.effect;
    setEffects(next);
  }, [selected]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || selected.role === "SUPER_ADMIN") return;
    setSaving(true); setError("");
    try {
      const grants = catalog.filter((permission) => effects[permission] === "ALLOW" || effects[permission] === "DENY").map((permission) => ({ permission, effect: effects[permission] }));
      const saved = await request(`auth/users/${selected.id}/permissions`, "PATCH", { grants });
      setUsers((current) => current.map((user) => user.id === saved.id ? saved : user));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được quyền."); }
    finally { setSaving(false); }
  };

  return <div className={styles.workspace}>
    <header className={styles.header}><div><span className={styles.eyebrow}>GEME · BẢO MẬT</span><h1>Vai trò & quyền truy cập</h1><p>Cấp quyền theo chức năng; mọi thay đổi quyền được ghi vào nhật ký quản trị.</p></div><button type="button" className="button button-quiet" onClick={() => void load()} disabled={loading}>Làm mới</button></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <div className={styles.empty}>Đang tải tài khoản…</div> : <div className={styles.layout}>
      <aside className={styles.users}><h2>Tài khoản quản trị</h2>{users.map((user) => <button key={user.id} type="button" className={selectedId === user.id ? styles.selectedUser : ""} onClick={() => setSelectedId(user.id)}><strong>{user.displayName}</strong><span>{user.email}</span><small>{user.role}{user.isActive ? " · Hoạt động" : " · Đã khóa"}</small></button>)}{!users.length && <div className={styles.empty}>Không tìm thấy tài khoản.</div>}</aside>
      {selected && <form className={styles.editor} onSubmit={save}><div className={styles.editorTitle}><div><h2>{selected.displayName}</h2><p>{selected.email} · quyền mặc định theo vai trò <strong>{selected.role}</strong></p></div>{selected.role === "SUPER_ADMIN" && <span className={styles.locked}>Super Admin · không thể sửa</span>}</div>
        <div className={styles.permissions}>{catalog.map((permission) => { const base = defaults[selected.role]?.includes(permission) || false; const current = effects[permission] || "DEFAULT"; const effective = current === "ALLOW" || (current === "DEFAULT" && base); return <label className={styles.permissionRow} key={permission}><span><strong>{labels[permission] || permission}</strong><small>{permission} · mặc định {base ? "cho phép" : "từ chối"} · hiện tại {effective ? "cho phép" : "từ chối"}</small></span><select disabled={selected.role === "SUPER_ADMIN"} value={current} onChange={(event) => setEffects((state) => ({ ...state, [permission]: event.target.value === "DEFAULT" ? "" : event.target.value }))}><option value="DEFAULT">Theo vai trò</option><option value="ALLOW">Cho phép</option><option value="DENY">Từ chối</option></select></label>; })}</div>
        {selected.role !== "SUPER_ADMIN" && <div className={styles.actions}><button className="button button-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu quyền"}</button></div>}
      </form>}
    </div>}
  </div>;
}
