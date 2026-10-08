# GEME Admin

Admin UI riêng bằng Next.js App Router, React và TypeScript. Source code nằm độc lập với storefront trong `outputs/geme-admin`.

## Chạy local

```powershell
pnpm install
pnpm dev
```

Mở <http://localhost:3001>.

Admin đọc và ghi dữ liệu nghiệp vụ qua NestJS API tại `NEXT_PUBLIC_API_BASE_URL` (mặc định `http://127.0.0.1:4000/api/v1`). Danh sách chất liệu kim loại và loại đá được lưu trong bảng PostgreSQL `material_options`; hai phạm vi Trang sức và Mặt đá quý được tách riêng bằng `scope`. Admin không dùng `localStorage` để lưu các mục này. Khi API mất kết nối, thao tác lưu bị khóa/báo lỗi thay vì lưu cục bộ. Cấu hình ví dụ nằm trong `.env.example`.

## Stack đề xuất cho giai đoạn backend

- NestJS REST API dùng chung bởi storefront và admin.
- PostgreSQL làm cơ sở dữ liệu chính; Prisma quản lý schema và migrations trong `outputs/geme-api`.
- Xem README của backend để cấu hình database và chạy migrations.
