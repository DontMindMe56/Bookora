// Kiểm thử tích hợp: nhà cung cấp, phiếu nhập, giá vốn, kiểm kê. Cần MySQL đã nạp db/01_schema.sql + 02_seed.sql.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ymdVN } from '../src/modules/inventory/lines.js';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { createAutoPurchaseOrders, recomputeStockLevels } from '../src/modules/inventory/inventory.jobs.js';

const rnd = Math.random().toString(36).slice(2, 8);
let server, base, adminToken, staffToken, supplierId, edA, edB, isbnA, isbnB, voucherId, detailA;

async function api(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const newIsbn = () => {
  const d12 = '978605' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +d12[i] * (i % 2 ? 3 : 1);
  return d12 + ((10 - (sum % 10)) % 10);
};
const login = async (email, password) => (await api('POST', '/api/auth/login', { body: { email, password } })).data.token;
const inv = async (editionId) => (await query('SELECT * FROM Inventory WHERE editionId=?', [editionId]))[0];
const cost = async (editionId) => (await query('SELECT costPrice FROM Edition WHERE editionId=?', [editionId]))[0].costPrice;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await createStaffAccount({ email: `ad_${rnd}@example.com`, password: 'Admin12345', fullName: 'Admin Kho' });
  await createStaffAccount({ email: `nv_${rnd}@example.com`, password: 'Staff12345', fullName: 'Nhân viên kho', role: 'STAFF', position: 'Nhân viên kho' });
  adminToken = await login(`ad_${rnd}@example.com`, 'Admin12345');
  staffToken = await login(`nv_${rnd}@example.com`, 'Staff12345');
  for (const [k, title] of [
    ['A', 'Sách kho A'],
    ['B', 'Sách kho B'],
  ]) {
    const isbn = newIsbn();
    const r = await api('POST', '/api/admin/editions', {
      token: adminToken,
      body: {
        isbn,
        title: `${title} ${rnd}`,
        authors: ['Tác giả Kho'],
        categories: ['Kho'],
        publisher: 'NXB Kho',
        format: 'Bìa mềm',
        listPrice: 100000,
        weightGram: 300,
      },
    });
    assert.equal(r.status, 201);
    if (k === 'A') {
      edA = r.data.editionId;
      isbnA = isbn;
    } else {
      edB = r.data.editionId;
      isbnB = isbn;
    }
  }
});
after(async () => {
  server.close();
  await pool.end();
});

test('chỉ nhân viên/quản trị viên dùng được API kho; khách và người chưa đăng nhập bị chặn', async () => {
  assert.equal((await api('GET', '/api/inventory')).status, 401);
  const email = `kh_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'Khách', acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  const customerToken = await login(email, 'Matkhau123');
  assert.equal((await api('GET', '/api/inventory', { token: customerToken })).status, 403);
  assert.equal((await api('GET', '/api/suppliers', { token: staffToken })).status, 200);
});

test('nhà cung cấp: tạo, trùng bị chặn, sửa; chưa dùng thì xóa hẳn', async () => {
  const body = { name: `NCC ${rnd}`, phone: '0901234567', address: '12 Lê Lợi, Q1', leadTimeDays: 5 };
  assert.equal((await api('POST', '/api/suppliers', { token: staffToken, body: { ...body, phone: 'abc' } })).status, 400);
  const ok = await api('POST', '/api/suppliers', { token: staffToken, body });
  assert.equal(ok.status, 201);
  supplierId = ok.data.supplierId;
  assert.equal((await api('POST', '/api/suppliers', { token: staffToken, body })).status, 409);
  assert.equal((await api('PATCH', `/api/suppliers/${supplierId}`, { token: staffToken, body: { leadTimeDays: 10 } })).status, 200);
  const tmp = await api('POST', '/api/suppliers', { token: staffToken, body: { ...body, name: `Tạm ${rnd}` } });
  const del = await api('DELETE', `/api/suppliers/${tmp.data.supplierId}`, { token: staffToken });
  assert.equal(del.data.deleted, true);
});

test('phiếu nhập: xem trước báo lỗi từng dòng; tạo nháp; ISBN lạ bị từ chối', async () => {
  const lines = [
    { isbn: isbnA, quantity: 10, unitCost: 50000 },
    { isbn: '9780000000002', quantity: 1, unitCost: 1 },
  ];
  const pv = await api('POST', '/api/import-vouchers/preview', { token: staffToken, body: { supplierId, lines } });
  assert.equal(pv.status, 200);
  assert.equal(pv.data.valid.length, 1);
  assert.equal(pv.data.errors[0].row, 2);
  assert.equal(pv.data.errors[0].code, 'EDITION_NOT_FOUND');

  const bad = await api('POST', '/api/import-vouchers', { token: staffToken, body: { supplierId, importDate: '2026-01-01', lines } });
  assert.equal(bad.status, 422);
  const future = await api('POST', '/api/import-vouchers', { token: staffToken, body: { supplierId, importDate: '2999-01-01', lines: [lines[0]] } });
  assert.equal(future.status, 400);

  const ok = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: { supplierId, importDate: '2026-01-01', lines: [lines[0], { isbn: isbnB, quantity: 4, unitCost: 20000 }] },
  });
  assert.equal(ok.status, 201);
  voucherId = ok.data.voucherId;
  assert.equal(ok.data.totalQuantity, 14);
  assert.equal(ok.data.totalAmount, 580000);
  assert.equal((await inv(edA)).qtyOnHand, 0); // nháp chưa đụng tồn kho
});

test('xác nhận phiếu: ISBN quét sai bị chặn; sửa số thực nhận; tăng tồn, giá vốn, nhật ký; không xác nhận lần hai', async () => {
  const detail = await api('GET', `/api/import-vouchers/${voucherId}`, { token: staffToken });
  detailA = detail.data.details.find((d) => d.isbn === isbnA);
  const detailB = detail.data.details.find((d) => d.isbn === isbnB);

  let r = await api('POST', `/api/import-vouchers/${voucherId}/confirm`, {
    token: staffToken,
    body: {
      lines: [
        { detailId: detailA.detailId, receivedQty: 9, isbn: isbnB },
        { detailId: detailB.detailId, receivedQty: 4, isbn: isbnB },
      ],
    },
  });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'ISBN_MISMATCH');
  r = await api('POST', `/api/import-vouchers/${voucherId}/confirm`, { token: staffToken, body: { lines: [{ detailId: detailA.detailId, receivedQty: 9 }] } });
  assert.equal(r.data.error.code, 'MISSING_LINES');
  assert.equal((await inv(edA)).qtyOnHand, 0); // các lần lỗi không để lại thay đổi

  r = await api('POST', `/api/import-vouchers/${voucherId}/confirm`, {
    token: staffToken,
    body: {
      lines: [
        { detailId: detailA.detailId, receivedQty: 9, isbn: isbnA },
        { detailId: detailB.detailId, receivedQty: 4, isbn: isbnB },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.totalQuantity, 13);
  assert.equal(r.data.totalAmount, 530000);
  assert.equal((await inv(edA)).qtyOnHand, 9);
  assert.equal(await cost(edA), 50000);
  const mv = await api('GET', `/api/inventory/${edA}/movements`, { token: staffToken });
  assert.equal(mv.data.items[0].movementType, 'IMPORT');
  assert.equal(mv.data.items[0].qtyAfter, 9);
  assert.equal((await api('POST', `/api/import-vouchers/${voucherId}/confirm`, { token: staffToken, body: {} })).status, 409);
  assert.equal((await api('PATCH', `/api/import-vouchers/${voucherId}`, { token: staffToken, body: { importDate: '2026-01-02' } })).status, 409);
});

test('nhập lần hai: giá vốn bình quân gia quyền; điều chỉnh giá nhập chỉ admin và tính lại giá vốn', async () => {
  const d = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: { supplierId, importDate: '2026-01-05', lines: [{ isbn: isbnA, quantity: 9, unitCost: 60000 }] },
  });
  assert.equal((await api('POST', `/api/import-vouchers/${d.data.voucherId}/confirm`, { token: staffToken, body: {} })).status, 200);
  assert.equal((await inv(edA)).qtyOnHand, 18);
  assert.equal(await cost(edA), 55000); // (9*50.000 + 9*60.000) / 18

  const body = { detailId: detailA.detailId, newUnitCost: 40000, reason: 'NCC đổi hóa đơn' };
  assert.equal((await api('POST', `/api/import-vouchers/${voucherId}/cost-adjustments`, { token: staffToken, body })).status, 403);
  const adj = await api('POST', `/api/import-vouchers/${voucherId}/cost-adjustments`, { token: adminToken, body });
  assert.equal(adj.status, 201);
  assert.equal(await cost(edA), 50000); // 55.000 + (40.000-50.000)*9/18
  assert.equal((await api('POST', `/api/import-vouchers/${voucherId}/cost-adjustments`, { token: adminToken, body })).status, 400); // trùng giá hiện tại
});

test('phiếu nháp: hủy được; ấn bản ngừng kinh doanh không được chọn nhưng vẫn kiểm kê được', async () => {
  const d = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: { supplierId, importDate: '2026-01-06', lines: [{ isbn: isbnB, quantity: 1, unitCost: 1000 }] },
  });
  assert.equal((await api('POST', `/api/import-vouchers/${d.data.voucherId}/cancel`, { token: staffToken, body: {} })).data.status, 'CANCELLED');
  assert.equal((await api('POST', `/api/import-vouchers/${d.data.voucherId}/confirm`, { token: staffToken, body: {} })).status, 409);

  await api('PATCH', `/api/admin/editions/${edB}`, { token: adminToken, body: { businessStatus: 'DISCONTINUED', reason: 'Ngừng bán' } });
  const r = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: { supplierId, importDate: '2026-01-06', lines: [{ isbn: isbnB, quantity: 1, unitCost: 1000 }] },
  });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.details[0].code, 'EDITION_DISCONTINUED');
  const adj = await api('POST', '/api/inventory/adjustments', { token: staffToken, body: { reason: 'Kiểm kê quý', lines: [{ isbn: isbnB, actualQty: 3 }] } });
  assert.equal(adj.status, 201);
  assert.equal(adj.data.lines[0].diff, -1);
  assert.equal((await inv(edB)).qtyOnHand, 3);
});

test('kiểm kê: ghi chênh lệch; chặn khi thấp hơn số đang giữ (rollback cả đợt); hư hỏng chỉ giảm', async () => {
  await query('UPDATE Inventory SET qtyReserved=5 WHERE editionId=?', [edA]); // giả lập 5 cuốn đang giữ cho đơn
  let r = await api('POST', '/api/inventory/adjustments', {
    token: staffToken,
    body: {
      reason: 'Kiểm kê',
      lines: [
        { isbn: isbnB, actualQty: 2 },
        { isbn: isbnA, actualQty: 4 },
      ],
    },
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'ADJUST_REJECTED');
  assert.equal((await inv(edB)).qtyOnHand, 3); // dòng hợp lệ trong cùng đợt cũng không được ghi
  assert.equal((await inv(edA)).qtyOnHand, 18);

  r = await api('POST', '/api/inventory/adjustments', {
    token: staffToken,
    body: { reason: 'Rách bìa', lines: [{ isbn: isbnA, actualQty: 16, type: 'DAMAGE' }] },
  });
  assert.equal(r.status, 201);
  assert.equal((await inv(edA)).qtyOnHand, 16);
  r = await api('POST', '/api/inventory/adjustments', {
    token: staffToken,
    body: { reason: 'Rách bìa', lines: [{ isbn: isbnA, actualQty: 20, type: 'DAMAGE' }] },
  });
  assert.equal(r.status, 409);
  await query('UPDATE Inventory SET qtyReserved=0 WHERE editionId=?', [edA]);
});

test('xem tồn kho: lọc dưới mức tối thiểu; ghi đè tồn tối thiểu không bị tính lại; tự tạo phiếu đặt hàng', async () => {
  let r = await api('PATCH', `/api/inventory/${edA}/settings`, {
    token: staffToken,
    body: { minStockLevel: 50, reorderQty: 40, defaultSupplierId: supplierId },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.minStockOverridden, 1);
  r = await api('GET', `/api/inventory?q=${rnd}&filter=below_min`, { token: staffToken });
  assert.ok(r.data.items.some((i) => i.editionId === edA && i.belowMin));

  await recomputeStockLevels({ editionId: edA });
  assert.equal((await inv(edA)).minStockLevel, 50); // đã ghi đè => giữ nguyên

  await createAutoPurchaseOrders();
  const po = await query(
    `SELECT d.qtyOrdered, p.isAuto FROM PurchaseOrderDetail d JOIN PurchaseOrder p ON p.purchaseOrderId=d.purchaseOrderId WHERE d.editionId=?`,
    [edA],
  );
  assert.equal(po.length, 1);
  assert.equal(po[0].qtyOrdered, 40);
  assert.ok(po[0].isAuto);
  await createAutoPurchaseOrders(); // chạy lại không tạo trùng
  assert.equal((await query('SELECT 1 FROM PurchaseOrderDetail WHERE editionId=?', [edA])).length, 1);

  // nhận hàng theo phiếu đặt: quét ISBN tìm phiếu chờ nhận, nhập 40 cuốn => phiếu đặt chuyển RECEIVED
  const found = await api('GET', `/api/purchase-orders/lookup?isbn=${isbnA}`, { token: staffToken });
  assert.equal(found.data.items.length, 1);
  const d = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: {
      supplierId,
      purchaseOrderId: found.data.items[0].purchaseOrderId,
      importDate: '2026-01-07',
      lines: [{ isbn: isbnA, quantity: 40, unitCost: 50000 }],
    },
  });
  assert.equal(d.status, 201);
  assert.equal((await api('POST', `/api/import-vouchers/${d.data.voucherId}/confirm`, { token: staffToken, body: {} })).status, 200);
  assert.equal((await api('GET', `/api/purchase-orders/${found.data.items[0].purchaseOrderId}`, { token: staffToken })).data.status, 'RECEIVED');
});

test('nhà cung cấp đã có phiếu nhập: xóa => chuyển Ngừng hợp tác; không tạo phiếu nhập mới được', async () => {
  const del = await api('DELETE', `/api/suppliers/${supplierId}`, { token: staffToken });
  assert.equal(del.data.deleted, false);
  assert.equal(del.data.status, 'INACTIVE');
  const r = await api('POST', '/api/import-vouchers', {
    token: staffToken,
    body: { supplierId, importDate: '2026-01-08', lines: [{ isbn: isbnA, quantity: 1, unitCost: 1000 }] },
  });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'SUPPLIER_INACTIVE');
  const s = await api('GET', `/api/suppliers/${supplierId}`, { token: staffToken });
  assert.ok(s.data.editions.some((e) => e.isbn === isbnA)); // danh sách đầu sách đã nhập
});

test('ymdVN: ngày theo giờ Việt Nam (đổi ngày lúc 17:00 UTC)', () => {
  assert.equal(ymdVN(new Date('2026-11-04T16:59:00Z')), '20261104');
  assert.equal(ymdVN(new Date('2026-11-04T17:00:00Z')), '20261105');
});
