# GEME AI Technical Drawing

> **Trạng thái:** API AI Studio đã được tháo khỏi ứng dụng. Tài liệu này là đặc tả lưu trữ; luồng bản vẽ AI không khả dụng trong runtime hiện tại. Media và dữ liệu lịch sử được giữ nguyên.

The Image Studio has two separate jobs: deterministic Photoroom background finishing and AI technical-illustration drafts. Technical drawing jobs use the existing authenticated NestJS queue and private media storage; the Python AI Core is reachable only on the internal Docker network.

## Configuration

Set these server-side values in the ignored `.env.docker` file:

```dotenv
GEME_OPENAI_API_KEY=your-server-side-key
GEME_OPENAI_IMAGE_ANALYSIS_MODEL=gpt-6-luna
GEME_OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

The image analysis model defaults to `GEME_OPENAI_TEXT_MODEL` if omitted. The key is passed only to AI Core; it is not returned to Admin or the browser. Starting/recreating the AI Core and API services applies the new route code. Run the pending Prisma migration with the normal API migration startup/deploy workflow before using the feature.

## Admin workflow

1. Open **AI Studio → Image Studio** and choose **Tạo bản vẽ kỹ thuật AI**.
2. Enter the exact product SKU and upload one source photo.
3. The worker asks OpenAI to describe visible details, then generates a standalone warm-ivory technical illustration. The saved output contains no source-photo panel; the original remains stored separately and is only shown for review.
4. Compare the result with the original. Approve or reject it. An approved result remains private until **Gắn tag Ảnh kỹ thuật** is chosen.
5. Attaching writes the public URL to `products.technical_image_url` and stores a durable `TECHNICAL_DRAWING` tag in `product_media_assets`.

Admin agents can query approved/tagged media at `GET /api/admin/ai-studio/image-studio/products/{sku}/technical-drawings`.

## Limits

Each technical drawing uses one image up to 8 MB and creates a single draft per request. Generation may incur OpenAI API charges. Errors are not automatically retried; use the manual retry button to avoid duplicate paid requests. API responses and logs do not include the provider key or raw provider error bodies.

Generated images are AI concept references, not CAD files or verified manufacturing specifications. The model may alter gem count, color, prongs, dimensions, or hidden construction despite the prompt. Every output is flagged for human review; only the admin's explicit approval and attachment make it the product's current technical image. Earlier tagged images remain in the media history.
