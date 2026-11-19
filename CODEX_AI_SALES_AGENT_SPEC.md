# AI Sales Agent — Đặc tả triển khai cho Codex

Bạn là senior full-stack engineer. Hãy triển khai một ứng dụng hoàn chỉnh, có thể chạy thử trên máy Windows 16 GB RAM, với Docker Desktop và VS Code đã cài. Làm việc trực tiếp trong workspace hiện tại. Không chỉ viết kế hoạch: hãy tạo mã nguồn, migration, test, tài liệu và chạy kiểm thử. Trước khi chạy lệnh phá huỷ dữ liệu hoặc cần thông tin đăng nhập, hãy yêu cầu xác nhận. Không tự tuyên bố tích hợp thành công khi chưa kiểm thử thực tế.

## Mục tiêu
Hệ thống đa fanpage, triển khai thử cho MaiSon trước; mở rộng cho Phúc Khang, Gemmi.Gốm và nhiều khách hàng. AI tư vấn sản phẩm gốm Bát Tràng qua Messenger, báo giá và thương lượng có giới hạn, chuyển nhân viên xác nhận khi khách đồng ý mua. Không tự tạo đơn hàng hay đặt vận chuyển.

## Công nghệ
Monorepo pnpm: `apps/api` NestJS + TypeScript + Prisma, `apps/web` React + TypeScript + Ant Design, `packages/shared` schema/types. PostgreSQL, Redis + BullMQ. Docker Compose cho database và Redis; backend/frontend chạy local để hot reload. OpenAI API cho hội thoại. Google Sheets API để đọc danh mục. Meta Messenger Platform Webhooks + Send API. Telegram Bot API để thông báo. Kiểm tra Node.js LTS, pnpm, Docker và WSL trước khi thực hiện; hướng dẫn cài thiếu phần mềm. Tất cả khóa bí mật trong `.env` (gitignored), cung cấp `.env.example`.

## Multi-tenant và phân quyền
- Super Admin: quản lý tất cả fanpage, gán/thu hồi quyền, cấu hình kết nối và AI, bật/tắt AI toàn fanpage.
- Người dùng tự đăng ký và xác thực email, mặc định không có quyền truy cập fanpage nào.
- Chỉ Super Admin được cấp/thu hồi quyền theo fanpage. Page Manager chỉ xem/trả lời hội thoại của fanpage được gán, tiếp quản và bật lại AI từng hội thoại; không sửa giá hay cấu hình AI.
- Mọi API, truy vấn DB, WebSocket và liên kết dashboard phải kiểm tra quyền ở server theo pageId. Có audit log cấp quyền, tiếp quản, thay đổi trạng thái.

## Dữ liệu sản phẩm
- Google Sheets là nguồn dữ liệu chuẩn; dashboard chỉ đọc, không sửa giá.
- Hỗ trợ cấu hình spreadsheetId, sheet/tab và mapping cột riêng theo fanpage. Đồng bộ định kỳ và thủ công, ghi thời điểm đồng bộ và lỗi; dùng bản cache DB khi Sheets tạm lỗi nhưng hiển thị độ mới dữ liệu.
- Mỗi sản phẩm cần SKU, tên, nhóm/phân khúc (phổ thông, trung cấp, cao cấp), mô tả, kích thước, link ảnh, tồn kho/trạng thái, giá gốc, giá min, giá max, trạng thái bán. Dữ liệu hiện tại là demo, KHÔNG mặc định rằng các cột Giá 1/2/3 là giá bán lẻ.
- Hỗ trợ quy tắc mặc định: giá chào ban đầu = giá gốc × 1,7; sàn thương lượng = giá gốc × 1,5. Khi bảng chính thức có min/max thì giá chào = giá max, giá sàn hiệu lực = max(giá min, giá gốc × 1,5) nếu giá gốc có mặt. Nếu thiếu dữ liệu để xác định sàn an toàn, KHÔNG tự báo giá/thương lượng, chuyển nhân viên. Nếu min > max hoặc sàn > max, đánh dấu dữ liệu lỗi và chuyển nhân viên.
- Backend pricing engine thuần xác định giá; LLM tuyệt đối không tự tính hoặc quyết định vượt giới hạn. Có unit tests cho biên giá và làm tròn VND.
- Chiến lược giảm theo phân khúc phải cấu hình được bởi Super Admin, giảm từng nấc sau khi khách mặc cả, không tự giảm nếu khách chưa yêu cầu; không bao giờ thấp hơn sàn. Ghi lại mọi báo giá.

## Messenger và AI
- Meta webhook GET verification và POST event, xác minh chữ ký, chống xử lý trùng event, hàng đợi xử lý, retry có kiểm soát, tránh trả lời tin do chính page gửi.
- Lưu khách, hội thoại, tin nhắn, trạng thái AI, sản phẩm quan tâm, giá đã báo, lý do chuyển nhân viên.
- Luồng: tin nhắn đến → kiểm tra page/AI switch/quyền gửi tin → truy xuất dữ liệu sản phẩm → công cụ báo giá backend → LLM tạo nội dung tiếng Việt thân thiện → Send API.
- Tôn trọng giới hạn cửa sổ nhắn tin và chính sách Meta; không dùng cookie hoặc tự động hoá giao diện Facebook. Kiểm tra phiên bản API/quyền Meta hiện hành trước khi tích hợp.
- Khi nhân viên trả lời/tiếp quản: đặt conversation.aiEnabled=false ngay, hủy hoặc chặn phản hồi AI đang chờ bằng kiểm tra trạng thái ngay trước Send API. Chỉ bật lại khi nhân viên chủ động.
- Khi AI thiếu dữ liệu, khách muốn gặp người thật, khách đòi giá dưới sàn, hoặc khách đồng ý mua: đánh dấu `NEEDS_HUMAN`, tắt AI, ghi lý do, gửi thông báo. Với khách đồng ý mua, chỉ thu thập thông tin cần thiết và thông báo đang chờ shop xác nhận; không tự tạo đơn hoặc giao vận.

## Dashboard
- Login/register/verify email; Super Admin user management, page management, mapping Google Sheets, kết nối Messenger, Telegram chat ID, cấu hình AI, audit logs.
- Page Manager: inbox realtime, bộ lọc (đang AI xử lý/cần nhân viên/đã tiếp quản/chờ xác nhận), xem lịch sử, trả lời thủ công, bật/tắt AI hội thoại; danh mục sản phẩm chỉ đọc nếu cần.
- Công tắc AI toàn fanpage do Super Admin quản lý; khi tắt thì không cuộc hội thoại nào được AI phản hồi.
- Giao diện tiếng Việt, responsive, trạng thái loading/error/empty rõ ràng.

## Telegram
Mỗi fanpage cấu hình một Telegram group/chat ID riêng. Khi chuyển nhân viên, gửi tên fanpage, lý do, sản phẩm, giá gần nhất và deep link tới hội thoại trên dashboard. Không gửi dữ liệu cá nhân nhạy cảm vào nhóm. Nếu Telegram lỗi, hội thoại vẫn nằm trong hàng chờ dashboard và có retry/log.

## Bảo mật và chất lượng
- Auth bằng session/cookie HttpOnly hoặc JWT với refresh token an toàn; password hashing, rate limiting, validation, RBAC server-side, CORS, CSRF theo cơ chế auth, encryption-at-rest cho token tích hợp nếu phù hợp.
- Không log access token, mật khẩu hoặc dữ liệu nhạy cảm. Không commit `.env`.
- Prisma migrations, seed dữ liệu demo (ít nhất 3 sản phẩm/2 fanpage), OpenAPI docs, health endpoint, structured logging, unit/integration tests, lint, typecheck, README hướng dẫn Windows.
- Dùng mock adapters cho Meta, Google Sheets, OpenAI, Telegram để chạy end-to-end local không cần tài khoản thật. Không giả định có quyền API thật.

## Thứ tự thực thi
1. Kiểm tra môi trường, tạo monorepo, cấu hình Docker Compose và `.env.example`.
2. Thiết kế Prisma schema + migration + seed + auth/RBAC.
3. Xây dashboard và API đồng thời theo hợp đồng types/OpenAPI.
4. Google Sheets sync + pricing engine và tests.
5. Messenger webhook + AI orchestration + human handoff.
6. Telegram notifications + audit logs.
7. Chạy toàn bộ lint/typecheck/tests/build, khởi động local, thử kịch bản end-to-end bằng mock.
8. Viết checklist các thao tác thủ công để kết nối dịch vụ thật (Meta App, App Review, Google service account/OAuth, OpenAI key, Telegram bot/group) và hướng dẫn chạy trên Windows.

Sau mỗi giai đoạn, báo file đã tạo, lệnh đã chạy, test pass/fail và blocker thực tế. Nếu thiếu credentials, hoàn thiện luồng mock rồi hỏi người dùng cung cấp cấu hình qua `.env` trên máy, không yêu cầu dán bí mật vào chat. Bắt đầu ngay từ bước kiểm tra môi trường và tạo dự án.
