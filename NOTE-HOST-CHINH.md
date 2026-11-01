# NOTE — cấu hình bảo mật trước khi chuyển GEME lên host chính

Ngày cập nhật: 01/11/2026. Đây là danh sách việc cần làm khi triển khai production, chưa phải xác nhận host đã hoàn tất. Không lưu mật khẩu hoặc token trong file này.

## Quy tắc bắt buộc trước mỗi lần cập nhật host

Theo yêu cầu chủ dự án: luôn sao lưu bản cũ trước khi cập nhật để có thể quay về nếu thất bại.

1. Đối chiếu local với host; lưu source sẽ thay đổi, cấu hình triển khai và danh sách image/container đang chạy vào thư mục release có thời gian. Tag riêng image cũ để không bị lần build mới ghi mất. Bản sao cấu hình có secret phải giới hạn quyền và chỉ lưu trên VPS.
2. Nếu có migration hoặc thao tác thay đổi dữ liệu: backup database liên quan, kiểm tra bản backup và kế hoạch rollback dữ liệu trước khi chạy. Không reset DB, không chạy seed lại trong một đợt cập nhật thông thường.
3. Build và kiểm tra trước khi thay container; giữ bản cũ phục vụ trong lúc build. Chuẩn bị sẵn lệnh/script rollback source + cấu hình + image cũ.
4. Sau cập nhật, kiểm tra health, API, trang web và chức năng bị ảnh hưởng. Nếu lỗi nghiêm trọng, phục hồi bản cũ rồi kiểm tra lại; không báo triển khai thành công khi chưa xác minh.
5. Ghi lại thời gian, phạm vi, thư mục backup, phiên bản image, kiểm tra và kết quả trong biên bản release. Không xóa bản rollback trong lúc chủ dự án đang test. Chỉ commit sau khi chủ dự án xác nhận test đạt nếu đang theo quy trình test trước, commit sau.

## Code đã chuẩn bị để đi theo build

- Storefront/Admin Next 16.4.3; API có các bản vá dependency và giới hạn từ khóa tìm kiếm.
- CSP nonce mới cho từng response ở cả Storefront và Admin. Script không có nonce và event handler HTML bị chặn; production không cho `unsafe-eval` hay `unsafe-inline` trong script. Inline CSS còn được phép để giữ gallery, style React và màn hình chỉnh sửa. Ảnh/video HTTPS ngoài hệ thống còn được phép vì nội dung do Admin cấu hình.
- HTML và RSC render theo request, không cache công khai để tránh tái sử dụng nonce. Cache ảnh/static và các fetch/cache dữ liệu được cấu hình rõ ràng vẫn dùng được. Cần đo lại tải thực tế trước khi chuyển domain vì các trang trước đây dựng tĩnh nay dùng server render.
- Rate limit API dùng Redis khi có `REDIS_URL`; production bắt buộc có biến này. Tất cả API replica cùng deployment cần cùng Redis/database và `API_RATE_LIMIT_PREFIX`. Lua kiểm tra/tăng bộ đếm nguyên tử và tự hết hạn sau 60 giây.
- Redis lỗi: login, tạo đơn, các thao tác ghi và webhook trả 503 + Retry-After để thử lại; không xử lý thanh toán khi chưa vượt qua limiter. GET dùng bộ đếm cục bộ có giới hạn làm dự phòng. Readiness báo 503, liveness vẫn sống. Local không khai báo Redis dùng bộ đếm trong tiến trình.
- Không cần migration mới chỉ cho CSP/rate limit. Các migration nghiệp vụ của toàn bộ release vẫn phải áp dụng ở bước triển khai.

## 1. Domain, HTTPS và URL

- [ ] Chốt hostname Storefront, Admin và endpoint API production; cấu hình DNS tới VPS chính. Không dùng hostname test trong production build.
- [ ] Cấp SSL hợp lệ, tự gia hạn, chuyển HTTP sang HTTPS. Kiểm tra HTTPS trước khi duy trì HSTS.
- [ ] `GEME_SITE_URL`: canonical HTTPS thật. `NEXT_PUBLIC_API_BASE_URL`: URL API công khai đúng môi trường hoặc đường dẫn cùng origin.
- [ ] `GEME_API_BASE_URL`, `GEME_STOREFRONT_ASSETS_URL`, `AEGIS_AUTH_API_URL`, `AEGIS_ORDER_EMAIL_URL`: URL nội bộ đúng service/port. Không dùng localhost máy cá nhân trên VPS.
- [ ] `CORS_ORIGINS`: chỉ những origin HTTPS thật được sử dụng, không `*` và không có path.
- [ ] URL `NEXT_PUBLIC_*` và rewrites nằm trong build: thay domain/route thì build lại. Secret backend được đọc runtime: thay thì recreate/restart đúng service.
- [ ] Reverse proxy/CDN chuyển nguyên header CSP; không thêm CSP thứ hai, không cache HTML/RSC và không bật tính năng tự chèn JavaScript nếu chưa kiểm tra tương thích nonce. Giữ cache cho static/image.
- [ ] Nếu browser cần fetch tới origin ngoài API/media đã cấu hình, thêm đúng HTTPS origin vào `CSP_CONNECT_ORIGINS` (phân cách dấu phẩy) của frontend tương ứng. Không thêm wildcard. Google Maps iframe hiện được phép.

## 2. Database, Redis, mạng và proxy

- [ ] Tạo database production, cấu hình `DATABASE_URL`, mật khẩu PostgreSQL, `DB_POOL_MAX`, `REDIS_URL`, `NODE_ENV=production`.
- [ ] Redis production là bắt buộc; giữ riêng database/namespace với staging. Tất cả replica production dùng cùng `API_RATE_LIMIT_PREFIX` (mặc định `geme:rate-limit:v1`). Prefix không phải secret. Redis cần TTL và atomic Lua/EVAL; không public cổng Redis.
- [ ] Bật private network; không mở PostgreSQL, Redis, SQL Server, AEGIS ra Internet. Cấu hình persistence Redis và dung lượng/eviction phù hợp cho queue + limiter.
- [ ] `TRUST_PROXY_HOPS` đúng số proxy thực tế tới Express; AEGIS KnownProxy đúng proxy tin cậy. Proxy phải ghi đè/xử lý đúng forwarded headers, không tin giá trị IP do khách tự gửi. Các request đi qua BFF có thể chung IP; đo thực tế trước khi giảm hạn mức.
- [ ] Kiểm tra `/api/v1/health/ready` nhận 200 khi DB/Redis sẵn sàng, 503 khi mất Redis; `/api/v1/health/live` vẫn đáp ứng để không tạo vòng restart liên tục.

## 3. Tài khoản, khóa bí mật và email

- [ ] Tạo secret production riêng: `ADMIN_AUTH_JWT_SECRET` tối thiểu 32 byte ngẫu nhiên, `AEGIS_JWT_KEY`, `AEGIS_OTP_HASHING_KEY`, `AEGIS_SQL_PASSWORD`, mật khẩu DB. Thay những secret cũ đã lộ trong log/chat nếu còn hiệu lực.
- [ ] `GEME_ORDER_EMAIL_API_KEY` phải khớp secret gửi mail nội bộ AEGIS. Giữ secret phía server, ngoài Git và ngoài `NEXT_PUBLIC_*`.
- [ ] Cấu hình SMTP `AEGIS_EMAIL_HOST/PORT/ENABLE_SSL/USERNAME/PASSWORD/FROM_EMAIL/FROM_NAME`; kiểm tra DNS mail nếu dùng domain riêng. Xác minh OTP, reset mật khẩu và email đơn hàng trên production trước mở bán.
- [ ] Nếu DB chưa có Admin: bootstrap một lần với `ADMIN_EMAIL/ADMIN_PASSWORD` bằng mật khẩu riêng đủ mạnh; gỡ biến bootstrap sau đó. Rà quyền từng tài khoản.

## 4. Ảnh, R2 và tệp riêng tư

- [ ] Cấu hình Worker public media, bucket private, token giới hạn đúng bucket. Không mở công khai toàn bộ bucket có tệp riêng tư.
- [ ] API: `MEDIA_STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; `R2_PRIVATE_BUCKET_NAME` nếu dùng. `R2_REQUEST_TIMEOUT_MS` theo đường truyền.
- [ ] `MEDIA_PUBLIC_BASE_URL`: HTTPS Worker đúng dữ liệu. Cấu hình cho API, Storefront và Admin (Admin dùng để tải/xem trước ảnh). Không đưa credentials R2 vào frontend.
- [ ] Sao lưu, áp dụng migration và chạy chuyển media nếu cần. Xác minh card, chi tiết sản phẩm, biến thể, blog, banner, video, upload và quyền tệp riêng tư.

## 5. Thanh toán SePay

- [ ] API production: `SEPAY_API_TOKEN`, `SEPAY_WEBHOOK_SECRET` riêng tối thiểu 32 byte, `SEPAY_WEBHOOK_ENABLED=true`, `SEPAY_API_BASE_URL` đúng.
- [ ] Tạo/cập nhật webhook trên SePay tới `https://<host-api-cong-khai>/api/v1/integrations/sepay/webhook`; host này phải route tới API thật. Chọn JSON, tiền vào, HMAC-SHA256, bật retry lỗi HTTP và cảnh báo.
- [ ] Kiểm tra một tài khoản ngân hàng liên kết đang hoạt động để GEME lấy thông tin tạo QR. `SEPAY_ACCOUNT_NUMBERS` chỉ là fallback cũ, không dùng thay API token cho cấu hình mới.
- [ ] Xác minh đơn thử được phép: đúng mã/đủ tiền mới xác nhận; thiếu tiền, sai mã, quá hạn, webhook gửi lặp và retry sau 503 không ghi nhận trùng. Không đánh dấu đã thanh toán chỉ vì hiển thị/quét QR.
- [ ] Nếu ghi nhận tiền sang POS: cấu hình `POS365_ACCOUNT_ID_BANK_TRANSFER` đúng tài khoản và theo dõi queue đồng bộ.

## 6. Tích hợp tùy chọn

- [ ] POS365 nếu bật: `POS365_API_BASE_URL/USERNAME/PASSWORD/BRANCH_ID`, kiểm tra kết nối và đúng cửa hàng trước khi `POS365_ENABLED=true`. Staging/local không chạy job ghi trùng với production.
- [ ] Viettel Post nếu bật: token, endpoint production, thông tin người gửi, webhook token và callback.
- [ ] Shopee/Meta nếu bật: app/key/token encryption riêng, callback/return URL và quyền production trên dashboard nhà cung cấp. Giữ tắt khi chưa hoàn tất.

## 7. Phát hành và vận hành host

- [ ] Build từ cùng commit và lockfiles; giữ các policy `pnpm-workspace.yaml`. Không cần viết lại bản sửa khi đổi VPS.
- [ ] Backup PostgreSQL + SQL Server + media mapping, thử restore trước release. Chạy `pnpm db:deploy` cho GEME và quy trình migration AEGIS đúng release. Không seed đè dữ liệu hiện hữu.
- [ ] Firewall: 80/443 và SSH giới hạn nguồn; SSH key, hạn chế root/password theo kế hoạch quản trị. Cập nhật OS/runtime/container, quyền truy cập file env và backup.
- [ ] WAF/load balancer: giới hạn lưu lượng/connection/body size, login/OTP/search/orders/webhook và chống bot/DDoS. Redis limiter trong API đã dùng chung nhưng không thay thế lớp chống lưu lượng ở mạng. Đặt mức có tính tới NAT/BFF và retry SePay.
- [ ] Đồng bộ giờ NTP vì chữ ký webhook có hạn thời gian. Theo dõi 429/503, Redis memory/latency, DB pool, lỗi OTP/webhook, tồn queue, dung lượng ổ đĩa, backup và SSL hết hạn.
- [ ] Kiểm tra bảo mật/kiểm thử tải được phép trên đúng hạ tầng trước chuyển domain; không lấy kết quả build/unit test làm chứng nhận chống mọi loại tấn công.
- [ ] Chạy smoke test trình duyệt desktop/mobile cho đăng nhập, upload, search, giỏ hàng, checkout, QR, Admin và CSP console; giữ bản image + backup để rollback.

## Kết quả kiểm tra bản sửa local

- Build production API, Admin, Storefront: đạt, gồm TypeScript. Hai frontend dùng thư mục build kiểm thử riêng, không thay bản đang chạy.
- 15/15 test rate limit, guard phân quyền, dữ liệu checkout và tính giá: đạt.
- 7/7 test CSP của hai frontend: đạt.
- 1/1 test Redis thật với hai kết nối và 40 yêu cầu đồng thời: đạt ngày 31/10, đúng quota và TTL; khóa test riêng đã được dọn. Lần kiểm tra lại readiness ngày 01/11 chưa thực hiện được vì Docker Desktop đang tắt; chưa xác nhận tình trạng toàn bộ dịch vụ local hiện tại.
- Kiểm tra HTTP trên hai bản production ở cổng local 3310/3311: đạt. Nonce mới mỗi response, mọi script render (kể cả JSON-LD) mang nonce đúng, header giả bị ghi đè, HTML không cache công khai. Hai server kiểm thử đã dừng.
- CI đã bổ sung test CSP và rate limit với Redis riêng. Workflow GitHub chưa chạy vì chưa push.
- Chưa kiểm thử xâm nhập, tải lớn, toàn bộ thao tác trình duyệt hoặc cấu hình bảo mật của host chính. CSP vẫn cho inline style và media HTTPS; không coi đây là cam kết chống mọi loại tấn công.
- Chưa commit/push. Đã triển khai lên staging ngày 01/11/2026 theo yêu cầu chủ dự án; xem biên bản bên dưới. Chưa triển khai lên domain chính.

## Biên bản triển khai staging — 01/11/2026

- Hoàn tất lúc 08:42:16 giờ Việt Nam, release `security-20261101-0134`.
- Phạm vi: API, Storefront `https://test.geme.vn`, Admin `https://testadmin.geme.vn`. 25 file source trên VPS khớp checksum với gói local. Không commit hoặc push; chờ chủ dự án test đạt.
- Backup trên VPS: `/opt/geme-staging/backups/security-20261101-0134/`. Có `source-config.tar.gz` (quyền 600, chứa source/cấu hình cũ), `images.json` và danh sách file mới. Thư mục backup có quyền 700. Image cũ đã tag riêng với hậu tố `rollback-security-20261101-0134` và đã xác minh tồn tại.
- Thư mục release/log: `/opt/geme-staging/releases/security-20261101-0134/` (`build.log`, `activate.log`, `verification.json`, `manifest.json`).
- Lệnh rollback trên VPS: `bash /opt/geme-staging/releases/security-20261101-0134/rollback.sh`. Khôi phục source/cấu hình cũ và chạy lại ba image cũ; không seed/reset database. Giữ nguyên các image và backup này trong lúc test.
- Không có migration hay thao tác thay đổi dữ liệu trong release này. Cấu hình restart API đã tách seed/migration ra khỏi startup; quy trình cài đặt lần đầu/migration được cập nhật ở `deploy/staging/README.md`.
- Kết quả: cả ba container healthy, restart count 0 tại lần kiểm tra cuối; Storefront/Admin chạy Next 16.4.3; Redis limiter dùng namespace `geme:staging:rate-limit:v1`. Sáu test rate limit/Redis thật trên VPS đạt 6/6.
- HTTP public: hai endpoint readiness trả 200; trang chủ, đăng nhập Storefront, sản phẩm, New Arrivals, liên hệ và đăng nhập Admin trả 200. Nonce thay đổi theo response, script khớp nonce, HTML không cache công khai; 31 lượt kiểm tra tài nguyên JS/CSS/ảnh lấy mẫu trả 200.
- Đợt kiểm tra này chưa thực hiện thao tác tài khoản hoặc thanh toán thật. Chủ dự án kiểm tra UI/nghiệp vụ trước khi chốt commit. Không coi smoke test là kiểm thử xâm nhập hoặc kiểm thử tải.

## Bản cập nhật UI staging — 01/11/2026

- 09:08: cập nhật trang chi tiết sản phẩm: hàng còn tồn hiển thị “Còn hàng”, tồn bằng 0 hiển thị “Tạm hết hàng”; nhãn “Liên hệ…” cho đá quý cao cấp giữ nguyên. Chỉ build/restart Storefront.
- Backup Storefront: `/opt/geme-staging/backups/stock-label-20261101-0908/source-config.tar.gz` (mode 600, gồm source cũ, compose và `.env`); image cũ được tag `geme-staging-storefront:rollback-stock-label-20261101-0908`. Rollback: `bash /opt/geme-staging/releases/stock-label-20261101-0908/rollback.sh`.
- 09:18: thay prompt trình duyệt mặc định khi ghi chú xử lý/lưu trữ tin nhắn liên hệ bằng modal theo style Admin, đồng nhất font Segoe UI, cỡ chữ nhập 16px/nội dung 15px; vẫn bắt buộc ghi chú tối thiểu 5 ký tự. Chỉ build/restart Admin.
- Backup Admin: `/opt/geme-staging/backups/contact-note-modal-20261101-0918/source-config.tar.gz` (mode 600, gồm hai file component/style cũ, compose và `.env`); image cũ được tag `geme-staging-admin:rollback-contact-note-modal-20261101-0918`. Rollback: `bash /opt/geme-staging/releases/contact-note-modal-20261101-0918/rollback.sh`.
- Kiểm tra local: production build Storefront và Admin thành công; `pnpm build` ban đầu không chạy được do sandbox chặn tạo symlink, sau đó gọi Next trực tiếp từ `node_modules` và build đạt. Docker Desktop local đang tắt nên chưa cập nhật container local.
- Kiểm tra host: `https://test.geme.vn/san-pham/kieng-aquamarine` trả 200 và HTML có “Còn hàng”; `https://testadmin.geme.vn/login` trả 200; Storefront, Admin và API đều healthy sau cập nhật. Không có thay đổi dữ liệu/DB.
- Chưa commit hoặc push; chờ chủ dự án kiểm tra giao diện trước khi chốt.

## Chương trình điểm thưởng và mật khẩu — staging — 01/11/2026

- Hoàn tất lúc khoảng 10:40 giờ Việt Nam, release `loyalty-password-20261101-1027`. Chỉ cập nhật staging (`test.geme.vn`, `testadmin.geme.vn`); không đụng host chính, không commit/push.
- Trước khi ghi source hoặc migration, tạo backup tại `/opt/geme-staging/backups/loyalty-password-20261101-1027/` (thư mục 700, các file dump/source có quyền 600): source + `.env` + compose cũ, dump PostgreSQL 83 MB, backup SQL Server AEGIS 5.5 MB, danh sách image/container và checksum. `pg_restore --list` đọc được; SQL Server `RESTORE VERIFYONLY ... WITH CHECKSUM` xác nhận backup hợp lệ. PostgreSQL backup đầy đủ bao gồm bảng media mapping.
- Image cũ đã gắn tag `rollback-loyalty-password-20261101-1027`. Lệnh quay lại source và 4 image cũ: `bash /opt/geme-staging/releases/loyalty-password-20261101-1027/rollback.sh`. Migration điểm thưởng chỉ thêm cột/bảng/index nên giữ nguyên trong rollback ứng dụng; không restore DB tự động.
- Lần build đầu dừng trước khi thay container do source AEGIS trên staging thiếu các file command/validator đặt lại mật khẩu có trong local. Đã đồng bộ toàn bộ source AEGIS local, build lại thành công; containers cũ tiếp tục phục vụ suốt thời gian build.
- Build API, AEGIS, Storefront, Admin: đạt. Áp dụng migration `20261113000000_loyalty_points_program` bằng `pnpm db:deploy`, thành công. Chương trình điểm mặc định đang tắt; admin cần bật rõ ràng, không cộng điểm hồi tố cho đơn cũ.
- Sau cập nhật, API, AEGIS, Storefront, Admin đều healthy; restart count 0. `https://test.geme.vn/`, `https://testadmin.geme.vn/login`, và API readiness trả 200.
- Kiểm tra mật khẩu staging: POST `/api/auth/change-password` không có phiên đăng nhập trả 401 đúng; POST `/api/auth/forgot-password` với địa chỉ `.invalid` trả phản hồi chung 200, không tiết lộ tài khoản tồn tại. AEGIS SMTP và OTP hashing key đã được xác nhận có cấu hình mà không đọc/ghi log giá trị bí mật.
- Giới hạn kiểm tra: chưa gửi OTP tới hộp thư thật và chưa đổi/reset mật khẩu trên tài khoản người dùng; cần chủ dự án kiểm tra một tài khoản của mình trên `test.geme.vn`. Build, API test và smoke test không thay cho thao tác E2E với email/phiên thật.
- Local: code và build đã cập nhật; Docker Desktop đang tắt nên migration điểm thưởng chưa áp dụng vào DB/container local. Khi mở Docker, chạy `pnpm db:deploy` trong `outputs/geme-api` (hoặc `docker compose run --rm api pnpm db:deploy`) rồi khởi động lại stack local.
- Kiểm tra local trước khi triển khai: 117/117 API test đạt; API TypeScript, Admin/Storefront production build và AEGIS build đạt. Không có dữ liệu local bị reset.
