"use client";

export function TechnicalImagePicker({
  image,
  uploading = false,
  onSelect,
  onRemove,
}: {
  image?: string | null;
  uploading?: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  return <section className="technical-image-picker" aria-label="Ảnh kỹ thuật">
    <div className="technical-image-copy">
      <strong>Ảnh kỹ thuật</strong>
      <span>Ảnh hiển thị cạnh bảng thông số kỹ thuật trên trang chi tiết sản phẩm.</span>
    </div>
    <div className="technical-image-control">
      {image ? <img src={image} alt="Ảnh kỹ thuật sản phẩm"/> : <div className="technical-image-placeholder">Chưa chọn ảnh kỹ thuật</div>}
      <div className="technical-image-actions">
        <label className="technical-image-select">
          <input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onSelect(file); event.currentTarget.value = ""; }}/>
          {uploading ? "Đang xử lý ảnh…" : image ? "Đổi ảnh" : "Chọn ảnh kỹ thuật"}
        </label>
        {image && <button type="button" className="technical-image-remove" onClick={onRemove} disabled={uploading}>Gỡ ảnh</button>}
      </div>
    </div>
  </section>;
}
