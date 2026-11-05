# Bookstore Backend (Node.js + Express + MySQL)

Mọi lệnh trong tài liệu này chạy trong thư mục `BE/`. Tổng quan dự án ở `../README.md`.

## Chạy nhanh

```bash
# 1. DB (thư mục ../db): nạp lần lượt 01_schema đến 08_exception_ghn_cancelled
for f in ../db/0*.sql; do mysql -uroot -p < $f; done

# 2. Backend
cp .env.example .env        # chỉnh DB_*, JWT_SECRET
npm install
npm run create-admin        # tạo quản trị viên đầu tiên (ADMIN_EMAIL / ADMIN_PASSWORD trong .env)
npm run seed-demo           # (tùy chọn) 12 đầu sách + admin@demo.vn, kho@demo.vn, khach1..3@demo.vn (mật khẩu Demo12345)
npm run dev                 # http://localhost:3000   (GET /health)
npm run check               # eslint + prettier
npm test                    # cần MySQL đã nạp schema + seed
```

## Giao diện cửa hàng mẫu

Mở `http://localhost:3000/shop/` (cùng điều kiện bật với `/demo`). Một file `FE/shop/index.html`, không cần build: trang chủ và tìm kiếm, chi tiết sách, giỏ hàng, đăng nhập, thanh toán (COD / SePay QR / VNPay). Cần đã chạy `npm run seed-demo`; tài khoản `khach1@demo.vn` / `Demo12345`. Tỉnh/quận/phường cần danh mục GHN đã đồng bộ.

## Trang demo khách hàng

Mở `http://localhost:3000/demo/` (chỉ bật khi không phải production hoặc `DOCS_ENABLED=1`). Là công cụ test, không phải giao diện thật; mọi lời gọi API hiện ở "Nhật ký gọi API" cuối trang. Phủ các luồng:

- Đăng nhập mật khẩu / Google / Facebook; đăng ký, xác thực email, quên + đặt lại mật khẩu, hồ sơ, đổi mật khẩu.
- Tìm sách (danh mục, định dạng, nhà xuất bản, khoảng giá, sắp xếp, phân trang), chi tiết sách, đánh giá (xem, viết, sửa, xóa, báo cáo), yêu thích.
- Giỏ hàng (khách vãng lai + gộp giỏ khi đăng nhập, sửa số lượng), sổ địa chỉ (thêm, sửa, mặc định, xác nhận, xóa).
- Kiểm tra mã giảm giá, báo giá, đặt hàng COD / SePay (QR) / VNPay (tự chuyển sang trang VNPay, quay lại `/demo/`); SĐT nhận hàng và ghi chú đơn; xử lý `QUOTE_CHANGED` / hết hàng (hiện báo giá mới để khách xác nhận lại); nút gửi lại cùng `Idempotency-Key` để thấy `replayed: true`.
- Danh sách đơn, chi tiết đơn (sách, tiền, vận đơn GHN), hủy đơn, tự làm mới trạng thái.

## Trang demo nhân viên / quản trị

Mở `http://localhost:3000/demo/staff.html` (cùng điều kiện bật như trang khách hàng). Đăng nhập `kho@demo.vn` (STAFF) hoặc `admin@demo.vn` (ADMIN) sau `npm run seed-demo`. Phủ các luồng:

- STAFF / ADMIN: tìm đơn (mã, SĐT, tên, mã vận đơn, trạng thái), chi tiết đơn, phiếu đóng gói, quét ISBN đóng gói, tạo / thử lại vận đơn GHN, xác nhận hàng hoàn về kho, hủy đơn kèm lý do; tồn kho (lọc dưới mức tối thiểu / hết hàng, nhật ký biến động, kiểm kê / hư hỏng).
- ADMIN: danh sách hoàn tiền (đánh dấu đã chuyển khoản, hoàn qua VNPay), kiểm duyệt đánh giá (ẩn / hiện), khách hàng (chi tiết, khóa / mở khóa), báo cáo (tổng quan, doanh thu, bán chạy), tham số hệ thống.

Chưa có demo cho phiếu nhập kho, nhà cung cấp, khuyến mãi / mã giảm giá, danh mục / tác giả / NXB, nhân viên và nhật ký thao tác (dùng `/api/docs`).

Cần cấu hình thêm trong `.env`:

| Chức năng      | Biến                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google         | `GOOGLE_CLIENT_ID`; thêm `http://localhost:3000` vào "Authorized JavaScript origins"                                                                                                                                                                                    |
| Facebook       | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`; chạy `npm run migrate:facebook` (hoặc nạp `db/07_facebook_login.sql`) để có cột `Account.facebookId` và cho phép tài khoản chỉ đăng nhập bằng Facebook; loại ngoại lệ `GHN_CANCELLED` cần `db/08_exception_ghn_cancelled.sql` |
| VNPay          | `VNPAY_TMN_CODE`, `VNPAY_SECRET`, `VNPAY_RETURN_URL=http://localhost:3000/demo/`; IPN cần URL công khai (ngrok / cloudflared)                                                                                                                                           |
| Email xác thực | để trống `SMTP_*` thì email in ra console backend (`[mail:dev]`)                                                                                                                                                                                                        |

## Cấu trúc

```
src/
  config.js  db.js  app.js  server.js
  middleware/   auth (JWT + bảng UserSession), validate (zod), sanitize (xss), rateLimit, error
  utils/        errors, http (asyncHandler), schemas (zod dùng chung), pagination, format (vnd/ngày), security, text
  services/     params (SystemParameter), audit (AuditLog), mailer (EmailOutbox + worker retry 1/5/15')
  modules/
    auth/       đăng ký, xác thực email, đăng nhập (khóa 5 lần/15'), quên/đặt lại MK, hồ sơ
    catalog/    tìm kiếm/lọc/chi tiết, quản trị ấn bản (giá, trạng thái, lịch sử)
    cart/       giỏ khách vãng lai (cookie) + thành viên, gộp giỏ khi đăng nhập
    address/    sổ địa chỉ (tối đa 10, mặc định, xác nhận lại khi GHN đổi địa giới)
    wishlist/   danh sách yêu thích
    geo/        danh mục tỉnh/quận/phường GHN (đọc công khai + đồng bộ)
    supplier/   nhà cung cấp (CRUD, ngừng hợp tác, đầu sách đã nhập)
    order/      báo giá checkout (quote.service.js: tiền, phí GHN, COD), tạo/hủy/hết hạn đơn (order.service.js), tra cứu (order.query.js), email đơn (order.notify.js)
    review/     đánh giá sách (review.service.js), bộ lọc nội dung (review.filter.js)
    inventory/  phiếu nhập kho (voucher.service.js), phiếu đặt hàng NCC (purchaseOrder.service.js), chuẩn hóa dòng hàng (lines.js), tồn kho, kiểm kê, giá vốn (costing.js là hàm thuần); inventory.jobs.js: job kho
  jobs/         outbox email, dọn tài khoản chưa xác thực / giỏ / phiên hết hạn, job kho (mỗi giờ)
```

## API (đợt 1)

| Method                | Đường dẫn                                                                                                                     | Ghi chú                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| POST                  | /api/auth/register, /verify-email, /resend-verification, /login, /logout, /forgot-password, /reset-password, /change-password |                                                 |
| GET/PATCH             | /api/auth/me                                                                                                                  | hồ sơ                                           |
| GET                   | /api/books?q&categoryId&publisherId&format&minPrice&maxPrice&sort&page                                                        | sort: price_asc, price_desc, newest, bestseller |
| GET                   | /api/books/:workId, /api/categories                                                                                           |                                                 |
| GET/POST/PATCH/DELETE | /api/cart, /api/cart/items, /api/cart/items/:editionId                                                                        | không cần đăng nhập                             |
| POST/PATCH            | /api/admin/editions, /api/admin/editions/:editionId                                                                           | ADMIN                                           |

Lỗi trả dạng `{ "error": { "code", "message", "details?" } }`.
Xác thực: header `Authorization: Bearer <token>`.

## API (đợt 2: kho) — vai trò STAFF hoặc ADMIN

| Method           | Đường dẫn                                                           | Ghi chú                                                                                                                  |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET/POST         | /api/suppliers                                                      | tìm `q`, lọc `status`                                                                                                    |
| GET/PATCH/DELETE | /api/suppliers/:supplierId                                          | DELETE: đã dùng thì chuyển INACTIVE; GET kèm danh sách đầu sách đã nhập                                                  |
| POST             | /api/import-vouchers/preview                                        | xem trước (Excel/nhập tay): `{supplierId, lines:[{isbn\|editionId, quantity, unitCost}]}` → `valid` + `errors` từng dòng |
| GET/POST         | /api/import-vouchers                                                | tạo phiếu nháp (`purchaseOrderId` tùy chọn)                                                                              |
| GET/PATCH        | /api/import-vouchers/:voucherId                                     | PATCH: chỉ phiếu nháp, thay toàn bộ dòng                                                                                 |
| POST             | /api/import-vouchers/:voucherId/confirm                             | `{lines:[{detailId, receivedQty, isbn?}]}` (bỏ trống = nhận đúng như phiếu)                                              |
| POST             | /api/import-vouchers/:voucherId/cancel                              | chỉ phiếu nháp                                                                                                           |
| POST             | /api/import-vouchers/:voucherId/cost-adjustments                    | **ADMIN**: điều chỉnh giá nhập, tính lại giá vốn                                                                         |
| GET/POST         | /api/purchase-orders, GET /lookup?isbn=, GET /:id, POST /:id/cancel | phiếu đặt hàng NCC (tự động hoặc tạo tay)                                                                                |
| GET              | /api/inventory?q&filter=below_min\|out_of_stock&page                | tồn thực tế / đã giữ / khả dụng / tối thiểu                                                                              |
| GET              | /api/inventory/:editionId, /:editionId/movements                    | nhật ký biến động                                                                                                        |
| PATCH            | /api/inventory/:editionId/settings                                  | ghi đè tồn tối thiểu, số lượng đặt lại, NCC mặc định; `resetToAuto`                                                      |
| POST             | /api/inventory/adjustments                                          | kiểm kê/hư hỏng theo ISBN, trả phiếu chênh lệch                                                                          |
| POST             | /api/inventory/:editionId/inspections                               | kiểm hàng chờ kiểm                                                                                                       |

Test: dùng `npm run test:fresh` (dựng lại DB `bookstore_test` rồi chạy toàn bộ test, cần MySQL; không đụng DB đang dùng); `costing.test.js` là test đơn vị không cần DB.

## API (đợt 3: địa chỉ, GHN, yêu thích)

Nạp thêm `db/03_ghn_catalog.sql` nếu DB đã tạo trước đó (DB mới qua docker compose tự nạp). Đặt `GHN_TOKEN` trong `.env` rồi gọi `POST /api/admin/geo/sync` để lấy danh mục.

| Method          | Đường dẫn                                                                          | Ghi chú                                                         |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GET             | /api/geo/provinces, /api/geo/provinces/:id/districts, /api/geo/districts/:id/wards | công khai                                                       |
| POST/GET        | /api/admin/geo/sync, /api/admin/geo/status                                         | ADMIN; đồng bộ chạy nền (202)                                   |
| GET/POST        | /api/addresses                                                                     | khách hàng; gửi `ghnProvinceId`, `ghnDistrictId`, `ghnWardCode` |
| PATCH/DELETE    | /api/addresses/:addressId                                                          | đổi khu vực phải gửi đủ cả ba mã                                |
| POST            | /api/addresses/:addressId/default, /confirm                                        | đặt mặc định / xác nhận lại khi `needsConfirm`                  |
| GET/POST/DELETE | /api/wishlist, /api/wishlist/:editionId                                            | khách hàng                                                      |

## API (đợt 4: khuyến mãi, mã giảm giá)

Nạp thêm `db/04_promotion_price_source.sql` nếu DB đã tạo trước đó (DB mới qua docker compose tự nạp). Quản trị: **ADMIN**.

| Method           | Đường dẫn                          | Ghi chú                                                                                                                                                              |
| ---------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST         | /api/admin/promotions              | lọc `q`, `phase` (SCHEDULED/RUNNING/ENDED/PAUSED); tạo: `scopeType` EDITION/CATEGORY/PUBLISHER/ISBN_LIST + `targets` (id hoặc ISBN-13), `discountType` PERCENT/FIXED |
| GET/PATCH/DELETE | /api/admin/promotions/:promotionId | PATCH: `status` ACTIVE/INACTIVE, thay `targets`, gia hạn `endAt`; DELETE: chưa bắt đầu thì xóa, đã chạy thì dừng                                                     |
| GET/POST         | /api/admin/discount-codes          | lọc `q`, `phase` (… USED_UP); `categoryIds` bỏ trống = toàn bộ sách                                                                                                  |
| GET/PATCH/DELETE | /api/admin/discount-codes/:id      | không đổi được chuỗi mã; DELETE: đã có đơn dùng thì chuyển INACTIVE                                                                                                  |
| POST             | /api/discount-codes/validate       | khách hàng: `{code}` → mức giảm theo giỏ hàng hiện tại (chưa trừ lượt)                                                                                               |

Mã lỗi 422 đáng chú ý: `PROMO_BELOW_COST` (kèm danh sách ấn bản; gửi lại với `allowBelowCost: true` + `belowCostReason`), `CODE_MIN_ORDER`, `CODE_USED_UP`, `CODE_CUSTOMER_LIMIT`, `CODE_NOT_APPLICABLE`…

Module đặt hàng sau này dùng trong `discount.service.js`: `claimDiscountCode` (trước khi INSERT Orders) → `recordDiscountUsage` (sau khi INSERT Orders) → `releaseDiscountCode` (hủy / hết hạn / hoàn về / trả hàng; chỉ trả lượt đúng một lần).

## API (đợt 5: checkout và đặt hàng)

Đặt `GHN_TOKEN` và `GHN_SHOP_ID` trong `.env` (phí vận chuyển lấy từ GHN; thiếu cấu hình hoặc GHN lỗi thì không báo giá/đặt hàng được).

| Method | Đường dẫn                                                    | Ghi chú                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/checkout/quote                                          | khách hàng: `{addressId, phone?, discountCode?}` → tiền hàng, giảm giá, phí ship (miễn phí từ 300.000 đ sau giảm), tổng, `paymentMethods` (COD kèm lý do nếu không dùng được). Chưa giữ hàng, chưa trừ lượt mã                                                                    |
| POST   | /api/orders                                                  | khách hàng: header **`Idempotency-Key`** + `{addressId, paymentMethod: COD\|SEPAY\|VNPAY, expectedTotal, phone?, discountCode?, note?}` → 201 (đơn mới) hoặc 200 `replayed: true` (gửi lại cùng khóa). COD => `CONFIRMED`; SePay/VNPay => `PENDING_PAYMENT` có `paymentExpiresAt` |
| GET    | /api/orders?status&page, /api/orders/:orderId                | chỉ đơn của chính khách                                                                                                                                                                                                                                                           |
| POST   | /api/orders/:orderId/cancel                                  | khách: `{reason?}`; chỉ khi GHN chưa lấy hàng                                                                                                                                                                                                                                     |
| GET    | /api/staff/orders?q&status&paymentStatus&shippingStatus&page | STAFF/ADMIN; `q` khớp mã đơn, SĐT, tên người nhận/khách (không dấu), mã vận đơn                                                                                                                                                                                                   |
| GET    | /api/staff/orders/:orderId, /:orderId/packing-slip           | chi tiết kèm khách; dữ liệu phiếu đóng gói                                                                                                                                                                                                                                        |
| POST   | /api/staff/orders/:orderId/cancel                            | STAFF/ADMIN: `{reason}` bắt buộc, ghi lịch sử thao tác                                                                                                                                                                                                                            |

Mã lỗi đáng chú ý: `409 QUOTE_CHANGED` (giá/phí/giỏ đổi giữa lúc xem và lúc đặt; kèm `details.quote` mới để khách xác nhận lại), `409 CART_NOT_PURCHASABLE` (kèm dòng lỗi), `409 INSUFFICIENT_STOCK`, `422 COD_OVER_LIMIT`, `422 COD_DISABLED`, `422 ADDRESS_NEEDS_CONFIRM`, `409 ORDER_NOT_CANCELLABLE`, `409 ORDER_ALREADY_SHIPPED`, `502/503/504 GHN_*`.

Dùng ở các module sau (`order.service.js`): `restoreReservation(conn, orderId)` trả hàng giữ đúng một lần (chỉ khi hàng chưa giao GHN); `cancelOrder`; job `expireUnpaidOrders` (chạy mỗi phút trong `jobs/index.js`).

## API (đợt 6: thanh toán SePay, vận đơn GHN, hoàn tiền, quản trị)

Tài liệu đầy đủ, luôn khớp code: **`/api/docs`** (Swagger UI) và `/api/openapi.json`.

| Method         | Đường dẫn                                                    | Ghi chú                                                                                             |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| GET            | /api/orders/:orderId/payment                                 | khách: QR chuyển khoản SePay cho đơn chờ thanh toán                                                 |
| POST           | /api/webhooks/sepay                                          | `Authorization: Apikey <SEPAY_API_KEY>`; trả `{success:true}`, xử lý đúng một lần theo mã giao dịch |
| POST           | /api/webhooks/ghn?token=                                     | `GHN_WEBHOOK_TOKEN`; không lùi trạng thái                                                           |
| POST           | /api/staff/orders/:id/packing, /shipment, /returned-received | quét ISBN đóng gói; tạo/thử lại vận đơn; kho xác nhận hàng hoàn về                                  |
| GET/POST       | /api/admin/refunds, /api/admin/refunds/:id/complete          | ADMIN: danh sách khoản hoàn, đánh dấu đã chuyển khoản                                               |
| GET            | /api/admin/customers[/:id]                                   | tìm khách, xem địa chỉ + đơn                                                                        |
| POST           | /api/admin/accounts/:id/lock, /unlock                        | khóa kèm lý do, hủy phiên; chặn admin cuối cùng                                                     |
| GET/POST/PATCH | /api/admin/staff[/:id], POST /api/auth/set-password          | tạo nhân viên + link đặt mật khẩu                                                                   |
| CRUD           | /api/admin/categories, authors, publishers, series           | xóa khi không còn dùng                                                                              |
| PATCH/POST     | /api/admin/editions/:id/details, /cover                      | sửa thông tin sách; upload bìa (multipart `cover`)                                                  |
| GET/PATCH      | /api/admin/parameters[/:key], GET /api/admin/audit-logs      | tham số hệ thống, lịch sử thao tác                                                                  |
| GET            | /api/admin/reports/revenue, best-sellers, overview           | báo cáo cơ bản                                                                                      |
| GET            | /api/books/:workId/reviews?rating&page                       | công khai: điểm trung bình, phân bố sao, danh sách                                                  |
| GET/POST       | /api/reviews/mine, /api/reviews                              | khách: đánh giá của tôi / tạo (cần đã nhận hàng, trong 90 ngày)                                     |
| PATCH/DELETE   | /api/reviews/:id                                             | khách: sửa/xóa đánh giá của mình                                                                    |
| POST           | /api/reviews/:id/report                                      | báo cáo; đủ 3 tài khoản thì tự ẩn                                                                   |
| GET/POST       | /api/admin/reviews, /:id/hide, /:id/show                     | ADMIN: kiểm duyệt                                                                                   |

Job mới: `shipments-retry` (1 phút), `shipments-sync` (5 phút), `returned-auto` (1 giờ). Thư viện: multer, sharp, xss, swagger-ui-express, zod-to-json-schema.
