# Cần lưu ý — rà soát vòng tay bạc

**Trạng thái:** Chưa nhập 59 dòng từ dữ liệu SQL cũ. Cần kiểm tra lại trước khi xử lý lô tiếp theo.
**Phiếu đã nhập:** PN20261019-03. 137 SKU hợp lệ đã nhập và đồng bộ POS365.

## Các mục cần rà soát

- 48 dòng thuộc 23 nhóm mã SKU bị trùng giữa các sản phẩm nguồn. Không tự chọn một mô tả để nhập.
- 2 dòng thiếu mã sản phẩm/SKU: ID nguồn 417 “Lắc tay mặt đá Opal bạc 925”; ID nguồn 4369 “Lắc bạc đeo tay 925 đính đá Opal”.
- 8 dòng chưa xác định rõ chất liệu bạc theo tên sản phẩm.
- 1 dòng sai tiền tố cần xác nhận quy tắc: ID nguồn 5507, “Lắc Tay Ngọc Trai 10mm Bạc 950 - NE25500”; mã tạo theo nháp `NSSBNE25500`, trong khi quy tắc Ngọc Trai hiện dùng `NSSBGP`.

## Tệp tham chiếu

- `not-ready-skus.csv`: đầy đủ 59 dòng, SKU/mã nguồn, tên và lý do.
- `imported-skus.csv`: 137 SKU đã nhập.
- `import-result.json`: số liệu phiếu nhập.

Khi rà soát, xác nhận mã đúng cho các nhóm trùng, gán mã cho 2 dòng thiếu SKU, xác nhận chất liệu cho 8 dòng và chốt cách xử lý mã Ngọc Trai `NE25500` trước khi nhập.
