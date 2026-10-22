# Ghi chú SKU — Vòng Kiềng (cập nhật 22/10/2026)

Ghi chú phân tích cũ trong `CAN-LUU-Y-SKU.md` được giữ lại làm lịch sử; trạng thái “chưa tạo phiếu” ở đó đã lỗi thời.

## Quy tắc hiện hành

`NSB` + mã loại đá + mã dáng + mã chất lượng hai chữ số + `S` + size.

- Kiềng: `NSB`
- Dáng: tròn `R`, oval `O`, vuông `SQ`
- Chất lượng: A `01`, 2A `02`, 3A `03`, tiếp tục tăng đến 6A `06`
- Size: ghi số mm sau `S`, ví dụ size 51mm → `S51`
- Ví dụ: Aquamarine 5A oval size 50mm → `NSBAFO05S50`

Các mã đá đã bật trong quy tắc Admin: Aquamarine `AF`, Hổ Phách `AB`, Cẩm Thạch `CM`, Lam Ngọc `LN`, Lapis Lazuli `LA`, Moonstone `MO`, Ngọc Bích `NE`, Ruby `RB`, San Hô `SH`.

## Đã thực hiện

- Đã lưu quy tắc SKU trên Admin và bật phạm vi danh mục Vòng Kiềng cho các loại đá liên quan.
- Đã nhập 32 SKU đủ loại đá, dáng, chất lượng, size; số lượng 2/SKU, tổng 64 chiếc.
- Phiếu nhập: `PN20261022-01`; tổng giá vốn `132.069.996đ`; POS365 xác nhận phiếu và tồn kho `SYNCED`.
- Đã lưu giá bán theo SQL cũ ở Hồ sơ giá cho cả 32 SKU; 32/32 giá đã đồng bộ POS365.
- Ghi chú trạng thái lúc lập danh sách: DRAFT. Sau đó 19 SKU đã gộp thành 3 trang sản phẩm biến thể ACTIVE; Aquamarine là trang thứ 4. Xem KIENG-GOP-BIEN-THE-NHOM-CAC-DA-20261022.md.
- Chờ xử lý 2 Ruby Nam Phi 5A oval size 46mm và 48mm vì giá bán nguồn bằng 0: `NSBRBO05S46`, `NSBRBO05S48`.

Chi tiết từng dòng: [KIENG-NHAP-KHO-DA-XAC-DINH-20261022.csv](KIENG-NHAP-KHO-DA-XAC-DINH-20261022.csv) và [KIENG-NHAP-KHO-DA-XAC-DINH-20261022.md](KIENG-NHAP-KHO-DA-XAC-DINH-20261022.md).
