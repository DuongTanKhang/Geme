"use client";

import { useMemo, useState } from "react";

type BlogPost = Record<string, any> & {
  id: string;
  name: string;
  category: string;
  author: string;
  date: string;
  status: string;
  views: number;
  summary: string;
  images: string[];
};

type Props = {
  posts: Record<string, any>[];
  categories: string[];
  onCreate: () => void;
  onEdit: (post: BlogPost) => void;
  onDelete: (post: BlogPost) => Promise<void>;
  onNotify: (message: string) => void;
};

const formatCount = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(1).replace(".0", "")}K` : String(count);
const normalizePosts = (saved: Record<string, any>[]): BlogPost[] => saved.map((item, index) => ({
  ...item,
  id: String(item.apiId || item.id || `POST-${index + 1}`),
  name: String(item.name || item.title || ""),
  category: String(item.category || ""),
  author: String(item.author || "Admin"),
  date: String(item.date || ""),
  status: String(item.status || "Bản nháp"),
  views: Number(item.views) || 0,
  summary: String(item.summary || ""),
  images: Array.isArray(item.images) ? item.images : [],
}));

function statusClass(status: string) { return status === "Đã xuất bản" ? "published" : status === "Đã lên lịch" ? "scheduled" : "draft"; }

export default function BlogWorkspace({ posts, categories, onCreate, onEdit, onDelete, onNotify }: Props) {
  const allPosts = useMemo(() => normalizePosts(posts), [posts]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("Tất cả danh mục");
  const [filterStatus, setFilterStatus] = useState("Tất cả trạng thái");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState("");

  const filtered = useMemo(() => allPosts.filter((post) => {
    const matchesSearch = !search.trim() || `${post.name} ${post.summary} ${post.category} ${(post.tags || []).join(" ")}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
    const matchesCategory = filterCategory === "Tất cả danh mục" || post.category === filterCategory;
    const matchesStatus = filterStatus === "Tất cả trạng thái" || post.status === filterStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  }), [allPosts, search, filterCategory, filterStatus]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const publishedCount = allPosts.filter((post) => post.status === "Đã xuất bản").length;
  const draftCount = allPosts.filter((post) => post.status === "Bản nháp").length;

  const deletePost = async (post: BlogPost) => {
    if (!window.confirm(`Xóa bài viết “${post.name}” khỏi database?`)) return;
    setDeleting(post.id);
    try { await onDelete(post); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể xóa bài viết khỏi database."); }
    finally { setDeleting(""); }
  };

  return <div className="blog-workspace blog-list-workspace">
    <main className="blog-main">
      <div className="blog-heading"><div><h1>Bài viết / Blog</h1><p>Quản lý bài viết và chủ đề nội dung của GEME.</p></div><button className="button button-primary" onClick={onCreate}><span>＋</span>Tạo bài viết mới</button></div>
      <section className="blog-stats" aria-label="Thống kê bài viết">
        <article className="blog-stat"><span className="blog-stat-icon mint">▱</span><div><small>Tổng bài viết</small><strong>{allPosts.length}</strong></div></article>
        <article className="blog-stat"><span className="blog-stat-icon green">▣</span><div><small>Bài viết đã xuất bản</small><strong>{publishedCount}</strong></div></article>
        <article className="blog-stat"><span className="blog-stat-icon purple">▧</span><div><small>Bản nháp</small><strong>{draftCount}</strong></div></article>
        <article className="blog-stat"><span className="blog-stat-icon teal">⌁</span><div><small>Lượt xem</small><strong>{formatCount(allPosts.reduce((sum, post) => sum + post.views, 0))}</strong></div></article>
      </section>
      <section className="blog-list-panel">
        <div className="blog-toolbar">
          <label className="blog-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm tiêu đề, nội dung..." aria-label="Tìm bài viết"/></label>
          <select value={filterCategory} onChange={(event) => { setFilterCategory(event.target.value); setPage(1); }} aria-label="Lọc danh mục"><option>Tất cả danh mục</option>{Array.from(new Set([...categories, ...allPosts.map((post) => post.category).filter(Boolean)])).map((category) => <option key={category}>{category}</option>)}</select>
          <select value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value); setPage(1); }} aria-label="Lọc trạng thái"><option>Tất cả trạng thái</option><option>Đã xuất bản</option><option>Bản nháp</option><option>Đã lên lịch</option></select>
        </div>
        <div className="blog-table-scroll"><table className="blog-table"><thead><tr><th>Tiêu đề</th><th>Danh mục</th><th>Tác giả</th><th>Ngày đăng</th><th>Trạng thái</th><th>Lượt xem</th><th>Thao tác</th></tr></thead><tbody>
          {pageRows.length ? pageRows.map((post) => <tr key={post.id}>
            <td><button className="blog-title-cell blog-title-button" onClick={() => onEdit(post)}>{post.images[0] ? <img src={post.images[0]} alt=""/> : <span className="blog-image-placeholder">▧</span>}<span><strong>{post.name}</strong></span></button></td>
            <td><span className={`blog-category ${post.category === "Đá quý" ? "gem" : post.category === "Trang sức" ? "jewelry" : post.category === "Tư vấn" ? "advice" : post.category === "Phong thủy" ? "fengshui" : "trend"}`}>{post.category || "Chưa phân loại"}</span></td>
            <td>{post.author}</td><td className="blog-date-cell">{post.date || "—"}</td><td><span className={`blog-status ${statusClass(post.status)}`}><i/>{post.status}</span></td><td>{formatCount(post.views)}</td>
            <td><div className="blog-row-actions">{post.status === "Đã xuất bản" && post.slug && <a aria-label={`Xem ${post.name}`} href={`http://localhost:3000/blog/${encodeURIComponent(post.slug)}`} target="_blank" rel="noreferrer">◉</a>}<button aria-label={`Sửa ${post.name}`} onClick={() => onEdit(post)}>✎</button><button disabled={deleting === post.id} aria-label={`Xóa ${post.name}`} onClick={() => void deletePost(post)}>{deleting === post.id ? "…" : "×"}</button></div></td>
          </tr>) : <tr><td colSpan={7} className="blog-empty">{allPosts.length ? "Không tìm thấy bài viết phù hợp." : "Chưa có bài viết. Hãy tạo bài đầu tiên cho GEME."}</td></tr>}
        </tbody></table></div>
        <div className="blog-pagination"><span>Hiển thị {filtered.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filtered.length)} / {filtered.length} bài viết</span><div><button disabled={page === 1} aria-label="Trang trước" onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} className={page === number ? "current" : ""} onClick={() => setPage(number)}>{number}</button>)}<button disabled={page >= pageCount} aria-label="Trang sau" onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button></div></div>
      </section>
      <section className="blog-category-manager"><div><div><h2>Danh mục bài viết</h2><p>Các loại bài viết lưu trong database và dùng để phân loại trên website.</p></div><button className="button button-quiet" onClick={() => onNotify("Có thể tạo danh mục mới ngay trong trang soạn bài.")}>＋ Tạo trong lúc soạn</button></div><div>{categories.length ? categories.map((category) => <span key={category}>{category}</span>) : <small>Chưa có danh mục. Danh mục đầu tiên có thể tạo ngay trong trình soạn thảo.</small>}</div></section>
    </main>
  </div>;
}
