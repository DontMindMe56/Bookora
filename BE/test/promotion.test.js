// Kiểm thử tích hợp: chiến dịch khuyến mãi (CRUD, chặn bán lỗ, giá thấp nhất, tự áp/gỡ, giá nhập tay). Cần MySQL.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { applyPromotions, promoPrice } from '../src/modules/promotion/promotion.service.js';

const rnd = Math.random().toString(36).slice(2, 8);
let server, base, adminToken, customerToken;
const E = {},
  ids = {}; // E.e1... = editionId, ids.catA/pubA... = id danh mục/NXB

async function api(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
const isbns = {};
async function mkEdition(key, { listPrice, publisher, category, cost }) {
  isbns[key] = isbn13();
  const r = await api('POST', '/api/admin/editions', {
    token: adminToken,
    body: { isbn: isbns[key], title: `KM ${key} ${rnd}`, authors: ['TG'], categories: [category], publisher, format: 'Bìa mềm', listPrice, weightGram: 200 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  E[key] = r.data.editionId;
  await query('UPDATE Edition SET costPrice = ? WHERE editionId = ?', [cost, E[key]]);
}
const ed = async (key) => (await query('SELECT listPrice, salePrice, salePromotionId FROM Edition WHERE editionId = ?', [E[key]]))[0];
const iso = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const promoBody = (o) => ({
  name: `CT ${rnd}`,
  scopeType: 'EDITION',
  discountType: 'PERCENT',
  discountValue: 20,
  startAt: iso(-1),
  endAt: iso(24),
  targets: [],
  ...o,
});

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: `adkm_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin KM' });
  adminToken = (await api('POST', '/api/auth/login', { body: { email: `adkm_${rnd}@example.com`, password: 'Admin12345' } })).data.token;
  const email = `kmcus_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'Khách KM', acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  customerToken = (await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).data.token;

  const [A, B] = [`NXB A ${rnd}`, `NXB B ${rnd}`],
    [CA, CB] = [`TL A ${rnd}`, `TL B ${rnd}`];
  await mkEdition('e1', { listPrice: 100000, publisher: A, category: CA, cost: 50000 });
  await mkEdition('e2', { listPrice: 200000, publisher: A, category: CB, cost: 190000 }); // giảm 20% => 160.000 < giá vốn
  await mkEdition('e3', { listPrice: 50000, publisher: B, category: CA, cost: 0 });
  await mkEdition('e4', { listPrice: 80000, publisher: B, category: CB, cost: 30000 });
  ids.pubA = (await query('SELECT publisherId AS id FROM Publisher WHERE name = ?', [A]))[0].id;
  ids.catA = (await query('SELECT categoryId AS id FROM Category WHERE name = ?', [CA]))[0].id;
});
after(async () => {
  server.close();
  await pool.end();
});

test('công thức giá khuyến mãi', () => {
  assert.equal(promoPrice(100000, 'PERCENT', 20), 80000);
  assert.equal(promoPrice(99999, 'PERCENT', 15), 84999); // làm tròn tới đồng gần nhất
  assert.equal(promoPrice(100000, 'FIXED', 30000), 70000);
});

test('khuyến mãi: chỉ ADMIN; kiểm tra dữ liệu đầu vào', async () => {
  assert.equal((await api('GET', '/api/admin/promotions')).status, 401);
  assert.equal((await api('GET', '/api/admin/promotions', { token: customerToken })).status, 403);
  const post = (o) => api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ targets: [E.e1], ...o }) });
  assert.equal((await post({ discountValue: 100 })).status, 400); // 100% không hợp lệ
  assert.equal((await post({ discountType: 'FIXED', discountValue: 1000.5 })).status, 400);
  assert.equal((await post({ endAt: iso(-0.5) })).status, 400); // kết thúc ở quá khứ
  assert.equal((await post({ startAt: iso(5), endAt: iso(2) })).status, 400);
  assert.equal((await post({ targets: [] })).status, 400);
  let r = await post({ scopeType: 'ISBN_LIST', targets: [isbns.e1, '9780000000002'] });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'UNKNOWN_ISBN');
  r = await post({ scopeType: 'ISBN_LIST', targets: ['abc'] });
  assert.equal(r.status, 400);
  r = await post({ targets: ['3f0a1f0e-1111-4111-8111-111111111111'] });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'UNKNOWN_TARGET');
});

test('chiến dịch đã đến giờ được áp ngay; ấn bản khác không bị ảnh hưởng', async () => {
  const r = await api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ name: `P1 ${rnd}`, targets: [E.e1] }) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.p1 = r.data.promotionId;
  const e1 = await ed('e1');
  assert.equal(e1.salePrice, 80000);
  assert.equal(e1.salePromotionId, ids.p1);
  assert.equal((await ed('e3')).salePrice, null);
  const d = (await api('GET', `/api/admin/promotions/${ids.p1}`, { token: adminToken })).data;
  assert.equal(d.phase, 'RUNNING');
  assert.equal(d.appliedEditions, 1);
  assert.equal(d.targets[0].isbn, isbns.e1);
});

test('bán lỗ: bị chặn nếu không xác nhận; xác nhận phải kèm lý do', async () => {
  const mk = (o) =>
    api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ name: `P2 ${rnd}`, scopeType: 'PUBLISHER', targets: [ids.pubA], ...o }) });
  let r = await mk({});
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'PROMO_BELOW_COST');
  assert.ok(r.data.error.details.editions.some((x) => x.isbn === isbns.e2));
  assert.equal((await mk({ allowBelowCost: true })).status, 400); // thiếu lý do
  r = await mk({ allowBelowCost: true, belowCostReason: 'Xả kho cuối mùa' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.p2 = r.data.promotionId;
  assert.equal((await ed('e2')).salePrice, 160000);
  const log = await query(`SELECT reason FROM AuditLog WHERE entityType='PROMOTION' AND entityId=? AND action='CREATE'`, [ids.p2]);
  assert.equal(log[0].reason, 'Xả kho cuối mùa');
});

test('thuộc nhiều chiến dịch: lấy giá thấp nhất; tạm dừng thì gỡ ngay', async () => {
  // e1 và e3 cùng thể loại A; giảm cố định 30.000
  const r = await api('POST', '/api/admin/promotions', {
    token: adminToken,
    body: promoBody({ name: `P3 ${rnd}`, scopeType: 'CATEGORY', discountType: 'FIXED', discountValue: 30000, targets: [ids.catA] }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.p3 = r.data.promotionId;
  let e1 = await ed('e1');
  assert.equal(e1.salePrice, 70000);
  assert.equal(e1.salePromotionId, ids.p3); // 70.000 < 80.000 (P1/P2)
  assert.equal((await ed('e3')).salePrice, 20000);
  assert.equal((await ed('e2')).salePrice, 160000); // khác thể loại: chỉ P2

  const p = await api('PATCH', `/api/admin/promotions/${ids.p3}`, { token: adminToken, body: { status: 'INACTIVE' } });
  assert.equal(p.status, 200);
  assert.equal(p.data.changed, true);
  e1 = await ed('e1');
  assert.equal(e1.salePrice, 80000); // quay về giá của P1/P2
  assert.equal((await ed('e3')).salePrice, null); // hết chiến dịch => gỡ giá KM
});

test('hết hạn: job chuyển EXPIRED và gỡ giá; gia hạn thì chạy lại', async () => {
  await query(`UPDATE Promotion SET startAt = NOW() - INTERVAL 2 HOUR, endAt = NOW() - INTERVAL 1 MINUTE WHERE promotionId IN (?, ?)`, [ids.p1, ids.p2]);
  const res = await applyPromotions();
  assert.ok(res.expired >= 2 && res.cleared >= 2, JSON.stringify(res));
  assert.equal((await ed('e1')).salePrice, null);
  assert.equal((await ed('e2')).salePrice, null);
  assert.equal((await api('GET', `/api/admin/promotions/${ids.p1}`, { token: adminToken })).data.phase, 'ENDED');
  // sửa khác khi chưa gia hạn => 409
  let r = await api('PATCH', `/api/admin/promotions/${ids.p1}`, { token: adminToken, body: { name: 'Đổi tên' } });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'PROMOTION_ENDED');
  r = await api('PATCH', `/api/admin/promotions/${ids.p1}`, { token: adminToken, body: { endAt: iso(48) } });
  assert.equal(r.status, 200);
  assert.equal((await ed('e1')).salePrice, 80000);
  assert.equal((await api('GET', `/api/admin/promotions/${ids.p1}`, { token: adminToken })).data.status, 'ACTIVE');
});

test('chiến dịch chưa bắt đầu không áp; xóa được. Đã chạy thì chỉ dừng', async () => {
  let r = await api('POST', '/api/admin/promotions', {
    token: adminToken,
    body: promoBody({ name: `P4 ${rnd}`, targets: [E.e4], startAt: iso(5), endAt: iso(30) }),
  });
  assert.equal(r.status, 201);
  const p4 = r.data.promotionId;
  assert.equal((await ed('e4')).salePrice, null);
  assert.equal((await api('GET', `/api/admin/promotions/${p4}`, { token: adminToken })).data.phase, 'SCHEDULED');
  r = await api('DELETE', `/api/admin/promotions/${p4}`, { token: adminToken });
  assert.equal(r.data.deleted, true);
  assert.equal((await api('GET', `/api/admin/promotions/${p4}`, { token: adminToken })).status, 404);

  r = await api('DELETE', `/api/admin/promotions/${ids.p1}`, { token: adminToken });
  assert.equal(r.data.deleted, false);
  assert.equal(r.data.status, 'INACTIVE');
  assert.equal((await ed('e1')).salePrice, null);
  const list = (await api('GET', `/api/admin/promotions?phase=PAUSED&q=${encodeURIComponent('P1 ' + rnd)}`, { token: adminToken })).data;
  assert.equal(list.items.length, 1);
});

test('giá KM nhập tay: không bị job gỡ; chiến dịch chỉ thay khi giá thấp hơn', async () => {
  let r = await api('PATCH', `/api/admin/editions/${E.e3}`, { token: adminToken, body: { salePrice: 10000, reason: 'KM tay' } });
  assert.equal(r.status, 200);
  assert.equal((await ed('e3')).salePromotionId, null);
  await applyPromotions();
  assert.equal((await ed('e3')).salePrice, 10000); // job không gỡ giá nhập tay

  // chiến dịch cho giá 20.000 (cao hơn 10.000) => giữ giá tay
  r = await api('POST', '/api/admin/promotions', {
    token: adminToken,
    body: promoBody({ name: `P5 ${rnd}`, discountType: 'FIXED', discountValue: 30000, targets: [E.e3] }),
  });
  assert.equal(r.status, 201);
  const p5 = r.data.promotionId;
  let e3 = await ed('e3');
  assert.equal(e3.salePrice, 10000);
  assert.equal(e3.salePromotionId, null);
  // tăng mức giảm: 45.000 => 5.000 < 10.000 => chiến dịch thay thế
  r = await api('PATCH', `/api/admin/promotions/${p5}`, { token: adminToken, body: { discountValue: 45000 } });
  assert.equal(r.status, 200);
  e3 = await ed('e3');
  assert.equal(e3.salePrice, 5000);
  assert.equal(e3.salePromotionId, p5);
  await api('DELETE', `/api/admin/promotions/${p5}`, { token: adminToken });
});

test('đổi giá niêm yết khi đang KM: giá KM tính lại theo giá mới', async () => {
  let r = await api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ name: `P6 ${rnd}`, targets: [E.e4] }) });
  assert.equal(r.status, 201);
  const p6 = r.data.promotionId;
  assert.equal((await ed('e4')).salePrice, 64000);
  r = await api('PATCH', `/api/admin/editions/${E.e4}`, { token: adminToken, body: { listPrice: 100000, reason: 'Tăng giá' } });
  assert.equal(r.status, 200);
  assert.equal((await ed('e4')).salePrice, null); // tạm gỡ
  await applyPromotions();
  assert.equal((await ed('e4')).salePrice, 80000); // 20% của 100.000
  await api('DELETE', `/api/admin/promotions/${p6}`, { token: adminToken });
});

test('giá vốn tăng sau khi tạo chiến dịch: job không bán lỗ ngoài ý muốn', async () => {
  const r = await api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ name: `P7 ${rnd}`, targets: [E.e4] }) });
  assert.equal(r.status, 201);
  const p7 = r.data.promotionId;
  assert.equal((await ed('e4')).salePrice, 80000);
  await query('UPDATE Edition SET costPrice = 90000 WHERE editionId = ?', [E.e4]); // nhập hàng giá cao hơn giá KM
  const res = await applyPromotions();
  assert.ok(res.skippedBelowCost >= 1);
  assert.equal((await ed('e4')).salePrice, null);
  await api('DELETE', `/api/admin/promotions/${p7}`, { token: adminToken });
});

test('chạy job đồng thời: không lỗi, kết quả nhất quán', async () => {
  const r = await api('POST', '/api/admin/promotions', { token: adminToken, body: promoBody({ name: `P8 ${rnd}`, targets: [E.e1] }) });
  const results = await Promise.all(Array.from({ length: 5 }, () => applyPromotions()));
  assert.ok(results.every((x) => x === null || typeof x.applied === 'number'));
  assert.equal((await ed('e1')).salePrice, 80000);
  await api('DELETE', `/api/admin/promotions/${r.data.promotionId}`, { token: adminToken });
});
