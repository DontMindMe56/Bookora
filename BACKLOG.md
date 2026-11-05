# Backlog — việc hoãn lại (ngoài phạm vi 7 tuần)

Các mục chuyển từ `TODO.md` ngày 2026-10-29. Nội dung giữ nguyên như bản gốc, nhóm theo mục SRS. Thiết kế dữ liệu (schema 45 bảng) vẫn có sẵn chỗ cho các mục này; chỉ chưa cài đặt luồng nghiệp vụ.

## 1. Tài khoản & phân quyền (2.1.1.1–2, 2.1.2.1, 2.1.2.3)

> Chuyển ngày 2026-10-29 — lý do: đổi email, xóa tài khoản, cờ rủi ro và lưu đồng ý chính sách là nghiệp vụ nhiều trường hợp biên, không nằm trên luồng demo chính.

- [ ] Đổi email (nhập mật khẩu, xác thực lại email mới, gửi thông báo tới email cũ)
- [ ] Xóa tài khoản và dữ liệu cá nhân (2.1.2.1.6): kiểm tra điều kiện, email xác nhận, ẩn danh hóa đơn/đánh giá, giải phóng email, hoàn số dư trước khi xóa
- [ ] Gắn cờ rủi ro `Customer.riskFlag` khi trả hàng >= 3 lần/90 ngày (làm cùng mục 9)
- [ ] Lưu thời điểm đồng ý chính sách dữ liệu cá nhân cho tài khoản Google

## 3. Sách, ấn bản, danh mục (2.1.2.4–2.1.2.5)

> Chuyển ngày 2026-10-29 — lý do: tra cứu ISBN, ước lượng trọng lượng, nhập Excel và cảnh báo giá vốn không chặn luồng bán hàng.

- [ ] Tra cứu ISBN từ nguồn dữ liệu ngoài để điền sẵn tên, tác giả, NXB, số trang, năm xuất bản
- [ ] Ước lượng trọng lượng và kích thước từ số trang và khổ sách
- [ ] Nhập danh mục hàng loạt từ Excel (xem trước, báo lỗi từng dòng, xuất dòng lỗi để sửa)
- [ ] Cảnh báo khi giá bán thấp hơn giá vốn bình quân khi tạo ấn bản (hiện chỉ cảnh báo khi sửa giá)

## 4. Khuyến mãi & mã giảm giá (2.1.2.4.5, 2.1.2.9)

> Chuyển ngày 2026-10-29 — lý do: phần còn lại phụ thuộc luồng trả hàng (mục 9).

- [ ] Luồng hoàn về / trả hàng (mục 8, 9) gọi `releaseDiscountCode` để trả lượt mã

## 5. Nhà cung cấp, nhập kho, tồn kho (2.1.1.15–16, 2.1.2.6–7, 2.1.2.14)

> Chuyển ngày 2026-10-29 — lý do: phần còn lại phụ thuộc hoàn tiền/trả hàng (mục 8, 9).

- [ ] Khi điều chỉnh làm tồn < số đã giữ: tự hủy các đơn đặt muộn nhất + hoàn tiền + gửi email (đã có `cancelOrder` và `restoreReservation`; còn phải viết phần chọn đơn đặt muộn nhất và hoàn tiền — mục 9)
- [ ] Đưa hàng vào `qtyPendingInspection` khi hoàn về / trả hàng (mục 8, 9)

## 6. Đặt hàng (2.1.1.3–4, 2.1.1.10, 2.1.2.13)

> Chuyển ngày 2026-10-29 — lý do: phụ thuộc cổng VNPay `QueryDR` (mục 7).

- [x] VNPay `QueryDR` trước khi hết hạn đơn thanh toán: đã làm

## 7. Thanh toán (2.1.1.5–6)

> Chuyển ngày 2026-10-29 — lý do: xử lý giao dịch muộn/thừa/thiếu và ẩn cổng khi lỗi tốn nhiều nghiệp vụ, làm một cổng đường chính trước.

- [ ] SePay: tự ghép giao dịch không có mã đơn khi chỉ có đúng một đơn khớp; không ghép được thì vào danh sách ngoại lệ
- [ ] SePay: giao dịch đến muộn / thừa / thiếu / trùng ghi vào "Chờ hoàn tiền" mà không đổi trạng thái đơn
- [ ] Tạm ẩn phương thức thanh toán khi cổng đang lỗi

## 8. Đóng gói, vận chuyển GHN, đối soát (2.1.1.7–9)

> Chuyển ngày 2026-10-29 — lý do: nhắc/tự hủy, hồ sơ bồi thường và đối soát GHN là nghiệp vụ vận hành nâng cao.

- [ ] Nhắc khi chưa đóng gói sau 24 giờ; tự hủy, hoàn kho, hoàn tiền sau 72 giờ
- [ ] Tự dựng và gửi hồ sơ bồi thường GHN khi mất/hư hàng
- [ ] Đối soát hằng ngày với GHN (tiền COD, phí vận chuyển thực tế); đơn lệch vào danh sách ngoại lệ

## 9. Trả hàng, hoàn tiền (2.1.1.11–14)

> Chuyển ngày 2026-10-29 — lý do: máy trạng thái hoàn tiền đầy đủ (duyệt theo ngưỡng, nhắc, gia hạn liên kết, số dư, mã hóa) quá nặng cho 7 tuần; chỉ làm bản rút gọn ở TODO.md.

- [ ] Tạo vận đơn GHN chiều trả, hạn gửi 7 ngày, trạng thái "Quá hạn gửi hàng"
- [~] Hoàn tiền VNPay qua API: **đã làm bản rút gọn** (`POST /api/admin/refunds/:id/vnpay`, trạng thái `PROCESSING_BANK`, lỗi vào ngoại lệ — xem TODO mục 7); còn lại: tra cứu kết quả khi không rõ thành công (`QueryDR` cho hoàn tiền) và tự thử lại 1/5/15 phút
- [ ] Hoàn tiền SePay/COD: Lệnh chi kèm VietQR, đối chiếu tên người nhận, nhân viên xác nhận "Đã chuyển" (tối đa 3 lần không khớp)
- [ ] Quy tắc duyệt: tự duyệt dưới ngưỡng, admin duyệt một chạm từ ngưỡng trở lên (khách gắn cờ rủi ro hoặc khoản không gắn hàng trả), nhắc sau 3 ngày, tự duyệt sau 14 ngày; người duyệt khác người xác nhận chuyển
- [ ] Link nhập tài khoản nhận hoàn (7 ngày, nhắc ngày 3 và 6, tự gia hạn 2 lần), quá 60 ngày thì cộng vào số dư tài khoản
- [ ] Số dư tài khoản khách: cộng/trừ, sổ ghi (hiện mới có cột `accountBalance`, chưa có bảng lịch sử số dư)
- [ ] Mã hóa số tài khoản nhận hoàn (AES), che khi hiển thị, xóa sau thời hạn lưu

## 10. Danh sách ngoại lệ (2.1.1.17)

> Chuyển ngày 2026-10-29 — lý do: danh sách ngoại lệ phụ thuộc đối soát và hoàn tiền đầy đủ.

- [ ] API và màn hình duy nhất cho 6 loại ngoại lệ, gắn tên người đang mở, ghi lý do xử lý, lịch sử
- [ ] Email báo mục mới cho nhân viên kho và admin; hạn xử lý 3 ngày; sau 30 ngày tự áp dụng xử lý mặc định

## 11. Hóa đơn điện tử (1.2, 2.1.1.8, 2.1.1.12)

> Chuyển ngày 2026-10-29 — lý do: hóa đơn điện tử đã tắt mặc định (`EINVOICE_ENABLED=false`) và ngoài phạm vi luận văn.

- [ ] Tích hợp nhà cung cấp hóa đơn điện tử, tự phát hành khi đơn Hoàn tất (bật/tắt bằng tham số `EINVOICE_ENABLED`)
- [ ] Tự lập hóa đơn điều chỉnh / hủy khi đơn chuyển "Đã trả hàng" hoặc hủy do thất lạc; thử lại khi lỗi, không làm hỏng đơn hay hoàn tiền

## 12. Đánh giá (2.1.2.10)

> Chuyển ngày 2026-10-29 — lý do: báo cáo/ẩn đánh giá là phần phụ so với tạo/sửa đánh giá.

- [x] Báo cáo đánh giá, tự ẩn khi có >= 3 tài khoản khác nhau báo cáo — đã làm (TODO mục 12)
- [x] Admin xem đánh giá bị ẩn, giữ ẩn hoặc khôi phục, ghi lịch sử — đã làm (TODO mục 12)

## 13. Thông báo (2.1.2.11)

> Chuyển ngày 2026-10-29 — lý do: trung tâm thông báo và xử lý bounce không chặn luồng demo.

- [ ] Trung tâm thông báo trong tài khoản (bảng `Notification` đã có, chưa có API), hiển thị cả khoản hoàn đang chờ nhập tài khoản
- [ ] Xử lý email bị trả về (bounce): đánh dấu và chỉ dùng thông báo trong tài khoản

## 14. Báo cáo & thống kê (2.1.2.12)

> Chuyển ngày 2026-10-29 — lý do: xuất file và báo cáo tự động là phần mở rộng.

- [ ] Xuất Excel / PDF; báo cáo tuần và tháng tự gửi email cho admin kèm cảnh báo bất thường
- [ ] Chỉ tiêu tỷ lệ đơn đi thẳng đến trạng thái cuối không cần can thiệp (mục 1.2.2)

## 16. Vận hành, giám sát, phi chức năng (2.1.1.17, 2.2)

> Chuyển ngày 2026-10-29 — lý do: vận hành/triển khai (giám sát, sao lưu, CI, migration, đo hiệu suất) để sau khi phần chức năng ổn định.

- [ ] Giám sát GHN, SePay, VNPay, nhà cung cấp hóa đơn mỗi 5 phút, cảnh báo email, tự tạm ẩn phương thức lỗi
- [ ] Sao lưu hằng ngày (giữ 30 ngày), kiểm thử khôi phục hằng quý
- [ ] Dockerfile cho backend, CI chạy test, cấu hình HTTPS/reverse proxy khi triển khai
- [ ] Log có cấu trúc, ID theo dõi yêu cầu
- [ ] Công cụ migration (hiện chỉ có script SQL dựng DB từ đầu)
- [ ] Đo hiệu suất theo chỉ tiêu (95% trang sách trong 3 giây, tạo đơn trong 5 giây, báo cáo trong 5 giây)
- [ ] Rate limit cho các nhóm API còn lại ngoài `/api/auth`


## 7b. VNPay và trả hàng `[P1]` (chuyển ngày 2026-10-30)

> Lý do: đã chọn SePay làm cổng thanh toán và chọn nhóm đánh giá thay cho trả hàng ở mốc tuần 4; tuần 6 dừng thêm tính năng.

- [x] VNPay: đã làm lại ngày 2026-10-30 (xem TODO mục 7). Còn lại: ẩn cổng khi VNPay gặp lỗi lúc chạy (hiện chỉ ẩn khi chưa cấu hình)
- [ ] Gửi yêu cầu trả hàng (lý do, 1–5 ảnh, tài khoản nhận hoàn), tự duyệt/tự từ chối theo hạn 7 ngày
- [ ] Nhận và kiểm hàng trả (quét ISBN, đánh dấu cuốn hư hỏng, hàng sai thì từ chối hoàn tiền và vào ngoại lệ)
