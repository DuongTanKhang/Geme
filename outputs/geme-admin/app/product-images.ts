export const MAX_PRODUCT_IMAGES = 10;
export const MAX_VARIANT_MEDIA_ITEMS = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 780_000;

export function compressProductImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Hãy chọn một tệp hình ảnh."));
    if (file.size > 20 * 1024 * 1024) return reject(new Error("Mỗi ảnh cần nhỏ hơn 20 MB trước khi tải lên."));

    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        for (const dimension of [2000, 1600, 1200]) {
          const ratio = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Không xử lý được ảnh này.");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          for (const quality of [0.84, 0.76, 0.68, 0.58, 0.48]) {
            const compressed = canvas.toDataURL("image/webp", quality);
            if (compressed.length <= MAX_IMAGE_DATA_URL_LENGTH) {
              URL.revokeObjectURL(source);
              resolve(compressed);
              return;
            }
          }
        }
        throw new Error("Ảnh quá phức tạp để nén. Hãy chọn ảnh có kích thước nhỏ hơn.");
      } catch (error) {
        URL.revokeObjectURL(source);
        reject(error);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Không đọc được tệp ảnh.")); };
    image.src = source;
  });
}

export function parsePriceInput(value: string): number {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}
