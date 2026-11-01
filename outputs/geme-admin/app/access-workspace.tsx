"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import styles from "./access-workspace.module.css";

type Row = Record<string, any>;
type PermissionPage = { id: string; label: string; permissions: string[] };
type StaffRole = { id: string; label: string; pages: string[] };
type Props = { request: (path: string, method?: string, body?: unknown) => Promise<any> };

const labels: Record<string, string> = {
  "dashboard.read": "Xem tổng quan", "catalog.read": "Xem sản phẩm, danh mục và loại đá", "catalog.write": "Sửa danh mục sản phẩm",
  "catalog.content.write": "Sửa tên, mô tả và nội dung sản phẩm", "catalog.price.write": "Sửa giá sản phẩm", "catalog.publish": "Ẩn hoặc đăng sản phẩm", "catalog.delete": "Xóa sản phẩm",
  "content.read": "Xem bài viết / Blog và thư viện nội dung", "content.write": "Sửa bài viết / Blog và thư viện nội dung",
  "promotions.read": "Xem khuyến mãi", "promotions.write": "Tạo, sửa và xóa khuyến mãi",
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
  const [pages, setPages] = useState<PermissionPage[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState("");
  const [effects, setEffects] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("sales");
  const [jobTitle, setJobTitle] = useState("Nhân viên bán hàng");
  const [selectedPages, setSelectedPages] = useState<string[]>(["overview", "orders", "customers"]);
  const [resetPassword, setResetPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const selected = useMemo(() => users.find((user) => user.id === selectedId), [users, selectedId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [list, permissionData] = await Promise.all([request("auth/users"), request("auth/permissions")]);
      const nextUsers = Array.isArray(list) ? list : [];
      setUsers(nextUsers);
      setCatalog(Array.isArray(permissionData.permissions) ? permissionData.permissions : []);
      setPages(Array.isArray(permissionData.pages) ? permissionData.pages : []);
      setRoles(Array.isArray(permissionData.roleSuggestions) ? permissionData.roleSuggestions : []);
      setDefaults(permissionData.defaults || {});
      setSelectedId((current) => current && nextUsers.some((user: Row) => user.id === current) ? current : nextUsers[0]?.id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được phân quyền."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const grant of selected?.permissionGrants || []) next[grant.permission] = grant.effect;
    setEffects(next);
    setResetPassword("");
  }, [selected]);

  const chooseRole = (id: string) => {
    const suggestion = roles.find((role) => role.id === id);
    setRoleId(id);
    setJobTitle(suggestion?.label || "");
    setSelectedPages(suggestion?.pages || []);
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (creating) return;
    setCreating(true); setError("");
    try {
      const created = await request("auth/users", "POST", { account, password, jobTitle, pages: selectedPages });
      setUsers((current) => [created, ...current.filter((user) => user.id !== created.id)]);
      setSelectedId(created.id);
      setAccount(""); setPassword("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tạo được tài khoản."); }
    finally { setCreating(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || selected.role === "SUPER_ADMIN" || saving) return;
    setSaving(true); setError("");
    try {
      const grants = catalog.filter((permission) => effects[permission] === "ALLOW" || effects[permission] === "DENY").map((permission) => ({ permission, effect: effects[permission] }));
      const saved = await request(`auth/users/${encodeURIComponent(selected.id)}/permissions`, "PATCH", { grants });
      setUsers((current) => current.map((user) => user.id === saved.id ? saved : user));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được quyền."); }
    finally { setSaving(false); }
  };
  const setActive = async () => {
    if (!selected || saving) return;
    setSaving(true); setError("");
    try {
      const saved = await request(`auth/users/${encodeURIComponent(selected.id)}/status`, "PATCH", { isActive: !selected.isActive });
      setUsers((current) => current.map((user) => user.id === saved.id ? saved : user));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái tài khoản."); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    if (!selected || resettingPassword) return;
    setResettingPassword(true); setError("");
    try {
      await request(`auth/users/${encodeURIComponent(selected.id)}/password`, "PATCH", { password: resetPassword });
      setResetPassword("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không đặt lại được mật khẩu."); }
    finally { setResettingPassword(false); }
  };

  return <div className={styles.workspace}>
    <header className={styles.header}><div><span className={styles.eyebrow}>GEME · BẢO MẬT</span><h1>Vai trò & quyền truy cập</h1><p>Chọn vai trò và các trang nhân viên được phép mở. Tài khoản nội bộ do Admin tạo và quản lý mật khẩu.</p></div><button type="button" className="button button-quiet" onClick={() => void load()} disabled={loading}>Làm mới</button></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <div className={styles.empty}>Đang tải tài khoản…</div> : <>
      <form className={styles.create} onSubmit={create}>
        <div className={styles.createHeading}><div><h2>Tạo tài khoản nhân viên</h2><p>Chỉ cần tài khoản đăng nhập, mật khẩu, vai trò và các trang được phép truy cập.</p></div></div>
        <div className={styles.createFields}>
          <label>Tài khoản đăng nhập<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="off" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="vd: nhanvien01"/><small>3–40 ký tự, không dấu cách.</small></label>
          <label>Mật khẩu ban đầu<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 12 ký tự"/><small>Nhân viên không tự đổi hoặc khôi phục mật khẩu.</small></label>
          <label>Vai trò<select value={roleId} onChange={(event) => chooseRole(event.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select><small>Vai trò gợi ý quyền trang; có thể chỉnh từng trang bên dưới.</small></label>
          {roleId === "custom" && <label>Tên vai trò<input required maxLength={80} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="Ví dụ: Nhân viên bán hàng"/></label>}
        </div>
        <div className={styles.pagePicker}><div><strong>Trang được phép truy cập</strong><small>Không chọn trang thì tài khoản sẽ không mở được các khu vực đó.</small></div><div className={styles.pageGrid}>{pages.map((page) => <label key={page.id} className={styles.pageOption}><input type="checkbox" checked={selectedPages.includes(page.id)} onChange={(event) => setSelectedPages((current) => event.target.checked ? [...current, page.id] : current.filter((id) => id !== page.id))}/><span>{page.label}</span></label>)}</div></div>
        <div className={styles.createActions}><button className="button button-primary" disabled={creating}>{creating ? "Đang tạo…" : "Tạo tài khoản"}</button></div>
      </form>
      <div className={styles.layout}>
        <aside className={styles.users}><h2>Tài khoản quản trị</h2>{users.map((user) => <button key={user.id} type="button" className={selectedId === user.id ? styles.selectedUser : ""} onClick={() => setSelectedId(user.id)}><strong>{user.displayName}</strong><span>{user.username || user.email}</span><small>{user.jobTitle || user.role}{user.isActive ? " · Hoạt động" : " · Đã khóa"}</small></button>)}{!users.length && <div className={styles.empty}>Không tìm thấy tài khoản.</div>}</aside>
        {selected && <form className={styles.editor} onSubmit={save}><div className={styles.editorTitle}><div><h2>{selected.displayName}</h2><p>{selected.username || selected.email} · {selected.jobTitle || selected.role}</p></div><span className={selected.isActive ? styles.active : styles.locked}>{selected.role === "SUPER_ADMIN" ? "Super Admin" : selected.isActive ? "Hoạt động" : "Đã khóa"}</span></div>
          <div className={styles.permissions}>{catalog.map((permission) => { const base = defaults[selected.role]?.includes(permission) || false; const current = effects[permission] || "DEFAULT"; const effective = current === "ALLOW" || (current === "DEFAULT" && base); return <label className={styles.permissionRow} key={permission}><span><strong>{labels[permission] || permission}</strong><small>{permission} · mặc định {base ? "cho phép" : "từ chối"} · hiện tại {effective ? "cho phép" : "từ chối"}</small></span><select disabled={selected.role === "SUPER_ADMIN"} value={current} onChange={(event) => setEffects((state) => ({ ...state, [permission]: event.target.value === "DEFAULT" ? "" : event.target.value }))}><option value="DEFAULT">Theo vai trò</option><option value="ALLOW">Cho phép</option><option value="DENY">Từ chối</option></select></label>; })}</div>
          {selected.role !== "SUPER_ADMIN" && <><div className={styles.actions}><button className="button button-primary" disabled={saving}>{saving ? "Đang lưu…" : "Lưu quyền"}</button><button type="button" className="button button-quiet" onClick={() => void setActive()} disabled={saving}>{selected.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}</button></div><div className={styles.passwordReset}><label>Đặt mật khẩu mới<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Tối thiểu 12 ký tự"/></label><button type="button" className="button button-quiet" disabled={resettingPassword || resetPassword.length < 12} onClick={() => void reset()}>{resettingPassword ? "Đang cập nhật…" : "Admin đặt lại mật khẩu"}</button><small>Đặt lại mật khẩu sẽ đăng xuất phiên hiện có của tài khoản.</small></div></>}
        </form>}
      </div>
    </>}
  </div>;
}
