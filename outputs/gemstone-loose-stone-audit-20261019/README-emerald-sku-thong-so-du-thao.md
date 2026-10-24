# Emerald SKU và thông số kỹ thuật — bản đối chiếu

Nguồn: `mat-da-quy-cut-goi-y-tung-san-pham.csv`. Đây là bản chuẩn bị để rà soát, chưa ghi vào database/POS.

## Quy tắc áp dụng

- Tên chung đề xuất: `Mặt đá Emerald`.
- Dùng quy tắc SKU riêng cho Mặt Đá Quý trong [QUY_TAC_SKU_MAT_DA_QUY.md](QUY_TAC_SKU_MAT_DA_QUY.md). Emerald dùng đơn vị carat nên tiền tố `NCT`; mã đá `EM`.
- Mã dáng: Tròn `C`, Chữ nhật `R`, Oval `O`, Vuông `S`.
- Chất lượng: `4A` → `04`; `5A` → `05` theo cùng quy luật số cấp; tên không ghi cấp A → `01`.
- Size lấy số đo thứ nhất trong kích thước dài × rộng. Phần thập phân từ `0.8` trở lên làm tròn lên; dưới `0.8` lấy phần nguyên. Ví dụ `8` → `S08`, `10.8` → `S11`.
- Tất cả SKU có thêm cả chiều dài và chiều rộng ở độ chính xác 0.1 mm: `L` + chiều dài × 10, `W` + chiều rộng × 10. Ví dụ 10.8 × 8.5 mm → `L108W085`; SKU đề xuất `NCTEMR01S11L108W085`.
- Hai dòng nguồn ID 2063 và 2087 cùng dáng, cấp và kích thước 6 × 8 mm nên thêm hậu tố `-01`/`-02` theo ID để mã vẫn duy nhất; không gộp hay xóa dòng.
- `Dai_cm`/`Rong_cm` đổi từ mm sang cm để nhập vào field thông số kỹ thuật hiện có.

## Kết quả rà soát

- 27 sản phẩm Emerald; mọi SKU đề xuất đều có chiều dài và chiều rộng.
- Không còn SKU đề xuất trùng.
- 2 dòng nguồn cùng thông số được phân biệt bằng hậu tố tuần tự.
- 11 sản phẩm có giá nguồn bằng 0; kiểm tra giá trước khi nhập.
- `5A` → `05` là suy luận theo cùng mẫu số cấp; cần rà soát nếu quy ước POS khác.

Mở `emerald-sku-thong-so-du-thao.csv` để xem từng ID cũ, tên, dáng, chất lượng, số đo, SKU cơ sở, SKU đề xuất, giá và ảnh nguồn.
