# Gộp biến thể các nhóm Kiềng — 22/10/2026

## Kết quả

Đã giữ nguyên 19 SKU đã nhập kho và gộp thành 3 trang sản phẩm theo loại đá. Cộng với Aquamarine đã xử lý trước đó, GEME local hiện có 4 trang Kiềng, 32 biến thể và 64 chiếc tồn. Không tạo phiếu nhập mới, tránh cộng tồn trùng.

| Trang sản phẩm | SKU cha | Biến thể | Dáng | Chất lượng | Tồn | Giá theo biến thể |
|---|---|---:|---|---|---:|---|
| Kiềng Aquamarine | `NSBAF` | 13 | Oval | 4A, 5A, 6A | 26 | 2.220.000–5.425.000đ |
| Kiềng Lapis Lazuli | `NSBLA` | 6 | Oval, Tròn | 2A, 3A | 12 | 1.770.000–2.160.000đ |
| Kiềng Moonstone | `NSBMO` | 10 | Oval, Tròn | 5A, 6A | 20 | 3.030.000–10.290.000đ |
| Kiềng Ruby Nam Phi | `NSBRB` | 3 | Oval | 3A, 5A | 6 | 28.950.000–35.280.000đ |

Giá, tồn, ảnh theo SKU và lịch sử phiếu được giữ ở cấp biến thể. Các dòng phiếu nhập/lịch sử tồn được liên kết sang biến thể tương ứng; ảnh sản phẩm được giữ ở trang cha và ảnh riêng được giữ trong biến thể. Tên/giá SKU đã được hàng đợi POS365 xử lý, trạng thái của 3 trang mới là `SYNCED`; tồn POS vẫn `SYNCED`.

## Trang kiểm tra trên storefront local

- [Kiềng Lapis Lazuli](http://localhost:3000/san-pham/kieng-lapis-lazuli)
- [Kiềng Moonstone](http://localhost:3000/san-pham/kieng-moonstone)
- [Kiềng Ruby Nam Phi](http://localhost:3000/san-pham/kieng-ruby-nam-phi)
- [Kiềng Aquamarine](http://localhost:3000/san-pham/kieng-aquamarine)

## Ảnh cần bổ sung

4 SKU không có ảnh riêng trong dữ liệu hiện tại; storefront đang dùng ảnh bìa của trang sản phẩm làm ảnh dự phòng:

- `NSBLAO02S56`
- `NSBLAR03S58`
- `NSBMOO05S56`
- `NSBRBO03S55`

Các URL ảnh còn lại đã được gọi thử qua storefront và trả về ảnh hợp lệ.

## Chưa đưa lên

- Ruby Nam Phi 5A size 46mm và 48mm (`NSBRBO05S46`, `NSBRBO05S48`) vẫn chưa có giá nguồn nên không tạo biến thể/tồn.
- Các mặt hàng Kiềng cũ khác chưa có trong database mới vẫn chờ hoàn thiện mã đá, dáng, chất lượng, size hoặc dữ liệu giá. Không tự tạo giá/SKU thay cho dữ liệu còn thiếu.
- Thay đổi này áp dụng cho database và storefront **local**. Chưa triển khai lên `geme.vn` production.

Bản sao dữ liệu trước khi gộp: [remaining-kieng-before-variant-merge-20261022.json](backups/remaining-kieng-before-variant-merge-20261022.json). Danh sách 19 SKU sau khi gộp nằm trong [kieng-variants-after-merge-20261022.csv](kieng-variants-after-merge-20261022.csv).
