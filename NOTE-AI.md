# NOTE AI — GEME Sale AI

## Định hướng đã chốt

- Chatbot tư vấn bán hàng hiển thị trên Storefront GEME cho khách hàng. Không phải AI Studio hay trợ lý vận hành dành riêng cho Admin.
- AI đóng vai một nhân viên sale GEME: hiểu đầy đủ thông tin sản phẩm được phép công khai, SKU/biến thể, giá bán/khuyến mãi/tồn kho hiện tại, cách chọn sản phẩm và kiến thức tư vấn đã được GEME duyệt.
- Phạm vi nguồn dữ liệu chỉ nằm trong GEME. Không tìm Internet, không lấy kiến thức từ website/dịch vụ ngoài, không kết nối Gmail, Facebook, Zalo, POS hay nền tảng ngoài để làm giàu câu trả lời.
- Admin tự quản lý phạm vi dữ liệu mà AI được dùng: bật/tắt nhóm nguồn, duyệt nội dung, cập nhật hướng dẫn và giọng tư vấn. Quyền này chỉ dành cho tài khoản Admin được cấp quyền cấu hình.
- AI chỉ có phạm vi hiểu biết và hành vi của một nhân viên sale, không phải quản trị viên hay agent vận hành. AI chỉ tư vấn/giải thích/gợi ý; không sửa sản phẩm, giá, tồn kho, đơn hàng hay thanh toán.

## Tách dữ liệu khách được xem và dữ liệu Admin-only

- Storefront chỉ truy vấn allowlist dữ liệu công khai do Admin cấu hình: thông tin sản phẩm đã duyệt, biến thể, giá/khuyến mãi/tồn kho được phép hiển thị, FAQ/chính sách và nội dung tư vấn đã duyệt.
- Dữ liệu chỉ Admin được biết tuyệt đối không được đưa vào chatbot khách hàng: giá vốn/giá nhập, lợi nhuận, doanh thu nội bộ, hiệu quả bán hàng, PII hoặc lịch sử mua của khách khác, ghi chú vận hành và thông tin cấu hình.
- Cấu hình AI cũng nằm ngoài phạm vi hiểu biết của AI: API keys, secrets, provider/model settings, system prompt nội bộ, quota, log và quyền quản trị. Không cung cấp tool hay retrieval để AI đọc/sửa các mục này; không bao giờ đưa secrets vào context hoặc câu trả lời.
- Backend kiểm tra allowlist và quyền ở mỗi lần truy vấn; không tin dữ liệu/quyền do browser gửi, không cấp SQL/Prisma tùy ý, shell, web search hay công cụ ghi dữ liệu.
- Nếu hồ sơ GEME không có căn cứ, AI phải nói rõ chưa có thông tin; không đoán loại đá/chất liệu, chứng nhận, xuất xứ, bảo hành hay tính xác thực.

## Quản trị trong Admin

- Tạo trang quản lý Sale AI dành cho Admin: bật/tắt chatbot, chọn tập dữ liệu cho phép, quản lý FAQ/chính sách/quy trình tư vấn, giọng thương hiệu, xem nội dung chờ duyệt và sửa phiên bản.
- Mọi thay đổi knowledge/scope cần ghi người sửa, thời điểm, phiên bản và audit. Nhân viên khác chỉ được quản lý nếu Admin cấp quyền tương ứng.
- Admin có thể giới hạn AI theo loại sản phẩm/danh mục hoặc trường dữ liệu; mặc định chỉ bật dữ liệu công khai. Nguồn mới phải được Admin chủ động cho phép.

## MVP đề xuất

1. Thêm bong bóng/panel “Mua hàng với AI” trên trang chi tiết sản phẩm Storefront GEME; gửi ngữ cảnh sản phẩm hiện tại lấy từ backend, không tin giá/tồn do browser tự gửi.
2. API chat NestJS chỉ truy vấn catalog công khai và knowledge đã duyệt từ GEME; Redis rate limit, giới hạn đầu vào/token/chi phí, timeout và công tắc tắt khẩn cấp.
3. Hỗ trợ tư vấn món đang xem, tìm theo nhu cầu/ngân sách và so sánh sản phẩm đang hoạt động. Giá, khuyến mãi, tồn và biến thể quan trọng lấy lại từ API hiện hành.
4. Khách tự bấm nút thêm giỏ/mua theo luồng Storefront hiện có. AI không tự tạo đơn, xác nhận thanh toán, sửa giá/tồn hay gửi nội dung sang nền tảng khác.
5. Knowledge base ban đầu dùng PostgreSQL full-text/keyword search; chỉ cân nhắc embeddings/vector search khi thử nghiệm cho thấy tìm kiếm nội bộ chưa đủ.
6. Khi thiếu căn cứ, AI thừa nhận giới hạn và đưa kênh liên hệ GEME; không gửi hội thoại tự động sang Zalo/Facebook/email.

## Mô hình chạy và dữ liệu gửi đi

- “Không lấy thông tin bên ngoài vào” nghĩa là retrieval/nguồn tri thức chỉ dùng dữ liệu GEME; cần tắt web search và mọi connector nguồn ngoài.
- Nếu gọi model cloud, câu hỏi và phần dữ liệu GEME được backend chọn vẫn được gửi tới nhà cung cấp để suy luận. Nếu yêu cầu còn bao gồm “không gửi dữ liệu ra khỏi hạ tầng GEME”, cần dùng model self-host và retrieval nội bộ. Nếu chấp nhận cloud thì chỉ gửi câu hỏi cùng dữ liệu công khai tối thiểu, không gửi dữ liệu Admin-only hoặc secrets.
- Dữ liệu gửi qua OpenAI API không được dùng để huấn luyện model theo mặc định, nhưng cần xem chính sách retention của endpoint/provider trước khi chọn và mô tả minh bạch trong chính sách riêng tư.

## Trạng thái repository

- Đã gỡ AI Studio phases 1–4 trước đó; hiện repository chưa có AI runtime, endpoint chat hay SDK cho Sale AI.
- Storefront dùng Next.js; API dùng NestJS/Prisma và có Redis rate limiting. Có thể tích hợp chatbot ở Storefront, endpoint/backend retrieval và màn hình Admin quản lý knowledge/scope mà không khôi phục AI Studio.
- Chưa triển khai code hay bật provider; đây là nghiên cứu/định hướng. Trước khi code cần chọn cloud hay self-host, chính sách payload/retention, và nhóm dữ liệu công khai được phép cho chatbot.

## Lộ trình

1. Chốt model và ranh giới dữ liệu; tạo test cases đảm bảo khách không thể hỏi ra giá vốn, lợi nhuận, thông tin khách hàng hoặc cấu hình.
2. Làm Admin knowledge/scope với trạng thái nháp/duyệt và audit.
3. Làm chatbot Storefront + backend tools đọc catalog/knowledge allowlist, không có external retrieval hoặc write tools.
4. Kiểm thử prompt injection, sai giá/tồn, dữ liệu Admin-only, sản phẩm hết hàng, spam, provider lỗi và quota; chỉ bật staging sau khi đạt.

## Tài liệu kỹ thuật đã tham khảo

- OpenAI Responses API: https://developers.openai.com/api/docs/guides/migrate-to-responses
- Function calling: https://developers.openai.com/api/docs/guides/function-calling
- File Search: https://developers.openai.com/api/docs/guides/tools-file-search
- Data controls: https://developers.openai.com/api/docs/guides/your-data
## Quyết định hướng triển khai — 05/11/2026

- Hướng MVP: dùng model qua API cloud, còn catalog, knowledge base, allowlist và logic kiểm soát quyền vẫn do backend GEME quản lý.
- Chỉ gửi câu hỏi cùng phần dữ liệu GEME đã được phép công khai và cần thiết cho câu trả lời. Không gửi dữ liệu Admin-only, PII, giá vốn/lợi nhuận, cấu hình AI, API keys hoặc secrets.
- Không bật web search hay kết nối nguồn ngoài; model cloud chỉ xử lý prompt được GEME gửi, không được dùng làm nguồn tri thức.
- Đây là quyết định đánh đổi để có chất lượng tư vấn tốt và triển khai nhanh mà không làm VPS hiện tại quá tải. Phải thông báo rõ rằng model cloud nhận payload tối thiểu để suy luận; API không dùng dữ liệu để huấn luyện theo mặc định, nhưng chính sách retention của provider vẫn cần được kiểm tra.
- Thiết kế adapter/backend theo hướng đổi được provider để sau này chuyển sang self-host. Nếu yêu cầu bảo mật đổi thành “không gửi bất kỳ dữ liệu nào ra ngoài hạ tầng GEME”, chuyển sang model self-host trên máy chủ riêng; không đặt model lên VPS staging 8 GB hiện tại vì RAM còn dùng cho các dịch vụ GEME.
- Tham khảo hạ tầng: Ollama ghi model 7B thường cần khoảng 8 GB RAM, chưa tính API, database, Redis và các container khác: https://ollama.com/library/llama2
- Tham khảo dữ liệu API: OpenAI ghi dữ liệu API không được dùng để huấn luyện theo mặc định; abuse monitoring logs có thể được giữ tối đa 30 ngày theo mặc định: https://developers.openai.com/api/docs/guides/your-data