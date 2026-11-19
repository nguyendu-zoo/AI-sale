# Checklist kết nối thật

Hoàn thiện ứng dụng và mock tests trước. Nhập khóa thật trong `.env` hoặc dashboard trên máy; không dán vào chat, issue, log hay source. Không có API key thật được cung cấp sẵn trong repository.

## Meta Messenger

1. Tạo/chọn Meta App phù hợp, thêm Messenger, gắn đúng Facebook Page và kiểm tra quyền quản trị Page.
2. Kiểm tra [Messenger Platform](https://developers.facebook.com/docs/messenger-platform/) và [Meta Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog/) để chọn phiên bản còn được hỗ trợ; ghi rõ `META_GRAPH_VERSION=vXX.X` theo App dashboard. Không dùng một phiên bản lấy từ ví dụ cũ mà chưa xác minh.
3. Cấu hình `META_APP_SECRET`, `META_VERIFY_TOKEN` thật trong `.env`; nhập Page Access Token riêng cho từng Fanpage qua Super Admin. `setup:env` chỉ tạo khóa ký webhook local để kiểm thử, không phải Meta credential thật.
4. Tạo URL HTTPS công khai trỏ về endpoint webhook của backend, cấu hình verification token trùng `.env`, đăng ký trường message/echo cần thiết. Reverse proxy phải giữ nguyên raw request body để xác minh `X-Hub-Signature-256`.
5. Đối chiếu quyền hiện hành (thường liên quan `pages_messaging`, `pages_manage_metadata`, `pages_show_list`) trong App dashboard và hoàn tất App Review/Business Verification/Advanced Access nếu Meta yêu cầu cho trường hợp của bạn. Danh sách quyền thực tế phụ thuộc App và loại truy cập, không tự khẳng định đã được cấp.
6. Trong chế độ development chỉ thử với tài khoản/Page được Meta cho phép. Gửi tin thật từ tài khoản thử, kiểm tra event, webhook signature, dedup, send result và trạng thái hội thoại.
7. Kiểm tra cửa sổ nhắn tin 24 giờ theo [Send API](https://developers.facebook.com/docs/messenger-platform/send-messages/). Không dùng HUMAN_AGENT tag để kéo dài phản hồi AI. Không dùng cookie hoặc scraping/UI automation.

## Google Sheets

1. Bật Google Sheets API trong Google Cloud project. Dùng service account riêng hoặc OAuth được quản lý; [tài liệu Sheets API](https://developers.google.com/workspace/sheets/api/quickstart/nodejs) mô tả quyền và credential.
2. Với service account, share đúng spreadsheet cho email service account, quyền chỉ đọc nếu đủ. Không cấp quyền Drive toàn bộ khi không cần.
3. Nhập service-account JSON qua cấu hình Fanpage; token được mã hóa ở DB. Không lưu JSON credential vào source.
4. Cấu hình spreadsheet ID, tên tab, mapping chính xác SKU/tên/phân khúc/gốc/min/max/tồn kho. Mapping giá phải được shop xác nhận; không suy luận “Giá 1/2/3”.
5. Sync thử, đối chiếu số sản phẩm và vài hàng giá với sheet thật; kiểm tra thiếu cột, min > max, sàn > max, và sheet tạm lỗi dùng cache.

## OpenAI

1. Tạo API key thuộc project riêng; nhập `OPENAI_API_KEY` và model được phép trong `OPENAI_MODEL` ở `.env`. Cấu hình ngân sách/rate limit tại project.
2. Tham khảo [OpenAI API](https://platform.openai.com/docs/overview). Kiểm tra model có quyền sử dụng thật; không coi tên model trong `.env.example` là bằng chứng quyền truy cập.
3. Bật live, kiểm tra câu tư vấn tiếng Việt, lời đề nghị giá dưới sàn, yêu cầu gặp người thật, khách đồng ý mua, prompt injection và dữ liệu sản phẩm thiếu.
4. Pricing engine backend quyết định mọi con số. Không cung cấp cho model quyền tạo đơn hoặc tự thay đổi sàn/giá.

## Telegram

1. Tạo bot bằng BotFather trong Telegram, lấy bot token thật và thêm bot vào group cần nhận thông báo.
2. Xác định chat/group ID chính xác; mỗi Fanpage dùng cấu hình riêng. Nhập bot token và chat ID qua Super Admin. [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage).
3. Gây một handoff thử và kiểm tra group nhận tên Fanpage/lý do/sản phẩm/giá/deep link; không gửi tên khách, điện thoại, địa chỉ hoặc nội dung nhạy cảm vào group.
4. Chặn network để xác minh retry/log và hội thoại vẫn xuất hiện ở dashboard dù Telegram lỗi.

## Email và public deployment

Mailpit tại cổng8025 chỉ phục vụ local. Với live, dùng SMTP được xác thực qua TLS, tên miền gửi phù hợp và cấu hình `SMTP_HOST/PORT/SECURE/USER/PASSWORD/MAIL_FROM`. Đặt `WEB_URL`, `WEB_ORIGIN` và `APP_URL` thành URL HTTPS thật; bật cookie secure theo `NODE_ENV=production`. Giới hạn CORS đúng origin.

Các dịch vụ chỉ được coi là kết nối thành công sau khi có kết quả kiểm thử thực tế bằng tài khoản/quyền được chủ sở hữu cấp. Build, unit test hoặc mock test pass không thay thế xác minh này.
