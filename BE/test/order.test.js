// Kiểm thử tích hợp: báo giá, tạo đơn (idempotency, giữ hàng, mã giảm giá, COD), hủy, hết hạn, tra cứu. Cần MySQL.
// GHN được giả lập bằng cách chặn fetch tới GHN_BASE_URL.
import './env.js';
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { uuid, randomOrderCode } from '../src/utils/security.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { expireUnpaidOrders } from '../src/modules/order/order.service.js';
import { buildPackage, applyFreeShipping } from '../src/modules/order/quote.service.js';

const rnd = Math.random().toString(36).slice(2, 8);
const P = 7_000_000 + Math.floor(Math.random() * 900_000),
  D = P + 1; // mã địa giới giả
let server, base, adminToken, staffToken, E1, E_COSTLY;
let seq = 0;

const realFetch = globalThis.fetch;
const ghn = { fee: 25000, failFee: false, cancelFail: false, calls: [] };
function fakeFetch(url, opts) {
  if (!String(url).startsWith(config.ghn.baseUrl)) return realFetch(url, opts);
  const [path, qs] = String(url).slice(config.ghn.baseUrl.length).split('?');
  const body = opts?.body ? JSON.parse(opts.body) : Object.fromEntries(new URLSearchParams(qs));
  ghn.calls.push({ path, body, headers: opts.headers });
  const reply = (json, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));
  if (path === '/v2/shipping-order/fee') return ghn.failFee ? reply({ code: 500, message: 'down' }, 500) : reply({ code: 200, data: { total: ghn.fee } });
  if (path === '/v2/switch-status/cancel') return ghn.cancelFail ? reply({ code: 400, message: 'khong huy duoc' }, 400) : reply({ code: 200, data: [] });
  return reply({ code: 404, message: 'not mocked' }, 404);
}

async function api(method, path, { body, token, headers } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const isbn13 = () => {
  const d12 = '978607' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1);
  return d12 + ((10 - (s % 10)) % 10);
};
async function mkEdition(title, listPrice, stock) {
  const r = await api('POST', '/api/admin/editions', {
    token: adminToken,
    body: {
      isbn: isbn13(),
      title: `${title} ${rnd}`,
      authors: ['TG'],
      categories: ['Test'],
      publisher: `NXB DH ${rnd}`,
      format: 'Bìa mềm',
      listPrice,
      weightGram: 200,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await query('UPDATE Inventory SET qtyOnHand = ? WHERE editionId = ?', [stock, r.data.editionId]);
  return r.data.editionId;
}
/** Khách mới + một địa chỉ hợp lệ. */
async function newCustomer(tag) {
  const email = `${tag}${++seq}_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: `Khách ${tag}`, acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  const token = (await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).data.token;
  const [{ customerId }] = await query('SELECT c.customerId FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE a.email = ?', [email]);
  const a = await api('POST', '/api/addresses', {
    token,
    body: { receiverName: 'Nguyễn Văn A', phone: '0901234567', detail: '12 Lê Lợi', ghnProvinceId: P, ghnDistrictId: D, ghnWardCode: `${rnd}W1` },
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  return { token, customerId, email, addressId: a.data.addressId };
}
async function withCart(tag, items = [[E1, 1]]) {
  const c = await newCustomer(tag);
  for (const [editionId, quantity] of items)
    assert.equal((await api('POST', '/api/cart/items', { token: c.token, body: { editionId, quantity } })).status, 201);
  return c;
}
const quote = (c, extra = {}) => api('POST', '/api/checkout/quote', { token: c.token, body: { addressId: c.addressId, ...extra } });
const order = (c, { key = `key-${uuid()}`, paymentMethod = 'COD', expectedTotal, ...extra } = {}) =>
  api('POST', '/api/orders', { token: c.token, headers: { 'idempotency-key': key }, body: { addressId: c.addressId, paymentMethod, expectedTotal, ...extra } });
/** Báo giá rồi đặt đúng tổng đã thấy. */
async function quoteAndOrder(c, o = {}) {
  const q = await quote(c, o.discountCode ? { discountCode: o.discountCode } : {});
  assert.equal(q.status, 200, JSON.stringify(q.data));
  return order(c, { expectedTotal: q.data.total, ...o });
}
const inv = async (editionId) => (await query('SELECT qtyOnHand, qtyReserved, qtyAvailable FROM Inventory WHERE editionId = ?', [editionId]))[0];
const orderRow = async (orderId) => (await query('SELECT * FROM Orders WHERE orderId = ?', [orderId]))[0];
const iso = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
async function mkCode(o = {}) {
  const r = await api('POST', '/api/admin/discount-codes', {
    token: adminToken,
    body: { code: `DH${rnd.toUpperCase()}${++seq}`, type: 'PERCENT', value: 10, startAt: iso(-1), endAt: iso(24), ...o },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

before(async () => {
  Object.assign(config.ghn, { token: 'test-token', shopId: '999' });
  Object.assign(config.sepay, { bank: 'MBBank', accountNo: '0123456789' });
  Object.assign(config.vnpay, { tmnCode: 'TMNTEST', secret: 'vnpay-secret' });
  globalThis.fetch = fakeFetch;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: `ad_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin' });
  await createStaffAccount({ email: `nv_${rnd}@example.com`, password: 'Staff12345', fullName: 'Nhân viên', role: 'STAFF', position: 'Nhân viên kho' });
  adminToken = (await api('POST', '/api/auth/login', { body: { email: `ad_${rnd}@example.com`, password: 'Admin12345' } })).data.token;
  staffToken = (await api('POST', '/api/auth/login', { body: { email: `nv_${rnd}@example.com`, password: 'Staff12345' } })).data.token;
  await query('INSERT INTO GhnProvince (provinceId, name) VALUES (?, ?)', [P, 'Tỉnh Test']);
  await query('INSERT INTO GhnDistrict (districtId, provinceId, name) VALUES (?,?,?)', [D, P, 'Quận Test']);
  await query('INSERT INTO GhnWard (districtId, wardCode, name) VALUES (?,?,?)', [D, `${rnd}W1`, 'Phường Test']);
  E1 = await mkEdition('Sách đặt hàng', 100000, 100);
  E_COSTLY = await mkEdition('Sách đắt', 2_500_000, 20);
});
beforeEach(() => Object.assign(ghn, { fee: 25000, failFee: false, cancelFail: false, calls: [] }));
after(async () => {
  globalThis.fetch = realFetch;
  server.close();
  await pool.end();
});

// ---------------------------------------------------------------------------

test('hàm thuần: kiện hàng và miễn phí vận chuyển', () => {
  assert.deepEqual(buildPackage([{ quantity: 2, weightGram: 200, lengthMm: 240, widthMm: 160, heightMm: 15 }], 100), {
    weight: 500,
    length: 24,
    width: 16,
    height: 3,
  });
  assert.deepEqual(buildPackage([{ quantity: 1, weightGram: 300 }], 100), { weight: 400, length: 24, width: 16, height: 2 }); // thiếu kích thước => mặc định
  assert.equal(applyFreeShipping(299_999, 25000, 300_000), 25000);
  assert.equal(applyFreeShipping(300_000, 25000, 300_000), 0);
});

test('báo giá: cần đăng nhập khách hàng; giỏ trống 422; địa chỉ của người khác 404', async () => {
  assert.equal((await api('POST', '/api/checkout/quote', { body: { addressId: uuid() } })).status, 401);
  assert.equal((await api('POST', '/api/checkout/quote', { token: staffToken, body: { addressId: uuid() } })).status, 403);
  const empty = await newCustomer('trong');
  const r = await quote(empty);
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'CART_EMPTY');
  const other = await withCart('khac');
  assert.equal((await quote(other, {})).status, 200);
  assert.equal((await api('POST', '/api/checkout/quote', { token: other.token, body: { addressId: empty.addressId } })).status, 404);
});

test('báo giá: tiền hàng + phí GHN; miễn phí khi tiền hàng sau giảm >= 300.000; GHN nhận đúng khối lượng/địa chỉ', async () => {
  const c = await withCart('tinh', [[E1, 2]]);
  let r = await quote(c);
  assert.equal(r.data.subtotal, 200000);
  assert.equal(r.data.shippingFee, 25000);
  assert.equal(r.data.total, 225000);
  assert.equal(r.data.freeShipping, false);
  const call = ghn.calls.find((x) => x.path === '/v2/shipping-order/fee');
  assert.equal(call.body.weight, 2 * 200 + 100);
  assert.equal(call.body.to_district_id, D);
  assert.equal(call.body.to_ward_code, `${rnd}W1`);
  assert.equal(call.headers.ShopId, '999');
  assert.equal(call.body.insurance_value, 200000);

  await api('POST', '/api/cart/items', { token: c.token, body: { editionId: E1, quantity: 1 } }); // 3 cuốn = 300.000
  r = await quote(c);
  assert.equal(r.data.subtotal, 300000);
  assert.equal(r.data.shippingFee, 0);
  assert.equal(r.data.freeShipping, true);
  assert.equal(r.data.total, 300000);

  const code = await mkCode(); // giảm 10% => 270.000 < ngưỡng => tính lại phí ship
  r = await quote(c, { discountCode: code.code });
  assert.equal(r.data.discountAmount, 30000);
  assert.equal(r.data.shippingFee, 25000);
  assert.equal(r.data.total, 295000);
});

test('báo giá: GHN lỗi => không báo giá, không đặt được, không giữ hàng, giỏ nguyên vẹn', async () => {
  const c = await withCart('ghnloi');
  const before = await inv(E1);
  ghn.failFee = true;
  let r = await quote(c);
  assert.equal(r.status, 502);
  assert.equal(r.data.error.code, 'GHN_ERROR');
  r = await order(c, { expectedTotal: 125000 });
  assert.equal(r.status, 502);
  assert.equal((await query('SELECT COUNT(*) AS n FROM Orders WHERE customerId = ?', [c.customerId]))[0].n, 0);
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved);
  assert.equal((await api('GET', '/api/cart', { token: c.token })).data.items.length, 1);
});

test('báo giá: giỏ có sách không đặt được => 409 CART_NOT_PURCHASABLE; địa chỉ cần xác nhận => 422', async () => {
  const out = await mkEdition('Sách hết', 50000, 1);
  const c = await withCart('loi', [
    [E1, 1],
    [out, 1],
  ]);
  await query('UPDATE Inventory SET qtyOnHand = 0 WHERE editionId = ?', [out]);
  let r = await quote(c);
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'CART_NOT_PURCHASABLE');
  assert.equal(r.data.error.details[0].editionId, out);
  await api('DELETE', `/api/cart/items/${out}`, { token: c.token });
  await query('UPDATE Address SET needsConfirm = TRUE WHERE addressId = ?', [c.addressId]);
  r = await quote(c);
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'ADDRESS_NEEDS_CONFIRM');
});

test('tạo đơn COD: xác nhận ngay, chốt giá, giữ hàng, xóa giỏ, email xác nhận, bản sao địa chỉ', async () => {
  const c = await withCart('cod', [[E1, 2]]);
  const before = await inv(E1);
  const r = await quoteAndOrder(c, { note: 'Giao giờ hành chính' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const o = r.data;
  assert.match(o.orderCode, /^DH[A-Z0-9]{8}$/);
  assert.equal(o.orderStatus, 'CONFIRMED');
  assert.equal(o.paymentStatus, 'UNPAID');
  assert.equal(o.shippingStatus, 'NOT_CREATED');
  assert.equal(o.subtotal, 200000);
  assert.equal(o.shippingFee, 25000);
  assert.equal(o.totalAmount, 225000);
  assert.equal(o.paymentExpiresAt, null);
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].unitPrice, 100000);
  assert.equal(o.items[0].quantity, 2);
  assert.equal(o.shippingAddressSnapshot.ward, 'Phường Test');
  assert.equal(o.shippingAddressSnapshot.phone, '0901234567');
  assert.equal(o.idempotencyKey, undefined);
  assert.equal(o.customerId, undefined);
  const after = await inv(E1);
  assert.equal(after.qtyReserved, before.qtyReserved + 2);
  assert.equal(after.qtyOnHand, before.qtyOnHand); // giữ chứ chưa xuất kho
  assert.equal((await api('GET', '/api/cart', { token: c.token })).data.items.length, 0);
  const [mail] = await query(`SELECT body FROM EmailOutbox WHERE toEmail = ? AND subject LIKE ?`, [c.email, `%${o.orderCode}%`]);
  assert.ok(mail && mail.body.includes('khi nhận hàng'));
  assert.ok((await query('SELECT lastUsedAt FROM Address WHERE addressId = ?', [c.addressId]))[0].lastUsedAt);
  // giá đã chốt: đổi giá sách sau đó không làm đổi đơn
  await query('UPDATE Edition SET listPrice = 110000 WHERE editionId = ?', [E1]);
  assert.equal((await api('GET', `/api/orders/${o.orderId}`, { token: c.token })).data.totalAmount, 225000);
  await query('UPDATE Edition SET listPrice = 100000 WHERE editionId = ?', [E1]);
});

test('tạo đơn: bắt buộc Idempotency-Key; gửi lại cùng khóa trả đúng đơn cũ (200), không giữ hàng hai lần', async () => {
  const c = await withCart('idem');
  const q = (await quote(c)).data;
  let r = await api('POST', '/api/orders', { token: c.token, body: { addressId: c.addressId, paymentMethod: 'COD', expectedTotal: q.total } });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const before = await inv(E1);
  const first = await order(c, { key: 'abc12345-xyz', expectedTotal: q.total });
  assert.equal(first.status, 201);
  const again = await order(c, { key: 'abc12345-xyz', expectedTotal: q.total });
  assert.equal(again.status, 200);
  assert.equal(again.data.orderId, first.data.orderId);
  assert.equal(again.data.replayed, true);
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved + 1);
  // cùng khóa nhưng khác khách => đơn riêng, không lộ đơn của người khác
  const other = await withCart('idem2');
  const o2 = await order(other, { key: 'abc12345-xyz', expectedTotal: q.total });
  assert.equal(o2.status, 201);
  assert.notEqual(o2.data.orderId, first.data.orderId);
});

test('tạo đơn: 5 yêu cầu đồng thời cùng Idempotency-Key => đúng một đơn', async () => {
  const c = await withCart('idemcc', [[E1, 2]]);
  const q = (await quote(c)).data;
  const before = await inv(E1);
  const rs = await Promise.all(Array.from({ length: 5 }, () => order(c, { key: 'same-key-12345', expectedTotal: q.total })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 201], JSON.stringify(rs.map((r) => r.data?.error)));
  assert.equal(new Set(rs.map((r) => r.data.orderId)).size, 1);
  assert.equal((await query('SELECT COUNT(*) AS n FROM Orders WHERE customerId = ?', [c.customerId]))[0].n, 1);
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved + 2);
});

test('tạo đơn: tổng khác lúc xem => 409 QUOTE_CHANGED kèm báo giá mới, không tạo đơn', async () => {
  const c = await withCart('doigia');
  const q = (await quote(c)).data;
  ghn.fee = 40000; // GHN đổi phí giữa lúc xem và lúc đặt
  let r = await order(c, { expectedTotal: q.total });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'QUOTE_CHANGED');
  assert.equal(r.data.error.details.quote.total, 140000);
  assert.equal((await query('SELECT COUNT(*) AS n FROM Orders WHERE customerId = ?', [c.customerId]))[0].n, 0);
  r = await order(c, { expectedTotal: 140000 }); // khách xác nhận lại với tổng mới
  assert.equal(r.status, 201);
  assert.equal(r.data.shippingFee, 40000);
});

test('COD: vượt hạn mức 2.000.000 => 422; SePay/VNPay vẫn đặt được; tắt COD khi có >= 2 đơn COD hoàn về trong 90 ngày', async () => {
  const c = await withCart('hanmuc', [[E_COSTLY, 1]]);
  const q = (await quote(c)).data;
  assert.equal(q.total, 2_500_000);
  assert.equal(q.shippingFee, 0); // đã miễn phí vận chuyển nhưng vẫn vượt hạn mức COD
  assert.equal(q.paymentMethods.find((m) => m.method === 'COD').available, false);
  let r = await order(c, { expectedTotal: q.total, paymentMethod: 'COD' });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'COD_OVER_LIMIT');
  r = await order(c, { expectedTotal: q.total, paymentMethod: 'VNPAY' });
  assert.equal(r.status, 201);
  assert.equal(r.data.orderStatus, 'PENDING_PAYMENT');

  const b = await withCart('codtat');
  const ins = () =>
    query(
      `INSERT INTO Orders (orderId, orderCode, customerId, orderStatus, paymentStatus, shippingStatus, subtotal, totalAmount, paymentMethod, shippingAddressSnapshot)
     VALUES (?,?,?, 'RETURNED_TO_WAREHOUSE','UNPAID','RETURNED', 100000,100000,'COD','{}')`,
      [uuid(), randomOrderCode(), b.customerId],
    );
  await ins(); // 1 đơn: vẫn dùng được COD
  assert.equal((await quote(b)).data.paymentMethods[0].available, true);
  await ins();
  const qb = (await quote(b)).data;
  assert.equal(qb.paymentMethods[0].available, false);
  assert.equal(qb.paymentMethods[0].code, 'COD_DISABLED');
  r = await order(b, { expectedTotal: qb.total, paymentMethod: 'COD' });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'COD_DISABLED');
});

test('đơn trực tuyến: PENDING_PAYMENT, hạn 30 phút; job hết hạn trả hàng + lượt mã; SePay có ân hạn 5 phút', async () => {
  const code = await mkCode({ totalUsageLimit: 10 });
  const mk = async (tag, method) => {
    const c = await withCart(tag, [[E1, 2]]);
    return (await quoteAndOrder(c, { paymentMethod: method, discountCode: code.code })).data;
  };
  const before = await inv(E1);
  const vn = await mk('vn', 'VNPAY'),
    sp = await mk('sp', 'SEPAY');
  assert.equal(vn.orderStatus, 'PENDING_PAYMENT');
  assert.equal(vn.discountAmount, 20000);
  const minutes = (new Date(vn.paymentExpiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 28 && minutes <= 30.1, `hạn thanh toán ~30 phút, thực tế ${minutes}`);
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved + 4);
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 2);

  // VNPay quá hạn 1 phút => hết hạn ngay; SePay quá hạn 3 phút (còn ân hạn) => chưa
  await query('UPDATE Orders SET paymentExpiresAt = NOW() - INTERVAL 1 MINUTE WHERE orderId = ?', [vn.orderId]);
  await query('UPDATE Orders SET paymentExpiresAt = NOW() - INTERVAL 3 MINUTE WHERE orderId = ?', [sp.orderId]);
  await expireUnpaidOrders();
  assert.equal((await orderRow(vn.orderId)).orderStatus, 'EXPIRED');
  assert.equal((await orderRow(vn.orderId)).paymentStatus, 'EXPIRED');
  assert.equal((await orderRow(sp.orderId)).orderStatus, 'PENDING_PAYMENT');
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved + 2);
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 1);

  await query('UPDATE Orders SET paymentExpiresAt = NOW() - INTERVAL 6 MINUTE WHERE orderId = ?', [sp.orderId]);
  await Promise.all([expireUnpaidOrders(), expireUnpaidOrders(), expireUnpaidOrders()]); // chạy đồng thời vẫn trả đúng một lần
  assert.equal((await orderRow(sp.orderId)).orderStatus, 'EXPIRED');
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved);
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 0);
  assert.equal(
    (
      await query(`SELECT COUNT(*) AS n FROM EmailOutbox WHERE dedupeKey LIKE 'order-expired:%' AND dedupeKey IN (?,?)`, [
        `order-expired:${vn.orderId}`,
        `order-expired:${sp.orderId}`,
      ])
    )[0].n,
    2,
  );
  // đơn đã thanh toán / đã xác nhận không bị job động tới
  const paid = await withCart('paid', [[E1, 1]]);
  const po = (await quoteAndOrder(paid, { paymentMethod: 'VNPAY' })).data;
  await query(`UPDATE Orders SET orderStatus='CONFIRMED', paymentStatus='PAID', paymentExpiresAt = NOW() - INTERVAL 1 HOUR WHERE orderId = ?`, [po.orderId]);
  await expireUnpaidOrders();
  assert.equal((await orderRow(po.orderId)).orderStatus, 'CONFIRMED');
});

test('mã giảm giá: trừ lượt khi đặt, hủy đơn trả lượt đúng một lần; hết lượt thì đơn thứ hai bị từ chối', async () => {
  const code = await mkCode({ totalUsageLimit: 1 });
  const a = await withCart('ma1', [[E1, 2]]);
  const ra = await quoteAndOrder(a, { discountCode: code.code });
  assert.equal(ra.status, 201);
  assert.equal(ra.data.discountAmount, 20000);
  assert.equal(ra.data.discountCode, code.code);
  assert.equal((await query('SELECT COUNT(*) AS n FROM DiscountCodeUsage WHERE orderId = ? AND returnedAt IS NULL', [ra.data.orderId]))[0].n, 1);

  const b = await withCart('ma2', [[E1, 2]]);
  const rb = await quote(b, { discountCode: code.code });
  assert.equal(rb.status, 422);
  assert.equal(rb.data.error.code, 'CODE_USED_UP');

  const res = await api('POST', `/api/orders/${ra.data.orderId}/cancel`, { token: a.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.orderStatus, 'CANCELLED');
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 0);
  const again = await api('POST', `/api/orders/${ra.data.orderId}/cancel`, { token: a.token });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'ORDER_NOT_CANCELLABLE');
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 0); // không trả lần hai
  assert.equal((await quote(b, { discountCode: code.code })).status, 200); // lượt đã trả, khách khác dùng được
});

test('mã giảm giá: đồng thời nhiều khách chỉ đặt được đúng số lượt còn lại', async () => {
  const code = await mkCode({ totalUsageLimit: 2 });
  const cs = await Promise.all(Array.from({ length: 5 }, (_, i) => withCart(`mcc${i}`, [[E1, 2]])));
  const quotes = await Promise.all(cs.map((c) => quote(c, { discountCode: code.code })));
  assert.ok(quotes.every((q) => q.status === 200)); // báo giá chưa trừ lượt
  const rs = await Promise.all(cs.map((c, i) => order(c, { expectedTotal: quotes[i].data.total, discountCode: code.code })));
  assert.equal(rs.filter((r) => r.status === 201).length, 2, JSON.stringify(rs.map((r) => r.data?.error?.code)));
  assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.status === 422 && r.data.error.code === 'CODE_USED_UP'));
  assert.equal((await query('SELECT usedCount FROM DiscountCode WHERE discountCodeId = ?', [code.discountCodeId]))[0].usedCount, 2);
  // đơn thất bại không để lại gì: giỏ còn nguyên, không có đơn
  for (const [i, r] of rs.entries())
    if (r.status !== 201) {
      assert.equal((await api('GET', '/api/cart', { token: cs[i].token })).data.items.length, 1);
      assert.equal((await query('SELECT COUNT(*) AS n FROM Orders WHERE customerId = ?', [cs[i].customerId]))[0].n, 0);
    }
});

test('giữ hàng đồng thời: 6 khách tranh 3 cuốn cuối => đúng 3 đơn, tồn giữ = 3, không âm', async () => {
  const scarce = await mkEdition('Sách khan', 80000, 3);
  const cs = await Promise.all(Array.from({ length: 6 }, (_, i) => withCart(`kh${i}`, [[scarce, 1]])));
  const quotes = await Promise.all(cs.map((c) => quote(c)));
  const rs = await Promise.all(cs.map((c, i) => (quotes[i].status === 200 ? order(c, { expectedTotal: quotes[i].data.total }) : Promise.resolve(quotes[i]))));
  const ok = rs.filter((r) => r.status === 201),
    bad = rs.filter((r) => r.status !== 201);
  assert.equal(ok.length, 3, JSON.stringify(rs.map((r) => r.data?.error?.code)));
  assert.ok(bad.every((r) => r.status === 409 && ['INSUFFICIENT_STOCK', 'CART_NOT_PURCHASABLE', 'QUOTE_CHANGED'].includes(r.data.error.code)));
  const s = await inv(scarce);
  assert.equal(s.qtyReserved, 3);
  assert.equal(s.qtyOnHand, 3);
  assert.equal(s.qtyAvailable, 0);
});

test('hủy đơn: khách chỉ hủy đơn của mình; trả hàng giữ; đơn đã thanh toán chuyển REFUND_PENDING', async () => {
  const c = await withCart('huy', [[E1, 2]]);
  const o = (await quoteAndOrder(c, { paymentMethod: 'SEPAY' })).data;
  const before = await inv(E1);
  const stranger = await newCustomer('la');
  assert.equal((await api('POST', `/api/orders/${o.orderId}/cancel`, { token: stranger.token })).status, 404);
  assert.equal((await api('GET', `/api/orders/${o.orderId}`, { token: stranger.token })).status, 404);

  await query(`UPDATE Orders SET orderStatus='CONFIRMED', paymentStatus='PAID' WHERE orderId = ?`, [o.orderId]); // giả lập đã thanh toán (mục 7 chưa làm)
  const r = await api('POST', `/api/orders/${o.orderId}/cancel`, { token: c.token, body: { reason: 'Đặt nhầm' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.paymentStatus, 'REFUND_PENDING');
  assert.equal(r.data.refundPending, true);
  const row = await orderRow(o.orderId);
  assert.equal(row.orderStatus, 'CANCELLED');
  assert.equal(row.cancelReason, 'Đặt nhầm');
  assert.ok(row.stockRestoredAt);
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved - 2);
});

test('hủy đơn có vận đơn GHN: hủy vận đơn trước; GHN lỗi thì giữ nguyên đơn; đã lấy hàng thì không hủy được', async () => {
  const mkShipped = async (tag, shipStatus, extra = '') => {
    const c = await withCart(tag, [[E1, 1]]);
    const o = (await quoteAndOrder(c)).data;
    const ghnCode = `G${uuid().slice(0, 8)}`;
    await query(`UPDATE Orders SET shippingStatus = 'WAITING_PICKUP' WHERE orderId = ?`, [o.orderId]);
    await query(
      `INSERT INTO Shipment (shipmentId, orderId, ghnOrderCode, direction, status ${extra ? ', pickedUpAt' : ''}) VALUES (?,?,?, 'FORWARD', ? ${extra ? ', NOW()' : ''})`,
      [uuid(), o.orderId, ghnCode, shipStatus],
    );
    return { c, o, ghnCode };
  };
  const a = await mkShipped('gh1', 'WAITING_PICKUP');
  const before = await inv(E1);
  ghn.cancelFail = true;
  let r = await api('POST', `/api/orders/${a.o.orderId}/cancel`, { token: a.c.token });
  assert.equal(r.status, 502);
  assert.equal((await orderRow(a.o.orderId)).orderStatus, 'CONFIRMED');
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved);
  ghn.cancelFail = false;
  r = await api('POST', `/api/orders/${a.o.orderId}/cancel`, { token: a.c.token });
  assert.equal(r.status, 200);
  assert.deepEqual(ghn.calls.filter((x) => x.path === '/v2/switch-status/cancel').at(-1).body.order_codes, [a.ghnCode]);
  assert.equal((await orderRow(a.o.orderId)).shippingStatus, 'CANCELLED');
  assert.equal((await query('SELECT status FROM Shipment WHERE orderId = ?', [a.o.orderId]))[0].status, 'CANCELLED');
  assert.equal((await inv(E1)).qtyReserved, before.qtyReserved - 1);

  const b = await mkShipped('gh2', 'DELIVERING', 'picked');
  r = await api('POST', `/api/orders/${b.o.orderId}/cancel`, { token: b.c.token });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'ORDER_ALREADY_SHIPPED');
  assert.equal((await orderRow(b.o.orderId)).orderStatus, 'CONFIRMED');
});

test('khách xem lịch sử: chỉ đơn của mình, lọc theo trạng thái, phân trang; chi tiết có sản phẩm', async () => {
  const c = await withCart('ls', [[E1, 1]]);
  const o1 = (await quoteAndOrder(c)).data;
  await query('UPDATE Orders SET createdAt = NOW() - INTERVAL 1 HOUR WHERE orderId = ?', [o1.orderId]); // createdAt chỉ chính xác tới giây: làm lệch để thứ tự xác định
  await api('POST', '/api/cart/items', { token: c.token, body: { editionId: E1, quantity: 2 } });
  const o2 = (await quoteAndOrder(c, { paymentMethod: 'VNPAY' })).data;
  const all = await api('GET', '/api/orders', { token: c.token });
  assert.equal(all.data.total, 2);
  assert.equal(all.data.items[0].orderId, o2.orderId);
  assert.equal(all.data.items[0].itemCount, 2);
  assert.ok(all.data.items[0].firstTitle.startsWith('Sách đặt hàng'));
  assert.equal((await api('GET', '/api/orders?status=PENDING_PAYMENT', { token: c.token })).data.items.map((x) => x.orderId).join(), o2.orderId);
  assert.equal((await api('GET', '/api/orders?status=CONFIRMED', { token: c.token })).data.items.map((x) => x.orderId).join(), o1.orderId);
  assert.equal((await api('GET', '/api/orders?status=SAI', { token: c.token })).status, 400);
  const other = await newCustomer('khac2');
  assert.equal((await api('GET', '/api/orders', { token: other.token })).data.total, 0);
  assert.equal((await api('GET', '/api/orders')).status, 401);
  const d = (await api('GET', `/api/orders/${o1.orderId}`, { token: c.token })).data;
  assert.equal(d.items[0].isbn.length, 13);
});

test('nhân viên: tìm theo mã đơn / SĐT / tên không dấu / mã vận đơn, in phiếu đóng gói, hủy phải có lý do và ghi lịch sử', async () => {
  const c = await withCart('nv', [[E1, 2]]);
  const o = (await quoteAndOrder(c)).data;
  assert.equal((await api('GET', '/api/staff/orders', { token: c.token })).status, 403);
  assert.equal((await api('GET', '/api/staff/orders')).status, 401);
  const ids = async (q) => (await api('GET', `/api/staff/orders?q=${encodeURIComponent(q)}`, { token: staffToken })).data.items.map((x) => x.orderId);
  assert.ok((await ids(o.orderCode.toLowerCase())).includes(o.orderId));
  assert.ok((await ids('0901234567')).includes(o.orderId));
  assert.ok((await ids('nguyen van a')).includes(o.orderId)); // không dấu, không phân biệt hoa thường
  assert.ok(!(await ids('khong-ton-tai-xyz')).includes(o.orderId));
  await query(`INSERT INTO Shipment (shipmentId, orderId, ghnOrderCode, direction, status) VALUES (?,?,?, 'FORWARD','WAITING_PICKUP')`, [
    uuid(),
    o.orderId,
    `GHN${rnd}`,
  ]);
  assert.ok((await ids(`ghn${rnd}`)).includes(o.orderId));
  const list = (await api('GET', `/api/staff/orders?status=CONFIRMED&paymentStatus=UNPAID&q=${o.orderCode}`, { token: staffToken })).data.items[0];
  assert.equal(list.ghnOrderCode, `GHN${rnd}`);
  assert.equal(list.receiverPhone, '0901234567');

  const detail = (await api('GET', `/api/staff/orders/${o.orderId}`, { token: staffToken })).data;
  assert.ok(detail.customerEmail.includes('@'));
  assert.equal(detail.shipments.length, 1);
  const slip = (await api('GET', `/api/staff/orders/${o.orderId}/packing-slip`, { token: staffToken })).data;
  assert.equal(slip.codAmount, 225000);
  assert.equal(slip.items[0].quantity, 2);
  assert.equal(slip.ghnOrderCode, `GHN${rnd}`);
  assert.ok(slip.receiver.address.includes('Phường Test'));

  const online = await withCart('nv2', [[E1, 1]]);
  const po = (await quoteAndOrder(online, { paymentMethod: 'SEPAY' })).data;
  assert.equal((await api('GET', `/api/staff/orders/${po.orderId}/packing-slip`, { token: staffToken })).status, 409); // chưa xác nhận

  // nhân viên hủy: bắt buộc lý do; đơn đã có vận đơn chưa lấy hàng => hủy vận đơn GHN
  assert.equal((await api('POST', `/api/staff/orders/${o.orderId}/cancel`, { token: staffToken, body: {} })).status, 400);
  assert.equal((await api('POST', `/api/staff/orders/${o.orderId}/cancel`, { token: c.token, body: { reason: 'Thiếu hàng' } })).status, 403);
  const r = await api('POST', `/api/staff/orders/${o.orderId}/cancel`, { token: staffToken, body: { reason: 'Hàng bị hư khi đóng gói' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [log] = await query(`SELECT reason, actorId FROM AuditLog WHERE entityType='ORDER' AND entityId = ? AND action = 'CANCEL'`, [o.orderId]);
  assert.equal(log.reason, 'Hàng bị hư khi đóng gói');
  assert.ok(log.actorId);
  assert.equal((await orderRow(o.orderId)).cancelReason, 'Hàng bị hư khi đóng gói');
  const [mail] = await query(`SELECT body FROM EmailOutbox WHERE dedupeKey = ?`, [`order-cancelled:${o.orderId}`]);
  assert.ok(mail.body.includes('Hàng bị hư khi đóng gói'));
});
