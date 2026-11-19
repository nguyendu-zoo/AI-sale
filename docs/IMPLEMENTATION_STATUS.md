# Trạng thái triển khai ngày 17/11/2026

## Sửa cập nhật Fanpage ngày 19/11/2026

- Nguyên nhân: ô Facebook Page ID bị đặt chỉ đọc, form không gửi trường này và API cập nhật chưa nhận `externalPageId`; tài khoản Super Admin vẫn có quyền quản trị.
- Super Admin có thể sửa tên và Page ID, lưu ngay tại thẻ thông tin Fanpage. Form giữ nội dung chưa lưu khi dữ liệu được làm mới, hiển thị xác nhận ID cũ/mới và đọc lại kết quả server sau khi lưu.
- Backend kiểm tra định dạng, loại khoảng trắng và trả 409 rõ ràng khi trùng ID. Giữ nguyên phân quyền nhân viên, CSRF và kiểm tra Origin.
- Đổi Page ID sẽ tắt AI, xóa token Messenger cũ trừ khi có token thay thế trong cùng yêu cầu. Không tự xác nhận token đã kết nối thành công. Giữ sản phẩm và phân công nhân viên theo ID nội bộ.
- Fanpage đã có hội thoại hoặc webhook không được gắn sang Page ID khác; tạo Fanpage mới để giữ đúng lịch sử khách hàng. Khóa giao dịch và kiểm tra lại Page ID lúc ghi webhook ngăn tin của Page cũ bị đưa sang Page mới trong lúc cập nhật.
- Sửa tương thích cấu hình `aiInstructions` đã được hỗ trợ trong AI nhưng trước đây bị schema cập nhật từ chối; giới hạn 2.000 ký tự, tiếp tục từ chối trường lạ.
- Kiểm chứng: 73/73 unit tests; 13/13 integration cập nhật Fanpage và 17/17 integration hệ thống trên PostgreSQL/Redis/SMTP local với nhà cung cấp ngoài dùng mock. Edge browser đạt 7/7: chỉnh sửa/lưu, giữ bản nháp, hủy rồi xác nhận đổi ID, tải lại trang, giải thích lỗi lịch sử và từ chối nhân viên sửa cấu hình. Typecheck, lint và build shared/API/web đạt; Vite còn cảnh báo bundle lớn hơn 500 kB. Không chỉnh sửa ID, token hoặc tài khoản vận hành để thử nghiệm; fixture mới đã dọn.
- Chế độ chạy vẫn là `mock`. Chưa xác minh kết nối Messenger, Sheets, OpenAI hoặc Telegram thật; không coi việc lưu Page ID/token là đã sẵn sàng phục vụ khách hàng thật.

Kiểm thử trình duyệt riêng cho phần này: chạy `pnpm test:browser:pages` bằng Node 22.12+ khi API và dashboard local đang hoạt động ở chế độ mock. Script chỉ tạo, sửa và dọn fixture riêng; mật khẩu ngẫu nhiên chỉ nằm trong bộ nhớ.

## Sửa lỗi đăng nhập ngày 19/11/2026

- Dashboard cổng 5173 hoạt động nhưng request `/api/*` trả 500 do backend cổng 3000 chưa khởi động xong.
- Nguyên nhân đã xác minh: Windows dành riêng dải TCP 56362–56461; cổng Redis cũ 56379 nằm trong dải này. Redis trong Docker vẫn báo healthy nhưng kết nối từ Windows bị từ chối. Tạo lại container ở cổng cũ cũng bị Docker báo lỗi bind socket.
- Đổi cổng host Redis sang 16379, giữ volume dữ liệu. Cập nhật Compose, cấu hình mẫu, giá trị mặc định trong API và riêng trường Redis local trong `.env`; giữ nguyên cấu hình/secret còn lại.
- Backend đã khởi động lại. Health qua cả cổng 3000 và proxy 5173 trả 200, PostgreSQL/Redis đều hoạt động.
- Kiểm tra đăng nhập thực tế qua proxy dashboard với tài khoản fixture tạm: login 201, đọc session 200, logout 201; fixture đã xóa. Không thay đổi tài khoản có sẵn.
- Vite proxy trả 503 JSON có hướng dẫn khi backend không kết nối được, giữ nguyên lỗi 401 thật từ backend. Kiểm thử proxy thực tế đã đạt.
- Log backend có tên exception/mã Prisma theo allowlist để chẩn đoán lỗi 5xx; kiểm thử không lộ dữ liệu nhạy cảm đã đạt 11/11.

## Thành phần đã triển khai

| Phần | Kết quả |
| --- | --- |
| Monorepo | pnpm, React/TypeScript/Ant Design, NestJS, package schema/types dùng chung |
| Dữ liệu | PostgreSQL, Prisma schema, migration đã áp dụng, seed 2 Fanpage và 6 sản phẩm demo |
| Tài khoản | Đăng ký, SMTP xác thực email một lần, bcrypt, session cookie HttpOnly, CSRF và kiểm tra Origin |
| Phân quyền | Super Admin cấp/thu hồi từng Fanpage; nhân viên chỉ truy cập Fanpage được gán; kiểm tra API và WebSocket ở server |
| Inbox | Tin nhắn realtime, bộ lọc, trả lời thủ công, tiếp quản, bật lại AI từng hội thoại, công tắc AI toàn Fanpage |
| Catalog | Google Sheets theo mapping riêng, đồng bộ thủ công/định kỳ, cache khi lỗi, thời điểm đồng bộ và lỗi hiển thị |
| Định giá | Giá chào/sàn xác định ở backend, làm tròn VND, giảm từng nấc khi khách thực sự yêu cầu; không giảm dưới sàn |
| Messenger | GET verification, chữ ký raw body HMAC, chống trùng, bỏ echo, kiểm tra timestamp và cửa sổ 24 giờ |
| AI | Mock và adapter OpenAI Responses API; nội dung tư vấn giới hạn trong danh mục, không giao quyền định giá cho model |
| Chuyển nhân viên | Thiếu dữ liệu, giá dưới sàn, yêu cầu người thật và đồng ý mua đều tắt AI, ghi audit và tạo thông báo |
| Telegram | Cấu hình theo Fanpage, retry giới hạn, deep link, không gửi tên/điện thoại/địa chỉ/nội dung khách vào nhóm |
| Vận hành | Docker Compose PostgreSQL/Redis/Mailpit, `.env.example`, health, OpenAPI, log có cấu trúc, script Windows |

Hệ thống không tạo đơn hàng hoặc giao vận. Token tích hợp lưu ở PostgreSQL được mã hóa AES-256-GCM; API không trả ciphertext hoặc secret đã nhập. `.env` được giữ ngoài source và không bị ghi đè trong phiên tiếp tục này.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Docker PostgreSQL, Redis, Mailpit | Cả 3 healthy |
| Prisma migration | Đã áp dụng; `migrate status` xác nhận schema hiện hành |
| `pnpm typecheck` | Đạt cả shared, API và web |
| `pnpm lint` | Đạt |
| `pnpm test` | 60/60 unit tests, 7 suites |
| Integration suite | 17/17 kịch bản trên PostgreSQL + Redis + SMTP thật, dịch vụ ngoài dùng mock |
| Edge headless browser | 8/8 kiểm tra desktop/mobile; đăng ký/xác thực email, RBAC, realtime, báo giá, tiếp quản/trả lời, cấu hình và các màn hình quản trị |
| `pnpm build` | Shared + API + web đạt; Vite cảnh báo bundle lớn hơn 500 kB |
| Dependency audit runtime | 0 advisory ở mọi mức độ tại thời điểm kiểm tra |
| Kiểm tra HTTP khi chạy API | Health báo database/redis hoạt động và `mode=mock`; OpenAPI có 22 path, có schema cho request |
| Windows launcher | `scripts/run-local.ps1 -CheckOnly` đạt với Node 22.15.0, pnpm 10.11.0, Docker Engine 28.0.4 |
| Sửa lỗi launcher `.env` | Chạy lại nguyên `scripts/run-local.ps1` đạt từ install, Docker, generate, migrate, seed đến khởi động API và web; cả health và frontend trả HTTP 200 |
| Regression đường dẫn launcher | `pnpm test:launcher`: 6/6 đạt, gồm thư mục chạy khác nhau, đường dẫn có khoảng trắng, giữ biến môi trường và chuyển tiếp exit code |

Integration suite kiểm tra đăng ký/xác thực email/token dùng một lần, cookie/CSRF/Origin, phân quyền chéo tenant và IDOR, token mã hóa, webhook chữ ký/trùng/echo, giá và sàn, tin đến trễ, chốt mua chuyển nhân viên, tắt AI toàn Page, nhân viên tiếp quản khi AI đang chờ, cửa sổ 24 giờ, retry Telegram/giới hạn dữ liệu cá nhân, cache Sheets, tham gia/thu hồi quyền WebSocket và đăng xuất.

Browser smoke dùng Edge có sẵn, backend/frontend đang chạy local và chế độ mock. Script tạo tài khoản/dữ liệu kiểm thử riêng, mật khẩu chỉ tồn tại trong bộ nhớ và xóa fixture sau kiểm thử. Ảnh đã được kiểm tra tại `.tools/browser/login-desktop.png`, `manager-mobile.png`, `inbox-desktop.png`, `inbox-mobile.png`; thư mục này được gitignore. Chạy lại bằng `pnpm test:browser` sau khi khởi động ứng dụng. Script dừng nếu API không ở chế độ mock hoặc URL/DB không phải local.

## Lỗi đã phát hiện và sửa

- SMTP `localhost` timeout DNS trong Jest/sandbox Windows: local dùng loopback IPv4, có timeout 10 giây; production giữ tên host và xác thực TLS.
- Script pnpm lồng nhau không tìm thấy pnpm khi chỉ gọi Corepack trực tiếp: launcher tạo shim riêng trong `.tools/bin`, không đổi Node mặc định toàn máy.
- Các lỗi strict TypeScript, lint và dependency runtime có advisory đã được xử lý.
- Tin webhook thiếu timestamp hoặc đến trễ không được tự mở cửa sổ gửi tin hay kích hoạt giảm giá cũ.
- Nhận diện thương lượng được kiểm tra lại ở backend; câu “không cần giảm” không làm giảm giá. Giá dạng `300.000đ` được đọc đúng.
- Outbound có trạng thái không chắc chắn không được tự gửi lại; dashboard chuyển nhân viên kiểm tra để tránh nhắn trùng.
- Cấu hình của Fanpage seed có cờ demo được giữ hợp lệ khi lưu mapping/chiến lược. Seed từ chối khẳng định tạo Super Admin nếu email đã thuộc tài khoản nhân viên.
- Lỗi `node: ../../.env: not found` khi pnpm gọi Node trên Windows: loại bỏ cờ `--env-file` tương đối trong script, dùng runner nạp `.env` tuyệt đối theo vị trí file; áp dụng cả Prisma, seed, dev/start và browser test. Backend cũng xác định `.env` theo thư mục source/build thay vì thư mục terminal. Không sửa nội dung `.env`.

Build Vite cần chạy ngoài filesystem sandbox của phiên Codex này vì esbuild bị chặn đọc thư mục cha Windows. Build ngoài sandbox đã đạt; đây không phải lỗi TypeScript của ứng dụng.

## Cần cấu hình hoặc xác minh thêm

- Tài khoản Super Admin ban đầu: tự điền `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` trong `.env` rồi chạy seed. Không có tài khoản hoặc mật khẩu quản trị được tự bịa sẵn.
- Meta, Google Sheets, OpenAI và Telegram thật chưa được kiểm thử bằng tài khoản thật. Mock pass không chứng minh đã kết nối các dịch vụ này.
- Cần Meta App/Page permissions và App Review phù hợp, Page token, URL webhook HTTPS, service account được chia sẻ bảng, OpenAI API key/model được cấp quyền, Telegram bot và chat ID. Xem [checklist kết nối](INTEGRATIONS.md).
- Phiên bản Graph API để trống cho đến khi được xác minh trong Meta App. Các trang tài liệu Meta trả HTTP 429 ở lượt tra cứu trong phiên triển khai, nên không tự khẳng định phiên bản/quyền hiện hành đã được xác nhận.
- Bản local lấy tối đa 100 sản phẩm đang bán làm ngữ cảnh AI, inbox lấy tối đa 100 hội thoại mỗi lần, và queue xử lý tuần tự để giữ thứ tự. Khi tăng tải cần bổ sung tìm kiếm/pagination và phân vùng queue theo hội thoại.
- Chưa triển khai production hoặc cung cấp HTTPS public. Docker Compose hiện chạy hạ tầng local; backend/frontend chạy local theo đặc tả.

## Chạy lại

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local.ps1
```

Script giữ `.env`, dùng Node phù hợp từ nvm-windows nếu cần, cài dependency theo lockfile, khởi động Docker, chạy migration/seed rồi mở hai tiến trình phát triển. Mở `http://localhost:5173`; Mailpit ở `http://localhost:8025`; OpenAPI ở `http://localhost:3000/api/docs`.
