# Bookstore – Nhà sách trực tuyến

Luận văn: backend API cho nhà sách trực tuyến (đặt hàng, thanh toán SePay/VNPay, vận chuyển GHN, kho, khuyến mãi, quản trị) kèm giao diện mẫu.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `BE/` | Server Node.js + Express + MySQL: `src/`, `scripts/`, `test/`, `package.json`, `.env` |
| `FE/web/` | Giao diện React (Vite): đăng nhập, giỏ hàng, thanh toán. `cd FE/web && npm i && npm run dev` (cổng 5173, proxy `/api` về BE) |
| `FE/demo/` | Trang test API cho nhân viên/quản trị (`staff.html`) |
| `db/` | Schema và dữ liệu mẫu MySQL (`01` đến `08`) kèm `docker-compose.yml` |
| `TODO.md`, `BACKLOG.md`, `GIOI-HAN.md` | Tiến độ, việc hoãn lại, giới hạn đã biết |

Server `BE/` phục vụ `FE/demo` khi không chạy production (hoặc khi đặt `DOCS_ENABLED=1`). Giao diện khách chạy riêng ở `FE/web`.

## Chạy nhanh

```bash
# 1. MySQL (Docker)
cd db && docker compose up -d && cd ..

# 2. Server
cd BE
cp .env.example .env        # chỉnh DB_*, JWT_SECRET
npm install
npm run db:init             # tạo DB bookstore, nạp 01..08 và dữ liệu demo
npm run dev                 # http://localhost:3000
```

Địa chỉ xem thử:

- Cửa hàng (React): `http://localhost:5173/`
- Trang test nhân viên/quản trị: `http://localhost:3000/demo/staff.html`
- Tài liệu API (Swagger): `http://localhost:3000/api/docs`

Tài khoản demo (mật khẩu `Demo12345`): `admin@demo.vn`, `kho@demo.vn`, `khach1@demo.vn`.

Test: `cd BE && npm run test:fresh` (dựng DB `bookstore_test` rồi chạy toàn bộ test).

Chi tiết API, biến môi trường và cấu trúc code: xem `BE/README.md`.
