"use client";

export function TechnicalImagePicker({
  image,
  video,
  uploading = false,
  uploadingVideo = false,
  onSelect,
  onSelectVideo,
  onRemove,
  onRemoveVideo,
}: {
  image?: string | null;
  video?: string | null;
  uploading?: boolean;
  uploadingVideo?: boolean;
  onSelect: (file: File) => void;
  onSelectVideo: (file: File) => void;
  onRemove: () => void;
  onRemoveVideo: () => void;
}) {
  const busy = uploading || uploadingVideo;
  return <section className="technical-image-picker" aria-label="Ảnh hoặc video kỹ thuật">
    <div className="technical-image-copy">
      <strong>Ảnh / video kỹ thuật</strong>
      <span>Hiển thị cạnh bảng thông số ở trang chi tiết. Chọn ảnh hoặc video; video hỗ trợ MP4/WebM tối đa 8 MB.</span>
    </div>
    <div className="technical-image-control">
      {video ? <video src={video} controls playsInline preload="metadata" aria-label="Video kỹ thuật sản phẩm"/> : image ? <img src={image} alt="Ảnh kỹ thuật sản phẩm"/> : <div className="technical-image-placeholder">Chưa chọn ảnh hoặc video</div>}
      <div className="technical-image-actions">
        <label className="technical-image-select">
          <input type="file" accept="image/*" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onSelect(file); event.currentTarget.value = ""; }}/>
          {uploading ? "Đang xử lý ảnh…" : image ? "Đổi ảnh" : "Chọn ảnh"}
        </label>
        <label className="technical-image-select">
          <input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onSelectVideo(file); event.currentTarget.value = ""; }}/>
          {uploadingVideo ? "Đang tải video…" : video ? "Đổi video" : "Chọn video"}
        </label>
        {(image || video) && <button type="button" className="technical-image-remove" onClick={video ? onRemoveVideo : onRemove} disabled={busy}>Gỡ {video ? "video" : "ảnh"}</button>}
      </div>
    </div>
  </section>;
}
