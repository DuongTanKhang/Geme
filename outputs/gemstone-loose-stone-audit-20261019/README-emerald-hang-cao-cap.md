# Emerald cao cấp — danh sách chuẩn bị nhập

`emerald-hang-cao-cap-import.csv` có 27 mặt đá Emerald, dùng SKU đã đối chiếu với SQL cũ và quy tắc mã mặt đá quý của GEME.

- Website: gắn nhãn **Hàng cao cấp**, luôn hiện **Liên hệ** dù giá nội bộ có hay chưa có; không cho đặt trực tiếp qua giỏ hàng.
- Giá nhập dự kiến: dòng nào có giá bán trong SQL cũ thì lấy `giá bán / 3`, làm tròn tới đồng gần nhất vì trường giá vốn hiện lưu số nguyên VND. Có 16 dòng nguồn có giá nên đã tính giá nhập; 11 dòng không có giá bán được để trống. Trạng thái hiển thị **Liên hệ** không làm mất giá nội bộ dùng để tính giá nhập.
- `SoLuongNhap` được đặt là `1` cho từng SKU theo chỉ định mới nhất. `Carat` vẫn để trống vì SQL cũ không có trọng lượng; không tự gán 1 ct. API hiện yêu cầu carat cho biến thể NCT, nên cần cho phép carat chưa biết hoặc nhập khối lượng thật trước khi tạo phiếu.
- `AnhSQLCu` giữ nguyên tên tệp trong SQL cũ để dò; ảnh chưa được sao chép sang R2 và cần xác minh từng tệp từ DirectAdmin trước khi gắn URL vào sản phẩm.
- Không có thay đổi nào được ghi vào cơ sở dữ liệu trực tiếp trong bước chuẩn bị này.

## Quy tắc hiện đang áp dụng

- Tên hiển thị chung: `Mặt đá Emerald`.
- Đơn vị/mã: `NCT` (carat) + `EM` (Emerald).
- Dáng: Oval `O`, chữ nhật `R`, vuông `S`, tròn `C`.
- Kích thước giữ đúng dài × rộng trong thông số; SKU mang cả hai số đo. Giá trị size chính vẫn lấy chiều dài theo quy tắc đã chốt.
- Chất lượng không ghi cấp A dùng `01`; cấp `4A` dùng `04`; cấp `5A` dùng `05` theo quy tắc đã thống nhất.

## Chưa hoàn tất

Mỗi SKU đã có số lượng nhập `1` theo chỉ định. Carat chưa có trong SQL cũ; API hiện yêu cầu carat cho biến thể NCT, nên chưa thể tạo phiếu chuẩn nếu không nới validation riêng cho hàng cao cấp hoặc cung cấp carat thật. Ảnh nguồn cũng cần được xác minh/chuyển lên kho ảnh trước khi đăng. Migration `20261102000000_premium_gemstone_contact_only` đã được áp dụng trên database local. Quy tắc bỏ yêu cầu giá chỉ áp dụng cho sản phẩm đá quý được gắn `Hàng cao cấp`; các validation khác vẫn giữ nguyên.
