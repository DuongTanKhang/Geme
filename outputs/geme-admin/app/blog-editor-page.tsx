"use client";

import { useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { compressProductImage } from "./product-images";

type BlogDraft = Record<string, any> & {
  name: string;
  category: string;
  tags: string[];
  summary: string;
  content: string;
  images: string[];
  status: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  coverImageUrl: string;
};

type Props = {
  post: Record<string, any> | null;
  categories: string[];
  onBack: () => void;
  onSave: (post: BlogDraft) => Promise<void>;
  onSaveCategory: (category: string) => Promise<string[]>;
  onNotify: (message: string) => void;
};

const MAX_INLINE_IMAGES = 6;
const emptyPost = (): BlogDraft => ({ name: "", category: "", tags: [], summary: "", content: "", images: [], status: "Bản nháp", slug: "", seoTitle: "", seoDescription: "", coverImageUrl: "" });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

function inlineImages(content: string): string[] {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  return Array.from(parsed.querySelectorAll("img[src]"), (image) => image.getAttribute("src") || "").filter(Boolean);
}

export default function BlogEditorPage({ post, categories, onBack, onSave, onSaveCategory, onNotify }: Props) {
  const [draft, setDraft] = useState<BlogDraft>(() => ({ ...emptyPost(), ...post, images: Array.isArray(post?.images) ? post.images : [], status: post?.status || "Bản nháp", coverImageUrl: post?.coverImageUrl || post?.images?.[0] || "" }));
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [categoryName, setCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyContent = useRef(draft.content);
  const savedSelection = useRef<Range | null>(null);
  const inlineImageInput = useRef<HTMLInputElement>(null);
  const coverImageInput = useRef<HTMLInputElement>(null);

  const update = (changes: Partial<BlogDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const updateBody = () => { if (bodyRef.current) bodyContent.current = bodyRef.current.innerHTML; };
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && bodyRef.current?.contains(selection.anchorNode)) savedSelection.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    bodyRef.current?.focus();
    if (!savedSelection.current || !bodyRef.current?.contains(savedSelection.current.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedSelection.current);
  };

  const format = (event: MouseEvent<HTMLButtonElement>, command: string, value?: string) => {
    event.preventDefault();
    restoreSelection();
    document.execCommand(command, false, value);
    updateBody();
  };

  const insertLink = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const url = window.prompt("Nhập địa chỉ liên kết (https://...)");
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!(["http:", "https:", "mailto:"].includes(parsed.protocol))) throw new Error();
      restoreSelection();
      document.execCommand("createLink", false, parsed.href);
      updateBody();
    } catch { onNotify("Địa chỉ liên kết chưa hợp lệ."); }
  };

  const handleInlineImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (inlineImages(bodyContent.current).length + files.length > MAX_INLINE_IMAGES) {
      onNotify(`Bài viết có thể chèn tối đa ${MAX_INLINE_IMAGES} ảnh trong nội dung.`);
      return;
    }
    setUploading(true);
    try {
      const sources = await Promise.all(files.map(compressProductImage));
      const editor = bodyRef.current;
      if (!editor) return;
      editor.focus();
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      const html = sources.map((src, index) => {
        const alt = escapeHtml(files[index].name.replace(/\.[^.]+$/, ""));
        return `<figure class="blog-inline-figure"><img src="${src}" alt="${alt}"/><figcaption>${alt}</figcaption></figure><p><br></p>`;
      }).join("");
      document.execCommand("insertHTML", false, html);
      updateBody();
      onNotify(`${sources.length} ảnh đã chèn vào bài viết. Ảnh sẽ được lưu cùng bài viết trong database.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể xử lý ảnh."); }
    finally { setUploading(false); }
  };

  const handleCoverImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try { update({ coverImageUrl: await compressProductImage(file) }); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Không thể xử lý ảnh bìa."); }
    finally { setUploading(false); }
  };

  const addCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = categoryName.trim();
    if (!value) return;
    try {
      const next = await onSaveCategory(value);
      setCategoryOptions(next);
      update({ category: value });
      setCategoryName("");
      setAddingCategory(false);
      onNotify(`Đã lưu danh mục “${value}” vào database.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu danh mục."); }
  };

  const save = async (status: "Bản nháp" | "Đã xuất bản") => {
    const content = bodyRef.current?.innerHTML ?? bodyContent.current;
    if (!draft.name.trim()) { onNotify("Nhập tiêu đề bài viết trước khi lưu."); return; }
    const text = bodyRef.current?.innerText.trim() || "";
    if (!text && !inlineImages(content).length) { onNotify("Thêm nội dung hoặc ảnh vào bài viết trước khi lưu."); return; }
    if (!draft.category) { onNotify("Chọn hoặc tạo danh mục cho bài viết."); return; }
    setSaving(true);
    try {
      const editorImages = inlineImages(content);
      const images = Array.from(new Set([draft.coverImageUrl, ...editorImages, ...draft.images].filter(Boolean))).slice(0, 12);
      await onSave({ ...draft, content, images, status, coverImageUrl: draft.coverImageUrl || editorImages[0] || images[0] || "" });
    } catch (error) { onNotify(error instanceof Error ? error.message : "Không thể lưu bài viết vào database."); }
    finally { setSaving(false); }
  };

  const toolbarButton = (label: string, title: string, command: string, value?: string, text?: React.ReactNode) => <button type="button" aria-label={label} title={title} onMouseDown={(event) => format(event, command, value)}>{text || label}</button>;

  return <div className="blog-editor-page">
    <header className="blog-editor-topbar"><button className="blog-editor-back" onClick={onBack} aria-label="Quay lại danh sách">← <span>Danh sách bài viết</span></button><div className="blog-editor-brand"><strong>G E M E</strong><span>TRÌNH SOẠN THẢO</span></div><div className="blog-editor-top-actions"><span className="blog-save-indicator"><i/> Lưu vào PostgreSQL</span><button className="button button-quiet" disabled={saving || uploading} onClick={() => void save("Bản nháp")}>{saving ? "Đang lưu…" : "Lưu nháp"}</button><button className="button button-primary" disabled={saving || uploading} onClick={() => void save("Đã xuất bản")}>{saving ? "Đang lưu…" : "Xuất bản"}</button></div></header>

    <div className="blog-editor-layout">
      <main className="blog-document-workspace">
        <div className="blog-document-caption"><div><span className="blog-document-dot"/><span>{post?.apiId ? "CHỈNH SỬA BÀI VIẾT" : "BÀI VIẾT MỚI"}</span></div><span>{uploading ? "Đang nén ảnh…" : "Nội dung được lưu trong database"}</span></div>
        <div className="blog-format-toolbar" role="toolbar" aria-label="Công cụ định dạng bài viết">
          <select aria-label="Kiểu văn bản" defaultValue="p" onMouseDown={rememberSelection} onChange={(event) => { restoreSelection(); document.execCommand("formatBlock", false, event.target.value); updateBody(); }}><option value="p">Đoạn văn</option><option value="h1">Tiêu đề 1</option><option value="h2">Tiêu đề 2</option><option value="h3">Tiêu đề 3</option><option value="blockquote">Trích dẫn</option></select>
          <i/>{toolbarButton("In đậm", "In đậm", "bold", undefined, <b>B</b>)}{toolbarButton("In nghiêng", "In nghiêng", "italic", undefined, <i>I</i>)}{toolbarButton("Gạch chân", "Gạch chân", "underline", undefined, <u>U</u>)}{toolbarButton("Gạch ngang", "Gạch ngang", "strikeThrough", undefined, <s>S</s>)}
          <i/>{toolbarButton("Danh sách có thứ tự", "Danh sách có thứ tự", "insertOrderedList", undefined, "1.")}{toolbarButton("Danh sách dấu đầu dòng", "Danh sách dấu đầu dòng", "insertUnorderedList", undefined, "☷")}
          <i/>{toolbarButton("Căn trái", "Căn trái", "justifyLeft", undefined, "⇤")}{toolbarButton("Căn giữa", "Căn giữa", "justifyCenter", undefined, "↔")}{toolbarButton("Căn phải", "Căn phải", "justifyRight", undefined, "⇥")}
          <i/><button type="button" title="Chèn liên kết" aria-label="Chèn liên kết" onMouseDown={(event) => { event.preventDefault(); rememberSelection(); }} onClick={insertLink}>↗</button><button type="button" title="Chèn ảnh vào nội dung" aria-label="Chèn ảnh vào nội dung" onMouseDown={(event) => { event.preventDefault(); rememberSelection(); }} onClick={() => inlineImageInput.current?.click()}>▧</button><button type="button" title="Đường kẻ ngang" aria-label="Đường kẻ ngang" onMouseDown={(event) => format(event, "insertHorizontalRule")}>―</button>
          <i/>{toolbarButton("Hoàn tác", "Hoàn tác", "undo", undefined, "↶")}{toolbarButton("Làm lại", "Làm lại", "redo", undefined, "↷")}{toolbarButton("Xóa định dạng", "Xóa định dạng", "removeFormat", undefined, "Tx")}
          <input ref={inlineImageInput} className="blog-hidden-file" type="file" accept="image/*" multiple onChange={(event) => void handleInlineImage(event)}/>
        </div>
        <div className="blog-paper-wrap"><article className="blog-paper">
          <input className="blog-paper-title" style={{fontFamily:'"Segoe UI", Arial, sans-serif',letterSpacing:"normal"}} value={draft.name} maxLength={180} onChange={(event) => update({ name: event.target.value })} placeholder="Tiêu đề bài viết" aria-label="Tiêu đề bài viết"/>
          <textarea className="blog-paper-summary" style={{fontFamily:'"Segoe UI", Arial, sans-serif',letterSpacing:"normal"}} value={draft.summary} maxLength={500} onChange={(event) => update({ summary: event.target.value })} placeholder="Viết một đoạn giới thiệu ngắn cho bài viết..." aria-label="Mô tả ngắn"/>
          <div key={String(post?.apiId || "new")} ref={bodyRef} className="blog-paper-body" style={{fontFamily:'"Segoe UI", Arial, sans-serif',letterSpacing:"normal"}} contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: draft.content }} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onInput={updateBody} data-placeholder="Bắt đầu viết bài tại đây. Dùng thanh công cụ để định dạng, hoặc chèn ảnh giữa các đoạn văn..."/>
          <div className="blog-paper-footer">GEME JOURNAL <span>•</span> Bản thảo được lưu vào PostgreSQL khi bấm Lưu nháp hoặc Xuất bản</div>
        </article></div>
      </main>

      <aside className="blog-editor-properties">
        <section className="blog-property-card"><h2>Thuộc tính bài viết</h2><label className="blog-property-field"><span>Danh mục <b>*</b></span><select value={draft.category} onChange={(event) => update({ category: event.target.value })}><option value="">Chọn danh mục</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>
          <button className="blog-add-category-trigger" type="button" onClick={() => setAddingCategory((value) => !value)}>＋ Thêm loại bài viết</button>
          {addingCategory && <form className="blog-create-category" onSubmit={(event) => void addCategory(event)}><input autoFocus value={categoryName} onChange={(event) => setCategoryName(event.target.value)} maxLength={120} placeholder="Ví dụ: Cẩm nang đá quý"/><button type="submit">Lưu loại</button></form>}
          <label className="blog-property-field"><span>Thẻ tag</span><input value={draft.tags.join(", ")} onChange={(event) => update({ tags: event.target.value.split(",").map((tag: string) => tag.trim()).filter(Boolean) })} placeholder="Đá quý, phong thủy..."/><small>Phân cách các thẻ bằng dấu phẩy</small></label>
          <div className="blog-property-field"><span>Ảnh bìa</span><input ref={coverImageInput} className="blog-hidden-file" type="file" accept="image/*" onChange={(event) => void handleCoverImage(event)}/>{draft.coverImageUrl ? <div className="blog-cover-preview"><img src={draft.coverImageUrl} alt="Ảnh bìa"/><button type="button" onClick={() => update({ coverImageUrl: "" })}>Gỡ ảnh bìa</button></div> : <button type="button" className="blog-cover-picker" disabled={uploading} onClick={() => coverImageInput.current?.click()}><strong>＋</strong><span>Chọn ảnh bìa (không bắt buộc)</span><small>Ảnh tự được nén trước khi lưu</small></button>}</div>
        </section>
        <section className="blog-property-card"><h2>Đường dẫn và SEO</h2><label className="blog-property-field"><span>Slug</span><input value={draft.slug} maxLength={220} onChange={(event) => update({ slug: event.target.value })} placeholder="Tự tạo theo tiêu đề"/><small>Để trống để tự tạo từ tiêu đề bài viết.</small></label><label className="blog-property-field"><span>Tiêu đề SEO</span><input value={draft.seoTitle} maxLength={180} onChange={(event) => update({ seoTitle: event.target.value })} placeholder={draft.name || "Tiêu đề hiển thị trên Google"}/></label><label className="blog-property-field"><span>Mô tả SEO</span><textarea value={draft.seoDescription} maxLength={320} onChange={(event) => update({ seoDescription: event.target.value })} rows={3} placeholder="Mô tả ngắn cho công cụ tìm kiếm"/></label></section>
        <section className="blog-property-note"><strong>Ảnh trong bài viết</strong><p>Chèn tối đa {MAX_INLINE_IMAGES} ảnh vào giữa nội dung. Hệ thống tự tối ưu và lưu ảnh cùng bài viết trong database.</p></section>
      </aside>
    </div>
  </div>;
}
