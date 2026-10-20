# GEME Storefront

Storefront GEME dùng Next.js App Router và NestJS API. Dữ liệu sản phẩm, giá, tồn kho và bài viết đọc từ API; không lưu bản sao SEO hoặc giá sản phẩm làm nguồn dữ liệu riêng.

## Chạy dự án

```bash
pnpm install
pnpm dev
```

Mở `http://127.0.0.1:3000`.

## Cấu hình domain SEO

Đặt `GEME_SITE_URL` thành origin HTTPS công khai của website, không thêm dấu `/` cuối, đường dẫn hay query. Giá trị dùng làm metadata base, canonical, robots và sitemap. Production sẽ dừng nếu biến này thiếu hoặc là localhost/domain mẫu. Mẫu ở `.env.example`; Docker Compose mặc định dùng domain GEME đã khai báo trong cấu hình repository, có thể ghi đè bằng `.env.docker`.

Storefront dùng canonical không có dấu `/` cuối (ngoại trừ trang chủ). URL danh mục có bộ lọc được đánh dấu `noindex,follow`; trang phân trang mặt đá giữ canonical riêng cho đúng số trang. Trang đăng nhập, đăng ký, tài khoản và thanh toán đều `noindex`.

`/sitemap.xml` lấy tất cả sản phẩm đang công khai và bài viết đã xuất bản qua API theo từng lô. Nếu API không truy cập được, sitemap trả lỗi để báo hỏng thay vì công bố sitemap rỗng. API công khai nhận `offset` để phân trang ổn định.

## Build production

Đặt `GEME_SITE_URL`, `GEME_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL` và `AEGIS_AUTH_API_URL` trước khi build. Dockerfile kiểm tra các biến bắt buộc.
