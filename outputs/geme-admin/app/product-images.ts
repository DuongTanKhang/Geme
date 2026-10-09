import { apiBaseUrl } from "../lib/api";

export const MAX_PRODUCT_IMAGES = 10;
export const MAX_VARIANT_MEDIA_ITEMS = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 780_000;
const IMAGE_TARGET_BYTES = 560_000;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không đọc được ảnh đã nén."));
    reader.onerror = () => reject(new Error("Không đọc được ảnh đã nén."));
    reader.readAsDataURL(blob);
  });
}

async function saveMedia(dataUrl: string, filename: string, alt: string): Promise<string> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Dữ liệu media không hợp lệ.");
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));
  const response = await fetch(`${apiBaseUrl}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, mimeType, base64: dataUrl.slice(comma + 1), alt }),
  });
  if (!response.ok) {
    let message = "Không thể tải media lên GEME.";
    try {
      const body = await response.json();
      message = Array.isArray(body.message) ? body.message.join(" ") : body.message || message;
    } catch { /* use the fallback message */ }
    throw new Error(message);
  }
  const asset = await response.json() as { url?: string };
  if (!asset.url) throw new Error("API chưa trả đường dẫn media đã lưu.");
  return asset.url;
}

export async function uploadProductImage(file: File, filename: string, alt: string): Promise<string> {
  return saveMedia(await compressProductImage(file), filename, alt);
}

export async function uploadProductVideo(file: File, filename: string, alt: string): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase().split(";", 1)[0] || (extension === "webm" ? "video/webm" : extension === "mp4" ? "video/mp4" : "");
  if (mimeType !== "video/mp4" && mimeType !== "video/webm") throw new Error("Chỉ nhận video MP4 hoặc WebM.");
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("Video tối đa 8 MB.");
  return saveMedia(await blobToDataUrl(file), filename, alt);
}

export function compressProductImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Hãy chọn một tệp hình ảnh."));
    if (file.size > 20 * 1024 * 1024) return reject(new Error("Mỗi ảnh cần nhỏ hơn 20 MB trước khi tải lên."));

    const source = URL.createObjectURL(file);
    const image = new Image();
    const releaseSource = () => URL.revokeObjectURL(source);
    image.onload = async () => {
      try {
        let chosen: Blob | null = null;
        for (const [dimension, quality] of [[1800, 0.82], [1450, 0.76], [1200, 0.7]] as const) {
          const ratio = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Không xử lý được ảnh này.");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((blobResolve) => canvas.toBlob(blobResolve, "image/webp", quality));
          if (!blob) throw new Error("Không thể nén ảnh này.");
          chosen = blob;
          if (blob.size <= IMAGE_TARGET_BYTES) break;
        }
        if (!chosen) throw new Error("Không thể nén ảnh này.");
        const dataUrl = await blobToDataUrl(chosen);
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("Ảnh quá phức tạp để nén. Hãy chọn ảnh có kích thước nhỏ hơn.");
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      } finally {
        releaseSource();
      }
    };
    image.onerror = () => { releaseSource(); reject(new Error("Không đọc được tệp ảnh.")); };
    image.src = source;
  });
}

export function parsePriceInput(value: string): number {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}
