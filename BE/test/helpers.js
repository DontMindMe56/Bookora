import './env.js';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { uuid } from '../src/utils/security.js';
import { ensureDefaultCover } from '../src/modules/admin/book.service.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';

export const rnd = Math.random().toString(36).slice(2, 8);
const P = 6_000_000 + Math.floor(Math.random() * 900_000),
  D = P + 1;
export const realFetch = globalThis.fetch;
export const ghn = { fee: 25000, calls: [], createFail: 0, createdCodes: 0, statuses: {}, detailExtra: {}, clientLookup: null };
let seq = 0,
  server,
  base;
export const ctx = {};

function fakeFetch(url, opts) {
  if (!String(url).startsWith(config.ghn.baseUrl)) return realFetch(url, opts);
  const [path, qs] = String(url).slice(config.ghn.baseUrl.length).split('?');
  const body = opts?.body ? JSON.parse(opts.body) : Object.fromEntries(new URLSearchParams(qs));
  ghn.calls.push({ path, body });
  const reply = (json, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));
  if (path === '/v2/shipping-order/fee') return reply({ code: 200, data: { total: ghn.fee } });
  if (path === '/v2/switch-status/cancel') return reply({ code: 200, data: [] });
  if (path === '/v2/shipping-order/create') {
    if (ghn.createFail > 0) {
      ghn.createFail--;
      return reply({ code: 400, message: 'loi' }, 400);
    }
    return reply({ code: 200, data: { order_code: `GHN${rnd}${++ghn.createdCodes}`, total_fee: 22000 } });
  }
  if (path === '/v2/shipping-order/detail-by-client-code')
    return ghn.clientLookup ? reply({ code: 200, data: ghn.clientLookup }) : reply({ code: 400, message: 'not found' }, 400);
  if (path === '/v2/shipping-order/detail')
    return reply({ code: 200, data: { status: ghn.statuses[body.order_code] ?? 'ready_to_pick', ...ghn.detailExtra[body.order_code] } });
  return reply({ code: 404, message: 'not mocked' }, 404);
}

export async function api(method, path, { body, token, headers } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function setup() {
  Object.assign(config.ghn, { token: 'test-token', shopId: '999', webhookToken: 'whk', autoCreate: false });
  // webhookSecret rỗng để dùng đường kiểm API key; nếu không, .env có SEPAY_WEBHOOK_SECRET sẽ làm mọi webhook giả bị 401
  Object.assign(config.sepay, { apiKey: 'sepay-key', webhookSecret: '', bank: 'MBBank', accountNo: '0123456789', accountName: 'NHA SACH' });
  Object.assign(config.vnpay, { tmnCode: 'TMNTEST', secret: 'vnpay-secret' });
  globalThis.fetch = fakeFetch;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.baseUrl = base;
  ctx.rawFetch = realFetch;
  await ensureDefaultCover();
  await createStaffAccount({ email: `ad_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin' });
  await createStaffAccount({ email: `nv_${rnd}@example.com`, password: 'Staff12345', fullName: 'Nhân viên', role: 'STAFF', position: 'Nhân viên kho' });
  ctx.adminToken = (await api('POST', '/api/auth/login', { body: { email: `ad_${rnd}@example.com`, password: 'Admin12345' } })).data.token;
  ctx.staffToken = (await api('POST', '/api/auth/login', { body: { email: `nv_${rnd}@example.com`, password: 'Staff12345' } })).data.token;
  await query('INSERT INTO GhnProvince (provinceId, name) VALUES (?, ?)', [P, 'Tỉnh Test']);
  await query('INSERT INTO GhnDistrict (districtId, provinceId, name) VALUES (?,?,?)', [D, P, 'Quận Test']);
  await query('INSERT INTO GhnWard (districtId, wardCode, name) VALUES (?,?,?)', [D, `${rnd}W1`, 'Phường Test']);
  ctx.edition = await mkEdition('Sách thanh toán', 100000, 100);
}
export async function teardown() {
  globalThis.fetch = realFetch;
  server.close();
  await pool.end();
}
export const resetGhn = () => Object.assign(ghn, { fee: 25000, calls: [], createFail: 0, statuses: {}, detailExtra: {}, clientLookup: null });

const isbn13 = () => {
  const d = '978608' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d[i] * (i % 2 ? 3 : 1);
  return d + ((10 - (s % 10)) % 10);
};
export async function mkEdition(title, listPrice, stock, extra = {}) {
  const r = await api('POST', '/api/admin/editions', {
    token: ctx.adminToken,
    body: {
      isbn: isbn13(),
      title: `${title} ${rnd}`,
      authors: ['TG'],
      categories: ['Test'],
      publisher: `NXB T ${rnd}`,
      format: 'Bìa mềm',
      listPrice,
      weightGram: 200,
      ...extra,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await query('UPDATE Inventory SET qtyOnHand = ? WHERE editionId = ?', [stock, r.data.editionId]);
  return r.data.editionId;
}

export async function newCustomer(tag) {
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

export async function placeOrder(paymentMethod = 'COD', { qty = 1, editionId = ctx.edition } = {}) {
  const c = await newCustomer('o');
  await api('POST', '/api/cart/items', { token: c.token, body: { editionId, quantity: qty } });
  const q = await api('POST', '/api/checkout/quote', { token: c.token, body: { addressId: c.addressId } });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  const o = await api('POST', '/api/orders', {
    token: c.token,
    headers: { 'idempotency-key': `k-${uuid()}` },
    body: { addressId: c.addressId, paymentMethod, expectedTotal: q.data.total },
  });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  return { c, order: o.data };
}
export const orderRow = async (id) => (await query('SELECT * FROM Orders WHERE orderId = ?', [id]))[0];
export const shipRow = async (id) => (await query(`SELECT * FROM Shipment WHERE orderId = ? AND direction='FORWARD'`, [id]))[0];
export const inv = async (id) => (await query('SELECT * FROM Inventory WHERE editionId = ?', [id]))[0];
export const sepayHook = (payload, key = 'sepay-key') =>
  api('POST', '/api/webhooks/sepay', { headers: key ? { authorization: `Apikey ${key}` } : {}, body: payload });
let txn = 0;
export const sepayPayload = (order, over = {}) => ({
  id: Number(`${Date.now()}${++txn}`.slice(-12)),
  transferType: 'in',
  transferAmount: order.totalAmount,
  content: `MBVCB.123.${order.orderCode}.CT`,
  transactionDate: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' '),
  ...over,
});
export const ghnHook = (code, status, time = new Date()) =>
  api('POST', '/api/webhooks/ghn?token=whk', { body: { OrderCode: code, Status: status, Time: time.toISOString() } });
export { query, uuid, config, pool };
