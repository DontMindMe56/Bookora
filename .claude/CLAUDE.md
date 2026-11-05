# Bookstore

Luận văn nhà sách trực tuyến. Backend Node 20+ / Express 4 / MySQL 8 (ESM, không TypeScript). Schema ở `db/`, code server ở `BE/`, giao diện ở `FE/`. Tiến độ nghiệp vụ xem `TODO.md`.

## Lệnh (chạy trong `BE/`)
- `npm run dev` · `npm test` (cần MySQL đã nạp `db/0*.sql`) · `npm run create-admin`
- `npm run check` (eslint + prettier) · `npm run lint:fix` · `npm run format`
- `npm run snapshot > /tmp/api.json`: xuất OpenAPI từ route thật; dùng so sánh trước/sau khi refactor

## Cấu trúc
- `src/modules/<tên>/`: `*.routes.js` (zod + gọi service) và `*.service.js` (SQL + nghiệp vụ). Route không chứa SQL, service không đụng `req/res`.
- `src/utils/`: `schemas.js` (zod dùng chung), `pagination.js`, `format.js`, `errors.js`, `http.js`, `security.js`, `text.js`. Cần gì thì import từ đây, không khai báo lại.
- `src/middleware/`: auth, validate, sanitize, rateLimit, error. `src/services/`: audit, mailer, notify, params, ghn.

## Quy ước
- Tiếng Việt cho thông báo lỗi và comment nghiệp vụ; tên biến/hàm tiếng Anh.
- Lỗi: ném `AppError` qua helper trong `utils/errors.js`; không tự `res.status(...)` trong service.
- Route: `validate(schema, 'body'|'query'|'params')` rồi `json((req) => service(...), status?)` (hoặc `asyncHandler` khi cần tự xử lý `res`); dữ liệu đã kiểm tra nằm ở `req.valid.*`.
- Phân quyền: `requireRole(...)`, `requireCustomer`. Route admin cần đứng đúng thứ tự mount trong `app.js`.
- Tiền là số nguyên đồng. Thời gian lưu UTC.
- Ghi thay đổi quan trọng bằng `audit()`; thao tác nhiều bảng dùng `withTx`.
- File service quá ~300 dòng thì tách theo trách nhiệm (query / notify / ...), không giữ một file lớn.
- Phân trang dùng `paged()` và `limitOffset()`.
- Dùng thư viện có sẵn (zod, xss, express-rate-limit...) thay vì tự viết.
- Code ngắn gọn, không thêm comment trừ khi ghi quy tắc nghiệp vụ.

## Trước khi xong việc
1. `npm run check`, rồi `npm test` nếu có MySQL.
2. Nếu đổi route/schema: `npm run snapshot` và đối chiếu, chỉ chấp nhận khác biệt có chủ đích.
