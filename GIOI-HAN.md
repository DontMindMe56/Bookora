# Giới hạn và hướng phát triển (bản nháp cho báo cáo)

Nguồn: `BACKLOG.md` (việc hoãn), các mục "Giả định" và "Hạn chế đã biết" trong `TODO.md`. Cập nhật 2026-10-30.

## 1. Phạm vi đã hoàn thành

Luồng chính **đặt hàng → thanh toán (SePay hoặc VNPay) → tạo vận đơn GHN → bàn giao/xuất kho → giao xong → đánh giá**, cùng các nhánh: hủy đơn, hết hạn thanh toán, giao thất bại/hoàn về kho, thất lạc/hư hỏng, hoàn tiền (thủ công và qua API VNPay). Kèm quản trị (khách, nhân viên, danh mục, bìa, tham số, lịch sử thao tác), kho/giá vốn bình quân, khuyến mãi/mã giảm giá, báo cáo cơ bản, Swagger. Có 130 test tích hợp chạy trên MySQL 8.0, trong đó có kịch bản demo đầu-cuối (`test/e2e.test.js`).

## 2. Giới hạn kỹ thuật cần nêu trung thực

| # | Giới hạn | Tác động | Hướng xử lý |
|---|---|---|---|
| 1 | **GHN, SePay, VNPay chưa chạy với dịch vụ thật.** Toàn bộ test dùng máy chủ giả lập theo tài liệu hiện hành (đã đối chiếu 2026-10-30). | Tên trường/endpoint thực tế có thể lệch; đặc biệt cách VNPay ký phản hồi hoàn tiền (xem TODO mục 7) | Chạy thử sandbox (VNPay), môi trường staging (GHN), giao dịch thật nhỏ (SePay) trước khi dùng |
| 2 | **Địa chỉ 3 cấp (tỉnh/quận/phường)**, trong khi từ 01/07/2025 Việt Nam còn 2 cấp. GHN còn giữ danh mục cũ. | Có thể ngừng hoạt động nếu GHN bỏ danh mục cũ | Đổi `GhnDistrict`/`Address.district`, dùng API `v3/master-data` và `is_new_to_address:true` |
| 3 | **Webhook GHN chỉ xác thực bằng token trong URL** (GHN không ký payload). | Lộ URL là lộ khả năng giả webhook | Giới hạn IP nguồn ở reverse proxy; xoay token định kỳ |
| 4 | **Tìm kiếm dùng `LIKE '%…%'`** với collation `ai_ci`: `ơ`≈`o` nên `thơ` khớp cả `thời`; chậm khi dữ liệu lớn. | Kết quả dư ở một số từ; hiệu năng | Dùng cột `Work.searchText` + FULLTEXT (đã chuẩn bị), hoặc công cụ tìm kiếm riêng |
| 5 | **Công việc nền chạy cùng tiến trình API** (khóa `GET_LOCK` giúp nhiều instance không giẫm nhau, nhưng tải job và API chung). | Khó mở rộng | Tách worker riêng |
| 6 | **Chưa có migration**: `01_schema.sql` chạy `DROP DATABASE`, chỉ dựng DB từ đầu. | Không nâng cấp DB đang chạy | Dùng công cụ migration (vd. Knex/Flyway) |
| 7 | **Chưa có giám sát, sao lưu, CI, Docker backend, log có cấu trúc**; rate limit mới áp cho vài nhóm API. | Chưa sẵn sàng production | Mục 16 của BACKLOG |
| 8 | Kiểm tra "GHN hỗ trợ COD theo khu vực" chưa có (coi mọi địa chỉ giao được đều hỗ trợ COD). | Có thể nhận đơn COD tại vùng GHN không thu hộ | Hỏi GHN API/danh sách vùng |
| 9 | `Idempotency-Key` không so sánh nội dung yêu cầu; `CartItem.priceAtAdd` chỉ cập nhật khi khách thao tác. | Cảnh báo đổi giá có thể hiện dai | Ghi nhận như hành vi đã biết |

## 3. Nghiệp vụ hoãn lại (BACKLOG)

- **Trả hàng đầy đủ** (yêu cầu kèm ảnh, tự duyệt theo hạn, vận đơn chiều trả, kiểm hàng trả, cờ rủi ro): đã chọn nhóm **đánh giá** thay cho trả hàng ở mốc tuần 4 vì máy trạng thái trả hàng/hoàn tiền quá nặng cho 7 tuần.
- **Hoàn tiền nâng cao**: Lệnh chi VietQR, duyệt theo ngưỡng/hai người, link nhập tài khoản nhận hoàn, số dư tài khoản, mã hóa số tài khoản; VNPay còn thiếu tra cứu kết quả và tự thử lại.
- **Danh sách ngoại lệ** (API/màn hình xử lý, email, hạn xử lý): hiện mới ghi 4 loại ngoại lệ vào bảng, chưa có giao diện xử lý.
- **Hóa đơn điện tử** (tắt mặc định, ngoài phạm vi).
- **Đối soát GHN** hằng ngày, hồ sơ bồi thường tự động, nhắc/tự hủy đơn chưa đóng gói sau 24/72 giờ.
- **Thanh toán**: tự ghép giao dịch SePay không có mã đơn, tạm ẩn cổng khi lỗi lúc chạy.
- **Tài khoản**: đổi email, xóa tài khoản và dữ liệu cá nhân.
- **Sách**: tra cứu ISBN ngoài, ước lượng trọng lượng, nhập danh mục từ Excel.
- **Thông báo/báo cáo**: trung tâm thông báo trong tài khoản, xử lý bounce, xuất Excel/PDF, báo cáo tự gửi.

## 4. Giả định cần chủ cửa hàng xác nhận

Các tham số SRS chưa nêu giá trị (trọng lượng bao bì, tồn an toàn, số ngày tính doanh số, ngưỡng cảnh báo, hạn lưu số tài khoản hoàn) dùng giá trị tạm trong `db/02_seed.sql`. Các quyết định nghiệp vụ tự đặt: chỉ ADMIN quản lý khuyến mãi/mã giảm giá; hoàn về kho hoàn toàn bộ tiền gồm phí ship; COD tắt khi có ≥ 2 đơn COD hoàn về trong 90 ngày; từ khóa cấm/lọc liên kết trong đánh giá. Chi tiết ở các mục "Giả định" của `TODO.md`.
