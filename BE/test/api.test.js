// Kiểm thử tích hợp: cần MySQL đã nạp db/01_schema.sql + 02_seed.sql (cấu hình qua biến môi trường DB_*).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { processOutbox } from '../src/services/mailer.js';

const rnd = Math.random().toString(36).slice(2, 8);
const customerEmail = `kh_${rnd}@example.com`;
const adminEmail = `admin_${rnd}@example.com`;
const PASS = 'Matkhau123';
let server, base, editionId, workId, customerToken, adminToken;

async function api(method, path, { body, token, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: setCookie?.split(';')[0] };
}
const tokenFromEmail = async (to, kind) => {
  await processOutbox();
  const [m] = await query(`SELECT body FROM EmailOutbox WHERE toEmail=? AND body LIKE ? ORDER BY createdAt DESC LIMIT 1`, [to, `%${kind}%`]);
  return m.body.match(/token=([a-f0-9]{64})/)[1];
};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: adminEmail, password: 'Admin12345', fullName: 'Admin Test' });
});
after(async () => {
  server.close();
  await pool.end();
});

test('đăng ký: yêu cầu đồng ý điều khoản, email trùng (không phân biệt hoa thường) bị từ chối', async () => {
  let r = await api('POST', '/api/auth/register', { body: { email: customerEmail, password: PASS, fullName: 'Nguyễn Văn A' } });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/auth/register', { body: { email: customerEmail, password: PASS, fullName: 'Nguyễn Văn A', acceptTerms: true } });
  assert.equal(r.status, 201);
  r = await api('POST', '/api/auth/register', { body: { email: customerEmail.toUpperCase(), password: PASS, fullName: 'B', acceptTerms: true } });
  assert.equal(r.status, 409);
});

test('chưa xác thực email thì không đăng nhập được; xác thực xong đăng nhập được; link chỉ dùng một lần', async () => {
  let r = await api('POST', '/api/auth/login', { body: { email: customerEmail, password: PASS } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'EMAIL_NOT_VERIFIED');
  const token = await tokenFromEmail(customerEmail, 'verify-email');
  assert.equal((await api('POST', '/api/auth/verify-email', { body: { token } })).status, 200);
  assert.equal((await api('POST', '/api/auth/verify-email', { body: { token } })).status, 400);
  r = await api('POST', '/api/auth/login', { body: { email: customerEmail, password: PASS } });
  assert.equal(r.status, 200);
  customerToken = r.data.token;
  assert.equal((await api('GET', '/api/auth/me', { token: customerToken })).data.profile.fullName, 'Nguyễn Văn A');
});

test('quản trị viên tạo ấn bản; khách không có quyền; ISBN sai/trùng bị chặn', async () => {
  const adm = await api('POST', '/api/auth/login', { body: { email: adminEmail, password: 'Admin12345' } });
  adminToken = adm.data.token;
  // ISBN-13 hợp lệ ngẫu nhiên mỗi lần chạy
  const d12 = '978604' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +d12[i] * (i % 2 ? 3 : 1);
  const isbn = d12 + ((10 - (sum % 10)) % 10);
  const badIsbn = d12 + ((((10 - (sum % 10)) % 10) + 1) % 10);
  const body = {
    isbn,
    title: 'Đắc Nhân Tâm',
    authors: ['Dale Carnegie'],
    categories: ['Kỹ năng sống'],
    publisher: 'NXB Tổng hợp',
    format: 'Bìa mềm',
    listPrice: 86000,
    weightGram: 300,
  };
  assert.equal((await api('POST', '/api/admin/editions', { body, token: customerToken })).status, 403);
  assert.equal((await api('POST', '/api/admin/editions', { body: { ...body, isbn: badIsbn }, token: adminToken })).status, 422);
  const ok = await api('POST', '/api/admin/editions', { body, token: adminToken });
  assert.equal(ok.status, 201);
  ({ editionId, workId } = ok.data);
  assert.equal((await api('POST', '/api/admin/editions', { body, token: adminToken })).status, 409);
  await query('UPDATE Inventory SET qtyOnHand=5 WHERE editionId=?', [editionId]); // tạm: sau này nhập qua phiếu nhập kho
});

test('tìm kiếm không dấu/không phân biệt hoa thường, lọc giá, chi tiết sách', async () => {
  let r = await api('GET', '/api/books?q=dac%20nhan%20tam');
  assert.equal(r.status, 200);
  assert.ok(r.data.items.some((i) => i.workId === workId && i.inStock));
  assert.ok((await api('GET', '/api/books?q=CARNEGIE')).data.items.some((i) => i.workId === workId));
  assert.equal((await api('GET', '/api/books?minPrice=500000&maxPrice=1000')).status, 400);
  assert.equal((await api('GET', '/api/books?minPrice=-5')).status, 400);
  r = await api('GET', '/api/books?q=khongtontaixyz');
  assert.equal(r.data.total, 0);
  assert.ok(Array.isArray(r.data.suggestions));
  r = await api('GET', `/api/books/${workId}`);
  assert.equal(r.data.editions[0].canBuy, true);
});

test('giỏ hàng khách vãng lai: cộng dồn, giới hạn 10 và tồn khả dụng; gộp vào tài khoản khi đăng nhập', async () => {
  let r = await api('POST', '/api/cart/items', { body: { editionId, quantity: 3 } });
  assert.equal(r.status, 201);
  const cookie = r.cookie;
  assert.ok(cookie);
  r = await api('POST', '/api/cart/items', { body: { editionId, quantity: 1 }, cookie });
  assert.equal(r.data.items[0].quantity, 4);
  r = await api('POST', '/api/cart/items', { body: { editionId, quantity: 2 }, cookie }); // 6 > tồn 5
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'INSUFFICIENT_STOCK');

  const login = await api('POST', '/api/auth/login', { body: { email: customerEmail, password: PASS }, cookie });
  const cart = await api('GET', '/api/cart', { token: login.data.token });
  assert.equal(cart.data.items[0].quantity, 4);
  assert.equal(cart.data.subtotal, 86000 * 4);
  assert.equal((await api('GET', '/api/cart', { cookie })).data.items.length, 0); // giỏ khách đã gộp
});

test('giỏ hàng báo đổi giá; sách ngừng bán bị đánh dấu không mua được', async () => {
  let r = await api('PATCH', `/api/admin/editions/${editionId}`, { body: { listPrice: 90000, reason: 'Tăng giá' }, token: adminToken });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/cart', { token: customerToken });
  assert.equal(r.data.items[0].issues[0].code, 'PRICE_CHANGED');
  await api('PATCH', `/api/admin/editions/${editionId}`, { body: { businessStatus: 'HIDDEN', reason: 'Đang chỉnh sửa' }, token: adminToken });
  r = await api('GET', '/api/cart', { token: customerToken });
  assert.equal(r.data.items[0].purchasable, false);
  assert.equal((await api('GET', `/api/books/${workId}`)).status, 404); // ấn bản Ẩn không truy cập được
  const logs = await query(`SELECT COUNT(*) c FROM AuditLog WHERE entityType='EDITION' AND entityId=?`, [editionId]);
  assert.equal(logs[0].c, 3);
});

test('đăng nhập sai 5 lần thì khóa tạm; quên/đặt lại mật khẩu hủy mọi phiên', async () => {
  const victim = `sai_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email: victim, password: PASS, fullName: 'C', acceptTerms: true } });
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/auth/login', { body: { email: victim, password: 'saimatkhau1' } })).status, 401);
  const locked = await api('POST', '/api/auth/login', { body: { email: victim, password: PASS } });
  assert.equal(locked.status, 429);

  assert.equal((await api('POST', '/api/auth/forgot-password', { body: { email: customerEmail } })).status, 200);
  assert.equal((await api('POST', '/api/auth/forgot-password', { body: { email: 'khongco@example.com' } })).status, 200); // không lộ email
  const token = await tokenFromEmail(customerEmail, 'reset-password');
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { token, password: 'MatKhauMoi99' } })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: customerToken })).status, 401); // phiên cũ mất hiệu lực
  assert.equal((await api('POST', '/api/auth/login', { body: { email: customerEmail, password: 'MatKhauMoi99' } })).status, 200);
});

test('đổi mật khẩu: sai mật khẩu hiện tại / trùng mật khẩu cũ bị từ chối; thành công hủy mọi phiên', async () => {
  const cur = 'MatKhauMoi99',
    next = 'MatKhauMoi100';
  const login = (password) => api('POST', '/api/auth/login', { body: { email: customerEmail, password } });
  const { token } = (await login(cur)).data;
  const change = (body) => api('POST', '/api/auth/change-password', { token, body });
  assert.equal((await change({ currentPassword: 'saimatkhau1', newPassword: next })).data.error.code, 'WRONG_PASSWORD');
  assert.equal((await change({ currentPassword: cur, newPassword: cur })).data.error.code, 'SAME_PASSWORD');
  assert.equal((await change({ currentPassword: cur, newPassword: 'ngan' })).status, 400);
  assert.equal((await api('POST', '/api/auth/change-password', { body: { currentPassword: cur, newPassword: next } })).status, 401);
  assert.equal((await change({ currentPassword: cur, newPassword: next })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
  assert.equal((await login(cur)).status, 401);
  assert.equal((await login(next)).status, 200);
});
