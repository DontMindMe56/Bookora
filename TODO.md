# Danh sách việc (TODO) — phạm vi luận văn 7 tuần

Việc nào chưa làm và không nằm ở đây thì đã chuyển sang `BACKLOG.md` (ngày chuyển: 2026-10-29). Nội dung từng mục giữ nguyên như bản gốc; chỉ thêm nhãn ưu tiên và tách phần đã làm / chưa làm của các mục `[~]` khi cần.

## Nhãn ưu tiên

| Nhãn | Ý nghĩa |
|---|---|
| (không nhãn, `[x]`) | Đã xong, giữ nguyên |
| **[P0]** | Phải làm, cần để demo trọn luồng đặt hàng → thanh toán → giao → hoàn tất |
| **[P1]** | Chọn **một** nhóm (trả hàng/hoàn tiền rút gọn **hoặc** đánh giá) sau mốc tuần 4 |
| **[OPT]** | Chỉ làm nếu dư thời gian (đường chính, nghiệp vụ nhẹ) |

## Kế hoạch 7 tuần và mốc kiểm tra

1. **Tuần 1:** thử GHN thật (phí, vận đơn, hủy, danh mục địa giới; sửa nếu GHN đã đổi cấu trúc), chạy lại `npm test` đầy đủ. Chọn một cổng thanh toán (SePay hoặc VNPay) và bắt đầu.
2. **Tuần 2:** hoàn thiện cổng thanh toán, tạo vận đơn GHN, webhook + đồng bộ trạng thái. **Mốc 1 (cuối tuần 2):** luồng đặt hàng → thanh toán → tạo vận đơn chạy end-to-end với GHN thật? Nếu có và dư thời gian → thêm `[OPT]`.
3. **Tuần 3-4:** bàn giao GHN (xuất kho, `costPrice`), hoàn tất đơn, API quản trị (nhân viên, khách, danh mục, bìa), tham số, lịch sử thao tác, báo cáo cơ bản, Swagger. **Mốc 2 (cuối tuần 4):** luồng chính ổn định? Nếu có → chọn **một** nhóm `[P1]`.
4. **Tuần 5:** nhóm `[P1]` đã chọn (hoặc dồn thời gian ổn định luồng chính).
5. **Tuần 6:** sửa lỗi, dữ liệu demo, test luồng chính. **Dừng thêm tính năng.**
6. **Tuần 7:** báo cáo, slide, video dự phòng. Không thêm tính năng.

> Cập nhật `BACKLOG.md` (ngày + lý do) mỗi khi chuyển thêm mục; đó là nguyên liệu cho mục “Giới hạn và hướng phát triển” của báo cáo.

---
Đối chiếu với SRS (Chương 1–2) và thiết kế dữ liệu (Chương 5). Ký hiệu: `[x]` đã xong, `[ ]` chưa làm, `[~]` làm một phần.
Số trong ngoặc là mục tương ứng trong SRS.

## 0. Tổng quan tiến độ

| Nhóm | Trạng thái |
|---|---|
| Schema DB (45 bảng, ràng buộc, trigger, seed tham số) | Xong |
| Khung dự án (config, db, transaction, lỗi, validate, auth middleware, audit, outbox email, job dọn dẹp) | Xong |
| Auth cơ bản, Catalog (đọc + tạo/sửa giá/trạng thái ấn bản), Giỏ hàng | Xong (7 test tích hợp qua) |
| Sổ địa chỉ, danh mục GHN (bản sao cục bộ + đồng bộ), yêu thích | Đã viết; `test/address.test.js` (6 test tích hợp, GHN giả lập) qua |
| Khuyến mãi (chiến dịch) và mã giảm giá | Đã viết; `test/promotion.test.js` (11 test) và `test/discount.test.js` (11 test) qua |
| Checkout và đặt hàng (báo giá GHN, tạo đơn idempotent, giữ hàng, mã giảm giá, COD, hủy, hết hạn, tra cứu) | Đã viết; `test/order.test.js` (18 test tích hợp, GHN giả lập, gồm test đồng thời) qua. **66 test lúc đó chạy qua trên MySQL 8.0** (số test hiện tại: xem mục 16). Phí GHN / hủy vận đơn **chưa thử với GHN thật** |
| Nhà cung cấp, nhập kho, tồn kho, giá vốn, phiếu đặt hàng NCC (mục 5) | Đã viết, `test/costing.test.js` (4 test đơn vị) qua; `test/inventory.test.js` (9 test tích hợp) qua |
| Thanh toán SePay (QR, webhook, đúng một lần, thiếu/dư/muộn/trùng => Refund), vận đơn GHN (tạo + thử lại 3 lần, webhook, đồng bộ, bàn giao => xuất kho + `costPrice`, hoàn tất, giao thất bại/hoàn về/về kho), Refund tối thiểu, email sự kiện đơn | Đã viết; `test/payment.test.js` (8) + `test/shipment.test.js` (11) qua với GHN/SePay giả lập. **Chưa thử với GHN thật** |
| API quản trị: khách, khóa/mở khóa, nhân viên, CRUD danh mục/tác giả/NXB/bộ sách, sửa sách, upload bìa, làm sạch HTML, tham số, lịch sử thao tác, báo cáo cơ bản, OpenAPI (`/api/docs`) | Đã viết; `test/admin.test.js` (13). **106 test lúc đó qua** (số hiện tại: xem mục 16) |
| Đăng nhập Google/Facebook, xử lý GHN hủy từ phía GHN, giới hạn tham số (cập nhật 2026-11-04) | Đã viết; **142 test qua** trên MySQL 8.0.46 (`npm run test:fresh`, chạy lặp lại `npm test` cũng qua) |
| Đánh giá sách `[P1]` (tạo/sửa/xóa, báo cáo tự ẩn, admin ẩn/hiện) | Đã viết; `test/review.test.js` (5 test) qua |
| Còn lại: trả hàng `[P1]` (đã chọn đánh giá thay), `[OPT]`, thử GHN thật | Chưa làm |

---

## 1. Tài khoản & phân quyền (2.1.1.1–2, 2.1.2.1, 2.1.2.3)

- [x] Đăng ký email, xác thực email, gửi lại link (có giới hạn tần suất), đăng nhập, đăng xuất, quên/đặt lại mật khẩu
- [x] Khóa tạm khi sai mật khẩu 5 lần (theo email + IP), hủy phiên khi đặt lại mật khẩu
- [x] Xem và sửa hồ sơ (họ tên, SĐT, ngày sinh, giới tính)
- [x] **[OPT]** Đăng nhập / đăng ký bằng Google (thư viện `google-auth-library`): `POST /api/auth/google {idToken}`, frontend lấy ID token qua Google Identity Services; cần `GOOGLE_CLIENT_ID`. Email Google phải đã xác thực; liên kết vào tài khoản CUSTOMER có sẵn, xóa mật khẩu cũ nếu tài khoản email chưa xác thực; nhân viên/admin không dùng Google (403). `test/google.test.js` (5 test) qua
- [x] **[OPT]** SĐT của tài khoản Google: sổ địa chỉ luôn bắt buộc SĐT người nhận, nên checkout không phải hỏi thêm; lần đặt hàng đầu lưu SĐT địa chỉ vào `Customer.phone` nếu còn trống
- [x] **[OPT]** Đăng nhập / đăng ký bằng Facebook (`POST /api/auth/facebook`, `auth/auth.facebook.js`, cần `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`). Cần `db/07_facebook_login.sql` (thêm `Account.facebookId` **và nới ràng buộc `ck_account_cred`** — schema gốc chỉ cho tài khoản có mật khẩu hoặc Google nên đăng ký Facebook bị 422); DB đã có thì chạy `npm run migrate:facebook` (làm đúng như file 07, chạy lặp lại được). `test/facebook.test.js` (6 test) qua. **Chưa thử với Facebook thật.**
- [x] Đổi mật khẩu (nhập mật khẩu hiện tại, hủy mọi phiên) — `POST /api/auth/change-password`
- [x] Admin: xem/tìm danh sách khách hàng, xem sổ địa chỉ và đơn hàng của khách — `GET /api/admin/customers[/:id]`
- [x] Admin: khóa/mở khóa tài khoản (kèm lý do, hủy mọi phiên, ghi lịch sử, email báo khóa) — `POST /api/admin/accounts/:id/lock|unlock`; không tự khóa mình
- [x] Admin: tạo tài khoản nhân viên, gán vai trò, link đặt mật khẩu lần đầu (24 giờ, `POST /api/auth/set-password`), đổi vai trò/hạ quyền (hủy phiên) — `/api/admin/staff`
- [x] Chặn khóa/hạ quyền quản trị viên cuối cùng đang hoạt động (`409 LAST_ADMIN`, khóa các dòng admin theo thứ tự cố định => không deadlock). Chưa có "xóa" nhân viên: dùng khóa tài khoản
- [x] Tắt COD khi có >= 2 đơn COD hoàn về kho trong 90 ngày (tính ngay lúc báo giá/đặt hàng, `codBlockedFor` trong `order/quote.service.js`; xem giả định mục 6)

## 2. Sổ địa chỉ & danh mục địa giới GHN (2.1.2.2)

- [x] API thêm / sửa / xóa địa chỉ (tối đa 10, địa chỉ đầu tiên tự là mặc định, xóa mặc định thì chọn địa chỉ dùng gần nhất) — `/api/addresses`; đã có hàm `touchAddress` để checkout ghi `lastUsedAt`
- [~] **[P0]** Đồng bộ danh mục tỉnh/quận/phường từ GHN (và cờ `needsConfirm` khi đổi địa giới): đã viết (`POST /api/admin/geo/sync`, job 24 giờ, `POST /api/addresses/:id/confirm`) nhưng **chưa thử với GHN thật** — tên trường và phương thức HTTP của API master-data (tỉnh GET; quận/phường POST) viết theo tài liệu cũ, cần đối chiếu tài liệu GHN hiện hành. Danh mục 3 cấp (tỉnh/quận/phường): nếu GHN đã bỏ cấp quận sau sáp nhập tỉnh thì cần đổi `GhnDistrict`/`Address.district`
- [x] Kiểm tra địa chỉ nằm trong danh mục GHN (tên tỉnh/quận/phường lưu theo danh mục, không tin tên client gửi)

## 3. Sách, ấn bản, danh mục (2.1.2.4–2.1.2.5)

- [x] Tìm kiếm không dấu, lọc, sắp xếp, phân trang, chi tiết sách, sách cùng bộ, sách liên quan
- [x] Admin tạo ấn bản (tự tạo tác giả/NXB/thể loại), sửa giá và trạng thái kinh doanh có lịch sử
- [x] Upload hình bìa — `POST /api/admin/editions/:id/cover` (multipart, trường `cover`): `sharp` đọc nội dung thật (JPG/PNG/WebP), tối đa 2 MB (413), lưu WebP 800px + ảnh nhỏ 200px tại `UPLOAD_DIR/covers`, phục vụ ở `/uploads`; chưa có bìa => `/uploads/covers/default.webp` (tạo khi khởi động)
- [x] Sửa thông tin sách/ấn bản đầy đủ — `PATCH /api/admin/editions/:id/details`, lịch sử trước/sau. Tên/tác giả/thể loại/bộ sách thuộc **tác phẩm** nên đổi chung cho mọi ấn bản của tác phẩm đó
- [x] CRUD thể loại, tác giả, nhà xuất bản, bộ sách — `/api/admin/{categories,authors,publishers,series}`; xóa chỉ khi không còn dùng (`409 IN_USE`); thể loại tối đa hai cấp
- [x] Làm sạch HTML ở mọi JSON body (`middleware/sanitize.js`, thư viện `xss`: bỏ thẻ, bỏ hẳn nội dung `<script>/<style>`; bỏ qua trường `password*`/`token*` và `/webhooks`). Văn bản có dấu `<` đứng riêng bị cắt (vd. `a<b` => `a`)
- [x] Ngừng kinh doanh / ẩn: danh sách yêu thích có nhãn "không còn bán"; đơn đang xử lý giữ nguyên (đơn chốt giá/ấn bản trong `OrderItem`, không phụ thuộc trạng thái kinh doanh sau đó)
- [x] Chặn chọn ấn bản "Ngừng kinh doanh" trong phiếu nhập mới (vẫn cho điều chỉnh tồn kho)

## 4. Khuyến mãi & mã giảm giá (2.1.2.4.5, 2.1.2.9)

- [x] CRUD chiến dịch khuyến mãi (theo ấn bản, thể loại, NXB, danh sách ISBN) — `/api/admin/promotions` (ADMIN). Chưa bắt đầu thì xóa hẳn; đã chạy thì chỉ chuyển `INACTIVE`; hết hạn thì gia hạn bằng cách sửa `endAt`
- [x] Chặn giá khuyến mãi thấp hơn giá vốn trừ khi admin xác nhận bán lỗ kèm lý do (lý do ghi vào lịch sử thao tác). Job còn tự bỏ qua ấn bản mà giá vốn tăng (do nhập hàng) vượt giá KM nếu chiến dịch chưa xác nhận bán lỗ
- [x] Job (mỗi phút, và ngay sau mỗi lần tạo/sửa/dừng chiến dịch) tự áp dụng khi đến giờ, tự gỡ khi hết hạn, chọn giá thấp nhất khi thuộc nhiều chiến dịch (cập nhật `Edition.salePrice`, đánh dấu nguồn ở `Edition.salePromotionId`). Có khóa `GET_LOCK` nên chạy nhiều instance không giẫm lên nhau
- [x] CRUD mã giảm giá (phần trăm/số tiền, giá trị tối thiểu, giảm tối đa, lượt tổng/lượt mỗi khách, phạm vi thể loại, loại trừ sách đang KM) — `/api/admin/discount-codes` (ADMIN)
- [x] Áp mã khi đặt hàng, trừ lượt an toàn khi nhiều khách đặt cùng lúc, trả lượt đúng một lần: đã nối vào checkout, hủy đơn và job hết hạn thanh toán (test đồng thời 5 khách tranh 2 lượt, hủy/hết hạn trả đúng một lần)
- [x] Tạm ngưng / xóa mã (đã có đơn dùng thì chuyển "Ngừng áp dụng"); job chuyển "Hết hiệu lực"

## 5. Nhà cung cấp, nhập kho, tồn kho (2.1.1.15–16, 2.1.2.6–7, 2.1.2.14)

- [x] CRUD nhà cung cấp, ngừng hợp tác nếu đã có phiếu nhập, tự ghi nhận danh sách đầu sách đã nhập
- [x] Lập phiếu nhập: quét ISBN đầu tiên để nhận phiếu đặt hàng chờ nhận (`GET /api/purchase-orders/lookup?isbn=`), nhập tay hoặc Excel (API `POST /api/import-vouchers/preview` nhận dòng JSON và báo lỗi từng dòng; **việc đọc file .xlsx do frontend làm**, chưa có giao diện "xuất dòng lỗi để sửa")
- [x] Xác nhận phiếu (quét ISBN đối chiếu, sửa số lượng thực nhận), tăng tồn thực tế, giá vốn bình quân gia quyền, nhật ký biến động
- [x] Sửa/hủy phiếu chưa xác nhận; job tự hủy phiếu chưa xác nhận quá 30 ngày
- [x] Phiếu điều chỉnh giá nhập (chỉ admin), tính lại giá vốn theo chênh lệch, không tính lại báo cáo kỳ cũ
- [x] Điều chỉnh tồn kho / kiểm kê (`POST /api/inventory/adjustments`, có phiếu chênh lệch, loại ADJUST/DAMAGE); khi trừ làm tồn < số đã giữ thì chặn (409)
- [x] Xem tồn kho (tồn thực tế, đã giữ, khả dụng, tồn tối thiểu), lọc dưới mức tối thiểu / hết hàng, xem nhật ký biến động
- [x] Tự tính mức tồn tối thiểu, số lượng đặt lại, nhà cung cấp mặc định; cho ghi đè (giá trị ghi đè không bị tính lại). Doanh số lấy từ `StockMovement` loại `SALE` (module đặt hàng phải ghi `quantity` âm khi GHN lấy hàng)
- [x] Tự tạo phiếu đặt hàng nhà cung cấp khi khả dụng dưới mức tối thiểu; job tự đóng sau 30 ngày chưa nhận đủ
- [x] Email tóm tắt hằng ngày các ấn bản dưới mức tồn tối thiểu (gửi cho mọi STAFF/ADMIN đang hoạt động)
- [x] API kiểm hàng “chờ kiểm” (`POST /api/inventory/:editionId/inspections`, cộng hàng nguyên vẹn vào tồn thực tế)

> Từ nay nhập hàng bằng phiếu nhập qua API; bài test cũ trong `api.test.js` vẫn gán tồn bằng SQL nên không bị ảnh hưởng.

## 6. Đặt hàng (2.1.1.3–4, 2.1.1.10, 2.1.2.13)

- [x] Giỏ hàng (thêm, sửa, xóa, gộp giỏ khi đăng nhập, báo đổi giá/hết hàng/ngừng bán)
- [x] Danh sách yêu thích (thêm/bỏ, yêu cầu đăng nhập) — `/api/wishlist`; sách ngừng bán vẫn hiện, kèm nhãn "Không còn bán"
- [x] Checkout: chọn địa chỉ, SĐT, mã giảm giá, phương thức thanh toán — `POST /api/checkout/quote` (báo giá, chưa giữ hàng/trừ lượt mã) và `POST /api/orders`
- [~] **[P0]** Tính phí vận chuyển qua GHN (không đặt được nếu GHN không giao được hoặc lỗi): **đã viết và test với GHN giả lập** (GHN lỗi/timeout => 502/503/504, không tạo đơn). **Chưa thử với GHN thật:** endpoint `/v2/shipping-order/fee`, header `ShopId`, trường `data.total`, `service_type_id` (cần đối chiếu tài liệu GHN hiện hành); cần đặt `GHN_SHOP_ID`
- [x] Tự tính tiền hàng, giảm giá, phí ship (miễn phí từ 300.000 đ tính trên tiền hàng sau giảm), luôn tính lại ở server; khách gửi `expectedTotal`, khác thì 409 `QUOTE_CHANGED` kèm báo giá mới để xác nhận lại
- [x] Quy tắc COD (<= 2.000.000 đ, tự tắt khi khách có >= 2 đơn COD hoàn về trong 90 ngày). **Chưa có:** kiểm tra "GHN hỗ trợ COD" theo khu vực (xem giả định mục 6)
- [x] Tạo đơn một lần duy nhất (header `Idempotency-Key`), mã đơn ngẫu nhiên `DH` + 8 ký tự, chốt giá và bản sao địa chỉ, giữ hàng, trừ lượt mã, email xác nhận, xóa dòng đã đặt khỏi giỏ — tất cả trong một transaction (test: 5 yêu cầu đồng thời cùng khóa => một đơn; 6 khách tranh 3 cuốn => đúng 3 đơn)
- [x] Job hết hạn đơn thanh toán trực tuyến sau 30 phút (+ 5 phút ân hạn cho chuyển khoản): `expireUnpaidOrders`, mỗi phút; trả hàng giữ và lượt mã đúng một lần, chạy đồng thời vẫn đúng
- [x] **[P0]** Hủy đơn (khách chỉ khi GHN chưa lấy hàng; nhân viên/admin kèm lý do): **đã làm** `POST /api/orders/:id/cancel`, `POST /api/staff/orders/:id/cancel` — hoàn tồn kho và lượt mã đúng một lần, hủy vận đơn GHN trước nếu có, ghi lịch sử thao tác, email. Hủy vận đơn GHN tự thử lại 3 lần (mục 8); đơn đã thanh toán tạo `Refund` (mục 9). **Chưa thử với GHN thật:** endpoint `/v2/switch-status/cancel`. Nhân viên kho báo hàng thiếu/hỏng dùng chung API hủy của nhân viên.
- [x] Khách xem lịch sử và chi tiết đơn (chỉ đơn của mình, đơn người khác => 404), lọc theo trạng thái, phân trang
- [x] Nhân viên tìm/lọc/xem đơn (mã đơn, SĐT, tên người nhận/khách không dấu, mã vận đơn) — `/api/staff/orders`; in lại phiếu đóng gói: API trả dữ liệu phiếu (`/:id/packing-slip`), **dàn trang in do frontend làm**

## 7. Thanh toán (2.1.1.5–6)

- [x] **SePay (cổng đã chọn)**: `GET /api/orders/:id/payment` (QR `qr.sepay.vn`, cần `SEPAY_BANK`/`SEPAY_ACCOUNT_NO`), `POST /api/webhooks/sepay` (header `Authorization: Apikey <SEPAY_API_KEY>`), tìm mã `DH********` trong nội dung, đúng một lần nhờ unique `(provider, providerTxnId)`, ghi `IntegrationLog`. Đủ tiền + trong hạn (+ân hạn) => `CONFIRMED/PAID` rồi tạo vận đơn; thiếu => hoàn toàn bộ (`UNDERPAID`); dư => nhận đơn + hoàn phần dư (`OVERPAID`); muộn/đơn đã hủy => `LATE_PAYMENT`; đã trả rồi => `DUPLICATE`; không xác định đơn => `ExceptionItem UNKNOWN_SEPAY_TXN`. **Chưa thử với SePay thật** (tên trường payload theo tài liệu cũ)
- [x] **VNPay (thư viện `vnpay`, sandbox)**: `POST /api/orders/:id/vnpay` (URL có chữ ký, mỗi lần thử một `vnp_TxnRef` = `<mã đơn>T<n>`, tối đa 5 lần, hết hạn theo `paymentExpiresAt`), `GET /api/webhooks/vnpay/ipn` (kiểm tra chữ ký/số tiền/lần thử PENDING, mã 00 => `CONFIRMED/PAID`; thất bại => `FAILED`; trả `RspCode` 00/01/02/04/97/99), `GET /api/webhooks/vnpay/return` (chỉ hiển thị), `QueryDR` trước khi hết hạn trong job `expireUnpaidOrders`. Thanh toán thành công lần hai => Refund `DUPLICATE`; đến muộn/đơn đã hủy => `LATE_PAYMENT`. `test/vnpay.test.js` (7 test) qua. **Chưa thử với sandbox thật**; hoàn tiền qua API VNPay: `POST /api/admin/refunds/:id/vnpay` (ADMIN; toàn phần `02`/một phần `03`, khóa bằng trạng thái `PROCESSING_BANK`, lỗi => Refund `FAILED` + `ExceptionItem REFUND_VNPAY_FAILED`, thành công => hoàn tất như `complete`). `test/vnpay-refund.test.js` (7 test, máy chủ VNPay giả lập kiểm cả chữ ký yêu cầu): toàn phần/một phần, VNPay từ chối rồi thử lại, lỗi HTTP/thiếu hoặc sai chữ ký, hai yêu cầu đồng thời chỉ gọi VNPay một lần, phân quyền/404/khoản không phải VNPay, chữ ký phản hồi ở cả hai biến thể. **Đã xử lý (2026-10-30):** thư viện `vnpay` 2.5.0 chia `vnp_Amount` phản hồi cho 100 *trước* khi kiểm chữ ký, nên hoàn tiền thật thành công có thể bị ghi `FAILED`; `refundViaVnpay` giờ tự gọi API hoàn tiền (`callVnpayRefund`, `payment/vnpay.service.js`) và kiểm chữ ký trên phản hồi thô — chấp nhận chữ ký trên `vnp_Amount` gốc (x100) hoặc đã chia 100, bắt buộc có `vnp_SecureHash`; mọi trường hợp không rõ kết quả (lỗi mạng, timeout, HTTP lỗi, thiếu/sai chữ ký, kể cả mã `00` chữ ký sai) ghi `FAILED` kèm ngoại lệ "KHÔNG RÕ KẾT QUẢ — kiểm tra trên cổng merchant trước khi thử lại" (tránh hoàn hai lần; nếu VNPay đã hoàn thì admin dùng `/complete`), còn VNPay từ chối rõ ràng thì thử lại an toàn. Test cũ ký theo hành vi của thư viện nên không phát hiện được lỗi này. **Vẫn cần kiểm với sandbox thật** (cách VNPay ký phản hồi hoàn tiền, `vnp_TransactionNo`/`vnp_TransactionDate` của giao dịch gốc). Cổng SePay/VNPay tự báo `GATEWAY_UNAVAILABLE` trong báo giá khi chưa cấu hình. GHN `scrap` ánh xạ thành thất lạc (`LOST`); `exception` vẫn bị bỏ qua

## 8. Đóng gói, vận chuyển GHN, đối soát (2.1.1.7–9)

- [x] Tạo vận đơn GHN khi đơn được xác nhận (COD: ngay sau khi đặt; SePay: ngay sau thanh toán; `GHN_AUTO_CREATE=0` để tắt). Không trùng: dòng `Shipment` tạo trước (unique đơn+chiều) + "giành" bằng `lastSyncAt`; `client_order_code` = mã đơn; tiền thu hộ = tổng nếu COD, 0 nếu đã thanh toán. `POST /api/staff/orders/:id/shipment` để tạo/thử lại tay. **Endpoint `/v2/shipping-order/create`, `detail`, `detail-by-client-code` chưa kiểm chứng với GHN thật**
- [x] Tự thử lại 3 lần khi tạo/hủy vận đơn lỗi (chờ 1s, 5s; lần thử lại tra theo mã đơn trước để không tạo trùng) rồi job `shipments-retry` (mỗi phút) thử tiếp
- [x] Webhook GHN `POST /api/webhooks/ghn?token=<GHN_WEBHOOK_TOKEN>`; job `shipments-sync` (mỗi 5 phút, chỉ vận đơn chưa cập nhật quá `GHN_SYNC_STALE_MINUTES`=30 phút). Không lùi trạng thái: so thời điểm sự kiện với `lastGhnEventAt` (cùng giây thì so thứ hạng), trạng thái cuối (đã giao/hoàn về/hủy/thất lạc/hỏng) bị khóa
- [x] (rút gọn) `POST /api/staff/orders/:id/packing` `{isbns:[...]}`: đối chiếu số lượng quét, báo thiếu/thừa, lần quét hợp lệ đầu tiên tự chuyển `PACKING`. Không lưu số đã quét (client gửi toàn bộ lần quét); bỏ phiếu soạn gộp, in nhãn
- [x] Bàn giao GHN: khi trạng thái sang `picked`/đang giao (hoặc muộn hơn mà chưa bàn giao) thì xuất kho đúng một lần (`pickedUpAt`), trừ `qtyOnHand` và `qtyReserved`, ghi `StockMovement SALE`, chốt `OrderItem.costPrice`. Đơn đã hủy mà GHN vẫn lấy hàng => `ExceptionItem GHN_CLAIM_FAILED`
- [x] Giao thất bại, đang hoàn về, GHN báo hoàn về => `RETURNED`; kho xác nhận `POST /api/staff/orders/:id/returned-received` hoặc tự động sau `RETURNED_AUTO_RECEIVE_DAYS`=7 ngày => `RETURNED_TO_WAREHOUSE`, hàng vào `qtyPendingInspection` (`StockMovement RETURN_TO_WAREHOUSE`), đơn trả trước tạo `Refund` + `REFUND_PENDING`. **Thất lạc/hư hỏng** (`shipment/shipment.loss.js`): GHN báo `lost`/`damage` => xuất kho như đã bàn giao (hàng mất thật, không hoàn kho), đơn `CANCELLED` (`cancelReason` ghi lý do), đơn trả trước tạo `Refund` nguồn `CANCEL` + `REFUND_PENDING`, tạo `ExceptionItem GHN_LOST` để đòi GHN bồi thường (cần nạp `db/06_exception_ghn_lost.sql`), email `SHIPMENT_LOST`. Không trả lượt mã giảm giá
- [x] Hoàn tất đơn khi GHN báo đã giao (COD => `COD_COLLECTED` + `PaymentTransaction COD`), ghi `deliveredAt`, `completedAt`. `completedAt` cũng được dùng làm mốc hoàn về kho cho quy tắc tắt COD

## 9. Trả hàng, hoàn tiền (2.1.1.11–14)
- [x] Bản ghi `Refund` tối thiểu: tạo khi hủy đơn đã thanh toán, hoàn về kho, thanh toán thiếu/dư/muộn/trùng. Admin xem `GET /api/admin/refunds` và đánh dấu `POST /api/admin/refunds/:id/complete {bankTxnRef}` (chuyển khoản thủ công) => `REFUNDED`, đơn `REFUNDED` khi hết khoản chờ, email. Chưa có: nhập tài khoản nhận hoàn, VietQR, duyệt hai người, hoàn VNPay

- [~] **[đã chuyển BACKLOG 2026-10-30 — đã chọn nhóm đánh giá]** Gửi yêu cầu trả hàng (lý do, 1–5 ảnh, tài khoản nhận hoàn), tự duyệt/tự từ chối theo hạn 7 ngày
- [~] **[đã chuyển BACKLOG 2026-10-30 — đã chọn nhóm đánh giá]** Nhận và kiểm hàng trả (quét ISBN, đánh dấu cuốn hư hỏng, hàng sai thì từ chối hoàn tiền và vào ngoại lệ)

## 10. Danh sách ngoại lệ (2.1.1.17)

> Toàn bộ mục này đã chuyển sang `BACKLOG.md`.

## 11. Hóa đơn điện tử (1.2, 2.1.1.8, 2.1.1.12)

> Toàn bộ mục này đã chuyển sang `BACKLOG.md`.

## 12. Đánh giá (2.1.2.10)

- [x] **[P1]** Tạo đánh giá (đã nhận hàng, trong `REVIEW_WINDOW_DAYS`=90 ngày kể từ `deliveredAt`, mỗi ấn bản một lần), lọc HTML (middleware `sanitize`) / liên kết / từ cấm — `POST /api/reviews`; xem công khai `GET /api/books/:workId/reviews` (điểm trung bình, phân bố sao, lọc theo sao)
- [x] **[P1]** Sửa/xóa đánh giá của mình (`PATCH|DELETE /api/reviews/:id`, `GET /api/reviews/mine`); điểm trung bình luôn tính trực tiếp từ bảng `Review` nên có hiệu lực ngay
- [x] Báo cáo đánh giá (`POST /api/reviews/:id/report`): đủ `REVIEW_REPORT_HIDE_COUNT`=3 tài khoản khác nhau thì tự ẩn (`hiddenBy=AUTO`); admin ẩn/hiện có lý do và lịch sử — `/api/admin/reviews`. `test/review.test.js` (5 test) qua; cần nạp `db/05_review.sql` trước

## 13. Thông báo (2.1.2.11)

- [x] Hạ tầng hàng đợi email (gửi sau commit, không gửi trùng, thử lại 1/5/15 phút)
- [x] Email xác thực tài khoản và đặt lại mật khẩu
- [x] (rút gọn, `services/notify.js`) Email: thanh toán thành công, đang đóng gói (gắn vào lần quét đầu tiên), đang giao, giao xong, giao thất bại, đang hoàn về, đã về kho, đã hoàn tiền, thanh toán cần hoàn. Xác nhận đặt hàng, hủy/hết hạn, khóa tài khoản đã có. **Còn thiếu (phụ thuộc BACKLOG):** yêu cầu nhập tài khoản hoàn, hướng dẫn gửi hàng trả, kết quả trả hàng, đổi email, ngoại lệ mới

## 14. Báo cáo & thống kê (2.1.2.12)

- [x] `GET /api/admin/reports/revenue?from&to&groupBy=day|month|category` (ngày theo giờ VN). Doanh thu = tiền hàng − giảm giá − hoàn tiền `RETURN` của đơn Hoàn tất (không tính phí ship); lợi nhuận gộp = doanh thu − giá vốn đã chốt. Theo thể loại: mỗi dòng hàng tính vào thể loại đầu tiên (theo tên) của tác phẩm, giảm giá đơn chưa phân bổ
- [x] `GET /api/admin/reports/best-sellers`, `/overview` (tỷ lệ hủy = hủy+hết hạn, tỷ lệ hoàn về, giá trị đơn trung bình, giá trị tồn, hết hàng, dưới mức tối thiểu)

## 15. Quản trị hệ thống (2.1.2.15–16)

- [x] `GET /api/admin/parameters`, `PATCH /api/admin/parameters/:key {value, reason}`: số nguyên dương (0 chỉ cho `SAFETY_STOCK_DEFAULT`, `FREE_SHIPPING_THRESHOLD`), `RETRY_BACKOFF_MINUTES` là danh sách; ghi lịch sử, xóa cache (instance khác trễ tối đa 30 giây). Mỗi tham số có khoảng giá trị cho phép riêng (`RANGES` trong `admin/system.service.js`; **giá trị là giả định của nhóm phát triển, cần chủ cửa hàng xác nhận**), vượt khoảng => 422
- [x] `GET /api/admin/audit-logs?actorId&entityType&entityId&action&from&to&page`

## 16. Vận hành, giám sát, phi chức năng (2.1.1.17, 2.2)

- [x] Ghi `IntegrationLog` cho lời gọi GHN và webhook SePay/GHN, VNPay (IPN, hoàn tiền, `QueryDR`) (`services/integrationLog.js`). HĐĐT chưa có
- [x] Timeout cho lời gọi hệ thống ngoài: GHN có (`GHN_TIMEOUT_MS`); SePay chỉ nhận webhook, không gọi ra
- [x] Tài liệu API: `/api/docs` (Swagger UI) và `/api/openapi.json`, sinh tự động từ bảng định tuyến + schema zod (tắt ở production trừ khi `DOCS_ENABLED=1`). Schema phản hồi đã có cho 11 API chính (`src/docs/responses.js`), được `test/docs.test.js` đối chiếu với dữ liệu thật; API khác chỉ ghi 200 chung chung
- [x] Bộ test 142 test (chạy `npm run test:fresh` để reset DB bằng `scripts/db-init.js` rồi test; `test/e2e.test.js` là kịch bản demo: SePay giao thành công, COD giao thất bại/hoàn về, khách hủy đơn), gồm webhook SePay trùng/đồng thời, GHN lệch thứ tự/trùng, thử lại tạo vận đơn, bàn giao/hoàn tất/hoàn về, khóa admin cuối cùng. Test dùng chung `test/helpers.js`
- [x] Rate limit cho `/api/discount-codes/validate` và `/api/checkout`, `/api/orders` (30 lần/phút/IP)

---

## Hạn chế đã biết của phần đã làm

1. ~~Tồn kho chưa có đường nhập hàng qua API~~ — đã có (mục 5). Đặt hàng giờ có thể thử bằng phiếu nhập thật.
2. **`CartItem.priceAtAdd`** chỉ được cập nhật khi khách đổi số lượng hoặc thêm lại; cảnh báo "đổi giá" sẽ còn hiện cho tới lúc đó.
3. **Tìm kiếm** dùng `LIKE '%...%'` trên collation `utf8mb4_0900_ai_ci`. Đã kiểm chứng trên MySQL 8.0 với dữ liệu demo (2026-10-30): "đ" khớp "d", không dấu/hoa thường/tên tác giả/NXB đều tìm được (vd. `dac nhan tam`, `nguyen nhat anh`, `kim dong`). Lưu ý: collation `_ai_` coi `ơ`≈`o` nên `thơ` cũng khớp `thời` (cả `tho`, `thô`, `thơ`) — chấp nhận được, nhưng ghi vào "Giới hạn" của báo cáo. Hiệu năng sẽ giảm khi dữ liệu lớn. Cột `Work.searchText` và FULLTEXT index đã chuẩn bị nhưng chưa dùng; nên chuyển sang dùng khi có nhiều sách.
4. **Lọc theo thể loại** chỉ tính thể loại được chọn và các thể loại con trực tiếp (một cấp).
5. **Sách bán chạy** tính từ đơn Hoàn tất 30 ngày gần nhất, nên hiện chưa có dữ liệu (chưa có đơn hàng).
6. **Admin đầu tiên** tạo bằng `npm run create-admin`; các nhân viên sau tạo qua `/api/admin/staff`.
7. ~~Hạn mức COD (2.000.000 đ)~~ — không đặt CHECK ở DB vì là tham số cấu hình; đã kiểm tra ở tầng ứng dụng (`order/quote.service.js`), cả lúc báo giá lẫn lúc tạo đơn.
8. **Thư mục `db/`** (01 schema, 02 seed tham số, 03 danh mục GHN, 04 cột `salePromotionId`, 05 đánh giá, 06 `GHN_LOST`, 07 đăng nhập Facebook, 08 `GHN_CANCELLED`) **không có trong zip nhận được** nên đã dựng lại ở `../db/`; 02 chứa giá trị tham số do mình đặt (xem 9) — đối chiếu với bản gốc của bạn. **Thay đổi ngoài schema gốc:** bảng `GhnProvince/GhnDistrict/GhnWard` (`db/03_ghn_catalog.sql`) và cột `Edition.salePromotionId` (`db/04_promotion_price_source.sql`). DB đang chạy cần nạp hai file này (đều chạy lặp lại được).
8b. **Các bảng đã có trong schema nhưng chưa có code ghi:** `EInvoice`, `Notification`, `ReturnRequest`; `ExceptionItem` chỉ ghi 5 loại (`UNKNOWN_SEPAY_TXN`, `GHN_CLAIM_FAILED`, `GHN_LOST`, `GHN_CANCELLED`, `REFUND_VNPAY_FAILED`), chưa có API xử lý.
9. **Một số tham số SRS chưa nêu giá trị** nên seed dùng giá trị tạm, ghi "(giả định)" trong `02_seed.sql`: trọng lượng bao bì, tồn an toàn, số ngày tính doanh số trung bình, ngưỡng cảnh báo bất thường, hạn nhắc Lệnh chi hoàn, hạn lưu số tài khoản nhận hoàn. Cần xác nhận với chủ cửa hàng.
10. **Mâu thuẫn nhỏ trong SRS cần chốt:** mục 5.2.3 ghi `costPrice > 0` nhưng ấn bản mới chưa nhập kho thì chưa có giá vốn (schema đang cho `>= 0`); ERD thiếu trạng thái đơn `EXPIRED` và các trạng thái vận chuyển `CANCELLED/LOST/DAMAGED` mà mục 2.1.3 có (schema đã bổ sung).

## Thứ tự đề xuất (bản gốc, trước khi cắt phạm vi — thay bằng kế hoạch 7 tuần ở đầu file)

1. ~~Nhà cung cấp, nhập kho, tồn kho (mục 5)~~ — đã viết (còn hai mục `[~]` phụ thuộc đặt hàng/trả hàng)
2. ~~Sổ địa chỉ, danh mục GHN, yêu thích (mục 2, 6)~~ — đã viết (đồng bộ GHN chưa thử với GHN thật)
3. ~~Mã giảm giá và khuyến mãi (mục 4)~~ — đã viết (phần áp mã trong checkout làm cùng mục 6)
4. ~~Checkout và đặt hàng, job hết hạn (mục 6)~~ — đã viết (còn các mục `[~]` phụ thuộc mục 7, 8, 9 và GHN thật)
5. SePay và VNPay (mục 7)
6. GHN, đóng gói, đối soát (mục 8)
7. Trả hàng, hoàn tiền, ngoại lệ (mục 9, 10)
8. Đánh giá, thông báo đầy đủ, báo cáo, quản trị tham số (mục 12–15)
9. Hóa đơn điện tử, giám sát, sao lưu, triển khai (mục 11, 16)

## Giả định đã dùng ở mục 5 (cần xác nhận với chủ cửa hàng)

1. **Phân quyền:** nhân viên kho và quản trị viên đều quản lý nhà cung cấp, phiếu nhập, phiếu đặt hàng, tồn kho; riêng phiếu điều chỉnh giá nhập chỉ ADMIN.
2. **Giá vốn bình quân:** tính trên `qtyOnHand` (gồm cả hàng đang giữ cho đơn, chưa tính hàng chờ kiểm). Ấn bản đang có giá vốn 0 được coi là "chưa có giá vốn" nên lấy luôn giá nhập đầu tiên.
3. **Điều chỉnh giá nhập:** chênh lệch chỉ tính trên phần của lô đó còn trong kho (tối đa số lượng lô, tối đa tồn hiện tại), chia đều cho tồn hiện tại; hết tồn thì giá vốn giữ nguyên.
4. **Tồn tối thiểu** = doanh số bình quân/ngày (theo `SALES_AVG_DAYS`) x thời gian giao của nhà cung cấp + `SAFETY_STOCK_DEFAULT`. **Số lượng đặt lại** = lớn nhất của (tồn tối thiểu, nhu cầu `SALES_AVG_DAYS` ngày), tối thiểu 1. **Nhà cung cấp mặc định** = nhà cung cấp của phiếu nhập đã xác nhận gần nhất còn hợp tác. Thiếu thời gian giao thì dùng 7 ngày.
5. Nhận hàng vượt số đặt trên phiếu đặt hàng vẫn được (không chặn); phiếu đặt chuyển `RECEIVED` khi mọi dòng đã nhận đủ.
6. Job kho chạy mỗi giờ trong cùng tiến trình API; nếu chạy nhiều instance, phiếu đặt hàng tự động đã có kiểm tra lại trong transaction nhưng nên tách job ra một worker riêng.

## Giả định đã dùng ở mục 4 (cần xác nhận với chủ cửa hàng)

1. **Phân quyền:** chỉ ADMIN quản lý chiến dịch khuyến mãi và mã giảm giá (SRS chưa nêu nhân viên có được không).
2. **Giá khuyến mãi:** phần trăm làm tròn tới đồng gần nhất; giảm cố định phải là số nguyên đồng; phần trăm phải < 100. Chiến dịch theo thể loại tính thể loại được chọn và các thể loại con trực tiếp (một cấp, giống bộ lọc sách).
3. **Giá KM nhập tay** (qua `PATCH /api/admin/editions/:id`) khác với giá do chiến dịch: job không bao giờ gỡ giá nhập tay; chiến dịch chỉ thay nó khi cho giá thấp hơn (khi chiến dịch kết thúc, ấn bản về giá niêm yết chứ không về giá nhập tay cũ). Admin nhập giá tay hoặc đặt `salePrice = null` trong lúc chiến dịch đang chạy thì job sẽ áp lại giá chiến dịch (muốn dừng hẳn thì tạm dừng chiến dịch).
4. **Đổi giá niêm yết khi đang KM:** giá KM của ấn bản đó bị gỡ rồi job tính lại theo giá mới trong vòng một phút.
5. **Mã giảm giá:** "giá trị tối thiểu" so với tiền hàng *đủ điều kiện* (sau khi loại sách đang KM và lọc theo thể loại), không phải cả giỏ. Số tiền giảm làm tròn xuống đồng; không vượt tiền hàng đủ điều kiện; mỗi đơn một mã. Mã nhập không phân biệt hoa thường và không đổi được sau khi tạo.
6. **Sách đang KM** để loại trừ khỏi mã = đơn giá đang bán thấp hơn giá niêm yết.
7. `POST /api/discount-codes/validate` giới hạn 20 lần/phút/IP để chống dò mã.

## Giả định đã dùng ở mục 12 (cần xác nhận với chủ cửa hàng)

1. **Điều kiện đánh giá:** đơn `COMPLETED` có `deliveredAt`, chứa ấn bản đó, lấy đơn giao gần nhất; quá `REVIEW_WINDOW_DAYS` => 422 `REVIEW_WINDOW_EXPIRED`. Chỉ khách hàng (không phải nhân viên) đánh giá.
2. **Lọc nội dung:** liên kết (`http(s)://`, `www.`, tên miền phổ biến) và danh sách từ cấm ngắn nằm trong `review/review.filter.js` (đối chiếu theo từ nguyên vẹn, có dấu) — cần chủ cửa hàng bổ sung danh sách. HTML bị loại sẵn bởi `sanitize`.
3. **Sửa đánh giá** không đổi trạng thái hiển thị; đánh giá bị ẩn (AUTO/ADMIN) vẫn sửa/xóa được nhưng không hiện công khai. Admin bấm "hiện lại" thì xóa các báo cáo cũ để không bị tự ẩn lại ngay.
4. **Tên người đánh giá** công khai rút gọn dạng "Nguyễn A.".
5. Đã dùng chung ấn bản: đánh giá theo `editionId` (mỗi ấn bản một lần); điểm trên trang sách tính gộp mọi ấn bản của tác phẩm.

## Giả định đã dùng ở mục 6 (cần xác nhận với chủ cửa hàng)

1. **Trạng thái sau khi đặt:** COD => `CONFIRMED` ngay (để mục 8 tạo vận đơn). SePay/VNPay => `PENDING_PAYMENT`, hạn `PAYMENT_TIMEOUT_MINUTES` (30 phút), chuyển khoản SePay có thêm `SEPAY_GRACE_MINUTES`. Hàng được giữ ngay khi tạo đơn (cả đơn chờ thanh toán).
2. **Giỏ phải "sạch" mới đặt được:** còn dòng hết hàng / ngừng bán / vượt tồn thì `409 CART_NOT_PURCHASABLE` kèm danh sách dòng lỗi; khách xóa/sửa dòng đó rồi báo giá lại (không tự bỏ dòng lỗi). Đặt hàng luôn lấy **toàn bộ** giỏ.
3. **Phí GHN:** kiện hàng = tổng khối lượng sách + `DEFAULT_PACKAGING_WEIGHT_GRAM`; dài/rộng = lớn nhất, cao = tổng chiều dày; ấn bản thiếu kích thước dùng 24 x 16 x 2 cm; `insurance_value` = tiền hàng (tối đa 5.000.000). Phí ship tính cho khách chốt ở lúc đặt; phí thực tế GHN đối soát ở mục 8. Miễn phí vẫn gọi GHN để biết có giao được không.
4. **GHN hỗ trợ COD:** chưa có API kiểm tra theo khu vực, tạm coi mọi địa chỉ GHN giao được đều hỗ trợ COD. Cần chốt với GHN.
5. **"Hoàn về do không nhận hàng" (tắt COD):** đếm đơn COD ở trạng thái `RETURNED_TO_WAREHOUSE` trong `COD_DISABLE_WINDOW_DAYS` ngày, mốc thời gian là `COALESCE(completedAt, createdAt)`; `completedAt` được ghi lúc kho xác nhận hàng về (`confirmReturnedToWarehouse`) nên thực tế đã là mốc hoàn về (cập nhật 2026-11-04, trước đó ghi tạm `createdAt`).
6. **Hủy đơn:** cho phép ở `PENDING_PAYMENT`, `CONFIRMED`, `PACKING` khi vận đơn (nếu có) chưa được GHN lấy; nhân viên và quản trị viên hủy được cùng điều kiện nhưng bắt buộc nêu lý do. Đơn đã thanh toán => `paymentStatus = REFUND_PENDING` (chưa tạo `Refund`). Hủy đơn chờ thanh toán không đổi `paymentStatus` (vẫn `UNPAID`); giao dịch đến muộn sẽ do mục 7 xử lý.
7. **`Idempotency-Key`** bắt buộc (8–64 ký tự `A-Za-z0-9._-`), phạm vi theo khách. Gửi lại cùng khóa trả về đơn đã tạo (200, `replayed: true`) và **không so sánh nội dung** yêu cầu; client nên sinh khóa mới cho mỗi lần khách bấm đặt hàng mới.
8. **Thứ tự danh sách đơn** theo `createdAt` giảm dần; `createdAt` chỉ chính xác đến giây nên hai đơn cùng giây có thứ tự bất kỳ.
9. **Phiếu đóng gói** chỉ có cho đơn đã xác nhận (`CONFIRMED`/`PACKING`/`COMPLETED`); tiền thu hộ = tổng đơn nếu COD, 0 nếu thanh toán trực tuyến.
10. **Email:** chỉ có mẫu xác nhận đặt hàng, hủy và hết hạn; các mẫu còn lại ở mục 13.

## Lỗi đã sửa trong lúc làm mục 6

- **Đăng ký đồng thời có thể trả 500 (deadlock):** `createAuthToken` chạy `UPDATE AuthToken ... WHERE accountId=? AND tokenType=?` ngay cả với tài khoản mới (không có dòng nào khớp) nên khóa "khoảng trống" của index; hai lượt đăng ký song song cùng khóa rồi cùng `INSERT` => `ER_LOCK_DEADLOCK`. Đã bỏ bước thu hồi token cho tài khoản vừa tạo (`{ fresh: true }`); 600 lượt đăng ký song song không còn lỗi. Trường hợp còn lại ở `resend-verification` / `forgot-password` đã sửa (2026-10-30): `createAuthToken` chọn token cũ rồi thu hồi theo khóa chính, không còn khóa khoảng trống. Đã chạy lại `npm test` (xem bên dưới).


## Giả định đã dùng ở mục 7–9, 14–15 (cần xác nhận)

1. **Cổng thanh toán:** chọn SePay; VNPay chuyển sang backlog. Đơn thanh toán SePay chỉ thành `CONFIRMED` khi số tiền đúng hoặc dư (phần dư hoàn lại); thiếu tiền thì hoàn toàn bộ và đơn vẫn chờ.
2. **Hoàn tiền khi hoàn về kho:** hoàn toàn bộ số tiền đã thanh toán (gồm phí ship). Chưa rõ SRS có trừ phí ship hoàn không.
3. **Nhận diện hàng bàn giao:** coi `picked`/`storing`/`delivering`... là GHN đã lấy hàng; `picking` chưa tính.
4. **Webhook GHN** xác thực bằng token riêng (`?token=` hoặc header `x-webhook-token`); GHN không ký payload. Webhook SePay xác thực bằng `Authorization: Apikey`.
5. **Doanh thu báo cáo** không gồm phí vận chuyển; báo cáo chỉ ADMIN xem.
6. **Phân quyền quản trị:** mọi API `/api/admin/*` mới chỉ ADMIN; nhân viên kho dùng được đóng gói, xác nhận hoàn về, hủy đơn, kho.

## Đối chiếu tài liệu GHN / SePay (2026-10-30, từ developer.ghn.vn và developer.sepay.vn)

Đã sửa theo tài liệu hiện hành (chưa chạy với GHN/SePay thật; `npm test` qua):
- `ShopId` giờ gửi mặc định ở mọi lời gọi GHN (danh mục địa giới cũng yêu cầu).
- `shipping-order/detail` và `detail-by-client-code` là **GET** với query (`order_code`, `client_order_code`), không phải POST body.
- Danh mục `master-data/district|ward` dùng GET + query; hủy vận đơn thêm `reason_code` (bắt buộc), và `result:false` trong phản hồi bị coi là GHN từ chối (409).
- Tạo vận đơn gửi thêm `to_ward_name/to_district_name/to_province_name` + `is_new_to_address:false` (tài liệu mô tả địa chỉ theo tên).
- SePay: ưu tiên trường `code`, rồi `content` để tìm mã đơn; hỗ trợ HMAC-SHA256 (`SEPAY_WEBHOOK_SECRET`, header `X-SePay-Signature`/`X-SePay-Timestamp`), không đặt thì dùng API key như cũ. Phản hồi webhook `{"success": true}` đã đúng.
- Phí `shipping-order/fee` (`data.total`, `to_district_id`, `to_ward_code`, `service_type_id`) khớp tài liệu.

Còn lại cần quyết định / thử thật (quyết định ngày 2026-10-30 ghi ở mỗi mục):
1. **[Quyết định: giữ 3 cấp cho luận văn, ghi vào "Giới hạn và hướng phát triển"]** **Mô hình địa chỉ 2 cấp** (từ 01/07/2025: 34 tỉnh, bỏ quận). Code vẫn dùng danh mục cũ 3 cấp (GHN còn giữ "legacy"); GHN khuyến nghị tích hợp mới dùng tên + `is_new_to_address:true` và API `v3/master-data/province/all`, `ward/all-by-province-id`. Chuyển đổi cần đổi schema `GhnDistrict`/`Address.district` và API phí (hiện vẫn cần `to_district_id`).
2. **[Quyết định: `scrap` đã ánh xạ thành LOST; `exception` cố ý bỏ qua vì GHN còn tiếp tục xử lý, không đổi trạng thái đơn. Webhook vẫn ghi `IntegrationLog` nên truy vết được]**
3. Webhook GHN không có xác thực/chữ ký theo tài liệu; token trong URL vẫn là cách duy nhất.
4. SePay: cấu hình tiền tố mã thanh toán `DH` trong trang SePay để trường `code` được điền.

## Kết quả chạy test (2026-10-30, MySQL 8.0.46)

Lúc đó **118 test qua** (chạy 3 lần liên tiếp); hiện **130 test qua** (2026-10-30, chạy `npm run test:fresh` + `npm run check` sạch). Lỗi tìm thấy và đã sửa khi chạy:
- **Deadlock khi nhiều khách cùng thêm vào giỏ** (`INSERT ... ON DUPLICATE KEY UPDATE` trên `CartItem`, khóa khoảng trống của index): làm test "giữ hàng đồng thời" thỉnh thoảng trả 500. `withTx` giờ tự chạy lại tối đa 3 lần khi gặp `ER_LOCK_DEADLOCK`.
- IPN VNPay trùng `providerTxnId` trả `99` thay vì `02`: đã bắt `ER_DUP_ENTRY`.

**Ghi chú (2026-10-30):** test từng gửi email thật khi `.env` có SMTP (địa chỉ `@example.com` bị Gmail trả thư). Đã chặn: `test/env.js` xóa `SMTP_*` và `mailer.js` không tạo transporter khi `NODE_ENV=test`.
**Ghi chú 2:** test đọc `.env` qua `config.js`; `test/helpers.js` giờ xóa `sepay.webhookSecret` khi chạy test (trước đó điền `SEPAY_WEBHOOK_SECRET` vào `.env` làm 11 test webhook SePay bị 401). Đã thử với `.env` điền đủ khóa: 130/130 qua.
**Ghi chú 3:** `test/vnpay-refund.test.js` dùng mã giao dịch ngẫu nhiên (trước đó tăng dần từ 14.000.001 nên IPN trả `02` khi chạy `npm test` lần hai trên DB chưa reset). Đã chạy `npm test` ba lần liên tiếp không reset: 130/130.
**Ghi chú 4:** thêm `FE/demo/` (trang test tĩnh, phục vụ ở `/demo`, gắn trong `app.js` trước `helmet` để hiện ảnh QR SePay; chỉ bật khi dev hoặc `DOCS_ENABLED=1`). Đã kiểm: `/demo/` trả 200, các API trang gọi trả đúng tên trường (sách, giỏ, địa chỉ, `/auth/me`); **chưa chạy được bước báo giá/đặt hàng vì cần GHN thật**, và chưa thử trên trình duyệt thật. 130 test vẫn qua.
**Ghi chú 5:** test từng chèn "Tỉnh Test" vào chính DB đang dùng (danh sách tỉnh trong form địa chỉ chỉ toàn dữ liệu giả). Đã tách: `test/env.js` đặt `DB_NAME=bookstore_test` (hoặc `TEST_DB_NAME`), `db:init --test` dựng DB đó, `db-init.js` thay tên DB ghi cứng trong `01_schema.sql`, và `04`/`06` dùng `DATABASE()` thay `'bookstore'`. Đã kiểm: 130/130 trên `bookstore_test`, DB `bookstore` sau test vẫn 0 tỉnh, 12 sách. DB cũ đã bị chèn dữ liệu giả cần `npm run db:init` + `npm run seed-demo` lại, hoặc đồng bộ GHN thật (sync đánh dấu mọi dòng không có trên GHN là không hoạt động).
**Ghi chú 6:** `db:init` tự chạy `seed-demo` (trừ `--test`, `--no-demo`, `NODE_ENV=production`); `server.js` tự đồng bộ danh mục GHN lần đầu khi bảng rỗng và có `GHN_TOKEN` (nền, lỗi chỉ ghi log). Đã kiểm: 4 chế độ `db:init`, server có/không token (token giả: kích hoạt sync, báo lỗi mạng, API vẫn 200), 130/130 test. **Chưa kiểm với GHN thật** (sandbox không ra internet).
**Ghi chú 7:** trang demo: đặt đơn SePay hiện QR ngay, đặt đơn VNPay tự chuyển sang trang VNPay (nút "thanh toán lại" chỉ còn khi quay lại đơn chưa trả). `vnpay.service.js`: `vnp_IpAddr` chuẩn hóa IPv6 → IPv4 (`::1`, `::ffff:x` → IPv4) cho cả tạo link và hoàn tiền; thêm kiểm tra vào `vnpay.test.js`. 130/130 test. Khi thử cục bộ phải đặt `VNPAY_RETURN_URL=http://localhost:3000/demo/` (mặc định trỏ `APP_URL/payment/vnpay-return` = cổng 5173, không có trang nào ở đó).

## Rà soát và hoàn thiện 2026-11-04

Phạm vi rà soát: các file đổi ngày 2–3/11 (`order/*`, `shipment/*`, `payment/*`, `discount`, `inventory/*`, `jobs`, `app.js`, Facebook).

**Kết quả test:** dựng MySQL 8.0.46 từ `db/01–06`; mốc ban đầu **136 test, 130 qua, 6 lỗi** (cả 6 là `test/facebook.test.js`). Sau khi sửa: `npm run test:fresh` **142/142 qua**, chạy lặp lại `npm test` không reset DB cũng **142/142**, `npm run check` sạch. Chưa thử với GHN/SePay/VNPay/Facebook thật (không có internet trong môi trường kiểm thử).

**Lỗi tìm thấy và đã sửa:**
1. **Đăng ký bằng Facebook không chạy được trên DB đúng schema:** `ck_account_cred` yêu cầu `passwordHash` hoặc `googleId`. Đã thêm `db/07_facebook_login.sql` và cập nhật `scripts/add-facebook-column.js` (thêm cột + nới ràng buộc, chạy lặp lại được; đã kiểm trên DB cũ 01–06).
2. **`test/facebook.test.js` gọi mạng thật:** `setup()` ghi đè `globalThis.fetch` sau khi test đã cài bản giả Facebook => 4/6 test báo `FACEBOOK_UNAVAILABLE`. Đã đổi thứ tự (gọi `setup()` trước rồi mới bọc bản giả Facebook).
3. **GHN hủy vận đơn từ phía GHN khi đơn còn xử lý** (trước đây đơn kẹt `CONFIRMED`, vận đơn `CANCELLED`, không ai biết): nay ghi `ExceptionItem GHN_CANCELLED` (cần `db/08_exception_ghn_cancelled.sql`), ghi lịch sử thao tác và email cho mọi nhân viên/admin đang hoạt động; đơn vẫn hủy được bằng API hủy. **Không tự tạo lại vận đơn** vì chưa biết GHN có cho trùng `client_order_code` không (lần thử lại còn tra theo mã đơn nên sẽ trả về chính vận đơn đã hủy) — cần thử với GHN thật trước khi làm. Hủy bằng API của ta rồi GHN gửi webhook hủy: không tạo ngoại lệ (có test).
4. **Đồng bộ GHN** (`syncShipments`) dùng thời điểm GHN ghi nhận (`log`/`updated_date`, `ghnEventTime`) thay cho giờ máy chủ, tránh bỏ nhầm webhook đến sau khi lệch đồng hồ. Tên trường `log`/`updated_date` theo tài liệu GHN, **chưa kiểm với GHN thật**; thiếu thì dùng giờ hiện tại như cũ.
5. **Email tóm tắt tồn kho** chống trùng theo ngày giờ Việt Nam (`ymdVN`) thay vì ngày UTC.
6. **Cảnh báo lúc khởi động** khi có `GHN_TOKEN` mà thiếu `GHN_SHOP_ID` (`server.js`).
7. **`IntegrationLog` cho `QueryDR` của VNPay** (IPN và hoàn tiền đã có từ trước).
8. **Giới hạn riêng từng tham số hệ thống** (xem mục 15).

**Đính chính:** bản rà soát trước của tôi nói `docker-compose.yml` sai đường dẫn — **không đúng**: file đó vốn nằm cùng thư mục với các file `.sql` trong `db/` (nên `./01_schema.sql` là đúng). Bản `docker-compose.yml` kèm theo chỉ thêm hai dòng gắn `07` và `08`; nhớ đặt nó trong `db/`.

**Còn lại (không làm được/không nên làm ở đây):**
- Thử GHN thật (phí, tạo/hủy/tra cứu vận đơn, danh mục địa giới, `log`/`updated_date`, tạo lại vận đơn sau khi bị hủy), SePay thật, sandbox VNPay (chữ ký phản hồi hoàn tiền), Facebook thật — **việc duy nhất còn chặn Mốc 1**.
- Kiểm tra "GHN hỗ trợ COD" theo khu vực (cần API/quy tắc từ GHN).
- Các mẫu email còn thiếu đều phụ thuộc `BACKLOG.md` (trả hàng, đổi email, ngoại lệ có API xử lý).
- Trả hàng, hóa đơn điện tử, API xử lý ngoại lệ: giữ ở `BACKLOG.md` (theo kế hoạch: dừng thêm tính năng từ tuần 6).
- Mô hình địa chỉ 3 cấp (quyết định giữ cho luận văn, ghi vào "Giới hạn và hướng phát triển").
