# Môi trường Windows

Kiểm tra từ PowerShell tại thư mục dự án:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-environment.ps1
```

Ở thời điểm kiểm tra workspace ban đầu: PowerShell 5.1; Node đang chọn `v16.16.0`; nvm-windows có thêm `22.15.0`; Docker CLI và Docker Engine `28.0.4`; Compose `v2.34.0-desktop.1`; WSL2 với distribution `docker-desktop`; Git `2.50.1.windows.1`. Những kết quả này là trạng thái máy lúc kiểm tra, không phải điều kiện cố định của ứng dụng.

## Cài hoặc chọn công cụ

- Node: dùng [Node.js chính thức](https://nodejs.org/en/download) hoặc [nvm-windows](https://github.com/coreybutler/nvm-windows). Không dùng Node16 cho ứng dụng. Nếu đã có Node22, `nvm use 22.15.0` có thể cần PowerShell quyền Administrator để đổi symlink. Có thể gọi trực tiếp `node.exe` tại thư mục nvm thay vì đổi Node toàn máy.
- pnpm: dùng `corepack enable` và `corepack prepare pnpm@10.11.0 --activate`, hoặc cài pnpm theo [tài liệu pnpm](https://pnpm.io/installation).
- Docker: cài [Docker Desktop Windows](https://docs.docker.com/desktop/setup/install/windows-install/), bật WSL2/Linux containers. Mở Docker Desktop và đợi engine sẵn sàng trước khi chạy Compose.
- WSL: kiểm tra `wsl --status`, `wsl --list --verbose`. Việc bật Windows feature hoặc cài distribution cần quyền hệ thống; làm theo [Microsoft WSL](https://learn.microsoft.com/windows/wsl/install).

Không tự đổi Node mặc định toàn máy hoặc bật Windows feature chỉ để chạy dự án nếu chưa hiểu ảnh hưởng tới các dự án khác.

## Lỗi thường gặp

- `EPERM lstat C:\Users\...` khi chạy npm trong sandbox: chạy lệnh được phê duyệt ngoài sandbox; đây là hạn chế quyền truy cập, không tự đổi ACL toàn bộ thư mục người dùng.
- `pnpm.ps1 cannot be loaded`: gọi `pnpm.cmd` hoặc dùng PowerShell execution policy phù hợp ở phạm vi process; không vô hiệu chính sách toàn hệ thống.
- Docker không kết nối: kiểm tra Docker Desktop và `docker info`. Không xóa volume để xử lý lỗi kết nối.
- Cổng bận: kiểm tra `Get-NetTCPConnection -LocalPort 3000,5173,55432,16379,1025,8025`; đổi cổng cấu hình tương ứng, không kill process của dự án khác.
- Dashboard báo 500 khi login nhưng API cổng 3000 không lắng nghe: kiểm tra Redis từ Windows, không chỉ nhìn container healthy. `netsh interface ipv4 show excludedportrange protocol=tcp` liệt kê dải cổng Windows dành riêng. Bản sửa dùng Redis cổng 16379 vì 56379 từng nằm trong dải bị dành riêng. Nếu đổi cổng, đồng bộ `REDIS_PORT` và cổng trong `REDIS_URL`, rồi chạy `docker compose up -d --no-deps --force-recreate --wait redis`; giữ nguyên volume dữ liệu.
- Prisma generate lỗi engine: kiểm tra Node hỗ trợ, proxy/antivirus/network, chạy lại `pnpm db:generate`; không dùng `db push` thay migration cho dữ liệu thật.
- Thiếu DB test khi volume có từ trước: tạo riêng `aisales_test` bằng client PostgreSQL, không chạy migration reset.
- `.env` đã tồn tại: `setup:env` sẽ giữ nguyên; đối chiếu `.env.example` rồi bổ sung biến thiếu thủ công.
- `node: ../../.env: not found`: đã sửa các lệnh Prisma/seed/backend bằng `scripts/run-api.mjs`. Runner đọc `.env` theo vị trí workspace, không truyền đường dẫn tương đối qua cờ Node `--env-file` khi gọi pnpm. Không cần chép `.env` vào `apps/api`; chạy lại script khởi động sau khi có bản sửa. `pnpm test:launcher` kiểm tra đường dẫn và thư mục chứa khoảng trắng.

## Chạy sau khi khởi động máy

```powershell
pnpm infra:up
pnpm dev
```

Không cần seed lại mỗi lần. Sau khi có migration mới, sao lưu trước khi chạy `pnpm db:migrate`. Trong môi trường live, cần HTTPS, backup PostgreSQL, quản lý khóa mã hóa và giám sát queue/log riêng.
