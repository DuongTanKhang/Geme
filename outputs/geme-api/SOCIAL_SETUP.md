# Mạng xã hội GEME

Module `src/social` kết nối Facebook Page và Instagram Professional đã liên kết với Page qua Facebook Login. Bản nháp thủ công hoạt động độc lập với AI. Marketing Agent hiện có được dùng làm nguồn nội dung; bản nháp Marketing không thay thế bước duyệt riêng trước khi xuất bản. Phạm vi chỉ đăng bài/ảnh và theo dõi kết quả, không xử lý inbox, bình luận, quảng cáo, đơn hàng hay tồn kho.

## Meta App và quyền

1. Trong Meta for Developers, tạo/chọn App của GEME, bật Facebook Login và thêm đúng Redirect URI công khai của API: `https://<API-domain>/api/v1/social/meta/callback`. URL phải khớp chính xác với `SOCIAL_META_REDIRECT_URI`.
2. Người kết nối cần quyền truy cập Facebook Page và một Instagram Professional account đã liên kết với Page. Hộp thoại GEME yêu cầu: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.
3. Đặt `SOCIAL_META_GRAPH_API_VERSION` theo phiên bản Meta hiện đang hỗ trợ cho App, cập nhật khi Meta ngừng hỗ trợ phiên bản đó. Code không tự giả định phiên bản mới nhất.
4. Điền `SOCIAL_META_APP_ID`, `SOCIAL_META_APP_SECRET`, `SOCIAL_META_GRAPH_API_VERSION`, `SOCIAL_META_REDIRECT_URI`, `SOCIAL_META_ADMIN_RETURN_URL` và `SOCIAL_META_ADMIN_ORIGINS` trong `.env.docker`. Tạo khóa riêng bằng `openssl rand -base64 32`, rồi đặt vào `SOCIAL_META_ENCRYPTION_KEY`. Không dùng chung với JWT, AEGIS hoặc AI Core; thay khóa cần có kế hoạch mã hóa lại token.
5. Cùng các biến server-side phải được cấu hình trên API và `social-worker`. Worker chỉ chạy trong mạng nội bộ Compose và không có port công khai. Thiếu Meta config không chặn API khởi động; bản nháp thủ công vẫn lưu được.
6. Sau khi migration được triển khai và API/worker khởi động, vào Admin → **Mạng xã hội** → **Tài khoản** → **Kết nối Meta**. Chọn rõ tài khoản đích, rồi lưu lựa chọn; GEME không tự chọn Page đầu tiên.

Quyền Meta có thể cần App Review/Advanced Access hoặc điều kiện khác tùy chế độ và đối tượng dùng App. Kiểm tra Access Level, Business Verification và App Review trong Meta App Dashboard trước khi mở quyền cho người ngoài vai trò thử nghiệm.

## Bản nháp, duyệt và lịch đăng

- Chọn sản phẩm đang ACTIVE, còn hàng; ảnh phải đã được duyệt/QC đạt, gắn với sản phẩm, và có URL CDN R2 công khai. Ảnh riêng tư, ảnh gốc đang chờ duyệt và URL nhập tự do bị từ chối. Trước khi đăng ảnh cần `MEDIA_STORAGE_PROVIDER=r2` và `MEDIA_PUBLIC_BASE_URL`.
- Facebook Page hỗ trợ nội dung text/link hoặc một ảnh. Instagram Professional hỗ trợ một ảnh JPEG tối đa 8 MB và caption. Luồng này không tự tạo carousel hoặc Story.
- Mỗi kênh có nội dung riêng. Có thể lưu bản nháp trước khi Meta được cấu hình; phải chọn tài khoản trước khi duyệt. Thời gian được lưu UTC; trường datetime-local trong Admin được hiểu là giờ Việt Nam (`Asia/Ho_Chi_Minh`).
- Duyệt gắn với một revision và snapshot nội dung/media/tài khoản. Mọi chỉnh sửa tạo revision mới và cần duyệt lại. Kết quả được lưu theo từng kênh để không đăng lại Page đã thành công khi Instagram thất bại.
- Nếu timeout xảy ra sau khi gọi API đăng hoặc worker khởi động lại giữa lúc gửi, mục chuyển `UNKNOWN` và không tự gửi lại. Admin cần đối chiếu Page/Instagram bên Meta trước khi xử lý tiếp. Không thể bảo đảm exactly-once khi nền tảng bên ngoài đã nhận request nhưng phản hồi bị mất.
- Ngắt kết nối ở **Tài khoản** → **Ngắt**. Bản nháp và lịch sử được giữ lại; ciphertext token được xóa khỏi kết nối. Có thể thu hồi quyền tại Facebook/Business Integrations của Meta.

## Tài liệu Meta chính thức

- [Instagram API — collection do Meta duy trì trên Postman](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Instagram API content publishing với Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)
- [Page Posts API](https://developers.facebook.com/docs/pages-api/posts/)
- [Facebook Login access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Permissions reference](https://developers.facebook.com/docs/permissions/)
