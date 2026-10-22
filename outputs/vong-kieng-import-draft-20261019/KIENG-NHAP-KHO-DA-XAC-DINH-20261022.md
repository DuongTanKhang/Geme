# Nhập kho kiềng — SKU theo đá, dáng, chất lượng, size

## Quy tắc SKU mới

`NSB` (kiềng) + mã đá + mã kiểu dáng + mã chất lượng hai chữ số + `S` + số size.

- Oval = `O`; Tròn = `R`; Vuông = `SQ`.
- Chất lượng A = `01`, 2A = `02`, 3A = `03`, 4A = `04`, 5A = `05`, 6A = `06`.
- Size 51mm = `S51`; size 54mm = `S54`.
- Ví dụ: Aquamarine 5A Oval 50mm → `NSBAFO05S50`; Cẩm Thạch 3A Vuông 52mm → `NSBCMSQ03S52`.

## Mã đá đã có trong quy tắc GEME

| Đá | Mã |
|---|---|
| Aquamarine | AF |
| Hổ Phách | AB |
| Cẩm Thạch | CM |
| Lam Ngọc | LN |
| Lapis / Lapis Lazuli | LA |
| Moonstone | MO |
| Ngọc Bích | NE |
| Ruby | RB |
| San Hô | SH |

## Đợt đủ dữ liệu

Có **32 sản phẩm** đủ mã đá, kiểu dáng, chất lượng, size và giá nguồn. Tồn nhập theo bản nháp đã duyệt trước là 2 mỗi SKU; giá vốn bằng giá bán nguồn chia 3. Tổng số lượng: 64. Giá bán được cập nhật riêng trong Hồ sơ giá theo SKU, không ghi vào phiếu nhập.

| SKU | ID cũ | Loại đá | Dáng | Chất lượng | Size | Tồn | Giá nhập |
|---|---:|---|---|---|---:|---:|---:|
| NSBLAO02S56 | 679 | Lapis Lazuli | Oval | 2A | 56mm | 2 | 590000 |
| NSBLAO02S58 | 1379 | Lapis Lazuli | Oval | 2A | 58mm | 2 | 590000 |
| NSBRBO03S53 | 664 | Ruby | Oval | 3A | 53mm | 2 | 9650000 |
| NSBRBO03S55 | 1347 | Ruby | Oval | 3A | 55mm | 2 | 9650000 |
| NSBLAR03S54 | 680 | Lapis Lazuli | Tròn | 3A | 54mm | 2 | 720000 |
| NSBLAR03S55 | 487 | Lapis Lazuli | Tròn | 3A | 55mm | 2 | 720000 |
| NSBLAR03S57 | 1378 | Lapis Lazuli | Tròn | 3A | 57mm | 2 | 720000 |
| NSBLAR03S58 | 3513 | Lapis Lazuli | Tròn | 3A | 58mm | 2 | 720000 |
| NSBAFO04S50 | 3045 | Aquamarine | Oval | 4A | 50mm | 2 | 740000 |
| NSBAFO04S51 | 3046 | Aquamarine | Oval | 4A | 51mm | 2 | 740000 |
| NSBAFO04S52 | 3047 | Aquamarine | Oval | 4A | 52mm | 2 | 740000 |
| NSBAFO04S53 | 3044 | Aquamarine | Oval | 4A | 53mm | 2 | 740000 |
| NSBAFO04S54 | 3520 | Aquamarine | Oval | 4A | 54mm | 2 | 740000 |
| NSBAFO04S57 | 3043 | Aquamarine | Oval | 4A | 57mm | 2 | 740000 |
| NSBAFO05S50 | 446 | Aquamarine | Oval | 5A | 50mm | 2 | 960000 |
| NSBMOO05S50 | 1390 | Moonstone | Oval | 5A | 50mm | 2 | 1010000 |
| NSBMOO05S51 | 3055 | Moonstone | Oval | 5A | 51mm | 2 | 1010000 |
| NSBMOO05S52 | 1391 | Moonstone | Oval | 5A | 52mm | 2 | 1010000 |
| NSBMOO05S53 | 3056 | Moonstone | Oval | 5A | 53mm | 2 | 1010000 |
| NSBMOO05S54 | 1392 | Moonstone | Oval | 5A | 54mm | 2 | 1010000 |
| NSBMOO05S55 | 3057 | Moonstone | Oval | 5A | 55mm | 2 | 1010000 |
| NSBMOO05S56 | 1393 | Moonstone | Oval | 5A | 56mm | 2 | 1010000 |
| NSBMOO05S58 | 1394 | Moonstone | Oval | 5A | 58mm | 2 | 1010000 |
| NSBRBO05S60 | 662 | Ruby | Oval | 5A | 60mm | 2 | 11760000 |
| NSBAFO06S50 | 1334 | Aquamarine | Oval | 6A | 50mm | 2 | 1753333 |
| NSBAFO06S51 | 661 | Aquamarine | Oval | 6A | 51mm | 2 | 1753333 |
| NSBAFO06S52 | 1336 | Aquamarine | Oval | 6A | 52mm | 2 | 1753333 |
| NSBAFO06S53 | 1335 | Aquamarine | Oval | 6A | 53mm | 2 | 1753333 |
| NSBAFO06S54 | 1337 | Aquamarine | Oval | 6A | 54mm | 2 | 1753333 |
| NSBAFO06S56 | 1338 | Aquamarine | Oval | 6A | 56mm | 2 | 1808333 |
| NSBMOR06S50 | 6378 | Moonstone | Tròn | 6A | 50mm | 2 | 3430000 |
| NSBMOR06S52 | 6379 | Moonstone | Tròn | 6A | 52mm | 2 | 3430000 |

## Để lại chờ xác nhận

Hai Ruby Nam Phi 5A size 46mm và 48mm có đủ thông tin mã nhưng giá bán nguồn bằng 0, nên chưa tạo giá vốn nhập. Để ở tệp riêng cho tới khi có giá nguồn.
- ID 1402 — Kiềng Ruby Nam Phi Chuẩn 5A Bản Oval Size 46mm — SKU dự kiến NSBRBO05S46 — giá bán nguồn 0, giá nhập chưa xác định.
- ID 1403 — Kiềng Ruby Nam Phi Chuẩn 5A Bản Oval Size 48mm — SKU dự kiến NSBRBO05S48 — giá bán nguồn 0, giá nhập chưa xác định.

## Kết quả nhập kho và đồng bộ — 22/10/2026

- Quy tắc SKU đã lưu cho danh mục **Vòng Kiềng**: `NSB + mã đá + dáng (R/O/SQ) + mã chất lượng 2 chữ số + S + size`. Ví dụ: `NSBAFO05S50`.
- Đã tạo phiếu **PN20261022-01** gồm 32 SKU, mỗi SKU 2 chiếc; tổng tồn nhập 64 chiếc, tổng giá vốn 132.069.996đ.
- Giá bán theo SQL cũ đã được lưu riêng vào Hồ sơ giá theo đúng SKU. Cả 32/32 SKU có giá khớp nguồn và POS365 xác nhận `SYNCED`.
- Phiếu nhập, tồn kho và hàng đợi POS365 đều xác nhận `SYNCED`; số phiếu, giá chờ/lỗi và tồn chờ/lỗi đều bằng 0.
- Lúc ghi nhận nhập kho, 32 SKU còn ở trạng thái DRAFT. Sau đó đã gộp thành 4 trang sản phẩm biến thể và bật trên storefront local; xem KIENG-GOP-BIEN-THE-NHOM-CAC-DA-20261022.md.
- Hai Ruby Nam Phi 5A size 46mm và 48mm vẫn chờ giá nguồn khác 0 nên chưa nhập.
- Chi tiết SKU và số liệu từng dòng nằm trong CSV cùng thư mục.
