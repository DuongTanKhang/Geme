"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./policy-workspace.module.css";

type Policy = { slug: string; title: string; status: "DRAFT" | "PUBLISHED"; content: string; updatedAt?: string };
type Request = (path: string, method?: string, body?: unknown) => Promise<unknown>;

const statusLabel = (status: Policy["status"]) => status === "PUBLISHED" ? "Đang hiển thị trên website" : "Bản nháp · Chưa hiển thị nội dung";

export default function PolicyWorkspace({ request, onNotify }: { request: Request; onNotify?: (message: string) => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [activeSlug, setActiveSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useMemo(() => policies.find((policy) => policy.slug === activeSlug) || policies[0], [policies, activeSlug]);
  const draftCount = policies.filter((policy) => policy.status === "DRAFT").length;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await request("policies") as Policy[];
      const next = Array.isArray(rows) ? rows : [];
      setPolicies(next);
      setActiveSlug((current) => next.some((policy) => policy.slug === current) ? current : next[0]?.slug || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được danh sách chính sách.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const updateActive = (changes: Partial<Policy>) => {
    if (!active) return;
    setPolicies((current) => current.map((policy) => policy.slug === active.slug ? { ...policy, ...changes } : policy));
  };

  const save = async () => {
    if (!policies.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const rows = await request("policies", "PATCH", { policies }) as Policy[];
      setPolicies(Array.isArray(rows) ? rows : policies);
      onNotify?.("Đã lưu nội dung chính sách.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được nội dung chính sách.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="workspace-loading">Đang tải chính sách…</div>;
  if (!policies.length) return <section className={styles.empty}><strong>Chưa tải được chính sách</strong><p>{error || "Kiểm tra kết nối API rồi thử lại."}</p><button className="button button-quiet" type="button" onClick={() => void load()}>Tải lại</button></section>;

  return <section className={styles.workspace}>
    <div className={styles.notice}><strong>{draftCount === policies.length ? "Các văn bản đang ở trạng thái nháp." : `${draftCount} chính sách đang ở trạng thái nháp.`}</strong> Nội dung được trích từ tài liệu GEME đã soạn. Chỉ chính sách chuyển sang “Đang hiển thị” mới được hiện đầy đủ trên storefront.</div>
    <div className={styles.layout}>
      <nav className={styles.list} aria-label="Danh sách chính sách">
        {policies.map((policy) => <button key={policy.slug} type="button" className={`${styles.policyButton} ${active?.slug === policy.slug ? styles.selected : ""}`} onClick={() => setActiveSlug(policy.slug)}>
          <span>{policy.title}</span><small className={policy.status === "PUBLISHED" ? styles.published : ""}>{policy.status === "PUBLISHED" ? "Đang hiển thị" : "Bản nháp"}</small>
        </button>)}
      </nav>
      {active && <div className={styles.editor}>
        <div className={styles.editorHeading}><div><h2>{active.title}</h2><p>Liên kết storefront: <code>/chinh-sach/{active.slug}</code></p></div><span className={`${styles.badge} ${active.status === "PUBLISHED" ? styles.published : ""}`}>{statusLabel(active.status)}</span></div>
        <label className={styles.label}>Tên hiển thị<input value={active.title} maxLength={180} onChange={(event) => updateActive({ title: event.target.value })}/></label>
        <label className={styles.label}>Nội dung chính sách<textarea value={active.content} maxLength={100000} spellCheck onChange={(event) => updateActive({ content: event.target.value })}/><small>{active.content.length.toLocaleString("vi-VN")} / 100.000 ký tự · Giữ dòng trống để chia đoạn.</small></label>
        <label className={styles.publishToggle}><input type="checkbox" checked={active.status === "PUBLISHED"} onChange={(event) => updateActive({ status: event.target.checked ? "PUBLISHED" : "DRAFT" })}/><span><strong>Hiển thị nội dung trên website</strong><small>Tắt để giữ văn bản trong admin dưới dạng bản nháp.</small></span></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}><button type="button" className="button button-quiet" onClick={() => void load()} disabled={saving}>Tải lại dữ liệu đã lưu</button><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu chính sách"}</button></div>
      </div>}
    </div>
  </section>;
}
