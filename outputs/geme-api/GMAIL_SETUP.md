# Gmail trong GEME Admin

Gmail workspace dùng Gmail REST API trực tiếp từ NestJS API. Admin browser chỉ nhận dữ liệu thư cần hiển thị; OAuth client secret và refresh token không gửi xuống trình duyệt. SMTP của Aegis dùng cho OTP là cấu hình khác, không dùng để kết nối hộp thư.

## Google Cloud

1. Chọn hoặc tạo Google Cloud project và bật **Gmail API**.
2. Cấu hình Google Auth Platform consent screen. Chọn **External** nếu hộp thư không nằm trong Google Workspace cùng tổ chức. Khi ứng dụng còn ở trạng thái Testing, thêm đúng hộp thư sẽ kết nối vào danh sách test users.
3. Tạo OAuth Client ID loại **Web application**.
4. Authorized JavaScript origins:
   - Local: `http://localhost:3001`
   - Staging Admin: `https://testadmin.geme.vn`
5. Authorized redirect URIs phải khớp tuyệt đối với API đang chạy:
   - Local Docker: `http://localhost:4000/api/v1/integrations/gmail/callback`
   - Staging: `https://testadmin.geme.vn/api/v1/integrations/gmail/callback`
6. API yêu cầu scope `https://www.googleapis.com/auth/gmail.modify`. Scope này cho phép đọc, gửi, gắn nhãn, lưu trữ và chuyển thư vào thùng rác. Nó là scope bị hạn chế; trước khi mở rộng dùng cho người dùng ngoài nhóm thử nghiệm, xem yêu cầu xác minh Google và security assessment.

## Environment

Chỉ điền vào environment của **API** (`.env.docker` cho local hoặc `.env` của staging VPS). Không thêm tiền tố `NEXT_PUBLIC_`, không đưa client secret vào Admin/Storefront.

### Local Docker

```dotenv
GMAIL_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REDIRECT_URI=http://localhost:4000/api/v1/integrations/gmail/callback
GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY=<output của openssl rand -base64 32>
GMAIL_OAUTH_ADMIN_RETURN_URL=http://localhost:3001/
```

Tạo khóa mã hóa bằng `openssl rand -base64 32`. Giữ nguyên khóa đó sau khi kết nối Gmail; database lưu refresh token đã mã hóa bằng khóa này. Nếu mất hoặc thay khóa, phải kết nối lại hộp thư. Sau khi sửa `.env.docker`, recreate API để container nhận env mới.

### Staging

```dotenv
GMAIL_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REDIRECT_URI=https://testadmin.geme.vn/api/v1/integrations/gmail/callback
GMAIL_OAUTH_TOKEN_ENCRYPTION_KEY=<output của openssl rand -base64 32>
GMAIL_OAUTH_ADMIN_RETURN_URL=https://testadmin.geme.vn/
```

Thêm đúng origin và callback trên vào Google OAuth Web client. Sau đó cập nhật stack staging theo quy trình backup/rollback ở `deploy/staging/README.md`. API phải được migrate trước khi truy cập trang Gmail.

## API của GEME

Tất cả endpoint Admin yêu cầu phiên Admin hợp lệ và quyền `settings.manage`:

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/api/v1/admin/gmail/status` | Trạng thái cấu hình/hộp thư |
| `POST` | `/api/v1/admin/gmail/authorize` | Tạo OAuth state một lần và trả URL Google |
| `DELETE` | `/api/v1/admin/gmail/connection` | Ngắt kết nối và xóa refresh token đã lưu |
| `GET` | `/api/v1/admin/gmail/labels` | Lấy nhãn Gmail |
| `GET` | `/api/v1/admin/gmail/messages` | Liệt kê/tìm thư theo thư mục hoặc nhãn |
| `GET` | `/api/v1/admin/gmail/messages/:id` | Lấy nội dung thư dạng text an toàn |
| `POST` | `/api/v1/admin/gmail/messages/:id/modify` | Đọc/chưa đọc, gắn/bỏ sao |
| `POST` | `/api/v1/admin/gmail/messages/:id/archive` | Lưu trữ |
| `POST` | `/api/v1/admin/gmail/messages/:id/trash` | Chuyển vào thùng rác |
| `POST` | `/api/v1/admin/gmail/messages/:id/restore` | Khôi phục khỏi thùng rác |
| `POST` | `/api/v1/admin/gmail/messages/send` | Gửi thư văn bản thuần |
| `GET`, `POST` | `/api/v1/admin/gmail/drafts` | Liệt kê/tạo thư nháp |
| `GET`, `PUT`, `DELETE` | `/api/v1/admin/gmail/drafts/:id` | Xem/cập nhật/xóa thư nháp |
| `POST` | `/api/v1/admin/gmail/drafts/:id/send` | Gửi thư nháp |

OAuth callback công khai nhưng được bảo vệ bằng state ngẫu nhiên một lần, PKCE, hạn dùng 10 phút và đối chiếu admin khởi tạo. Refresh token được mã hóa AES-256-GCM trong PostgreSQL. Thao tác gửi và OAuth có giới hạn request riêng. GEME hiện hỗ trợ một hộp thư dùng chung, văn bản thuần và metadata tệp đính kèm; chưa tải lên/tải xuống tệp đính kèm.

## Database và áp dụng

Migration mới: `prisma/migrations/20261116000000_gmail_oauth_integration`. API build cần Prisma Client được generate từ schema mới. Khi phát hành, sao lưu theo quy trình hiện có, rồi chạy migration bằng bước release `pnpm db:deploy`; không chạy seed lại trên dữ liệu đang dùng.

Tham khảo tài liệu chính thức:

- [Gmail API REST](https://developers.google.com/workspace/gmail/api/reference/rest)
- [OAuth server-side web applications](https://developers.google.com/workspace/gmail/api/auth/web-server)
- [Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
