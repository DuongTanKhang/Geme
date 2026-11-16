# QR thanh toán đơn tại cửa hàng — local

## Bản sửa

- Đơn Admin chọn chuyển khoản QR được tạo ở trạng thái chờ thanh toán, có hạn 15 phút; không tự đánh dấu đã thanh toán chỉ vì là đơn tại cửa hàng.
- API Docker trước đó còn chạy bản build cũ không hỗ trợ QR cho đơn tại cửa hàng. Đã build lại API và xác nhận route mới đang hoạt động, yêu cầu đăng nhập Admin.
- Modal lấy trạng thái và thời hạn từ API, đếm thời gian theo đồng hồ server; dữ liệu thiếu thời hạn được báo không hợp lệ, không quy thành vừa tạo đã hết hạn.
- Nút **Xem mã QR** ở danh sách và chi tiết đơn chuyển khoản đang chờ, còn hạn. Mở lại giữ nguyên đơn, số tiền, nội dung chuyển khoản và hạn ban đầu.
- Modal kiểm tra thanh toán mỗi 5 giây; ngừng hiện QR khi đã thanh toán, hủy, hết hạn, hoàn tiền hoặc có khoản thanh toán một phần cần đối soát.
- Route xem QR chỉ đọc dữ liệu, kiểm tra quyền `orders.read`, không tạo đơn hoặc gia hạn.

## Kiểm tra đã thực hiện

- 26 test API đạt: trạng thái/thời hạn QR, tạo đơn tại cửa hàng, gọi lại cùng idempotency key, quyền truy cập, reservation expiry và SePay.
- 5 test Admin đạt: đếm giờ, dữ liệu thiếu, mở lại cùng thời hạn, điều kiện hiện nút và số tiền/nội dung QR.
- TypeScript Admin, build API và build production Admin đạt. Build Admin chạy với `NODE_ENV=production`, thư mục output riêng `.next-qr-check` để không ghi đè server dev.
- Admin local tải được màn đăng nhập. Chưa kiểm tra giao dịch chuyển khoản thật hoặc toàn bộ modal trong phiên Admin đã đăng nhập.
- Không sửa đơn lịch sử có QR thiếu thời hạn, không tạo đơn thật để test, không triển khai host.

## Kiểm tra bằng tài khoản Admin

1. Tải lại Admin local, tạo đơn trực tiếp và chọn chuyển khoản QR.
2. Kiểm tra số tiền, nội dung và thời gian còn lại gần 15 phút.
3. Đóng modal, vào đơn đang chờ và bấm **Xem mã QR**: cùng mã đơn, thời gian tiếp tục giảm.
4. Khi SePay xác nhận đủ tiền, modal báo thành công và không còn QR.
5. Khi quá hạn, mã và nút xem QR không còn khả dụng. Mở lại không gia hạn.
