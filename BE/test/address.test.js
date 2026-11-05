// Kiểm thử tích hợp: sổ địa chỉ, danh mục GHN (GHN được giả lập bằng cách chặn fetch), yêu thích. Cần MySQL.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';

const rnd = Math.random().toString(36).slice(2, 8);
const P = 8_000_000 + Math.floor(Math.random() * 900_000),
  D = P + 1; // mã địa giới giả, tránh trùng dữ liệu thật
let server,
  base,
  adminToken,
  tokenA,
  tokenB,
  editionId,
  addr = [];

const realFetch = globalThis.fetch;
async function api(method, path, { body, token } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function newCustomer(tag) {
  const email = `${tag}_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: `Khách ${tag}`, acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  return (await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).data.token;
}
const body = (ward = 'W1', extra = {}) => ({
  receiverName: 'Nguyễn Văn A',
  phone: '0901234567',
  detail: '12 Lê Lợi',
  ghnProvinceId: P,
  ghnDistrictId: D,
  ghnWardCode: `${rnd}${ward}`,
  ...extra,
});

before(async () => {
  config.ghn.token = '';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: `ad_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin' });
  adminToken = (await api('POST', '/api/auth/login', { body: { email: `ad_${rnd}@example.com`, password: 'Admin12345' } })).data.token;
  tokenA = await newCustomer('a');
  tokenB = await newCustomer('b');
  await query('INSERT INTO GhnProvince (provinceId, name) VALUES (?, ?)', [P, 'Tỉnh Test']);
  await query('INSERT INTO GhnDistrict (districtId, provinceId, name) VALUES (?,?,?)', [D, P, 'Quận Test']);
  for (const w of ['W1', 'W2', 'W3']) await query('INSERT INTO GhnWard (districtId, wardCode, name) VALUES (?,?,?)', [D, `${rnd}${w}`, `Phường ${w}`]);
  const isbn = (() => {
    const d12 = '978606' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    let s = 0;
    for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1);
    return d12 + ((10 - (s % 10)) % 10);
  })();
  const ed = await api('POST', '/api/admin/editions', {
    token: adminToken,
    body: {
      isbn,
      title: `Sách yêu thích ${rnd}`,
      authors: ['TG'],
      categories: ['Test'],
      publisher: 'NXB Test',
      format: 'Bìa mềm',
      listPrice: 90000,
      weightGram: 250,
    },
  });
  editionId = ed.data.editionId;
});
after(async () => {
  globalThis.fetch = realFetch;
  server.close();
  await pool.end();
});

test('danh mục địa giới công khai, theo phân cấp', async () => {
  assert.ok((await api('GET', '/api/geo/provinces')).data.items.some((p) => p.provinceId === P));
  assert.deepEqual(
    (await api('GET', `/api/geo/provinces/${P}/districts`)).data.items.map((d) => d.districtId),
    [D],
  );
  assert.equal((await api('GET', `/api/geo/districts/${D}/wards`)).data.items.length, 3);
  assert.equal((await api('GET', '/api/geo/provinces/abc/districts')).status, 400);
});

test('địa chỉ: cần đăng nhập, kiểm tra SĐT và địa giới GHN; địa chỉ đầu tự là mặc định', async () => {
  assert.equal((await api('GET', '/api/addresses')).status, 401);
  assert.equal((await api('POST', '/api/addresses', { token: tokenA, body: { ...body(), phone: '123' } })).status, 400);
  let r = await api('POST', '/api/addresses', { token: tokenA, body: { ...body(), ghnWardCode: 'khong-co' } });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'ADDRESS_NOT_IN_GHN');
  r = await api('POST', '/api/addresses', { token: tokenA, body: { ...body(), ghnDistrictId: D + 99 } }); // sai phân cấp
  assert.equal(r.status, 422);

  r = await api('POST', '/api/addresses', { token: tokenA, body: body('W1') });
  assert.equal(r.status, 201);
  assert.equal(r.data.isDefault, true);
  assert.equal(r.data.ward, 'Phường W1');
  assert.equal(r.data.province, 'Tỉnh Test'); // tên lấy từ danh mục GHN
  addr.push(r.data.addressId);
  r = await api('POST', '/api/addresses', { token: tokenA, body: body('W2') });
  assert.equal(r.data.isDefault, false);
  addr.push(r.data.addressId);
});

test('đổi mặc định chỉ còn một địa chỉ mặc định; xóa mặc định thì chọn địa chỉ dùng gần nhất', async () => {
  let r = await api('POST', '/api/addresses', { token: tokenA, body: body('W3', { isDefault: true }) });
  addr.push(r.data.addressId);
  let list = (await api('GET', '/api/addresses', { token: tokenA })).data.items;
  assert.equal(list.filter((a) => a.isDefault).length, 1);
  assert.equal(list[0].addressId, addr[2]);

  await query('UPDATE Address SET lastUsedAt = NOW() WHERE addressId = ?', [addr[1]]); // addr[1] mới dùng gần đây
  r = await api('DELETE', `/api/addresses/${addr[2]}`, { token: tokenA });
  assert.equal(r.data.newDefaultId, addr[1]);
  list = (await api('GET', '/api/addresses', { token: tokenA })).data.items;
  assert.equal(list.find((a) => a.isDefault).addressId, addr[1]);

  r = await api('PATCH', `/api/addresses/${addr[1]}`, { token: tokenA, body: { isDefault: false } });
  assert.equal(r.status, 400); // không bỏ mặc định trực tiếp
  r = await api('PATCH', `/api/addresses/${addr[0]}`, { token: tokenA, body: { ghnWardCode: `${rnd}W2` } });
  assert.equal(r.status, 400); // đổi khu vực phải đủ tỉnh/quận/phường
  r = await api('PATCH', `/api/addresses/${addr[0]}`, {
    token: tokenA,
    body: { detail: '99 Nguyễn Huệ', ghnProvinceId: P, ghnDistrictId: D, ghnWardCode: `${rnd}W2` },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ward, 'Phường W2');
  assert.equal(r.data.detail, '99 Nguyễn Huệ');
});

test('địa chỉ của người khác không xem/sửa/xóa được; tối đa 10 địa chỉ', async () => {
  for (const [m, p, b] of [
    ['PATCH', `/api/addresses/${addr[0]}`, { detail: 'x' }],
    ['DELETE', `/api/addresses/${addr[0]}`],
    ['POST', `/api/addresses/${addr[0]}/default`],
  ]) {
    assert.equal((await api(m, p, { token: tokenB, body: b })).status, 404);
  }
  assert.equal((await api('GET', '/api/addresses', { token: tokenB })).data.items.length, 0);
  for (let i = 0; i < 10; i++) assert.equal((await api('POST', '/api/addresses', { token: tokenB, body: body('W1') })).status, 201);
  const over = await api('POST', '/api/addresses', { token: tokenB, body: body('W1') });
  assert.equal(over.status, 409);
  assert.equal(over.data.error.code, 'ADDRESS_LIMIT');
});

test('yêu thích: cần đăng nhập, thêm idempotent, sách ngừng bán hiện nhãn "Không còn bán"', async () => {
  assert.equal((await api('GET', '/api/wishlist')).status, 401);
  assert.equal((await api('POST', '/api/wishlist', { token: tokenA, body: { editionId: '00000000-0000-4000-8000-000000000000' } })).status, 404);
  let r = await api('POST', '/api/wishlist', { token: tokenA, body: { editionId } });
  assert.equal(r.status, 201);
  assert.equal(r.data.added, true);
  assert.equal((await api('POST', '/api/wishlist', { token: tokenA, body: { editionId } })).data.added, false);
  r = await api('GET', '/api/wishlist', { token: tokenA });
  assert.equal(r.data.total, 1);
  assert.equal(r.data.items[0].available, true);
  assert.equal((await api('GET', '/api/wishlist', { token: tokenB })).data.total, 0);

  await api('PATCH', `/api/admin/editions/${editionId}`, { token: adminToken, body: { businessStatus: 'DISCONTINUED', reason: 'Ngừng bán' } });
  r = await api('GET', '/api/wishlist', { token: tokenA });
  assert.equal(r.data.items[0].available, false);
  assert.equal(r.data.items[0].label, 'Không còn bán');
  assert.equal((await api('POST', '/api/wishlist', { token: tokenB, body: { editionId } })).status, 422);

  assert.equal((await api('DELETE', `/api/wishlist/${editionId}`, { token: tokenA })).data.removed, true);
  assert.equal((await api('GET', '/api/wishlist', { token: tokenA })).data.total, 0);
});

test('đồng bộ danh mục GHN: cần token; phường đổi tên/biến mất => needsConfirm; xác nhận lại', async () => {
  assert.equal((await api('POST', '/api/admin/geo/sync', { token: adminToken })).status, 503); // chưa cấu hình
  assert.equal((await api('POST', '/api/admin/geo/sync', { token: tokenA })).status, 403);

  // GHN giả: W1 đổi tên, W2 biến mất, W3 giữ nguyên
  config.ghn.token = 'test-token';
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith(config.ghn.baseUrl)) return realFetch(url, opts);
    const path = String(url).slice(config.ghn.baseUrl.length).split('?')[0];
    const ok = (data) => new Response(JSON.stringify({ code: 200, message: 'Success', data }), { status: 200 });
    if (path === '/master-data/province') return ok([{ ProvinceID: P, ProvinceName: 'Tỉnh Test' }]);
    if (path === '/master-data/district') return ok([{ DistrictID: D, DistrictName: 'Quận Test' }]);
    if (path === '/master-data/ward')
      return ok([
        { WardCode: `${rnd}W1`, WardName: 'Phường Một Mới' },
        { WardCode: `${rnd}W3`, WardName: 'Phường W3' },
      ]);
    return new Response('{}', { status: 404 });
  };
  // dữ liệu: addr[0] đang ở W2 (sau PATCH), addr[1] ở W2; thêm một địa chỉ ở W1 và một ở W3
  const w1 = (await api('POST', '/api/addresses', { token: tokenA, body: body('W1') })).data.addressId;
  const w3 = (await api('POST', '/api/addresses', { token: tokenA, body: body('W3') })).data.addressId;

  assert.equal((await api('POST', '/api/admin/geo/sync', { token: adminToken })).status, 202);
  let st;
  for (let i = 0; i < 50; i++) {
    st = (await api('GET', '/api/admin/geo/status', { token: adminToken })).data;
    if (!st.running) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(st.running, false);
  assert.equal(st.lastError, null);
  assert.equal(st.lastResult.wards, 2);

  const list = (await api('GET', '/api/addresses', { token: tokenA })).data.items;
  const flag = (id) => list.find((a) => a.addressId === id).needsConfirm;
  assert.equal(flag(addr[0]), true); // W2 biến mất
  assert.equal(flag(w1), true); // W1 đổi tên
  assert.equal(flag(w3), false); // W3 không đổi
  assert.equal((await api('GET', `/api/geo/districts/${D}/wards`)).data.items.length, 2); // chỉ phường còn hoạt động

  assert.equal((await api('POST', `/api/addresses/${addr[0]}/confirm`, { token: tokenA })).status, 422); // W2 không còn trong GHN
  const ok = await api('POST', `/api/addresses/${w1}/confirm`, { token: tokenA });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.needsConfirm, false);
  assert.equal(ok.data.ward, 'Phường Một Mới');
  const fixed = await api('PATCH', `/api/addresses/${addr[0]}`, { token: tokenA, body: { ghnProvinceId: P, ghnDistrictId: D, ghnWardCode: `${rnd}W3` } });
  assert.equal(fixed.data.needsConfirm, false); // chọn lại khu vực => hết cờ
  assert.equal((await api('POST', '/api/addresses', { token: tokenA, body: body('W2') })).status, 422); // phường đã gỡ không chọn mới được
});
