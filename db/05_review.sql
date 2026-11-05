USE bookstore;

INSERT INTO SystemParameter (paramKey, paramValue, description) VALUES
('REVIEW_WINDOW_DAYS','90','Được đánh giá trong vòng (ngày) kể từ khi giao hàng'),
('REVIEW_REPORT_HIDE_COUNT','3','Số tài khoản khác nhau báo cáo để tự ẩn đánh giá')
ON DUPLICATE KEY UPDATE paramValue = VALUES(paramValue);
