process.env.NODE_ENV = 'test';
// Test luôn chạy trên DB riêng (dotenv không ghi đè biến đã đặt) để không làm bẩn DB đang dùng thật
process.env.DB_NAME = process.env.TEST_DB_NAME || 'bookstore_test';
// Test không bao giờ gửi email thật dù .env có cấu hình SMTP (dotenv không ghi đè biến đã có, kể cả rỗng)
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
