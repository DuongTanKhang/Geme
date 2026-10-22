# Cần cấu hình SKU — Vòng Kiềng

**Trạng thái:** Chưa tạo phiếu nhập. Rà soát 188 dòng từ dữ liệu SQL cũ; hiện có 0 dòng đủ điều kiện tạo SKU theo quy tắc đang lưu.

## Quy tắc hiện tại trong Admin

- Danh mục: Vòng Tay / Vòng Kiềng
- Tiền tố danh mục: NSBS
- Loại đá đã bật: Lam Ngọc với tiền tố LN
- Số lượng dự thảo: 2 mỗi SKU; giá nhập dự kiến = giá bán nguồn chia 3 (làm tròn đến đồng)

## Vì sao chưa nhập

- 186 dòng không có SKU hoặc mã mẫu ổn định; không tự dùng ID SQL làm mã.
- 1 dòng có SKU nguồn NSB131 (ID 1353), nhưng mã này không khớp NSBS + LN; dòng được phân loại Cẩm Thạch.
- 1 dòng có mã mẫu SJ-100G (ID 3283), nhưng loại Hổ Phách chưa được bật trong quy tắc hiện tại và mã chứa dấu gạch nối.
- 8 dòng có giá bán nguồn bằng 0 nên chưa tính được giá nhập theo quy tắc cũ. Các lỗi có thể trùng với các dòng thiếu mã.

## Tệp tham chiếu

- draft.csv: toàn bộ 188 dòng, trạng thái rà soát và lý do.
- draft.json: thống kê nhóm đá, số dòng và bản ghi nguồn.

Cần chốt tiền tố cho từng loại đá được dùng ở Vòng Kiềng và cấp SKU cho các mặt hàng thiếu mã trước khi tạo phiếu. Không thay đổi SKU NSB131 và không tự sinh mã từ ID SQL.
