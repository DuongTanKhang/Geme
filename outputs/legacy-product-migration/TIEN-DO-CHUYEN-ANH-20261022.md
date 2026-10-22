# Tiến độ chuyển ảnh cũ sang GEME — 22/10/2026

## Đã làm

- Đối chiếu SQL cũ với sản phẩm mới theo SKU chính xác; khi SQL cũ không có SKU, chỉ dùng tên sản phẩm khớp chính xác và duy nhất. Không dùng fuzzy matching. Tìm được **1.011** cặp không mơ hồ: 626 theo SKU và 385 theo tên duy nhất.
- Chuyển, đổi tên và gắn **17 ảnh** từ R2 vào **17 sản phẩm bản nháp**: 16 kiềng và 1 mặt dây chuyền. Ảnh được lưu theo dạng `SKU-1.jpg`; API trả ảnh 200 và dung lượng khớp cho cả 17. Không đổi giá, tồn kho hay trạng thái sản phẩm.
- 4 ảnh nguồn khác trùng byte với ảnh đã gắn nên không tạo bản sao.
- Xóa **2,295 object staging** không được sản phẩm GEME hiện tại hoặc hồ sơ AI QC tham chiếu; giải phóng **1.217 GiB**. Giữ 541 ảnh staging có đường dẫn nguồn trong hồ sơ AI QC. Không xóa prefix `product-images/`.
- Đã tải đủ **371/371 ảnh** có trong FTP theo danh sách đối chiếu; **82/453 tên file nguồn không tồn tại trên FTP**. Trong 371 ảnh, 12 ảnh của lượt trước đã có trên R2; upload lượt này thêm **359 ảnh**, tổng cộng **371 liên kết ảnh DirectAdmin** được gắn vào sản phẩm theo SKU chính xác. R2 xác minh đủ 371 object, không có lỗi upload; database thêm 359 liên kết mới. Không chạy Product Agent và không sửa giá, tồn kho hay trạng thái sản phẩm.
- Phân loại 371 ảnh nguồn: Nhẫn 15, Bông tai 16, Dây chuyền 14, Mặt dây chuyền 314, Vòng Kiềng 10, Vòng Tay Bạc 2.

## Dung lượng R2 sau dọn

- **1,789 objects**, khoảng **2.423 GiB** sau khi upload toàn bộ ảnh DirectAdmin có sẵn.
- `product-images/`: 1,248 objects.
- `legacy-product-images/`: 541 nguồn được hồ sơ AI QC ghi nhận.

## Còn chờ tải từ DirectAdmin

- Trong 1.011 sản phẩm khớp chắc chắn, sau khi gắn 359 liên kết mới còn **82** sản phẩm thiếu ảnh; 82 tên file tương ứng cũng không hiện diện trong FTP.
- Ảnh DirectAdmin đã được lấy hết phần có sẵn: **371/453** tên file tìm thấy và gắn theo SKU, **82** tên file không có trong thư mục FTP.
- File danh sách gồm SKU, tên file nguồn và tên đích: `ANH-CHO-FTP-20261022.csv`.

## Quyền đọc thư mục FTP

- Ảnh nguồn không được phục vụ trực tiếp qua URL public; thử URL ảnh trả HTML, không phải JPEG.
- Đã kết nối FTPS tới `geme.vn`, tải đủ 371 file có sẵn bằng 3 kết nối song song, kiểm tra chữ ký file và upload/xác minh thành công trên R2. 82 tên file còn lại không được tìm thấy trong thư mục FTP; cần lấy từ bản sao lưu hoặc nguồn khác nếu muốn hoàn thiện 82 sản phẩm đang thiếu ảnh.
