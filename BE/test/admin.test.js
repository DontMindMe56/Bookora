import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkEdition, setup, teardown, api, ctx, rnd, query, newCustomer, placeOrder, ghnHook, shipRow } from './helpers.js';
import { ensureShipment } from '../src/modules/shipment/shipment.service.js';
import { validateParam } from '../src/modules/admin/system.service.js';

before(setup);
after(teardown);
const A = () => ({ token: ctx.adminToken });

test('phân quyền: nhân viên và khách không vào được API quản trị', async () => {
  const c = await newCustomer('x');
  for (const path of ['/api/admin/customers', '/api/admin/staff', '/api/admin/parameters', '/api/admin/audit-logs', '/api/admin/reports/overview']) {
    assert.equal((await api('GET', path, { token: ctx.staffToken })).status, 403, path);
    assert.equal((await api('GET', path, { token: c.token })).status, 403, path);
    assert.equal((await api('GET', path)).status, 401, path);
  }
});

test('khách hàng: tìm, xem chi tiết kèm địa chỉ và đơn', async () => {
  const { c } = await placeOrder('COD');
  const list = await api('GET', `/api/admin/customers?q=${encodeURIComponent(c.email)}`, A());
  assert.equal(list.data.total, 1);
  const d = await api('GET', `/api/admin/customers/${c.customerId}`, A());
  assert.equal(d.data.addresses.length, 1);
  assert.equal(d.data.orders.length, 1);
});

test('khóa / mở khóa: hủy phiên ngay, đăng nhập bị chặn, ghi lịch sử', async () => {
  const c = await newCustomer('lock');
  const [{ accountId }] = await query('SELECT accountId FROM Customer WHERE customerId = ?', [c.customerId]);
  assert.equal((await api('POST', `/api/admin/accounts/${accountId}/lock`, { ...A(), body: { reason: 'Gian lận' } })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: c.token })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: c.email, password: 'Matkhau123' } })).data.error.code, 'ACCOUNT_LOCKED');
  assert.equal((await api('POST', `/api/admin/accounts/${accountId}/lock`, { ...A(), body: { reason: 'Gian lận' } })).status, 409);
  assert.equal((await api('POST', `/api/admin/accounts/${accountId}/unlock`, { ...A(), body: {} })).data.status, 'ACTIVE');
  assert.equal((await api('POST', '/api/auth/login', { body: { email: c.email, password: 'Matkhau123' } })).status, 200);
  const logs = await api('GET', `/api/admin/audit-logs?entityType=account&entityId=${accountId}`, A());
  assert.deepEqual(logs.data.items.map((l) => l.action).sort(), ['LOCK', 'UNLOCK']);
});

test('nhân viên: tạo, đặt mật khẩu lần đầu, hạ quyền; không khóa/hạ quyền admin cuối cùng', async () => {
  const email = `new_${rnd}@example.com`;
  const created = await api('POST', '/api/admin/staff', { ...A(), body: { email, fullName: 'NV Mới', position: 'Nhân viên kho', role: 'STAFF' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await api('POST', '/api/admin/staff', { ...A(), body: { email, fullName: 'NV', position: 'x', role: 'STAFF' } })).status, 409);
  assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).status, 401);

  const [{ body }] = await query(`SELECT body FROM EmailOutbox WHERE toEmail = ? AND subject LIKE 'Đặt mật khẩu%'`, [email]);
  const token = /token=([a-f0-9]{64})/.exec(body)[1];
  assert.equal((await api('POST', '/api/auth/set-password', { body: { token, password: 'Matkhau123' } })).status, 200);
  assert.equal((await api('POST', '/api/auth/set-password', { body: { token, password: 'Matkhau123' } })).status, 400);
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.role, 'STAFF');

  const up = await api('PATCH', `/api/admin/staff/${created.data.staffId}`, { ...A(), body: { role: 'ADMIN' } });
  assert.equal(up.status, 200);
  assert.equal((await api('GET', '/api/admin/customers', { token: login.data.token })).status, 401);
  const relog = await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } });
  assert.equal((await api('GET', '/api/admin/customers', { token: relog.data.token })).status, 200);

  const others = (
    await query(`SELECT accountId FROM Account WHERE role='ADMIN' AND status='ACTIVE' AND email NOT IN (?, ?)`, [`ad_${rnd}@example.com`, email])
  ).map((r) => r.accountId);
  try {
    if (others.length) await query(`UPDATE Account SET status='LOCKED' WHERE accountId IN (?)`, [others]);
    const demote = await api('PATCH', `/api/admin/staff/${created.data.staffId}`, { ...A(), body: { role: 'STAFF' } });
    assert.equal(demote.status, 200);
    const [{ staffId: mainStaff }] = await query(`SELECT s.staffId FROM Staff s JOIN Account a ON a.accountId = s.accountId WHERE a.email = ?`, [
      `ad_${rnd}@example.com`,
    ]);
    const last = await api('PATCH', `/api/admin/staff/${mainStaff}`, { ...A(), body: { role: 'STAFF' } });
    assert.equal(last.data.error.code, 'LAST_ADMIN');
  } finally {
    if (others.length) await query(`UPDATE Account SET status='ACTIVE' WHERE accountId IN (?)`, [others]);
  }
  const [{ accountId: mainId }] = await query('SELECT accountId FROM Account WHERE email = ?', [`ad_${rnd}@example.com`]);
  assert.equal((await api('POST', `/api/admin/accounts/${mainId}/lock`, { ...A(), body: { reason: 'tự khóa' } })).status, 403);
});

test('CRUD thể loại / tác giả / NXB / bộ sách; chỉ xóa khi không còn sách dùng', async () => {
  const cat = await api('POST', '/api/admin/categories', { ...A(), body: { name: `Văn học ${rnd}` } });
  assert.equal(cat.status, 201);
  const catId = cat.data.categoryId;
  assert.equal((await api('POST', '/api/admin/categories', { ...A(), body: { name: `văn hoc ${rnd}` } })).status, 409);
  const child = await api('POST', '/api/admin/categories', { ...A(), body: { name: `Tiểu thuyết ${rnd}`, parentId: catId } });
  assert.equal(child.status, 201);
  assert.equal((await api('POST', '/api/admin/categories', { ...A(), body: { name: `Cháu ${rnd}`, parentId: child.data.categoryId } })).status, 422);
  assert.equal((await api('DELETE', `/api/admin/categories/${catId}`, A())).data.error.code, 'IN_USE');
  assert.equal((await api('DELETE', `/api/admin/categories/${child.data.categoryId}`, A())).status, 200);
  assert.equal((await api('PATCH', `/api/admin/categories/${catId}`, { ...A(), body: { description: 'mô tả' } })).data.description, 'mô tả');
  assert.equal((await api('DELETE', `/api/admin/categories/${catId}`, A())).status, 200);

  const pub = await api('POST', '/api/admin/publishers', { ...A(), body: { name: `NXB X ${rnd}` } });
  const author = await api('POST', '/api/admin/authors', { ...A(), body: { name: `Tác giả X ${rnd}` } });
  const series = await api('POST', '/api/admin/series', { ...A(), body: { name: `Bộ X ${rnd}` } });
  for (const [p, r] of [
    ['publishers', pub],
    ['authors', author],
    ['series', series],
  ]) {
    assert.equal((await api('DELETE', `/api/admin/${p}/${Object.values(r.data)[0]}`, A())).status, 200, p);
  }
  const used = (await api('GET', `/api/admin/publishers?q=${encodeURIComponent(`NXB T ${rnd}`)}`, A())).data.items[0];
  assert.equal((await api('DELETE', `/api/admin/publishers/${used.publisherId}`, A())).status, 409);
});

test('làm sạch HTML ở mọi dữ liệu nhập, giữ nguyên mật khẩu', async () => {
  const r = await api('POST', '/api/admin/authors', {
    ...A(),
    body: { name: `<script>alert(1)</script>Nam <b>Cao</b> ${rnd} & Co`, biography: '<img src=x onerror=alert(1)>Tiểu sử' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.name, `Nam Cao ${rnd} & Co`);
  assert.equal(r.data.biography, 'Tiểu sử');
  const email = `xss_${rnd}@example.com`;
  assert.equal((await api('POST', '/api/auth/register', { body: { email, password: 'Mk<b>123456', fullName: 'A <i>B</i>', acceptTerms: true } })).status, 201);
  await query(`UPDATE Account SET status='ACTIVE' WHERE email=?`, [email]);
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'Mk<b>123456' } });
  assert.equal(login.status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: login.data.token })).data.profile.fullName, 'A B');
});

test('sửa đầy đủ thông tin sách có lịch sử trước/sau', async () => {
  const [{ isbn }] = await query('SELECT isbn FROM Edition WHERE editionId = ?', [ctx.edition]);
  const r = await api('PATCH', `/api/admin/editions/${ctx.edition}/details`, {
    ...A(),
    body: {
      title: `Tên mới ${rnd}`,
      authors: ['Tác giả A', 'Tác giả B'],
      categories: ['Thiếu nhi'],
      publisher: `NXB Mới ${rnd}`,
      pageCount: 321,
      weightGram: 350,
      reason: 'Cập nhật',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.authors, ['Tác giả A', 'Tác giả B']);
  assert.equal(r.data.pageCount, 321);
  assert.equal(r.data.isbn, isbn);
  const found = await api('GET', `/api/books?q=${encodeURIComponent('Tác giả B')}`);
  assert.ok(found.data.items.some((b) => b.title === `Tên mới ${rnd}`));
  const [log] = (await api('GET', `/api/admin/audit-logs?entityId=${ctx.edition}&action=update_details`, A())).data.items;
  assert.equal(log.oldValue.pageCount ?? null, null);
  assert.equal(log.newValue.pageCount, 321);
  assert.equal((await api('PATCH', `/api/admin/editions/${ctx.edition}/details`, { ...A(), body: { isbn: '1234567890123' } })).data.error.code, 'INVALID_ISBN');
  assert.equal((await api('PATCH', `/api/admin/editions/${ctx.edition}/details`, { ...A(), body: {} })).status, 400);
});

test('upload bìa: kiểm tra theo nội dung thật, giới hạn 2 MB, tạo ảnh nhỏ', async () => {
  const png = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
  const base = ctx.baseUrl;
  const send = async (buf, name) => {
    const f = new FormData();
    f.append('cover', new Blob([buf]), name);
    const res = await ctx.rawFetch(`${base}/api/admin/editions/${ctx.edition}/cover`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
      body: f,
    });
    return { status: res.status, data: await res.json() };
  };
  const ok = await send(png, 'bia.png');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const img = await ctx.rawFetch(`${base}${ok.data.coverImageUrl}`);
  assert.equal(img.status, 200);
  assert.equal((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).width, 800);
  const thumb = await ctx.rawFetch(`${base}${ok.data.thumbnailUrl}`);
  assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width, 200);
  assert.equal((await send(Buffer.from('<?php echo 1; ?>'), 'bia.png')).data.error.code, 'INVALID_IMAGE');
  assert.equal(
    (
      await send(
        await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
          .gif()
          .toBuffer(),
        'bia.jpg',
      )
    ).data.error.code,
    'INVALID_IMAGE',
  );
  const big = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(big.length > 2 * 1024 * 1024);
  assert.equal((await send(big, 'big.png')).status, 413);
  const detail = await api('GET', `/api/books/${(await query('SELECT workId FROM Edition WHERE editionId = ?', [ctx.edition]))[0].workId}`);
  assert.match(detail.data.editions[0].coverImageUrl, /\/uploads\/covers\//);
});

test('ảnh mặc định khi chưa có bìa', async () => {
  const id = await mkEdition('Không bìa', 50000, 1);
  const [{ workId }] = await query('SELECT workId FROM Edition WHERE editionId = ?', [id]);
  assert.equal((await api('GET', `/api/books/${workId}`)).data.editions[0].coverImageUrl, '/uploads/covers/default.webp');
  const img = await ctx.rawFetch(`${ctx.baseUrl}/uploads/covers/default.webp`);
  assert.equal(img.status, 200);
});

test('tham số: kiểm tra giá trị, ghi lịch sử, có hiệu lực ngay', async () => {
  assert.equal(validateParam('COD_LIMIT', '1500000'), '1500000');
  assert.equal(validateParam('RETRY_BACKOFF_MINUTES', '1, 5,15'), '1,5,15');
  assert.throws(() => validateParam('COD_LIMIT', '-5'));
  assert.throws(() => validateParam('COD_LIMIT', '12.5'));
  assert.throws(() => validateParam('COD_LIMIT', '0'));
  const [{ paramValue: old }] = await query(`SELECT paramValue FROM SystemParameter WHERE paramKey='COD_LIMIT'`);
  assert.equal((await api('PATCH', '/api/admin/parameters/COD_LIMIT', { ...A(), body: { value: 'abc', reason: 'thử' } })).status, 422);
  assert.equal((await api('PATCH', '/api/admin/parameters/KHONG_CO', { ...A(), body: { value: '5', reason: 'thử' } })).status, 404);
  try {
    assert.equal((await api('PATCH', '/api/admin/parameters/COD_LIMIT', { ...A(), body: { value: 1000, reason: 'Giảm hạn mức' } })).status, 200);
    const c = await newCustomer('cod');
    await api('POST', '/api/cart/items', { token: c.token, body: { editionId: ctx.edition, quantity: 1 } });
    const q = await api('POST', '/api/checkout/quote', { token: c.token, body: { addressId: c.addressId } });
    assert.equal(q.data.paymentMethods.find((m) => m.method === 'COD').available, false);
    const log = (await api('GET', '/api/admin/audit-logs?entityType=parameter&action=update', A())).data.items[0];
    assert.equal(log.newValue.value, '1000');
    assert.equal(log.oldValue.value, old);
  } finally {
    await api('PATCH', '/api/admin/parameters/COD_LIMIT', { ...A(), body: { value: old, reason: 'Khôi phục' } });
  }
});

test('lịch sử thao tác: lọc theo người thực hiện và khoảng thời gian', async () => {
  const [{ accountId }] = await query('SELECT accountId FROM Account WHERE email = ?', [`ad_${rnd}@example.com`]);
  const r = await api(
    'GET',
    `/api/admin/audit-logs?actorId=${accountId}&from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 3600_000).toISOString()}`,
    A(),
  );
  assert.ok(r.data.total > 0);
  assert.ok(r.data.items.every((l) => l.actorId === accountId));
  assert.equal((await api('GET', `/api/admin/audit-logs?to=${new Date(Date.now() - 365 * 86400_000).toISOString()}&actorId=${accountId}`, A())).data.total, 0);
});

test('báo cáo: doanh thu, lợi nhuận, bán chạy, tỷ lệ hủy/trả', async () => {
  await query('UPDATE Edition SET costPrice = 60000 WHERE editionId = ?', [ctx.edition]);
  const done = [];
  for (let i = 0; i < 2; i++) {
    const { order } = await placeOrder('COD', { qty: 2 });
    await ensureShipment(order.orderId);
    const code = (await shipRow(order.orderId)).ghnOrderCode;
    await ghnHook(code, 'picked', new Date(Date.now() + 1000));
    await ghnHook(code, 'delivered', new Date(Date.now() + 2000));
    done.push(order);
  }
  const { c, order: cancelled } = await placeOrder('COD');
  await api('POST', `/api/orders/${cancelled.orderId}/cancel`, { token: c.token, body: {} });
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const range = `from=${today}&to=${today}`;

  const rev = await api('GET', `/api/admin/reports/revenue?${range}&groupBy=day`, A());
  assert.equal(rev.status, 200, JSON.stringify(rev.data));
  const row = rev.data.rows.find((x) => x.group === today);
  const expectedRevenue = done.reduce((s, o) => s + o.subtotal - o.discountAmount, 0);
  assert.ok(Number(row.revenue) >= expectedRevenue);
  assert.ok(Number(row.grossProfit) >= done.reduce((s, o) => s + o.subtotal - 4 * 60000, 0) - 1);
  const month = await api('GET', `/api/admin/reports/revenue?${range}&groupBy=month`, A());
  assert.equal(month.data.rows[0].group, today.slice(0, 7));
  const cat = await api('GET', `/api/admin/reports/revenue?${range}&groupBy=category`, A());
  assert.ok(cat.data.rows.length >= 1);
  const best = await api('GET', `/api/admin/reports/best-sellers?${range}&limit=3`, A());
  assert.ok(best.data.length > 0);
  const ov = await api('GET', `/api/admin/reports/overview?${range}`, A());
  assert.ok(ov.data.cancelRate > 0 && ov.data.completed >= 2 && ov.data.avgOrderValue > 0);
  assert.ok(ov.data.inventory.unitsOnHand > 0);
  assert.equal((await api('GET', '/api/admin/reports/overview?from=2026-02-02&to=2026-01-01', A())).status, 422);
  assert.equal((await api('GET', '/api/admin/reports/revenue?from=abc', A())).status, 400);
});

test('OpenAPI: sinh từ bảng định tuyến, có bảo mật và schema', async () => {
  const spec = await api('GET', '/api/openapi.json');
  assert.equal(spec.status, 200);
  const p = spec.data.paths;
  assert.ok(Object.keys(p).length > 80);
  assert.deepEqual(p['/api/orders/{orderId}/cancel'].post.security, [{ bearerAuth: [] }]);
  assert.ok(p['/api/orders'].post.requestBody.content['application/json'].schema.properties.paymentMethod);
  assert.ok(p['/api/books'].get.parameters.some((x) => x.name === 'q'));
  assert.equal(p['/api/books'].get.security, undefined);
  assert.match(p['/api/admin/staff'].post.description, /ADMIN/);
  assert.ok(p['/api/webhooks/sepay'].post);
  const ui = await ctx.rawFetch(`${ctx.baseUrl}/api/docs/`);
  assert.equal(ui.status, 200);
});

test('tham số: giới hạn riêng từng tham số', () => {
  assert.equal(validateParam('PAYMENT_TIMEOUT_MINUTES', '30'), '30');
  assert.throws(() => validateParam('PAYMENT_TIMEOUT_MINUTES', '1'), /từ 5 đến/); // dưới tối thiểu
  assert.throws(() => validateParam('MAX_LOGIN_FAILS', '21'));
  assert.throws(() => validateParam('CART_MAX_QTY_PER_LINE', '100'));
  assert.equal(validateParam('FREE_SHIPPING_THRESHOLD', '0'), '0');
  assert.equal(validateParam('SAFETY_STOCK_DEFAULT', '0'), '0');
  assert.throws(() => validateParam('COD_LIMIT', '50000001'));
  assert.equal(validateParam('RETRY_BACKOFF_MINUTES', '1,5,15'), '1,5,15');
  assert.throws(() => validateParam('RETRY_BACKOFF_MINUTES', '1,5,2000'));
  assert.throws(() => validateParam('RETRY_BACKOFF_MINUTES', '1,2,3,4,5,6,7,8,9,10,11'));
  assert.throws(() => validateParam('RETRY_BACKOFF_MINUTES', '1,,5'));
});
