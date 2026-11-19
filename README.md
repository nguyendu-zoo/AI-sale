# AI Sales Agent đa Fanpage

Monorepo chạy local trên Windows: NestJS + PostgreSQL/Prisma + Redis/BullMQ; dashboard React, TypeScript và Ant Design. Dữ liệu demo dành cho MaiSon và Phúc Khang. Hệ thống chỉ tư vấn/chuyển nhân viên xác nhận; không tạo đơn hàng hay giao vận.

## Chạy trên Windows

Yêu cầu Node.js 22.12+ trên nhánh 22 hoặc Node 24 LTS, pnpm 10, Docker Desktop ở chế độ Linux containers/WSL2. Máy 16 GB RAM đủ cho cấu hình Compose hiện tại. Cổng mặc định: frontend `5173`, API `3000`, PostgreSQL `55432`, Redis `16379`, SMTP `1025`, Mailpit `8025`.

Nếu Node mặc định đang là 16 nhưng máy đã có Node phù hợp trong nvm-windows, có thể dùng script sau. Script chọn Node cho tiến trình hiện tại, giữ nguyên phiên bản Node mặc định của máy và không ghi đè `.env`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-local.ps1 -CheckOnly
powershell -ExecutionPolicy Bypass -File scripts/run-local.ps1
```

Lần đầu script tải dependency, tạo `.env` nếu chưa có, khởi động Docker, áp dụng migration, nạp demo rồi chạy backend/frontend. Tài khoản quản trị chỉ được tạo khi bạn đã điền hai biến `SEED_ADMIN_*` trong `.env`. Các lệnh riêng cho từng bước:

```powershell
node --version
docker info
wsl --status
# Nếu đang dùng nvm-windows và đã có Node22:
nvm list
nvm use 22.15.0
# pnpm được khóa phiên bản bởi packageManager trong package.json
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm --version
pnpm install --frozen-lockfile
pnpm setup:env
```

Mở `.env` trên máy và điền `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` cho tài khoản Super Admin đầu tiên. Mật khẩu ít nhất 12 ký tự và tối đa 72 byte UTF-8. Không gửi mật khẩu hoặc API key vào chat. Script `setup:env` không ghi đè `.env` đã có, tạo mật khẩu DB và khóa AES ngẫu nhiên, mặc định dùng **mock**, không kết nối tài khoản bên ngoài.

```powershell
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Mở dashboard tại [localhost:5173](http://localhost:5173), tài liệu OpenAPI tại [localhost:3000/api/docs](http://localhost:3000/api/docs), health tại [localhost:3000/api/health](http://localhost:3000/api/health), hộp thư xác thực local tại [localhost:8025](http://localhost:8025).

Đăng nhập bằng tài khoản đã cấu hình trong `.env`. Người dùng tự đăng ký sẽ phải xác thực email và mặc định chưa có quyền trên Fanpage nào. Super Admin vào quản lý nhân viên để cấp từng Fanpage. Seed không ghi đè mật khẩu/quyền của tài khoản đã tồn tại và không sửa sản phẩm hiện có.

Nếu thiếu Node/WSL/Docker, xem [hướng dẫn môi trường Windows](docs/WINDOWS.md). Không dùng `docker compose down -v`, `prisma migrate reset` hoặc xóa dữ liệu nếu chưa có bản sao lưu và phê duyệt.

## Cấu trúc và vận hành

```text
apps/api       NestJS, Prisma schema/migrations/seed, auth/RBAC, tích hợp, pricing, queues
apps/web       React + Ant Design, inbox realtime, quản lý Fanpage/nhân viên/cấu hình
packages/shared  Types/schema dùng chung
scripts        Khởi tạo .env, kiểm tra môi trường, DB test
docs           Hướng dẫn Windows và checklist kết nối thật
```

`pnpm infra:stop` dừng container và giữ dữ liệu. PostgreSQL/Redis chỉ bind loopback. Volume PostgreSQL/Redis giữ dữ liệu qua lần khởi động. File khởi tạo DB test chỉ chạy ở volume mới; nếu volume đã tồn tại và thiếu DB test, tạo DB `aisales_test` riêng, không reset volume chính.

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:launcher
pnpm test:integration
pnpm build
```

Để kiểm tra giao diện với Edge có sẵn trên Windows, giữ ứng dụng chạy ở terminal khác rồi chạy `pnpm test:browser`. Script kiểm tra chế độ mock và loopback, tạo/xóa dữ liệu kiểm thử riêng; không dùng tài khoản thật. Có thể chọn executable bằng biến `EDGE_EXECUTABLE`. Ảnh kiểm tra được lưu vào `.tools/browser` và không đưa vào source.

Integration tests dùng `TEST_DATABASE_URL` và không được trỏ vào DB dùng thật. Kết quả kiểm thử thực tế được báo riêng trong phiên triển khai; có lệnh kiểm thử không đồng nghĩa lệnh đã pass. Build backend và frontend chạy local, không tự đăng lên hosting.

Kết quả triển khai, lỗi đã sửa và phần cần cấu hình thêm được ghi trong [báo cáo kiểm thử](docs/IMPLEMENTATION_STATUS.md).

Suite tích hợp tự kiểm tra tên database phải là `aisales_test`, dùng Redis DB1, áp dụng migration rồi chỉ tạo/xóa fixture có ID riêng của lần chạy. Dịch vụ Meta/Google/OpenAI/Telegram vẫn dùng mock; SMTP được kiểm tra qua Mailpit thật. PostgreSQL/Redis/Mailpit phải đang chạy trước `pnpm test:integration`.

## Luồng sử dụng

1. Super Admin cấu hình mỗi Fanpage: Messenger Page ID/token, Google Sheets tab và mapping rõ từng cột, Telegram group/chat ID, chiến lược giảm giá theo phân khúc.
2. Đồng bộ danh mục từ Sheets. Dashboard chỉ đọc giá; khi sync lỗi vẫn dùng cache DB và hiển thị thời điểm/lỗi đồng bộ.
3. Messenger webhook xác minh chữ ký trước khi đưa event vào BullMQ. Event trùng không xử lý lại; event echo của Page bị bỏ qua.
4. Pricing engine quyết định số tiền bằng VND. LLM chỉ viết lời tư vấn, không quyết định giá. Không tự giảm trước khi khách mặc cả.
5. Yêu cầu người thật, thiếu dữ liệu an toàn, đề nghị dưới sàn hoặc đồng ý mua đều chuyển nhân viên, tắt AI và tạo thông báo. Nhân viên tiếp quản/trả lời cũng tắt AI; chỉ bật lại khi nhân viên chủ động.
6. Mọi thao tác và subscription realtime kiểm tra quyền Fanpage ở backend. Nhân viên không sửa cấu hình AI/giá và không tự cấp quyền.

Giá mặc định: chào = giá gốc × 1,7; sàn = giá gốc × 1,5. Khi có giá min/max chính thức: chào = max, sàn = max(min, gốc × 1,5) nếu có gốc. Thiếu sàn an toàn hoặc sàn > giá chào thì chuyển người thật. Tuyệt đối không coi các cột “Giá 1/2/3” là giá bán nếu chưa có mapping được xác nhận.

## Mock và kết nối thật

`INTEGRATIONS_MODE=mock` dùng adapter mock cho Messenger, Google Sheets, OpenAI và Telegram. Mọi trạng thái mock là mô phỏng local; không chứng minh Page, Google account, OpenAI key hay Telegram bot đã được kết nối. Không dùng dữ liệu demo để báo giá thật.

Queue dùng giới hạn xử lý toàn cục một job để giữ thứ tự tin nhắn giữa các API process trong bản local này. Inbound và Telegram retry tối đa bốn lần; event được lưu PostgreSQL trước khi enqueue và recovery định kỳ xử lý event đang chờ. Messenger outbound ghi dấu lần gửi trước khi gọi API và không tự gửi lại khi kết quả không chắc chắn, nhằm tránh nhắn trùng; nhân viên kiểm tra trạng thái lỗi trên dashboard. Thiết kế này ưu tiên đúng thứ tự/an toàn, cần phân vùng queue theo hội thoại khi tăng lưu lượng.

Xem [checklist kết nối dịch vụ thật](docs/INTEGRATIONS.md). Chỉ bật `INTEGRATIONS_MODE=live` sau khi nhập thông tin thật trên máy, cấu hình HTTPS public cho webhook và xác minh quyền/phê duyệt của từng nhà cung cấp. Token theo Page được mã hóa AES bằng `ENCRYPTION_KEY`; mất khóa sẽ không giải mã được token cũ.

Phiên bản Graph API phải được chọn rõ qua `META_GRAPH_VERSION`; kiểm tra trang Meta App trước mỗi triển khai thật. Tôn trọng cửa sổ nhắn tin 24 giờ; hệ thống không dùng cookie Facebook hoặc tự động hóa giao diện.
