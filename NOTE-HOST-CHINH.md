# NOTE — cấu hình bảo mật trước khi chuyển GEME lên host chính

Ngày cập nhật: 01/11/2026. Đây là danh sách việc cần làm khi triển khai production, chưa phải xác nhận host đã hoàn tất. Không lưu mật khẩu hoặc token trong file này.

## Quy tắc bắt buộc trước mỗi lần cập nhật host

Theo yêu cầu chủ dự án: luôn sao lưu bản cũ trước khi cập nhật để có thể quay về nếu thất bại.

1. Đối chiếu local với host; lưu source sẽ thay đổi, cấu hình triển khai và danh sách image/container đang chạy vào thư mục release có thời gian. Tag riêng image cũ để không bị lần build mới ghi mất. Bản sao cấu hình có secret phải giới hạn quyền và chỉ lưu trên VPS.
2. Nếu có migration hoặc thao tác thay đổi dữ liệu: backup database liên quan, kiểm tra bản backup và kế hoạch rollback dữ liệu trước khi chạy. Không reset DB, không chạy seed lại trong một đợt cập nhật thông thường.
3. Build và kiểm tra trước khi thay container; giữ bản cũ phục vụ trong lúc build. Chuẩn bị sẵn lệnh/script rollback source + cấu hình + image cũ.
4. Sau cập nhật, kiểm tra health, API, trang web và chức năng bị ảnh hưởng. Nếu lỗi nghiêm trọng, phục hồi bản cũ rồi kiểm tra lại; không báo triển khai thành công khi chưa xác minh.
5. Quy tắc lưu backup host test: mỗi lần triển khai, tạo một thư mục backup mới có timestamp/release ID, xác minh đủ source/config cần khôi phục, image rollback và script rollback; sau khi backup mới đã xác minh thì xóa các thư mục backup cũ và tag image rollback cũ, chỉ giữ lại backup mới nhất. Thực hiện trước khi thay container để nếu deploy lỗi vẫn có đúng snapshot trước triển khai để quay lui. Không xóa backup mới nhất trong lúc chủ dự án đang test.
6. Ghi lại thời gian, phạm vi, thư mục backup, phiên bản image, kiểm tra và kết quả trong biên bản release. Chỉ commit sau khi chủ dự án xác nhận test đạt nếu đang theo quy trình test trước, commit sau.

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

## Bộ lọc đơn đã hủy — staging — 01/11/2026

- Hoàn tất lúc 2026-11-01 15:22:26 +07:00. Phạm vi: Admin local và Admin staging https://testadmin.geme.vn; không thay đổi API, Storefront hoặc dữ liệu/DB.
- Shipping workspace có bộ lọc riêng Đơn đã hủy, đếm theo trạng thái đơn GEME CANCELLED/Đã hủy; trạng thái vận đơn bị hãng hủy vẫn nằm trong nhóm Giao lỗi / hoàn.
- Local: production build Admin thành công; Docker Compose cập nhật và khởi động Admin tại http://localhost:3001 cùng các dịch vụ phụ thuộc. HTTP 200. Image cũ giữ ở tag geme-local-admin:rollback-before-cancelled-filter-20261101.
- Staging backup trước cập nhật: /opt/geme-staging/backups/shipping-cancelled-20261101-151822/; source Admin + compose + .env nằm trong source-config.tar.gz (file quyền 600, thư mục quyền 700). Image cũ: geme-staging-admin:rollback-shipping-cancelled-20261101-151822 (sha256:10c1cf38f23f05dca3c0b587e2ab7470e0a05004b9178ecbbab18b04df434d1f).
- Rollback: bash /opt/geme-staging/releases/shipping-cancelled-20261101-151822/rollback.sh. Không có migration nên không cần backup DB riêng cho release này. Giữ backup/tag rollback trong lúc chủ dự án kiểm tra.
- Image Admin mới: sha256:fddaed8fdaf189fe3a4a1ae0733a81ffbfd6f2b49c890dff2d5b39e3aee95c74.
- Xác minh sau deploy: Admin healthy, restart count 0; Storefront https://test.geme.vn/, Admin https://testadmin.geme.vn/login, API readiness đều trả HTTP 200; các container staging đều healthy. Bundle có shipping workspace mới.
- Chưa commit hoặc push; chờ chủ dự án kiểm tra.

## Ưu tiên an toàn SePay, Aegis và tải Admin — 02/11/2026

- Local source đã cập nhật; chưa deploy local container hoặc staging. Trước khi cập nhật staging phải làm backup source/config, tag image cũ và chuẩn bị lệnh rollback theo quy trình ở đầu file; chưa có thay đổi database trong đợt này.
- SePay: API kiểm tra giao dịch tiền vào định kỳ mỗi 5 phút, dùng cursor Redis và xử lý tối đa 1.000 giao dịch mỗi lượt. Giao dịch được đưa qua đúng hàng đợi/idempotency và cùng điều kiện tài khoản, mã GEME, trạng thái đơn, hạn QR 15 phút và số tiền chính xác. Giao dịch thiếu dữ liệu/không khớp không được tự đánh dấu đã thanh toán mà vào hàng cần kiểm tra. Chỉ chạy khi webhook bật và có `SEPAY_API_TOKEN`.
- Aegis staging: compose chuyển sang `ASPNETCORE_ENVIRONMENT=Production`; Swagger và migration tự chạy lúc khởi động bị tắt. Khi phát hành có migration Aegis, chạy riêng `docker compose --env-file .env -f deploy/staging/compose.yaml run --rm -e Database__MigrateOnly=true aegis` sau khi sao lưu SQL Server và xác minh file backup.
- Admin: màn hình tạo bài dùng `admin-summary` thay vì tải toàn bộ gallery/media của tất cả sản phẩm; chi tiết chỉ tải khi chọn SKU.
- Kiểm tra local: API TypeScript build đạt; Admin production build đạt; API tests 102/102 đạt và 2 test ánh xạ giao dịch SePay đạt riêng. Aegis build chưa xác minh được: môi trường Windows sandbox từ chối truy cập Service Control Manager khi .NET SDK đánh giá project references; Docker engine cũng không truy cập được trong phiên này.
- Trước khi bật/release staging: xoay các token/secret có thể còn hiệu lực nhưng từng xuất hiện trong screenshot/chat; kiểm tra SePay API token có quyền đọc giao dịch, webhook còn gửi HMAC-SHA256/retry, Redis persistent/healthy và xác minh một khoản thử. Không lưu secret mới trong file note.
- Không cập nhật host trong đợt này. Chờ Docker/SSH staging dùng được, tạo backup mới trước khi build/thay container; sau deploy phải kiểm tra readiness, OTP, thanh toán thử, ghi nhận POS và rollback image cũ nếu healthcheck hoặc đối soát sai.

## Báo cáo lợi nhuận, lịch sự kiện và nhóm menu Admin — 02/11/2026

- Phạm vi: API/Admin local và staging (`testadmin.geme.vn`). Báo cáo lãi sau giá vốn có kỳ ngày/tuần/tháng/quý; giá vốn bình quân theo SKU từ phiếu nhập đã hoàn tất trước lúc bán, trừ hàng hoàn/hoàn tiền; dòng chưa có giá nhập được báo riêng, không tự đoán. Lịch cho tạo/sửa/xóa sự kiện, quyền riêng `calendar.read`/`calendar.manage`, nhắc sự kiện hôm nay một lần mỗi ngày/tài khoản Admin. Menu Admin được nhóm theo chức năng. Bốn shortcut trong menu con Báo cáo đã bỏ; nội dung các báo cáo vẫn nằm trong trang Tổng quan báo cáo.
- Local: backup riêng tại `%TEMP%\GEME\local-profit-calendar-nav-20261102-1345` (ACL chỉ tài khoản Windows hiện tại), gồm dump PostgreSQL đã xác minh, compose/env và tag image cũ `geme-local-geme-api:rollback-local-profit-calendar-nav-20261102-1345`, `geme-local-admin:rollback-local-profit-calendar-nav-20261102-1345`. Migration `20261115000000_admin_calendar_events` áp thành công. API/Admin build và khởi động lại; API readiness, Admin `/login`, Storefront đều HTTP 200, container Admin/API healthy.
- Staging: backup trước release ở `/opt/geme-staging/backups/profit-calendar-nav-20261102-132915/`; có source/config, PostgreSQL dump, checksum và image rollback. Source/API/Admin image build; migration lịch áp thành công; API/Admin được khởi động lại. Rollback release đầy đủ: `bash /opt/geme-staging/releases/profit-calendar-nav-20261102-132915/rollback.sh`.
- Trước khi bỏ 4 shortcut menu, staging được backup lần nữa tại `/opt/geme-staging/backups/profit-calendar-menu-20261102-1405/`, gồm source/config, PostgreSQL dump đã checksum và image tag rollback. Admin build/restart thành công. Rollback trạng thái trước thay đổi menu: `bash /opt/geme-staging/releases/profit-calendar-menu-20261102-1405/rollback.sh`.
- Smoke test cuối: local và staging Admin `/login`, API `/api/v1/health/ready`, Storefront `/` trả 200; các container ứng dụng healthy. Hai API mới trả 401 khi gọi không có phiên đăng nhập, đúng với bảo vệ quyền; API test 110/110, Admin TypeScript và production build đã đạt. Chưa thao tác kiểm tra UI bằng tài khoản Admin thật hoặc kiểm thử báo cáo trên dữ liệu kinh doanh thật.
- Không commit/push. Giữ các backup và image rollback trong lúc chủ dự án kiểm tra.
- Lưu ý bảo mật: một lệnh chẩn đoán Docker local đã trả giá trị biến môi trường vào log công cụ. Không ghi lại các giá trị này ở đây; cần xoay các credential có quyền truy cập dịch vụ (POS365, SePay, R2, Shopee, JWT/email) rồi cập nhật `.env.docker`/staging. Gói source triển khai không chứa `.env.docker` local.

## Triển khai Gmail OAuth lên staging — 02/11/2026

- Release `gmail-oauth-20261102-172352`; chỉ cập nhật staging, không cập nhật host chính. Source snapshot đóng gói từ `outputs/geme-api`, `outputs/geme-admin` và `deploy/staging/compose.yaml` của workspace hiện tại; vì vậy snapshot gồm toàn bộ nội dung API/Admin trong source đó, không chỉ riêng Gmail.
- Sao lưu trước cập nhật tại `/opt/geme-staging/backups/gmail-oauth-20261102-172352/`: source/cấu hình cũ, danh sách container/image và PostgreSQL dump `geme` đã kiểm tra bằng `pg_restore -l`. Tag image cũ `geme-staging-api:rollback-gmail-oauth-20261102-172352` và `geme-staging-admin:rollback-gmail-oauth-20261102-172352` được giữ lại.
- Cấu hình OAuth staging đã có client credentials, redirect `https://testadmin.geme.vn/api/v1/integrations/gmail/callback`, return URL `https://testadmin.geme.vn/` và khóa mã hóa riêng 32 byte. Giá trị bí mật không ghi vào tài liệu. File patch tạm đã xóa sau khi nhập vào `.env` trên VPS.
- Build API/Admin thành công; migration `20261116000000_gmail_oauth_integration` áp dụng thành công; API/Admin được recreate. Toàn bộ container staging healthy. Smoke check: Admin login HTTP 200, Storefront HTTP 200, `/api/v1/health/ready` HTTP 200 và database connected.
- Rollback: `bash /opt/geme-staging/releases/gmail-oauth-20261102-172352/rollback.sh`. Rollback phục hồi source/image API/Admin trước release; migration Gmail là additive nên không bị đảo và database dump vẫn được giữ riêng.
- Gmail account chưa được OAuth-authorize trong staging. Trong Google Cloud OAuth Client cần Authorized redirect URI chính xác như trên; sau đó vào Admin → Gmail → Kết nối Gmail, chọn tài khoản đã thêm vào Test users và cấp quyền. Chưa kiểm tra gửi/đọc thư đầu-cuối.
- Chưa commit hoặc push.

## GEME Marketing Analytics — staging — 02/11/2026

- Đã triển khai lên `testadmin.geme.vn` và `test.geme.vn`; không cập nhật host production.
- Sao lưu trước cập nhật: `/opt/geme-staging/backups/marketing-analytics-20261102-2255/` (PostgreSQL dump đã được `pg_restore --list` kiểm tra, source/config và thông tin container/image). Image rollback: `geme-staging-api:rollback-marketing-analytics-20261102-2255`, `geme-staging-admin:rollback-marketing-analytics-20261102-2255`, `geme-staging-storefront:rollback-marketing-analytics-20261102-2255`.
- Rollback source/image: `bash /opt/geme-staging/releases/marketing-analytics-20261102-2255/rollback.sh`. Migration Marketing là bổ sung; rollback ứng dụng không tự phục hồi database để tránh xóa dữ liệu mới phát sinh.
- Build API, Admin, Storefront đạt; migration `20261102000000_marketing_analytics` áp dụng thành công; Prisma báo database schema up to date.
- Sau triển khai: API, Admin, Storefront, PostgreSQL và Redis healthy. Smoke check: `https://test.geme.vn/`, `https://testadmin.geme.vn/login`, `/api/v1/health/ready` đều HTTP 200; `GET /api/v1/admin/marketing/overview` HTTP 401 khi chưa đăng nhập (route có mặt và được bảo vệ bởi quyền Admin).
- Không thay đổi `.env` staging; không commit/push. Backup và image rollback được giữ lại trong lúc kiểm tra.

## GEME Marketing Cohort Retention — local + staging — 03/11/2026

- Đã build và khởi động API/Admin local bằng Docker; API và Admin healthy. Smoke check local: storefront `http://localhost:3000/` HTTP 200, Admin `/login` HTTP 200, API `/api/v1/health/ready` HTTP 200, Marketing overview trả 401 nếu chưa đăng nhập.
- Đã triển khai ba file API/Admin Marketing lên staging `testadmin.geme.vn` và `test.geme.vn`; không có thay đổi schema, không chạy migration. Smoke check staging: Storefront `/` HTTP 200, Admin `/login` HTTP 200, API `/api/v1/health/ready` HTTP 200, Marketing overview trả 401 khi chưa đăng nhập. API/Admin/Storefront đều healthy sau deploy.
- Sao lưu trước deploy: `/opt/geme-staging/backups/marketing-cohort-20261102-234649/`; `SHA256SUMS` hợp lệ. Image rollback: `geme-staging-api:rollback-marketing-cohort-20261102-234649`, `geme-staging-admin:rollback-marketing-cohort-20261102-234649`, `geme-staging-storefront:rollback-marketing-cohort-20261102-234649`. Rollback source/image: `bash /opt/geme-staging/releases/marketing-cohort-20261102-234649/rollback.sh`. Không tự phục hồi database vì đợt này không có migration.
- API/Admin production build đạt. Chưa chạy unit test riêng cho logic cohort trong lượt deploy này.
- Cohort tính theo visitor hash của trình duyệt, mốc gia nhập là OTP được xác minh, hoạt động theo session/tháng. Không nhận diện một người qua nhiều thiết bị và không thể bổ sung lịch sử trước khi analytics bắt đầu ghi nhận; tháng hiện tại chưa đầy đủ.
- Không commit/push; không cập nhật host production.

## Báo cáo thương mại điện tử tổng hợp — local + staging — 03/11/2026

- Tham chiếu bộ 10 chỉ số trong bài [Mastering Data Analytics](https://www.mastering-da.com/top-10-metrics-quan-trong-can-theo-doi-trong-thuong-mai-dien-tu): tỷ lệ chuyển đổi, AOV, CLV, CAC, bỏ giỏ, khách quay lại, bounce rate, NPS, CTR và phiên theo nguồn truy cập. Trang Report GEME bổ sung doanh thu/lợi nhuận sau giá vốn, đơn/hoàn trả, khách mới/quay lại, sản phẩm/danh mục, phương thức thanh toán, khuyến mãi, nguồn/kênh tiếp thị và các biểu đồ xu hướng/phễu; có lọc ngày, tuần, tháng, quý, năm. Chỉ dùng dữ liệu GEME đã lưu, không dựng chuỗi số giả.
- NPS và CTR hiện ghi “Chưa đo” vì chưa có dữ liệu khảo sát NPS và lượt hiển thị/nhấp chiến dịch. CAC là ước tính từ chi phí marketing nhập trong Admin chia khách mua mới nhận diện được. CLV là số liệu lịch sử đơn hàng, không phải dự báo vòng đời. Bounce rate là ước lượng theo phiên một trang sau timeout 30 phút do GEME chưa ghi nhận đầy đủ mọi tương tác. Báo cáo cần giữ nhãn giới hạn này.
- Migration bổ sung `20261103000000_marketing_ecommerce_metrics` đã áp dụng trên database local và staging; chỉ thêm bộ đếm/thời điểm thêm giỏ và index, không reset dữ liệu.
- Trước khi cập nhật staging, backup tại `/opt/geme-staging/backups/ecommerce-report-20261103-021821/`: PostgreSQL dump 86 MB đã xác minh đọc được bằng `pg_restore --list`, source/config và SHA256SUMS. Giữ image rollback `geme-staging-api:rollback-ecommerce-report-20261103-021821`, `geme-staging-admin:rollback-ecommerce-report-20261103-021821`. Rollback: `bash /opt/geme-staging/releases/ecommerce-report-20261103-021821/rollback.sh`; migration bổ sung không tự rollback, dump được giữ riêng.
- Trước khi cập nhật local, backup tại `%TEMP%\GEME\ecommerce-report-20261103-092446`: PostgreSQL dump đã xác minh với PostgreSQL 18, `.env.docker` ACL giới hạn cho user Windows hiện tại, compose, checksum `BA730959C45BAAC8F6D544E1F2403DCFCFCBAD1A0824C846F0FFA88CE95AB72F` và script `rollback.ps1`. Image rollback: `geme-local-geme-api:rollback-ecommerce-report-20261103-092446`, `geme-local-admin:rollback-ecommerce-report-20261103-092446`.
- API/Admin production build đạt trên local và staging; các image API/Admin build, migration áp dụng, dịch vụ được khởi động lại. Kiểm tra HTTP: Admin login và API readiness đều 200 trên local/staging. Đúng các route `/api/v1/reports/overview`, `/api/v1/reports/gross-profit`, `/api/v1/admin/marketing/overview` trả 401 khi chưa xác thực, xác nhận route tồn tại và được bảo vệ; không gọi nhầm `/commerce/reports`.
- Hạn chế kiểm chứng: chưa chạy unit/E2E hoặc kiểm tra giao diện với phiên Admin thật trong release này; chưa kiểm tra trực tiếp số liệu bằng tài khoản quản trị. Local storefront không được thay đổi trong đợt chỉ cập nhật Admin/API này. Không cập nhật production domain.

## Báo cáo khách hàng và kênh bán — local + staging — 03/11/2026

- Đã cập nhật Admin/API trên local và staging `testadmin.geme.vn`; không cập nhật production. Báo cáo phân loại đơn theo Website, Trực tiếp và kênh nền tảng; khách mới/quay lại được nhận diện theo lần thanh toán thành công đầu tiên, dùng số điện thoại/email hoặc mã khách nền tảng khi có. Website tách thành viên/khách vãng lai theo dữ liệu chụp lúc đặt hàng; trang có biểu đồ, chi tiêu ròng, tiền thu/hoàn và danh sách khách phân trang/tìm kiếm.
- Migration `20261117000000_order_customer_channel_reporting` đã áp dụng trên local và staging. Migration chỉ thêm nhãn nguồn/kênh và index cho đơn, đồng thời gắn nhãn DIRECT cho đơn cũ có phương thức giao hàng “Bán trực tiếp tại cửa hàng”; không reset hoặc xóa dữ liệu.
- Sao lưu local trước cập nhật: `outputs/backups/customer-channel-local-20261103-112030/` (PostgreSQL custom dump, checksum, `.env.docker` được giới hạn ACL, compose và snapshot source thay đổi). Image quay lui: `geme-local-geme-api:rollback-customer-channel-20261103-112030`, `geme-local-admin:rollback-customer-channel-20261103-112030`.
- Sao lưu staging trước cập nhật: `/opt/geme-staging/backups/customer-channel-20261103-112204/` (database dump đã xác minh bằng `pg_restore --list`, source/config và danh sách image). Image quay lui: `geme-staging-api:rollback-customer-channel-20261103-112204`, `geme-staging-admin:rollback-customer-channel-20261103-112204`. Script quay lui source/image: `/opt/geme-staging/releases/customer-channel-20261103-112204/rollback.sh`. Migration bổ sung không tự đảo khi quay lui ứng dụng; database dump được giữ riêng.
- API/Admin build thành công trên Docker local và staging. Sau cập nhật, local Admin `/login` và API `/api/v1/health/ready` trả HTTP 200; staging Admin `/login`, Storefront `/`, API readiness đều HTTP 200. API và Admin staging ở trạng thái healthy. Route `/api/v1/reports/customer-detail` trả HTTP 401 khi chưa đăng nhập trên cả local và staging, xác nhận route tồn tại và được bảo vệ.
- Chưa chạy unit/E2E; chưa kiểm tra các con số báo cáo bằng phiên Admin thật hoặc đối chiếu từng đơn trong dữ liệu production. Việc nhận diện khách cũ phụ thuộc dữ liệu liên hệ/kênh còn lưu; các đơn cũ thiếu thông tin không thể suy ra chắc chắn. Không commit/push.

## Báo cáo khách hàng: cuộn trang và biểu đồ đường — local + staging — 03/11/2026

- Sửa Admin Report: biểu đồ “Khách mới và quay lại theo kênh bán” dùng hai chuỗi đường SVG lấy trực tiếp từ số liệu report API, có điểm dữ liệu và tooltip; không dùng thanh ngang hoặc số liệu mẫu. Trục và nhãn kênh giữ rõ khi số kênh tăng; trên màn hình hẹp biểu đồ cuộn ngang.
- Khối báo cáo khách hàng không còn `sticky`, giới hạn chiều cao hoặc cuộn riêng gây chồng lên topbar/nội dung. Báo cáo đi theo cuộn trang Admin bình thường; các bảng vẫn có vùng cuộn ngang riêng khi cần.
- Admin local đã cập nhật trong Docker development container và restart healthy. `http://127.0.0.1:3001/login` trả HTTP 200. TypeScript check và production build Admin thành công.
- Đã build và triển khai Admin lên staging `testadmin.geme.vn`; sau deploy container Admin healthy, Admin `/login`, API readiness và Storefront `/` đều HTTP 200. SHA256 của `reports-workspace.tsx` và `globals.css` trên staging khớp local. Không đổi API, schema, dữ liệu hoặc Storefront; không chạy migration.
- Sao lưu local: `outputs/backups/customer-report-ui-20261103-133054-local/` (source trước cập nhật, compose, trạng thái container, image ID/tag `geme-local-admin:rollback-customer-report-ui-20261103-133054`, `.env.docker` trong thư mục ACL giới hạn cho user hiện tại). Khôi phục source/config và restart Admin bằng `powershell -ExecutionPolicy Bypass -File outputs/backups/customer-report-ui-20261103-133054-local/rollback.ps1`.
- Sao lưu staging: `/opt/geme-staging/backups/customer-report-ui-20261103-133054/` (source/config cũ, compose, trạng thái container, image ID và archive có quyền hạn chế). Image cũ: `geme-staging-admin:rollback-customer-report-ui-20261103-133054`. Rollback: `bash /opt/geme-staging/releases/customer-report-ui-20261103-133054/rollback.sh`.
- Chưa kiểm tra giao diện sau đăng nhập bằng phiên Admin thật; build, health, HTTP smoke và checksum đã kiểm tra. Không cập nhật production, không commit/push.

## Report — biểu đồ tròn kênh bán hàng — local + staging — 03/11/2026

- Đổi phần “Kênh bán hàng” trong Admin Report từ thanh doanh thu thành biểu đồ donut. Các lát biểu đồ dùng doanh thu thật theo kênh trả về từ Reports API; chú giải vẫn liệt kê mọi kênh cùng doanh thu và số đơn, kể cả kênh có doanh thu 0/âm. Tổng ở giữa biểu đồ chỉ cộng doanh thu dương để không biểu diễn sai tỷ trọng.
- Admin local Docker đã restart và healthy; `/login` HTTP 200. Staging `testadmin.geme.vn` đã build/recreate Admin và healthy; smoke check Admin `/login`, API `/api/v1/health/ready`, Storefront `test.geme.vn/` đều HTTP 200. SHA256 hai file Admin trên local và staging khớp nhau.
- `pnpm exec tsc --noEmit` và `pnpm build` trong `outputs/geme-admin` đều thành công. Không đổi API/schema/database, không chạy migration.
- Backup local trước sửa: `outputs/backups/sales-channel-pie-20261103-1450-local/` (source hai file trước sửa, compose, trạng thái container, image rollback `geme-local-admin:rollback-sales-channel-pie-20261103-1450`, script quay lui `rollback.ps1`).
- Backup staging trước deploy: `/opt/geme-staging/backups/sales-channel-pie-20261103-1505/`; archive `source-config.tar.gz` đã kiểm tra checksum. Image cũ `geme-staging-admin:rollback-sales-channel-pie-20261103-1505`; script rollback `bash /opt/geme-staging/releases/sales-channel-pie-20261103-1505/rollback.sh`. Cấu hình `.env` chỉ được lưu trên VPS trong thư mục hạn chế quyền.
- Chưa kiểm tra trực quan sau đăng nhập bằng phiên Admin thật; đã xác minh build, health, endpoint công khai và hash source. Không cập nhật production, không commit/push.

## VietMap keys on staging Admin — 03/11/2026

- Release `vietmap-dual-key-20261103-100541` cập nhật Admin lên `testadmin.geme.vn`; UI map dùng Tilemap key, VietMap API key giữ server-side. Không đổi API, database hay chạy migration.
- Trước khi thay container, đã lưu cấu hình/source cũ tại `/opt/geme-staging/backups/vietmap-dual-key-20261103-100541/`, image cũ `geme-staging-admin:rollback-vietmap-dual-key-20261103-100541` và script rollback `/opt/geme-staging/releases/vietmap-dual-key-20261103-100541/rollback.sh`. Thư mục backup/rollback có quyền hạn chế; `.env` backup mode 600.
- Build Admin thành công. Health: Admin container healthy; map config endpoint HTTP 200, hai key được nhận diện, API key riêng tư không xuất hiện trong JSON. Admin login, API readiness và Storefront trả HTTP 200. Tilemap style đã kiểm tra trả HTTP 200 khi gửi referrer testadmin.
- Các dịch vụ Search/Route chưa được gọi từ map quản lý giao hàng ở release này; phần giao diện map hiện chỉ sử dụng Tilemap. Không commit/push.

## Storefront host test — khôi phục tìm kiếm và sửa đường dẫn blog — 04/11/2026

- Đối chiếu local với source staging: API tìm kiếm và CSS gợi ý đã có trên host, nhưng `site-header.tsx` staging chỉ là ô nhập tĩnh. Local có component tìm kiếm hoạt động: gợi ý theo tên/SKU, mở sản phẩm, Enter chuyển tới trang kết quả; component này đã được triển khai sang Storefront `test.geme.vn`.
- Sửa lỗi blog local tại `outputs/geme/app/blog/[slug]/page.tsx`: trang đọc CSP nonce theo request nhưng cấu hình ISR `revalidate = 5` xung đột với render header động, dẫn đến `DYNAMIC_SERVER_USAGE` và HTTP 500. Chuyển trang bài viết sang `dynamic = "force-dynamic"`; cache ngắn của lời gọi API bài viết vẫn giữ nguyên.
- Đã build production Storefront trên VPS thành công và chỉ recreate container Storefront. Admin, API, Aegis, database, Redis và Caddy không bị thay đổi; không migration/seed hoặc sửa dữ liệu.
- Backup trước deploy blog: `/opt/geme-staging/backups/blog-article-20261104T1416Z/`; image cũ `geme-staging-storefront:rollback-blog-article-20261104T1416Z`; rollback `bash /opt/geme-staging/backups/blog-article-20261104T1416Z/rollback.sh`.
- Backup trước deploy thanh tìm kiếm: `/opt/geme-staging/backups/search-ui-20261104T1430Z/`; image cũ `geme-staging-storefront:rollback-search-ui-20261104T1430Z`; rollback `bash /opt/geme-staging/backups/search-ui-20261104T1430Z/rollback.sh`. `.env` được sao lưu trên VPS với mode 600; thư mục backup mode 700. Giữ hai bản sao lưu/image này trong thời gian kiểm thử.
- Xác minh staging: Storefront healthy; `/blog` và cả 7/7 bài viết trả HTTP 200; API tìm `NSSREM110` trả đúng SKU + tên “Nhẫn điểm nhấn sắc xanh”; API tìm `Topaz` trả sản phẩm; `/san-pham?search=NSSREM110` trả 200 và có SKU/tên mong đợi. SHA256 component local khớp source staging (`ffa297b9cf4eae9ba9c9c71b0bb547626a0cdd3c0b62919ee4820678144b172f`). Log Storefront 10 phút gần nhất không có `DYNAMIC_SERVER_USAGE` hoặc lỗi máy chủ.
- Docker báo thiếu buildx plugin nên dùng builder mặc định; build vẫn hoàn thành thành công. Chưa chạy unit/E2E hoặc kiểm thử trình duyệt tương tác sau đăng nhập; chưa commit/push hay deploy production.

## Storefront host test — breakpoint menu và cân bằng banner mobile — 04/11/2026

- Sửa breakpoint menu gập: hamburger xuất hiện khi viewport từ 1200px trở xuống để tránh menu desktop bị chật khi thu nhỏ cửa sổ PC; panel menu có cuộn riêng. Trên điện thoại giữ nguyên hành vi hiện có.
- Cố định chiều cao vùng chữ banner collection trên mobile (tiêu đề, mô tả, điều khiển slide) để tiêu đề 1 dòng/2 dòng không làm ảnh của slide kế tiếp bắt đầu ở vị trí khác nhau.
- Trước khi cập nhật staging, đã sao lưu source, Compose, `.env` và image Storefront cũ tại `/opt/geme-staging/backups/header-menu-hero-20261104T1506Z/`; checksum backup đã xác minh. Image quay lui: `geme-staging-storefront:rollback-header-menu-hero-20261104T1506Z`; rollback: `bash /opt/geme-staging/backups/header-menu-hero-20261104T1506Z/rollback.sh`.
- Chỉ cập nhật và recreate container Storefront; không thay đổi Admin, API, Aegis, database, Redis hay Caddy. Storefront staging báo healthy; `https://test.geme.vn/` và `/san-pham` đều HTTP 200. Build production Next.js thành công, TypeScript và tạo 45 trang hoàn tất. Thiếu Docker Buildx trên VPS nhưng builder mặc định build thành công.
- Bản local source đã được cập nhật và production build đã chạy thành công. Chưa thể recreate container local vì Docker Desktop daemon hiện không chạy; chưa chạy unit/E2E hoặc kiểm tra trực quan trình duyệt sau deploy. Không cập nhật production, không commit/push.

## Storefront host test — đồng nhất header trang chủ và trang sản phẩm — 04/11/2026

- Thực tế tại 1085px, trang chủ có CSS riêng đặt chiều rộng `.header-main` khác với trang còn lại. Đã bỏ các ghi đè chiều rộng riêng ở trang chủ để mọi page dùng cùng lề và kích thước header.
- Menu link hiển thị trực tiếp ở 1024–1200px (bao gồm viewport 1085px) với khoảng cách/font gọn hơn. Hamburger chỉ dùng ở 761–1023px; mobile giữ breakpoint và bố cục chung.
- Build production local và staging thành công. Đã cập nhật riêng Storefront trên `test.geme.vn`; container healthy, trang chủ `/` và trang Trang sức `/san-pham` đều HTTP 200. Hash source trên VPS trùng với local.
- Backup release tại `/opt/geme-staging/backups/header-responsive-20261104T1542Z/`, gồm source, Compose, `.env` và image cũ. Checksum và script rollback đã xác minh. Rollback: `bash /opt/geme-staging/backups/header-responsive-20261104T1542Z/rollback.sh`.
- Docker Desktop local vẫn không chạy nên chưa recreate container local; source local đã sửa và production build pass. Chưa kiểm tra trực quan trình duyệt ở đúng viewport 1085×698, chưa commit/push hay cập nhật production.

## Storefront host test — đồng nhất header trang chủ với Trang sức trên desktop và mobile — 04/11/2026

- Chẩn đoán lý do lần sửa trước chưa đổi giao diện: cả hai trang dùng chung `SiteHeader`, nhưng CSS di sản của trang chủ còn selector có độ ưu tiên cao đặt `zoom`/chiều rộng cho header và `translateX` cho nội dung. Các reset CSS phía sau có độ ưu tiên thấp hơn nên không thắng cascade.
- Đã sao lưu source local trước sửa tại `outputs/backups/home-header-parity-20261104/` (SHA256 `globals.css`: `05efb3bc6cc481bf0ae15937a5cf532c0a5b7d153a923ef74455bcc6ec12e9a3`; `site-header.tsx`: `5976a7e1118814b51b3ca787e1a9680650f97b7ed4c97a866d156af84c868017`).
- Đã bỏ các override zoom/lệch ngang cũ trên trang chủ; giữ nguyên breakpoint và style chung của SiteHeader. Bản local production build pass khi đặt `GEME_SITE_URL=https://geme.vn`; TypeScript và 45 route hoàn tất.
- Đã sao lưu staging trước deploy tại `/opt/geme-staging/backups/home-header-parity-20261104T160557Z/` (source, Compose, `.env`, checksum); image cũ `geme-staging-storefront:rollback-home-header-parity-20261104T160557Z`; rollback: `bash /opt/geme-staging/backups/home-header-parity-20261104T160557Z/rollback.sh`.
- Đã chép CSS mới và build/recreate riêng Storefront. Build Next.js/TypeScript và 45 route thành công; Admin, API, Aegis, database, Redis, Caddy không bị thay đổi.
- Staging Storefront healthy; `/` và `/san-pham` trả HTTP 200. SHA256 CSS local/host giống nhau: `8e41bfe0a548e12f46ae3bfc51945a47db305a00f6d7f558d4c5d9d55c564735`; log khởi động không có lỗi.
- Không thể mở trình duyệt host để kiểm tra trực quan do chính sách browser chặn quyền truy cập origin. Docker Desktop local đang tắt nên source và production build local đã cập nhật, nhưng container local chưa được recreate. Không cập nhật production, không commit/push.

## Storefront — nút Zalo/Facebook trên trang Liên hệ — local + staging — 04/11/2026

- Trang Liên hệ hiển thị nút Zalo từ số điện thoại Cài đặt; chuẩn hóa số VN dạng `+84` về `0` trước khi tạo `https://zalo.me/<số>`.
- Nút Facebook ưu tiên Messenger link của Facebook Page đang được chọn trong Social/Méta; API công khai chỉ trả URL `m.me`, không xuất access token. Nếu chưa có Page được chọn thì có thể dùng link Facebook trong Banner & Footer làm dự phòng.
- Source local đã cập nhật; API TypeScript và Storefront production build đều thành công. Docker Desktop local không chạy nên container local chưa được recreate.
- Staging `test.geme.vn`: đã backup trước deploy tại `/opt/geme-staging/backups/contact-social-meta-20261104T234500Z/` (source/config trước cập nhật, `.env` mode 600, image API/Storefront cũ). Rollback bằng `bash /opt/geme-staging/backups/contact-social-meta-20261104T234500Z/rollback.sh`.
- Đã build/recreate riêng API và Storefront. API + Storefront healthy; `/lien-he`, `/`, và API readiness đều HTTP 200. Public settings hiện có số điện thoại nhưng staging chưa có Facebook Page Meta được chọn, nên tại thời điểm kiểm tra chỉ hiện link Zalo; nút Facebook sẽ bật khi liên kết/chọn Page hoặc cấu hình link dự phòng.
- Không đổi schema/database hoặc chạy migration. Chưa kiểm tra trực quan bằng trình duyệt; không deploy production, không commit/push.
- Tiếp tục ý tưởng “AI sale ảo có thể huấn luyện” vào [NOTE-AI.md](NOTE-AI.md) để xem xét sau.

## Đồng bộ local và staging bản mới nhất — 05/11/2026

- Đối chiếu 22 file runtime/Compose giữa source local và `/opt/geme-staging`; tất cả giống hệt nhau. Không chép đè source đang làm dở, không sửa dữ liệu hoặc schema. Prisma trước cập nhật báo 70 migration và schema up to date.
- Local Docker: chỉ khởi động/recreate `geme-api`, `admin`, `storefront`; giữ nguyên trạng thái các worker. Cả ba container healthy; Storefront `/` và `/lien-he`, Admin `/login`, API `/api/v1/health/ready` đều HTTP 200.
- Staging: build và recreate riêng `api`, `admin`, `storefront`; API, Admin, Storefront đều healthy. `testadmin.geme.vn/login`, API readiness, `test.geme.vn/` và `/lien-he` đều HTTP 200. Không thay DB/Postgres/Redis/SQL Server, Aegis, Caddy hoặc workers; không chạy migration.
- Backup local trước cập nhật: `outputs/backups/sync-latest-20261105-1324-local/` (snapshot source/Compose, manifest; secrets `.env.docker` không được chép). Image rollback tags: `geme-local-geme-api:rollback-sync-latest-20261105-1324`, `geme-local-admin:rollback-sync-latest-20261105-1324`, `geme-local-storefront:rollback-sync-latest-20261105-1324`.
- Backup staging trước cập nhật: `/opt/geme-staging/backups/sync-latest-20261105-1329/` (source archive, Compose, `.env.before` mode 600, SHA256 và manifest). Rollback bằng `bash /opt/geme-staging/backups/sync-latest-20261105-1329/rollback.sh`; script tag lại image cũ và recreate riêng ba dịch vụ đã triển khai.
- Build staging thành công; Docker phát cảnh báo môi trường không có buildx (đã dùng builder mặc định) và cảnh báo hiện hữu về `AEGIS_AUTH_API_URL` truyền qua Docker ARG/ENV. Hai cảnh báo không làm build thất bại; nên chuyển cấu hình nhạy cảm khỏi ARG/ENV trong đợt hardening riêng.
- Chưa kiểm tra trực quan bằng đăng nhập admin hoặc giao dịch thực; đây là đồng bộ source/runtime và smoke HTTP trên staging test, không phải production. Không commit/push.
