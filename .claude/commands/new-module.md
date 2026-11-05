---
description: Tạo module backend mới theo quy ước (routes + service + mount + test)
argument-hint: <tên-module> <mô tả ngắn>
---
Tạo module `$ARGUMENTS` trong `BE/src/modules/`:
1. `<tên>.service.js` (SQL + nghiệp vụ, dùng `query`/`withTx`, `AppError`, `audit` nếu cần) và `<tên>.routes.js` (zod từ `utils/schemas.js`, `validate`, `asyncHandler`, `requireRole`/`requireCustomer`).
2. Mount router trong `src/app.js` đúng thứ tự.
3. Thêm `test/<tên>.test.js` theo mẫu `test/helpers.js`.
4. Thêm dòng vào mục Cấu trúc của `BE/README.md` và đánh dấu `TODO.md`.
Giữ code ngắn gọn, không comment thừa.
