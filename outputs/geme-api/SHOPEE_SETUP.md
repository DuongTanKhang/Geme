# Kết nối Shopee với GEME (chỉ đọc đơn)

Tích hợp lưu ảnh chụp đơn Shopee trong các bảng `shopee_*`, tách khỏi đơn website. GEME không sửa giá/tồn Shopee, không xác nhận/hủy/hoàn tiền, không tạo vận đơn, không trừ kho GEME, không gọi POS365/Viettel Post, không gửi email/SMS khách và không cộng đơn này vào doanh thu website.

## Trạng thái xác minh tài liệu Shopee

Ứng dụng Shopee/Open Platform thật chưa được kết nối trong môi trường này. Các trang tài liệu Open Platform bên dưới trả HTTP 403 khi truy cập từ môi trường kiểm tra hiện tại (có thể cần đăng nhập/quyền Developer Console), nên không thể xác minh tại đây quyền của app GEME, quota/rate limit đang áp dụng cho app, hoặc nghiệm thu request thật. Nội dung hợp đồng của app cụ thể cần được mở lại trong Shopee Console trước khi chuyển Production. Không coi các bài/SDK cộng đồng là bằng chứng thay thế.

Các trang cần đối chiếu trong Shopee Console:

- Authorization and Authentication: <https://open.shopee.com/developer-guide/20>
- Thông báo cập nhật luồng authorization: <https://open.shopee.com/announcements/902>
- `get_order_list`: <https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1>
- `get_order_detail`: <https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1>
- Lấy access token: <https://open.shopee.com/documents/v2/v2.public.get_access_token?module=120&type=1>
- Refresh access token: <https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=120&type=1>

Code hiện dùng fixed authorization URL `/auth` cho live và sandbox, với `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, `state`; authorization URL không ký bằng Partner Key. Chuỗi `state` ngẫu nhiên được lưu một lần, hết hạn sau 10 phút, gắn với admin, môi trường và Partner ID. Các endpoint API v2 được ký HMAC-SHA256; endpoint public cấp/refresh token ký theo partner ID + path + timestamp, còn endpoint shop-level thêm access token + shop ID. Client đọc response JSON và không ghi URL có code/token vào log. Hình dạng request/response và quyền `order` vẫn cần xác nhận trong tài liệu của đúng app; nếu Shopee trả schema khác, job sẽ lỗi và checkpoint không tiến.

## Chuẩn bị bên Shopee

1. Có tài khoản Open Platform chưa có nghĩa là ứng dụng đã được duyệt production hoặc đã có mọi quyền. Tạo/chọn App trong **App Management**, ghi lại Partner ID/Partner Key trong secret store cá nhân; không gửi chúng trong chat.
2. Bật đúng quyền đọc thông tin đơn hàng trong phần API Permission của App. App sandbox và production có credentials, shop grant, domain redirect, host API riêng; không dùng token giữa hai môi trường.
3. Khai báo **Test Redirect URL Domain** hoặc **Live Redirect URL Domain** trong đúng app. Domain callback phải trùng khai báo của môi trường. Shopee yêu cầu seller tự cấp quyền ở trang Shopee sau khi bấm kết nối trong GEME.
4. Đăng ký callback chính xác theo domain thật, ví dụ:

   ```text
   https://api.example.com/api/v1/shopee/callback
   ```

   Domain trên chỉ là ví dụ. Dùng hostname API public thật của GEME. Không đăng ký `localhost`, địa chỉ LAN hoặc URL Admin làm callback. Local callback cần tunnel HTTPS công khai và domain đó phải được khai báo trong app.
5. `SHOPEE_ADMIN_RETURN_URL` là URL Admin để quay về, ví dụ `https://admin.example.com/?view=shopee`. Production bắt buộc HTTPS. Sandbox local có thể dùng `http://localhost:3001/?view=shopee`.

## Cấu hình duy nhất cho Docker Compose

Từ thư mục gốc repo, sao chép mẫu nếu chưa có file cá nhân:

```powershell
Copy-Item .env.docker.example .env.docker
```

Mở `.env.docker` ở thư mục gốc repo. Điền các biến Shopee phía dưới; không sửa source code, route, schema hoặc Compose để thay Partner ID/domain. Tạo khóa mã hóa một lần bằng PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Đưa kết quả vào `SHOPEE_TOKEN_ENCRYPTION_KEY`, lưu khóa trong secret store/backup riêng và không commit. Mất/thay khóa làm các token đang lưu không giải mã được, cần cấp quyền lại shop. `SHOPEE_ENABLED=false` là mặc định an toàn; chỉ đổi thành `true` sau khi điền cấu hình.

| Biến | Bắt buộc | Nội dung |
|---|---|---|
| `SHOPEE_ENABLED` | Có | `false` tắt hoàn toàn polling; `true` bật tích hợp. Chỉ nhận `true`/`false`. |
| `SHOPEE_ENVIRONMENT` | Có | `sandbox` hoặc `production`; giá trị sai không tự chuyển sang production. |
| `SHOPEE_PARTNER_ID` | Khi bật | Partner ID số của App trong Open Platform, thuộc đúng môi trường. |
| `SHOPEE_PARTNER_KEY` | Khi bật | Partner Key của cùng App; chỉ API và worker nhận. |
| `SHOPEE_REDIRECT_URI` | Khi bật | HTTPS public URL `/api/v1/shopee/callback`; sandbox local có thể dùng HTTP tunnel/localhost theo cấu hình và giới hạn môi trường. |
| `SHOPEE_ADMIN_RETURN_URL` | Khi bật | URL Admin GEME; Production phải HTTPS và thường có `?view=shopee`. |
| `SHOPEE_TOKEN_ENCRYPTION_KEY` | Khi bật | Base64 chuẩn của đúng 32 bytes ngẫu nhiên. |
| `SHOPEE_INITIAL_SYNC_DAYS` | Tùy chọn | Số ngày import lần đầu, 1–365; mặc định 30. |
| `SHOPEE_POLL_INTERVAL_MINUTES` | Tùy chọn | Chu kỳ kiểm tra shop, 5–60 phút; mặc định 5. |
| `SHOPEE_WORKER_CONCURRENCY` | Tùy chọn | 1–8 job đồng thời; mặc định 2. |

API và `shopee-worker` đọc chung các biến này từ `.env.docker`; không khai báo biến Shopee nào là `NEXT_PUBLIC_*`. API trả trạng thái cấu hình dạng tên biến thiếu/sai, không trả Partner Key/token/khóa mã hóa. Kết nối, trạng thái môi trường và cấu hình hợp lệ là các trạng thái riêng.

## Khởi động local bằng Compose

Mở PowerShell ở thư mục gốc repo đã chứa `compose.yaml` và `.env.docker`. Lệnh sau dùng đúng luồng Compose phát triển của repo: API chạy `prisma generate`, triển khai migration bằng `prisma migrate deploy`, build API rồi mới healthy; worker phụ thuộc API healthy và Redis healthy nên không chạy trước schema.

```powershell
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build geme-api admin shopee-worker
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker exec geme-api pnpm shopee:check-config
docker compose --env-file .env.docker logs --tail 100 geme-api shopee-worker
```

Compose local này tự áp **migration phát triển** khi API khởi động. Không trỏ cấu hình Compose local vào database production và không dùng lệnh này thay release process. Production migration phải chạy trong bước migration của quy trình phát hành hiện có, sau khi review migration; khởi động API/worker chỉ sau khi bước đó thành công. Không có migration production nào được chạy ở đây.

Redis chỉ ở network nội bộ Compose, không publish port. Worker không mở HTTP/public port. Tắt `SHOPEE_ENABLED` không tắt các chức năng GEME khác và worker không schedule polling/gọi Shopee.

## Kết nối và nhập đơn đầu tiên

1. Mở GEME Admin → **Shopee** → **Kết nối shop**. Nút chỉ bật khi `SHOPEE_ENABLED=true` và toàn bộ cấu hình hợp lệ.
2. Shopee hiện trang consent. Đăng nhập seller account cần kết nối và xác nhận quyền đọc đơn.
3. Callback quay về Admin. GEME kiểm tra state một lần, đổi code ở server rồi lưu access/refresh token bằng AES-256-GCM. Admin thấy Shop ID thật; không giả tên shop nếu chưa đọc được tên qua API.
4. Bấm **Đồng bộ ngay**. Tác vụ được xếp vào BullMQ/Redis; giao diện hiển thị hàng đợi, heartbeat worker và các trạng thái chờ/đang chạy/thử lại/thành công/thất bại. Redis lỗi hiển thị unavailable, không báo queue rỗng.
5. Mở **Đơn Shopee** để xem danh sách, bộ lọc server theo từ khóa/trạng thái/shop/môi trường/ngày, chi tiết dòng hàng, trạng thái, phí và dữ liệu vận chuyển mà API trả về. Ngày hiển thị Asia/Ho_Chi_Minh; database lưu UTC.
6. Mở **Ghép SKU**. Chỉ tự ghép SKU chính xác, duy nhất; SKU/model mơ hồ cần chọn thủ công. Mapping lưu theo shop + item + model và được dùng cho lần import sau.
7. Mở **Lịch sử đồng bộ** để theo dõi hoặc thử lại job thất bại. Việc job vào hàng đợi không đồng nghĩa đồng bộ đã thành công.

## Cô lập môi trường và dữ liệu

- Mỗi kết nối lưu môi trường và Partner ID; worker chỉ polling/process kết nối trùng môi trường và Partner ID cấu hình hiện tại. Cấu hình đổi App/môi trường không tự dùng lại token cũ.
- Sync sử dụng cửa sổ tối đa 14 ngày với overlap 5 phút, phân trang có phát hiện cursor lặp, chi tiết tối đa 50 mã/lần, và chỉ tiến checkpoint khi đủ chi tiết cho mọi order ID trong cửa sổ. Response thiếu order, sai schema hoặc thiếu `item_list` làm job lỗi; không coi thiếu dữ liệu là thành công.
- Upsert chống trùng theo shop + mã đơn; cập nhật có điều kiện theo `update_time`. Response thiếu item list không xóa dòng cũ. Giá gốc/giá sau giảm được giữ riêng; null/chuỗi trống không đổi thành 0.
- Job retry có backoff tăng dần, tối đa theo cấu hình queue, tôn trọng Retry-After; lỗi quyền/cấu hình không retry vô hạn. Một rate gate nội bộ giới hạn yêu cầu Shopee ở mức bảo thủ 1 request/giây dùng chung Redis. Đây là giới hạn an toàn của GEME, không phải tuyên bố quota chính thức của Shopee.
- Ngắt kết nối chỉ xóa token cục bộ, chặn job/poll tiếp theo và giữ đơn/mapping/lịch sử. Nó không thu hồi grant trên Shopee; seller cần thu hồi tại Shopee/Open Platform nếu muốn.
- Bảng Shopee riêng; không nhập vào `Order`, không giữ/trừ tồn, không tạo shipment, không gọi POS365/Viettel Post và không xuất hiện trong báo cáo doanh thu web.

## Sandbox sang Production

1. Trên Shopee Console, xác nhận App đã qua duyệt và có quyền đọc order phù hợp cho production; tạo/copy Partner ID và Key production.
2. Khai báo live redirect domain và callback public HTTPS chính xác. Mở tài liệu auth/order/token đã đăng nhập để đối chiếu request/response, time window, phân trang, quyền và rate limit hiện hành.
3. Backup `.env.docker`/secrets; đặt `SHOPEE_ENVIRONMENT=production`, Partner ID/Key production, callback production, Admin return HTTPS. Giữ nguyên khóa mã hóa nếu cần giữ token hiện tại; nhưng sandbox token sẽ không được dùng trong production.
4. Chạy config validation, review migration release và health check worker. Sau đó mới bấm cấp quyền shop production và đồng bộ thử với đơn kiểm tra.

Không copy token, connection hoặc shop grant sandbox sang Production. Tài khoản Open Platform không đồng nghĩa với app production đã được Shopee duyệt/cấp mọi API permission.

## Xử lý lỗi

| Lỗi | Kiểm tra |
|---|---|
| Nút kết nối bị khóa | `SHOPEE_ENABLED=true`, `pnpm shopee:check-config`; xem tên biến thiếu/sai trong trang Shopee. |
| Shopee báo sai domain redirect | Redirect domain trong app chưa khai báo/không trùng; kiểm tra đúng sandbox/live app và `SHOPEE_REDIRECT_URI`. |
| `error_sign` | Đối chiếu Partner ID/Key/host cùng môi trường, đồng hồ máy chủ, đường dẫn API và đúng request signer trong tài liệu app. Không gửi Key vào chat/log. |
| Callback quay lại báo lỗi | Kiểm tra callback public tới được API, state còn hạn/chưa dùng, Partner ID/môi trường chưa đổi trong lúc cấp quyền, và `SHOPEE_ADMIN_RETURN_URL`. Bắt đầu kết nối mới nếu state đã bị tiêu thụ. |
| Cần cấp quyền lại | Access/refresh token hết hạn hoặc Shopee từ chối quyền; kết nối lại shop. Lỗi mạng/5xx tạm thời được retry, không tự xóa token. |
| Migration/API không healthy | Xem log `geme-api`, database URL và trạng thái migration. Không chạy migrate trên production bằng Compose local. |
| Queue unavailable / worker offline | Kiểm tra `ai-redis`, `shopee-worker` health/log, `SHOPEE_ENABLED`, config, và API/worker có cùng env. Worker cần heartbeat Redis trong 30 giây gần nhất. |
| Thiếu chi tiết đơn / cursor lặp | Job không tiến checkpoint; xem `errorCode` và lịch sử. Xác nhận permission/response schema trong tài liệu chính thức của app rồi thử lại. |

## Giới hạn hiện tại

- Chưa thử credential, consent, API request, quota/rate limit hoặc đơn thật. Tài liệu Open Platform trả 403 trong lần xác minh hiện tại; hãy mở các trang link ở trên sau khi đăng nhập Shopee Console trước khi bật Production.
- Test tự động dùng fixture/mocks, không thay cho sandbox end-to-end bằng app đã được cấp quyền. Không deploy, không chạy migration production và không kết nối shop thật trong thay đổi này.
