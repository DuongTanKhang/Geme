# Rà soát dữ liệu Mặt Đá Quý từ SQL cũ

Nguồn: `exports/legacy-products.csv`. Đây là danh sách đối chiếu, chưa nhập kho và không tạo SKU mới.

## Tổng quan

- Tổng số dòng sản phẩm: **759**
- Số nhóm loại đá (DanhMucCon): **19**
- Dòng thiếu SKU nguồn: **759**
- Dòng giá bán bằng 0: **39**
- Dòng thiếu ảnh filename: **0**
- Dòng thiếu SizeID: **759**
- Tên có dấu hiệu chứa kích thước: **738** (có mm: 734; có ct/carat: 0)
- Dòng thiếu nhóm Nhom: **73**
- Có **10** nhóm hình dạng được nhận diện trong Nhom, ứng với **574** sản phẩm; phần Nhom còn lại có thể là nhóm nguồn/loại ngọc hoặc đang trống.

## Quy tắc SKU Mặt Đá Quý

Mặt đá quý có quy tắc SKU và đơn vị tính riêng: `NCT` theo carat, `NSG` theo gram, `NSC` theo viên. Xem [QUY_TAC_SKU_MAT_DA_QUY.md](QUY_TAC_SKU_MAT_DA_QUY.md). File Emerald bên dưới là bản chuẩn bị theo nhánh `NCT`.

## Danh sách theo loại đá

### Amethyst (Thạch Anh Tím) — 34 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Chữ Nhật (10); Hình Tròn (7); Hình Giọt Nước (5); Hình Oval (5); Hình Vuông (5); Hình Trái Tim (2)

### Aquamarine — 9 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: (trống) (9)
- Giá nguồn bằng 0: **1**

### Các Mặt Đá Quý Khác — 13 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: (trống) (13)
- Giá nguồn bằng 0: **2**

### Citrine (Thạch Anh Vàng) — 71 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Cushion (19); Hình Chữ Nhật (10); Hình Giọt Nước (10); Hình Oval (9); Hình Trái Tim (9); Hình Tròn (9); Hình Vuông (4); (trống) (1)

### Diopside — 43 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Các dạng khác (11); Hình Vuông (9); Hình Oval (7); Hình Chữ Nhật (6); Hình Trái Tim (5); Hình Tròn (4); (trống) (1)

### Emerald ( Ngọc Lục Bảo) — 27 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Chữ Nhật (18); Hình Oval (9)
- Giá nguồn bằng 0: **11**

### Garnet — 79 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Cushion (16); Hình Tròn (13); Hình Trái Tim (11); Hình Giọt Nước (10); Hình Vuông (10); Hình Chữ Nhật (8); Hình Thoi (6); Hình Tam Giác (4); (trống) (1)
- Giá nguồn bằng 0: **1**

### Hổ Phách — 25 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Tròn (8); Hình Oval (7); Hình Chữ Nhật (5); Hình Giọt Nước (5)

### Moonstone — 8 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: (trống) (8)
- Giá nguồn bằng 0: **3**

### Ngọc Trai — 82 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Nước Ngọt (24); Ngọc Trai Tahiti (22); Ngọc Trai Southsea (21); Ngọc Trai Akoya (15)

### Opal — 49 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Oval (22); Hình Tròn (17); (trống) (6); Hình Giọt Nước (4)

### Peridot — 60 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Cushion (11); Hình Oval (10); Các dạng khác (8); Hình Chữ Nhật (7); Hình Tròn (7); Hình Giọt Nước (6); Hình Trái Tim (6); Hình Vuông (5)

### Ruby — 30 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Ruby Nam Phi (17); Ruby Việt Nam (9); Ruby Thái (4)
- Giá nguồn bằng 0: **13**

### Sapphire — 17 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: (trống) (17)
- Giá nguồn bằng 0: **4**

### Spinel — 16 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: (trống) (16)
- Giá nguồn bằng 0: **1**

### Topaz London — 60 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Chữ Nhật (14); Hình Vuông (12); Hình Tròn (11); Hình Oval (8); Hình Trái Tim (8); Hình Giọt Nước (7)

### Topaz Swiss — 62 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Chữ Nhật (16); Hình Tròn (11); Hình Giọt Nước (10); Hình Oval (10); Hình Vuông (8); Hình Trái Tim (7)

### Tourmaline — 28 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Oval (14); Hình Tròn (10); Hình Giọt Nước (4)

### White Topaz — 46 sản phẩm

- Nhóm/dạng ghi trong dữ liệu cũ: Hình Chữ Nhật (12); Các dạng khác (7); Hình Vuông (7); Hình Giọt Nước (6); Hình Oval (5); Hình Trái Tim (4); Hình Tròn (4); (trống) (1)
- Giá nguồn bằng 0: **3**

## Lưu ý phân loại

- `DanhMucCon` là loại đá trong dữ liệu cũ; `Nhom` có cả hình dạng (ví dụ Hình Oval, Hình Tròn) lẫn nhóm nguồn/loại ngọc (ví dụ Ngọc Trai Tahiti, Ruby Nam Phi). Vì vậy, không nên coi toàn bộ `Nhom` là cut.
- Toàn bộ sản phẩm đều thiếu `SizeID`, nhưng nhiều tên sản phẩm có ghi kích thước. Cần rà trích xuất kích thước từ tên trước khi ánh xạ sang biến thể size; dữ liệu cũ không có tên sản phẩm nào ghi `ct/carat` theo bộ lọc hiện tại.
- `DanhMucChiTiet` không được dùng làm danh mục cut trong file nguồn; cần xác nhận ánh xạ trước khi tạo biến thể cut và size/carat ở web mới.
- 759 dòng này đều thiếu SKU theo cột SKU nguồn; cần tạo/đối chiếu quy tắc mã riêng trước khi nhập kho.

## File dữ liệu đầy đủ

- `mat-da-quy-759-san-pham.csv` gồm ID cũ, tên, loại đá (đã chuẩn hóa và tên nguyên bản), nhóm thô/chuẩn hóa, giá, SizeID, ảnh, video, SKU nguồn.
