# GEME API

Backend riêng cho storefront (`outputs/geme`) và admin (`outputs/geme-admin`): NestJS, PostgreSQL 18+ và Prisma ORM 7. API dùng prefix `/api/v1`; tài liệu OpenAPI ở `/api/v1/docs`.

## Phạm vi schema

- Tài khoản quản trị và nhật ký thay đổi.
- Khách hàng, danh mục tối đa ba cấp, sản phẩm, hình ảnh, mức chất lượng/size và đánh giá.
- Đơn hàng, dòng sản phẩm và thanh toán.
- Chương trình khuyến mãi, đối tượng áp dụng và lượt sử dụng.
- Bài viết, ảnh bài viết và cấu hình website.
- Doanh thu là số liệu tổng hợp từ đơn hàng; không tạo bảng báo cáo trùng dữ liệu.
- Không có bảng kho/tồn kho. `kiot_viet_product_id` và `kiot_viet_order_id` chỉ là mã đối chiếu để tích hợp Kiot Việt sau này.

Với sản phẩm trang sức, giá nằm trên sản phẩm. Với đá quý, giá nằm trên từng biến thể chất lượng; nhóm danh mục tên có “vòng” có thể có thêm size hạt. Schema không lưu tồn kho biến thể.

Danh mục có `kind` để phân biệt Trang sức/Đá quý, `usage` để phân biệt danh mục sản phẩm với loại đá, và `level` để biểu diễn tối đa ba cấp. Vòng chuỗi đeo, Vòng chuỗi tay, Kiềng đá và Vòng tay bạc là cấp 3 bên dưới Trang sức → Vòng tay. Nhánh Đá quý tập trung vào danh mục sản phẩm Mặt đá quý; các loại đá là danh mục con riêng để làm bộ lọc và gắn vào sản phẩm. Loại định giá (`pricingMode`) thuộc danh mục, độc lập với `kind`, nên các vòng chuỗi vẫn có giá theo chất lượng và size hạt sau khi chuyển sang nhánh Trang sức. Seed tạo sẵn hai danh mục cấp 1 Trang sức và Đá quý cùng các danh mục con mặc định.

Chất liệu kim loại và loại đá được lưu trong bảng riêng `material_options`, không nằm trong bảng danh mục và không lưu trong bộ nhớ trình duyệt. Cột `scope` tách danh sách Trang sức (`JEWELRY`) khỏi Mặt đá quý (`GEMSTONE`); cùng tên đá có thể tồn tại độc lập ở cả hai nhóm. Sản phẩm liên kết tới mục này qua `products.material_option_id`.

## Chạy local

1. Tạo `.env` từ `.env.example`, rồi nhập `DATABASE_URL` trỏ tới PostgreSQL có sẵn.
2. Cài gói và tạo Prisma Client:

   ```powershell
   pnpm install
   pnpm db:generate
   ```

3. Áp dụng migration đã lưu và tạo danh mục gốc:

   ```powershell
   pnpm db:deploy
   pnpm db:seed
   ```

   Khi chỉnh schema trong môi trường phát triển, tạo migration mới bằng `pnpm db:migrate --name ten-thay-doi`.

4. Chạy API tại `http://localhost:4000`:

   ```powershell
   pnpm dev
   ```

- `GET /api/v1/health/live`: kiểm tra API còn hoạt động.
- `GET /api/v1/health/ready`: kiểm tra kết nối database.
- `/api/v1/docs`: OpenAPI.

`ADMIN_EMAIL` và `ADMIN_PASSWORD` chỉ cần cấu hình nếu chạy seed để tạo tài khoản khởi tạo; mật khẩu phải dài ít nhất 12 ký tự. Không có mật khẩu thật hay dữ liệu giả trong migration.

## Kết nối admin

Admin dùng `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` để đọc và ghi các danh sách nghiệp vụ. Riêng chất liệu/loại đá hỗ trợ tạo, sửa, ẩn và xóa qua `/api/v1/materials`; danh sách cũng được phát qua `/api/v1/materials/events` để cập nhật giao diện đang mở. Secret và thông tin Kiot Việt chỉ được lưu ở backend.
