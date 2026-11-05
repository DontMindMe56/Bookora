// Kiểm thử tích hợp: mã giảm giá (CRUD, xem trước theo giỏ, trừ lượt an toàn khi đồng thời, trả lượt đúng một lần). Cần MySQL.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query, withTx } from '../src/db.js';
import { uuid, randomOrderCode } from '../src/utils/security.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { claimDiscountCode, recordDiscountUsage, releaseDiscountCode, computeDiscount, expireDiscountCodes } from '../src/modules/discount/discount.service.js';

const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
let server, base, adminToken, A, B, D1, D2, catX, catY;
const crowd = []; // khách dùng cho thử đồng thời

async function api(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function newCustomer(tag) {
  const email = `${tag}_${rnd}@example.com`.toLowerCase();
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: `Khách ${tag}`, acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  const token = (await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).data.token;
  const [{ customerId }] = await query('SELECT c.customerId FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE a.email = ?', [email]);
  return { token, customerId };
}
const isbn13 = () => {
  const d12 = '978608' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1);
  return d12 + ((10 - (s % 10)) % 10);
};
async function mkEdition(title, listPrice, category) {
  const r = await api('POST', '/api/admin/editions', {
    token: adminToken,
    body: {
      isbn: isbn13(),
      title: `${title} ${rnd}`,
      authors: ['TG'],
      categories: [category],
      publisher: `NXB MG ${rnd}`,
      format: 'Bìa mềm',
      listPrice,
      weightGram: 200,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await query('UPDATE Inventory SET qtyOnHand = 50 WHERE editionId = ?', [r.data.editionId]);
  return r.data.editionId;
}
const iso = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
let seq = 0;
const codeBody = (o = {}) => ({ code: `MG${rnd}${++seq}`, type: 'PERCENT', value: 10, startAt: iso(-1), endAt: iso(24), ...o });
async function mkCode(o) {
  const r = await api('POST', '/api/admin/discount-codes', { token: adminToken, body: codeBody(o) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const validate = (token, code) => api('POST', '/api/discount-codes/validate', { token, body: { code } });
const lines = (qty = 2) => [{ editionId: D1, quantity: qty, unitPrice: 100000, listPrice: 100000 }];

/** Mô phỏng bước "tạo đơn" của module đặt hàng: claim -> INSERT Orders -> record, trong một transaction. */
async function placeOrder(customerId, code, ls = lines()) {
  return withTx(async (conn) => {
    const c = await claimDiscountCode(conn, { code, customerId, lines: ls });
    const orderId = uuid();
    const subtotal = ls.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    await query(
      `INSERT INTO Orders (orderId, orderCode, customerId, orderStatus, subtotal, discountAmount, shippingFee, totalAmount, paymentMethod, discountCodeId, shippingAddressSnapshot)
       VALUES (?,?,?, 'PENDING_PAYMENT', ?,?,0,?, 'COD', ?, '{}')`,
      [orderId, randomOrderCode(), customerId, subtotal, c.amount, subtotal - c.amount, c.discountCodeId],
      conn,
    );
    await recordDiscountUsage(conn, { discountCodeId: c.discountCodeId, customerId, orderId });
    return { orderId, ...c };
  });
}
const used = async (id) => (await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [id]))[0].usedCount;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: `admg_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin MG' });
  adminToken = (await api('POST', '/api/auth/login', { body: { email: `admg_${rnd}@example.com`, password: 'Admin12345' } })).data.token;
  A = await newCustomer('mga');
  B = await newCustomer('mgb');

  D1 = await mkEdition('Sách MG 1', 100000, `TL X ${rnd}`);
  D2 = await mkEdition('Sách MG 2', 60000, `TL Y ${rnd}`);
  await api('PATCH', `/api/admin/editions/${D2}`, { token: adminToken, body: { salePrice: 50000, reason: 'KM tay' } }); // D2 đang khuyến mãi
  catX = (await query('SELECT categoryId AS id FROM Category WHERE name = ?', [`TL X ${rnd}`]))[0].id;
  catY = (await query('SELECT categoryId AS id FROM Category WHERE name = ?', [`TL Y ${rnd}`]))[0].id;

  // Giỏ của A: 2 x D1 (100.000) + 1 x D2 (đang KM 50.000) = 250.000
  assert.equal((await api('POST', '/api/cart/items', { token: A.token, body: { editionId: D1, quantity: 2 } })).status, 201);
  assert.equal((await api('POST', '/api/cart/items', { token: A.token, body: { editionId: D2, quantity: 1 } })).status, 201);
  for (let i = 0; i < 6; i++) crowd.push(await newCustomer(`mgc${i}`));
});
after(async () => {
  server.close();
  await pool.end();
});

test('công thức giảm giá: phần trăm có trần, cố định, không vượt tiền hàng', () => {
  assert.equal(computeDiscount({ type: 'PERCENT', value: 10, maxDiscount: null }, 250000), 25000);
  assert.equal(computeDiscount({ type: 'PERCENT', value: 10, maxDiscount: 15000 }, 250000), 15000);
  assert.equal(computeDiscount({ type: 'PERCENT', value: 33, maxDiscount: null }, 1000), 330);
  assert.equal(computeDiscount({ type: 'FIXED', value: 30000, maxDiscount: null }, 250000), 30000);
  assert.equal(computeDiscount({ type: 'FIXED', value: 300000, maxDiscount: null }, 250000), 250000);
});

test('quản trị mã: chỉ ADMIN; kiểm tra đầu vào; mã không phân biệt hoa thường', async () => {
  assert.equal((await api('GET', '/api/admin/discount-codes')).status, 401);
  assert.equal((await api('GET', '/api/admin/discount-codes', { token: A.token })).status, 403);
  const post = (o) => api('POST', '/api/admin/discount-codes', { token: adminToken, body: codeBody(o) });
  assert.equal((await post({ value: 101 })).status, 400);
  assert.equal((await post({ type: 'FIXED', value: 0 })).status, 400);
  assert.equal((await post({ code: 'ab' })).status, 400);
  assert.equal((await post({ code: 'co dau cach' })).status, 400);
  assert.equal((await post({ endAt: iso(-1) })).status, 400);
  assert.equal((await post({ startAt: iso(5), endAt: iso(2) })).status, 400);
  assert.equal((await post({ categoryIds: ['3f0a1f0e-1111-4111-8111-111111111111'] })).status, 422);

  const c = await mkCode({ code: `abc${rnd}x` });
  assert.equal(c.code, `ABC${rnd}X`);
  const dup = await post({ code: `ABC${rnd}x`.toLowerCase() });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.code, 'CODE_EXISTS');
});

test('xem trước theo giỏ: cần đăng nhập, giỏ trống, mã không tồn tại', async () => {
  assert.equal((await validate(undefined, 'X')).status, 401);
  let r = await validate(B.token, 'ABCDEF'); // giỏ của B trống
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'CART_EMPTY');
  r = await validate(A.token, 'KHONGCO');
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'CODE_NOT_FOUND');
});

test('xem trước: phần trăm có trần, cố định, tối thiểu, loại trừ sách đang KM, phạm vi thể loại', async () => {
  // 10% của 250.000 = 25.000, trần 15.000
  let c = await mkCode({ maxDiscount: 15000 });
  let r = await validate(A.token, c.code.toLowerCase()); // nhập chữ thường vẫn nhận
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, 15000);
  assert.equal(r.data.subtotal, 250000);
  assert.equal(r.data.totalAfterDiscount, 235000);

  c = await mkCode({ type: 'FIXED', value: 30000 });
  assert.equal((await validate(A.token, c.code)).data.amount, 30000);

  c = await mkCode({ minOrderValue: 300000 });
  r = await validate(A.token, c.code);
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'CODE_MIN_ORDER');
  assert.equal(r.data.error.details.minOrderValue, 300000);

  // loại trừ sách đang KM: chỉ tính D1 (200.000)
  c = await mkCode({ excludeOnSale: true });
  r = await validate(A.token, c.code);
  assert.equal(r.data.eligibleSubtotal, 200000);
  assert.equal(r.data.amount, 20000);

  // phạm vi thể loại Y: chỉ D2 (50.000)
  c = await mkCode({ categoryIds: [catY] });
  r = await validate(A.token, c.code);
  assert.equal(r.data.eligibleSubtotal, 50000);
  assert.equal(r.data.amount, 5000);
  assert.equal((await api('GET', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken })).data.categories[0].categoryId, catY);

  // thể loại Y nhưng loại trừ sách KM => D2 đang KM => không còn sản phẩm nào đủ điều kiện
  c = await mkCode({ categoryIds: [catY], excludeOnSale: true });
  r = await validate(A.token, c.code);
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'CODE_NOT_APPLICABLE');

  // tối thiểu tính trên tiền hàng đủ điều kiện (200.000 < 220.000 dù cả giỏ là 250.000)
  c = await mkCode({ excludeOnSale: true, minOrderValue: 220000 });
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_MIN_ORDER');
});

test('trạng thái mã: ngừng áp dụng, chưa bắt đầu, hết hạn, hết lượt', async () => {
  let c = await mkCode();
  await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { status: 'INACTIVE' } });
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_INACTIVE');
  await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { status: 'ACTIVE' } });
  assert.equal((await validate(A.token, c.code)).status, 200);

  c = await mkCode({ startAt: iso(3), endAt: iso(30) });
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_NOT_STARTED');

  c = await mkCode();
  await query(`UPDATE DiscountCode SET startAt = NOW() - INTERVAL 2 HOUR, endAt = NOW() - INTERVAL 1 MINUTE WHERE discountCodeId = ?`, [c.discountCodeId]);
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_EXPIRED');
  // job chuyển trạng thái
  assert.ok((await expireDiscountCodes()).expired >= 1);
  assert.equal((await api('GET', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken })).data.status, 'EXPIRED');
  // gia hạn => hiệu lực lại
  let r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { name: 'x' } });
  assert.equal(r.status, 400); // không có trường nào hợp lệ
  r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { value: 12 } });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'CODE_ENDED');
  r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { endAt: iso(48) } });
  assert.equal(r.status, 200);
  assert.equal((await validate(A.token, c.code)).status, 200);

  c = await mkCode({ totalUsageLimit: 1 });
  await query('UPDATE DiscountCode SET usedCount = 1 WHERE discountCodeId = ?', [c.discountCodeId]);
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_USED_UP');
});

test('đặt hàng: trừ lượt, giới hạn mỗi khách, trả lượt thì dùng lại được', async () => {
  const c = await mkCode({ perCustomerLimit: 1, totalUsageLimit: 10 });
  const o1 = await placeOrder(A.customerId, c.code);
  assert.equal(o1.amount, 20000);
  assert.equal(await used(c.discountCodeId), 1);
  await assert.rejects(placeOrder(A.customerId, c.code), (e) => e.code === 'CODE_CUSTOMER_LIMIT');
  assert.equal(await used(c.discountCodeId), 1); // giao dịch lỗi không trừ lượt
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_CUSTOMER_LIMIT');
  await placeOrder(B.customerId, c.code); // khách khác vẫn dùng được
  assert.equal(await used(c.discountCodeId), 2);

  assert.equal(await withTx((conn) => releaseDiscountCode(conn, o1.orderId)), true); // đơn A hủy => trả lượt
  assert.equal(await used(c.discountCodeId), 1);
  const o3 = await placeOrder(A.customerId, c.code); // A dùng lại được
  assert.ok(o3.orderId);
});

test('nhiều khách đặt cùng lúc: không vượt tổng số lượt', async () => {
  const c = await mkCode({ totalUsageLimit: 3 });
  const results = await Promise.allSettled(crowd.map((u) => placeOrder(u.customerId, c.code)));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok, 3, JSON.stringify(results.map((r) => r.status)));
  assert.ok(
    failed.every((r) => r.reason.code === 'CODE_USED_UP'),
    failed.map((r) => r.reason.message).join('|'),
  );
  assert.equal(await used(c.discountCodeId), 3);
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM DiscountCodeUsage WHERE discountCodeId = ?', [c.discountCodeId]);
  assert.equal(n, 3);
});

test('một khách đặt song song nhiều đơn: vẫn tôn trọng giới hạn mỗi khách', async () => {
  const c = await mkCode({ perCustomerLimit: 2 });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => placeOrder(crowd[0].customerId, c.code)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(await used(c.discountCodeId), 2);
});

test('trả lượt đúng một lần dù được gọi nhiều lần / đồng thời', async () => {
  const c = await mkCode();
  const o = await placeOrder(crowd[1].customerId, c.code);
  await placeOrder(crowd[2].customerId, c.code);
  assert.equal(await used(c.discountCodeId), 2);
  const rs = await Promise.all(Array.from({ length: 5 }, () => withTx((conn) => releaseDiscountCode(conn, o.orderId))));
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal(await used(c.discountCodeId), 1);
  assert.equal(await withTx((conn) => releaseDiscountCode(conn, o.orderId)), false);
  assert.equal(await used(c.discountCodeId), 1);
  const [u] = await query('SELECT returnedAt FROM DiscountCodeUsage WHERE orderId = ?', [o.orderId]);
  assert.ok(u.returnedAt);
  // đơn không dùng mã => không làm gì
  assert.equal(await withTx((conn) => releaseDiscountCode(conn, uuid())), false);
});

test('sửa mã: không giảm tổng lượt dưới số đã dùng; không đổi chuỗi mã', async () => {
  const c = await mkCode({ totalUsageLimit: 5 });
  await placeOrder(crowd[3].customerId, c.code);
  await placeOrder(crowd[4].customerId, c.code);
  let r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { totalUsageLimit: 1 } });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'LIMIT_BELOW_USED');
  r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { totalUsageLimit: 2, maxDiscount: 5000 } });
  assert.equal(r.status, 200);
  assert.equal((await validate(A.token, c.code)).data.error.code, 'CODE_USED_UP');
  r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { code: 'DOIMA123' } });
  assert.equal(r.status, 400); // mã không đổi được (trường bị bỏ qua => không có thay đổi)
  r = await api('PATCH', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken, body: { categoryIds: [catX] } });
  assert.equal(r.status, 200);
  assert.deepEqual(
    (await api('GET', `/api/admin/discount-codes/${c.discountCodeId}`, { token: adminToken })).data.categories.map((x) => x.categoryId),
    [catX],
  );
});

test('xóa mã: chưa dùng thì xóa hẳn; đã có đơn dùng thì chuyển Ngừng áp dụng', async () => {
  const fresh = await mkCode({ categoryIds: [catX] });
  let r = await api('DELETE', `/api/admin/discount-codes/${fresh.discountCodeId}`, { token: adminToken });
  assert.equal(r.data.deleted, true);
  assert.equal((await api('GET', `/api/admin/discount-codes/${fresh.discountCodeId}`, { token: adminToken })).status, 404);

  const usedCode = await mkCode();
  await placeOrder(crowd[5].customerId, usedCode.code);
  r = await api('DELETE', `/api/admin/discount-codes/${usedCode.discountCodeId}`, { token: adminToken });
  assert.equal(r.data.deleted, false);
  assert.equal(r.data.status, 'INACTIVE');
  assert.equal((await validate(A.token, usedCode.code)).data.error.code, 'CODE_INACTIVE');
  const list = (await api('GET', `/api/admin/discount-codes?phase=PAUSED&q=${encodeURIComponent(usedCode.code.slice(0, -1))}`, { token: adminToken })).data;
  assert.ok(list.items.some((x) => x.discountCodeId === usedCode.discountCodeId));
});
