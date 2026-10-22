# NOTE — Sản phẩm có danh mục nhưng chưa nhập kho

Danh sách chi tiết từng sản phẩm nằm trong file CSV đi kèm. File được lập từ NOTE và dữ liệu SQL cũ trong repo; chưa truy vấn trực tiếp database GEME đang chạy, nên hãy đối chiếu trạng thái phiếu nhập trước khi thao tác.

## Tổng hợp

| Danh mục GEME | Số sản phẩm |
|---|---:|
| Kiềng đá | 188 |
| Mặt đá quý | 759 |
| Mặt dây chuyền | 2 |
| Vòng chuỗi đeo (cần xác nhận mapping) | 227 |
| Vòng chuỗi tay | 822 |
| Vòng tay bạc | 59 |
| **Tổng** | **2057** |

## Quy ước và lưu ý

- Mỗi dòng CSV là một sản phẩm nguồn; ID cũ chỉ để đối chiếu, không dùng làm SKU.
- Số lượng dự kiến là 2/sản phẩm theo quy ước các đợt nhập trước; đây chưa phải phiếu nhập.
- Nhóm SQL cũ “Vòng Chuỗi” được tạm ghép với danh mục “Vòng chuỗi đeo”; cần xác nhận ánh xạ trước khi nhập.
- Vòng tay bạc gồm 59 dòng chưa xử lý từ danh sách not-ready; 137 SKU đã nhập trước đó không nằm trong file.
- Mặt đá quý gồm 759 dòng, tất cả thiếu SKU nguồn và SizeID; 39 dòng có giá bán nguồn bằng 0.
- Hai mặt dây chuyền chưa có loại đá/mã SKU được chốt.
- Không đưa vào file: các sản phẩm chưa có danh mục và nhóm Vật Phẩm/Phụ Kiện chưa có danh mục tương ứng trong seed danh mục hiện tại.

## Nguồn

- exports/legacy-products.csv
- outputs/vong-kieng-import-draft-20261019/not-ready-skus.csv
- outputs/bracelet-silver-import-draft-20261019/not-ready-skus.csv
- outputs/gemstone-loose-stone-audit-20261019/mat-da-quy-759-san-pham.csv
- outputs/pending-pendant-stones.md
