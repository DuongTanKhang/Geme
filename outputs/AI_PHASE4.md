# GEME AI Studio — Phase 4 (Sales & Marketing)

## Đối chiếu roadmap

- Phase 1/2 đã có trong repository: AI Studio core, queue/worker, AI Core và Image Studio.
- Trong working tree hiện tại có phần triển khai Product Agent của Phase 3; đây là thay đổi local chưa được xem là đã deploy hoặc nghiệm thu end-to-end.
- Trước lượt này Phase 4A/4B chưa có workspace, API, schema hay xử lý AI riêng. Phase này bổ sung Sales Agent thử nghiệm nội bộ và Marketing Agent tạo nội dung nháp.

## Phạm vi đã triển khai

### Sales Agent — chỉ dùng nội bộ Admin

- Trả lời câu hỏi từ danh mục sản phẩm `ACTIVE`, có tồn kho; chỉ nhận giá/tồn kho từ NestJS.
- Tra cứu FAQ/chính sách đã được quản trị viên kích hoạt và còn hiệu lực; lưu từng phiên bản, nguồn, ngày hiệu lực và người duyệt.
- Có giới hạn ngân sách, gợi ý sản phẩm kèm đường dẫn, trích nguồn, handoff khi thiếu dữ kiện và analytics tổng hợp 30 ngày.
- Câu hỏi có email, số điện thoại, thông tin đơn hàng/hồ sơ riêng tư được thay bằng lời nhắc hỗ trợ chung trước khi tạo task. Không truy vấn đơn hàng/khách hàng.
- Worker đọc lại trạng thái, tồn kho, giá và phiên bản chính sách sát thời điểm gọi AI và xác thực lại kết quả trước khi trả; thay đổi giữa chừng sẽ chuyển nhân viên.
- Nội dung câu hỏi trong `AiTask.input` được thay bằng fingerprint sau khi xử lý; logs không ghi câu hỏi.
- Không có chat công khai trên storefront, không sửa sản phẩm/giá/tồn kho/đơn hàng.

### Marketing Agent — tạo nội dung để người duyệt

- Chọn 1–12 sản phẩm `ACTIVE`, còn hàng; tạo caption, nội dung dài, SEO title/meta, alt text và hashtag theo kênh.
- Sản phẩm được kiểm tra lại trước khi đưa vào prompt; dữ kiện nguồn và cảnh báo được lưu kèm bản nháp.
- Admin có thể sửa, duyệt, từ chối, thử lại và tải Markdown sau khi duyệt.
- Duyệt chỉ là ghi nhận nội bộ: không đăng mạng xã hội, không gửi email, không xuất bản CMS.
- Không sửa giá, tồn kho hay bản ghi sản phẩm.

### Hạ tầng

- Dùng lại AEGIS/AdminAuthGuard, NestJS, Prisma/PostgreSQL, AI Redis/BullMQ, worker và FastAPI AI Core; không thêm dịch vụ hay khóa nhà cung cấp mới.
- Thêm migration tăng dần `outputs/geme-api/prisma/migrations/20261022000000_ai_phase4_sales_marketing/`.
- Dùng khóa OpenAI hiện có ở server-side AI Core. Không trả khóa về Admin/browser.

## Mở giao diện

Trong Admin vào **AI Studio → Sales Agent** để thử câu tư vấn và quản lý FAQ/chính sách; vào **AI Studio → Marketing Agent** để tạo và rà soát nội dung.

Để Sales Agent trả lời từ chính sách, tạo tài liệu với nguồn đã được GEME xác nhận, sau đó nhấn **Kích hoạt**. Tài liệu nháp không được đưa vào prompt.

## API Phase 4

Tất cả route ở dưới được bảo vệ bởi `AdminAuthGuard`, cùng tiền tố `/api/v1/admin/ai-studio/phase4`:

| Method | Route | Mục đích |
|---|---|---|
| GET | `/sales/status` | Trạng thái pilot/provider |
| GET | `/sales/analytics` | Chỉ số tổng hợp 30 ngày |
| POST | `/sales/answer` | Tạo câu tư vấn; cần `Idempotency-Key` |
| POST | `/sales/answers/:taskId/product-click` | Ghi nhận click vào sản phẩm đã gợi ý |
| GET | `/sales/knowledge?archived=true` | Liệt kê FAQ/chính sách |
| POST | `/sales/knowledge` | Tạo phiên bản nháp |
| POST | `/sales/knowledge/:id/revisions` | Tạo phiên bản nháp tiếp theo |
| POST | `/sales/knowledge/:id/activate` | Kích hoạt phiên bản |
| POST | `/sales/knowledge/:id/archive` | Ngừng dùng một phiên bản |
| GET | `/marketing/products?search=...` | Tìm sản phẩm đang bán, còn hàng |
| GET | `/marketing/drafts?status=...&limit=...` | Liệt kê nội dung nháp |
| GET | `/marketing/drafts/:id` | Xem nội dung và trạng thái |
| POST | `/marketing/drafts` | Tạo nội dung; cần `Idempotency-Key` |
| PATCH | `/marketing/drafts/:id` | Sửa nội dung trước khi duyệt |
| POST | `/marketing/drafts/:id/approve` | Duyệt nội bộ |
| POST | `/marketing/drafts/:id/reject` | Từ chối |
| POST | `/marketing/drafts/:id/retry` | Xếp lại tác vụ lỗi |

Task tạo bởi Sales được xem qua route AI Studio hiện có `/api/v1/admin/ai-studio/tasks/:id`.

## Khởi động local sau khi Docker khả dụng

Compose hiện đã có sẵn AI Redis, `ai-worker` và `ai-core`; Phase 4 không cần service mới. Lệnh `geme-api` trong Compose chạy `pnpm db:generate`, `pnpm db:deploy`, build rồi khởi động API. Sau khi rà soát `.env.docker` tại máy, chạy:

```powershell
docker compose --env-file .env.docker up -d --build geme-api ai-worker ai-core geme-admin
docker compose --env-file .env.docker ps
```

AI Core cần biến `GEME_OPENAI_API_KEY` như các tính năng văn bản hiện có. Không ghi giá trị khóa vào tài liệu, log, commit hoặc frontend. Trong lượt triển khai này không chạy Compose, không áp migration và không gọi nhà cung cấp AI.

## Kiểm tra đã chạy

```powershell
# outputs/geme-api
pnpm build
pnpm test

# outputs/geme-admin
pnpm exec tsc --noEmit

# outputs/ai-core — trong môi trường đã cài requirements.txt
python -m unittest tests.test_phase_four_agents -v
```

Trạng thái lượt hiện tại:

- NestJS production TypeScript build: **đạt**.
- API contract tests: **12/12 đạt**.
- Admin TypeScript check: **đạt**.
- Python unit tests: **chưa chạy được trong máy local**, runtime thiếu package `httpx`; kết nối Docker Desktop cũng không truy cập được trong phiên kiểm tra. Không coi đây là test pass.
- Chưa chạy migration trên database, Compose smoke test, staging, test provider thật hoặc triển khai production.

## Release gate còn lại

Trước khi mở cho nhân viên dùng thường xuyên, hãy khởi động Compose trên máy có Docker, áp migration ở môi trường local/staging, chạy toàn bộ Python tests, rồi đánh giá thủ công ít nhất 50 câu hỏi: sản phẩm/đá/chất liệu; ngân sách và nhiều biến thể; sản phẩm hết hàng/ẩn; giá thiếu hoặc vừa đổi; chính sách giao hàng/đổi trả/bảo hành; câu hỏi đơn hàng/PII; chứng thư/độ tự nhiên; y tế/tâm linh; prompt injection từ câu hỏi, tên sản phẩm và chính sách; provider timeout/429. Ghi lại pass/handoff/fail cho từng câu. Chưa bật chat storefront hoặc đăng/gửi Marketing tự động.
