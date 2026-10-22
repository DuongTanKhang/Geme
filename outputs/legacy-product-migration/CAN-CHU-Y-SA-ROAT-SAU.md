# Cần chú ý — rà soát nhập hàng từ SQL cũ

Ngày cập nhật: 2026-10-19. Số lượng dưới đây là số dòng sản phẩm trong SQL cũ, sau khi bỏ khoảng trắng đầu/cuối ở tên danh mục; không phải số SKU duy nhất.

## Để rà soát sau

- **Vòng Kiềng — 188 dòng:** chưa nhập. Quy tắc hiện có trong Admin là NSBS + LN (chỉ Lam Ngọc). Có 1 SKU nguồn NSB131 lệch quy tắc, 1 mã mẫu SJ-100G chưa có quy tắc Hổ Phách, 186 dòng thiếu mã ổn định; 8 dòng có giá nguồn bằng 0. Xem outputs/vong-kieng-import-draft-20261019/.
- **Vòng Chuỗi — 227 dòng:** đưa vào danh sách làm sau; chưa rà SKU và chưa nhập kho.
- **Mặt Đá Quý — 759 dòng:** để xử lý sau; chưa nhập kho. Có 19 loại đá. Tất cả dòng đều thiếu SKU và `SizeID`; 738 tên có dấu hiệu kích thước, 39 dòng giá bán bằng 0. Đã lập bản nháp cut theo từng sản phẩm: 672 dòng có gợi ý, 87 chưa đủ căn cứ, 5 dòng nhóm cũ và tên hàng cần đối chiếu. Xem `outputs/gemstone-loose-stone-audit-20261019/mat-da-quy-cut-goi-y-tung-san-pham.csv` và `README-cut-goi-y.md`.
- **Lắc Tay / Vòng Tay Bạc — 59 dòng còn treo:** 137 SKU đã nhập ở phiếu PN20261019-03; 59 dòng cần rà trùng SKU, thiếu mã, chất liệu hoặc tiền tố. Xem outputs/bracelet-silver-import-draft-20261019/CAN-LUU-Y-RA-SOAT.md.

## Các nhóm lớn khác còn trong SQL cũ

- **Vòng Chuỗi Tay — 822 dòng**
- **Mặt Đá Quý — 759 dòng**
- **Vật Phẩm — 956 dòng**
- **Phụ Kiện — 135 dòng**
- **Chưa có danh mục — 25 dòng**

## Tiến độ đã xử lý theo các bước trước

Nhẫn, dây chuyền/mặt dây chuyền, hoa tai và phần SKU sẵn sàng của Vòng Tay Bạc đã được xử lý theo các lượt nhập trước. Khi tiếp tục, cần đối chiếu SKU trong hồ sơ sản phẩm và tránh tự tạo mã từ ID SQL.

Nguồn thống kê: exports/legacy-products.csv (5.637 dòng).
