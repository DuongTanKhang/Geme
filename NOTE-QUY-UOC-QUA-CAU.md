# Quy ước nhập kho Quả cầu

Áp dụng cho Vật phẩm → Quả cầu.

- Cấu trúc tồn kho cố định có **bốn cấp**: `Nhóm đá` → `Loại đá` → `Chất lượng` → `từng quả cầu`.
  - Ví dụ: `Thạch Anh` → `Thạch Anh Trắng` → `4A` → các quả với khối lượng riêng.
  - Danh mục gốc **Cầu** chỉ dùng để phân loại, **không có tổng kg riêng**.
  - Tổng kg của một loại đá được cộng từ các chất lượng; tổng kg của một nhóm đá được cộng từ các loại đá. Không lưu số tổng độc lập để tránh lệch dữ liệu.
- Mỗi SKU đại diện cho một **loại đá + chất lượng**, ví dụ `CAU-TAV04`; SKU được khóa vào đúng Nhóm đá, Loại đá và Chất lượng ngay từ phiếu nhập đầu tiên.
- Tồn kho và đơn vị bán của SKU là **kg**, được lưu đến 3 chữ số thập phân.
- Khi nhập kho, nhân viên nhập **tổng kg của SKU** và bắt buộc thêm từng quả cầu thuộc SKU đó.
- Mỗi quả chỉ cần nhập **khối lượng (kg)**; không bắt buộc ảnh hoặc video tại thời điểm nhập.
- Tổng kg của các quả phải khớp chính xác tổng kg SKU. GEME kiểm tra cả giao diện lẫn API trước khi lưu.
- Không dùng nút điều chỉnh tồn chung để tăng/giảm kg Quả cầu, vì nút này không biết quả vật lý nào đã thay đổi. API sẽ chặn thao tác này để giữ tồn từng quả đúng.
- Các quả không tạo SKU con. Chúng được lưu như chi tiết vật lý của SKU cha để dùng cho dropdown/chọn quả ở Storefront sau này.
- Khi bán, nhân viên sẽ chọn đúng một quả vật lý. Hệ thống phải trừ kg của quả đó khỏi SKU chất lượng rồi phản ánh lại ở tổng Loại đá và Nhóm đá. Luồng bán/Storefront chưa thay đổi trong đợt nhập kho này.
- Ảnh và video riêng từng quả là phần cập nhật sau, không phải điều kiện nhập kho.

## Chờ xác minh trước khi nhập – Cầu Thạch Anh Trắng

Các dòng dưới đây không được gộp hoặc quy đổi tự động, vì dữ liệu cũ chưa có khối lượng chính xác theo từng quả hoặc chưa có mã chất lượng đã chốt:

- `CAU-TAT02` — Cầu Thạch Anh Trắng Vân Mây 2A: dữ liệu ghi dải `1–7 kg`, chưa có quy ước mã cho Vân Mây 2A.
- `CAU-TAT1` (ID cũ `6304`) — Cùi Dừa: dữ liệu ghi dải `1–5 kg`, không có khối lượng của từng quả.
- `CAU-TAT4S05` — Cầu Thạch Anh Trắng Vân Mây 4A size 4–6 cm: dữ liệu là lô `1 kg`, khoảng 10–15 viên, chưa có cân nặng từng quả và chưa có mã quy ước riêng cho Vân Mây 4A.

## Ảnh legacy cần bổ sung – Cầu Thạch Anh Trắng

Khi rà từ FTP cũ ngày 09/11/2026, 18 ảnh đã được xác minh và lưu vào R2. Các tên dưới đây chưa có trên R2; không được gắn ảnh thay thế.

- `CAU-TAT1`: `3kg-7378.jpg`.
- `CAU-TAT5`: `d967696c6543b91de05247-1777.jpg`, `fd21e1f113ddcf8396cc44-5023.jpg`, `cau-thach-anh-trang-trong-5a-309kg-5682.jpg`, `de647ed427fbfba5a2ea77-2474.jpg`, `475-2-3662.jpg`, `z7275303784504732eade6d9fc6cdd81a283ae29932ead-8591.jpg`, `z7275303799448cd74ff016659076ea09621c66ad47358-7838.jpg`, `z7275303808039fabd8b6cd7ecb883ac017a61bf2ce861-3366.jpg`, `z7275303819934d630d5211ec2418f0c196fafdf5a1958-1755.jpg`, `z7275303844207f10ac056b430ce4999f38806f69b37c9-7796.jpg`, `z7275303844207f10ac056b430ce4999f38806f69b37c9-2379.jpg`.

Mỗi SKU trên vẫn có ít nhất một ảnh gốc đã xác minh, nên được phép hiển thị bằng gallery ảnh hiện có. Cần thử lại FTP để bổ sung phần còn thiếu, không suy đoán ảnh tương ứng.

## Lô Cầu Thạch Anh đã nhập lại theo cấu trúc 4 cấp — 09/11/2026

- Phiếu local: `PN20261109-01`.
- Đã thay đúng lô Trắng cũ bằng lô mới gồm **11 SKU chất lượng, 94 quả và 319,349 kg**. Object ảnh hiện có trên R2 được giữ nguyên; không có thao tác xoá object.
- Các cấp được ghi: `Thạch Anh` → `Thạch Anh Trắng/Đen/Hồng/Tím/Vàng` → chất lượng → từng quả và kg thực tế.
- Đã có ảnh nguồn R2 nên được hoạt động: `CAU-TATB`, `CAU-TAT1`, `CAU-TAT3`, `CAU-TAT4`, `CAU-TAT5`.
- Đã nhập kho nhưng giữ **nháp** đến khi có ảnh nguồn thật: `CAU-TAD1`, `CAU-TAD2`, `CAU-TAH1`, `CAU-TAH3`, `CAU-TATI2`, `CAU-TAV03`. Không gắn ảnh thay thế hoặc suy đoán.
- Chưa đồng bộ POS365 trong lần nhập này để tránh tạo phiếu POS khi ảnh/kiểm tra vận hành chưa hoàn tất.

## Chờ xác minh — Cầu Thạch Anh ngoài lô đã nhập

- `CAU-TDE3` (Tóc Đen, SQL cũ #636): chưa có cấp chất lượng đã chốt, giữ NOTE.
- Thạch Anh Khói: giữ NOTE theo yêu cầu; chưa nhập.
- Các dòng Thạch Anh Vàng không ghi rõ chất lượng và các nhóm Xanh/Dâu Tây: xử lý sau, không tự suy đoán.

## Hàm Ếch Tím đã nhập local — 14/11/2026

- Phiếu local: `PN20261114-02`.
- Đã nhập `CAU-HC-TAT05` — Cầu Hàm Ếch Thạch Anh Tím, chất lượng 5A: **33 quả, tổng 84,705 kg**; từng quả giữ cân nặng riêng theo SQL cũ.
- Đã tải và gắn **33 ảnh riêng** vào sản phẩm; toàn bộ object được lưu và xác minh trên R2.
- Sản phẩm đang ở trạng thái **nháp** vì chưa chốt giá bán; chưa ghi POS365.
- Cầu Thạch Anh Xanh và Dâu Tây tiếp tục ở NOTE vì SQL cũ chỉ có khoảng cân nặng, chưa có khối lượng chính xác từng quả.

## Sửa ảnh và bộ lọc tồn kho Vật phẩm — 14/11/2026

- 18 ảnh của `CAU-TAT1`, `CAU-TAT3`, `CAU-TAT4`, `CAU-TAT5`, `CAU-TATB` trước đó trỏ tới prefix R2 `legacy-product-images/`, prefix mà public media worker không phân phối. Ảnh vẫn còn trong R2.
- Đã chép 18 ảnh sang prefix public chuẩn `media/`, cập nhật gallery local của 5 SKU và xác minh tất cả URL mới trả ảnh hợp lệ. Object ảnh cũ không bị xóa; tồn kho, giá và trạng thái bán không đổi.
- Bộ lọc Loại đá trong Quản lý tồn kho trước đây chỉ đọc `materialOption`; đã bổ sung đọc `sphereStoneType` cho Vật phẩm để danh mục Quả cầu/Trụ có thể lọc theo loại đá.
- Quét 12 SKU thuộc danh mục Quả cầu: 51 ảnh có URL đều hợp lệ sau sửa. Sáu SKU vẫn chưa có ảnh nguồn (`CAU-TAD1`, `CAU-TAD2`, `CAU-TAH1`, `CAU-TAH3`, `CAU-TATI2`, `CAU-TAV03`); không gắn ảnh đoán.
