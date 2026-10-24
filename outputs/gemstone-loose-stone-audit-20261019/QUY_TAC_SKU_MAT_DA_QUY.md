# Quy tắc SKU riêng cho Mặt Đá Quý

Phạm vi: mặt đá rời/đá quý rời. Quy tắc này tách biệt với SKU Trang sức và Kiềng.

## 1. Mã đơn vị tính

Chọn đúng một tiền tố theo đơn vị quản lý và tính giá của mặt đá:

| Mã | Đơn vị tính | Áp dụng khi |
| --- | --- | --- |
| `NCT` | Carat (`ct`) | Sản phẩm được quản lý hoặc tính giá theo carat. |
| `NSG` | Gram (`g`) | Sản phẩm được quản lý hoặc tính giá theo gram. |
| `NSC` | Viên | Sản phẩm được quản lý hoặc tính giá theo từng viên. |

Không chọn tiền tố theo cảm tính hoặc chỉ dựa vào tên loại đá. Nếu chưa xác định đơn vị tính từ dữ liệu nghiệp vụ, để chờ xác minh thay vì tự gán mã. Emerald trong danh sách hiện tại dùng `NCT` theo chỉ định.

## 2. Các thành phần SKU

Mẫu mã:

```text
<Mã đơn vị><Mã đá><Mã dáng><Mã chất lượng><Mã size><Dài><Rộng>[-hậu tố trùng]
```

- **Mã đá:** dùng từ điển mã đá đã được GEME xác nhận. Emerald hiện dùng `EM`; loại đá chưa có mã thì chờ xác nhận, không tự viết tắt.
- **Mã dáng:** Tròn `C`, Chữ nhật `R`, Oval `O`, Vuông `S`. Những dáng khác cần được xác nhận trước khi cấp mã.
- **Mã chất lượng:** `4A` → `04`; tên không ghi cấp A → `01`. Danh sách Emerald tạm ánh xạ `5A` → `05` theo số cấp; cần xác minh nếu quy ước POS khác trước khi nhập.
- **Mã size:** lấy số đo đầu tiên (chiều dài) theo milimét. Phần thập phân từ `0.8` trở lên làm tròn lên; dưới `0.8` lấy phần nguyên. Ví dụ `8 mm` → `S08`, `10.8 mm` → `S11`.
- **Dài/rộng:** mọi SKU đều mang đủ hai số đo chính xác đến 0.1 mm. `L` là chiều dài, `W` là chiều rộng; phần số là số đo mm nhân 10 và điền đủ 3 chữ số. Ví dụ `10.8 × 8.5 mm` → `L108W085`.
- **Trùng hoàn toàn:** nếu hai dòng có cùng đơn vị, loại đá, dáng, chất lượng, size, chiều dài và chiều rộng, giữ cả hai dòng và thêm hậu tố tuần tự `-01`, `-02` theo thứ tự ID nguồn. Không tự gộp/xóa bản ghi.

### Ví dụ Emerald

Mặt đá Emerald 4A, chữ nhật, kích thước `7 × 10 mm`:

```text
NCT + EM + R + 04 + S07 + L070W100
= NCTEMR04S07L070W100
```

## 3. Thông số kỹ thuật

Nhập chiều dài và chiều rộng vào hai trường thông số tương ứng. Nếu Admin lưu kích thước theo cm, đổi mm sang cm bằng cách chia 10; ví dụ `10.8 × 8.5 mm` thành dài `1.08 cm`, rộng `0.85 cm`. Không lấy giá trị đã làm tròn trong mã size để thay thế kích thước chính xác.

## 4. Kiểm tra trước khi nhập kho

Mỗi dòng phải có đơn vị tính, loại đá, dáng (nếu nhận diện được), chất lượng theo dữ liệu, chiều dài, chiều rộng và SKU duy nhất. Riêng danh sách Emerald cao cấp, nếu SQL cũ có giá bán thì giá nhập dự kiến bằng `giá bán / 3`, làm tròn đến đồng gần nhất; không có giá bán thì để trống. Quy tắc này chỉ tính đơn giá nhập, không suy ra số lượng hoặc carat. Khi thiếu số lượng/carat thì chưa lập phiếu nhập, chưa tăng tồn. Tên, ảnh và các dòng lịch sử không được tự gộp khi mã nguồn trùng.
