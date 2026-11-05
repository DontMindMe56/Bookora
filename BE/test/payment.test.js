import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, resetGhn, ghn, placeOrder, orderRow, shipRow, inv, sepayHook, sepayPayload, api, ctx, query } from './helpers.js';
import { config } from '../src/config.js';
import { ensureShipment } from '../src/modules/shipment/shipment.service.js';

before(setup);
beforeEach(resetGhn);
after(teardown);

test('thông tin QR chỉ cho đơn SePay đang chờ thanh toán', async () => {
  const { c, order } = await placeOrder('SEPAY');
  const r = await api('GET', `/api/orders/${order.orderId}/payment`, { token: c.token });
  assert.equal(r.status, 200);
  assert.match(r.data.qrUrl, /amount=\d+&des=DH/);
  assert.equal(r.data.content, order.orderCode);
  const cod = await placeOrder('COD');
  assert.equal((await api('GET', `/api/orders/${cod.order.orderId}/payment`, { token: cod.c.token })).status, 409);
  assert.equal((await api('GET', `/api/orders/${order.orderId}/payment`, { token: cod.c.token })).status, 404);
});

test('webhook: sai/thiếu API key => 401', async () => {
  const { order } = await placeOrder('SEPAY');
  assert.equal((await sepayHook(sepayPayload(order), 'sai')).status, 401);
  assert.equal((await sepayHook(sepayPayload(order), null)).status, 401);
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'UNPAID');
});

test('đặt SEPAY_WEBHOOK_SECRET không làm webhook dùng Apikey bị 401; header chữ ký sai vẫn bị 401', async () => {
  const saved = config.sepay.webhookSecret;
  config.sepay.webhookSecret = 'whsec';
  try {
    const { order } = await placeOrder('SEPAY');
    const p = sepayPayload(order);
    assert.equal((await sepayHook(p, null)).status, 401); // không mang thông tin xác thực nào
    const bad = await api('POST', '/api/webhooks/sepay', {
      headers: { 'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)), 'x-sepay-signature': 'deadbeef' },
      body: p,
    });
    assert.equal(bad.status, 401);
    assert.equal((await sepayHook(p)).status, 200); // Apikey đúng
    assert.equal((await orderRow(order.orderId)).paymentStatus, 'PAID');
  } finally {
    config.sepay.webhookSecret = saved;
  }
});

test('webhook đúng số tiền: xác nhận đơn; gửi lại cùng mã giao dịch chỉ xử lý một lần', async () => {
  const { order } = await placeOrder('SEPAY');
  const p = sepayPayload(order);
  const results = await Promise.all([sepayHook(p), sepayHook(p), sepayHook(p)]);
  assert.ok(results.every((r) => r.status === 200 && r.data.success));
  const o = await orderRow(order.orderId);
  assert.equal(o.orderStatus, 'CONFIRMED');
  assert.equal(o.paymentStatus, 'PAID');
  const [{ n }] = await query(`SELECT COUNT(*) n FROM PaymentTransaction WHERE orderId = ?`, [order.orderId]);
  assert.equal(n, 1);
  const [{ r }] = await query(`SELECT COUNT(*) r FROM Refund WHERE orderId = ?`, [order.orderId]);
  assert.equal(r, 0);
  const [{ e }] = await query(`SELECT COUNT(*) e FROM EmailOutbox WHERE dedupeKey = ?`, [`order-PAID:${order.orderId}`]);
  assert.equal(e, 1);
});

test('webhook: chuyển thiếu => hoàn toàn bộ, đơn vẫn chờ; chuyển dư => nhận đơn + hoàn phần dư', async () => {
  const a = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(a.order, { transferAmount: a.order.totalAmount - 1000 }));
  assert.equal((await orderRow(a.order.orderId)).orderStatus, 'PENDING_PAYMENT');
  const [ra] = await query(`SELECT source, amount FROM Refund WHERE orderId = ?`, [a.order.orderId]);
  assert.deepEqual([ra.source, ra.amount], ['UNDERPAID', a.order.totalAmount - 1000]);

  const b = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(b.order, { transferAmount: b.order.totalAmount + 5000 }));
  assert.equal((await orderRow(b.order.orderId)).paymentStatus, 'PAID');
  const [rb] = await query(`SELECT source, amount FROM Refund WHERE orderId = ?`, [b.order.orderId]);
  assert.deepEqual([rb.source, rb.amount], ['OVERPAID', 5000]);
});

test('webhook đến muộn (đơn hết hạn) => hoàn tiền; giao dịch lạ => ghi nhận + ngoại lệ', async () => {
  const { order } = await placeOrder('SEPAY');
  await query(`UPDATE Orders SET paymentExpiresAt = NOW() - INTERVAL 1 HOUR WHERE orderId = ?`, [order.orderId]);
  await sepayHook(sepayPayload(order));
  const o = await orderRow(order.orderId);
  assert.equal(o.paymentStatus, 'UNPAID');
  assert.equal((await query(`SELECT source FROM Refund WHERE orderId = ?`, [order.orderId]))[0].source, 'LATE_PAYMENT');

  const p = sepayPayload(order, { content: 'chuyen tien khong ma' });
  assert.equal((await sepayHook(p)).status, 200);
  const [t] = await query(`SELECT orderId FROM PaymentTransaction WHERE providerTxnId = ?`, [String(p.id)]);
  assert.equal(t.orderId, null);
  const [{ n }] = await query(`SELECT COUNT(*) n FROM ExceptionItem WHERE type='UNKNOWN_SEPAY_TXN'`);
  assert.ok(n >= 1);
});

test('thanh toán lần hai cho đơn đã trả => DUPLICATE', async () => {
  const { order } = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(order));
  await sepayHook(sepayPayload(order));
  const rows = await query(`SELECT source FROM Refund WHERE orderId = ?`, [order.orderId]);
  assert.deepEqual(
    rows.map((r) => r.source),
    ['DUPLICATE'],
  );
});

test('hủy đơn đã thanh toán tạo Refund; admin đánh dấu đã hoàn => đơn REFUNDED', async () => {
  const { c, order } = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(order));
  const before = await inv(ctx.edition);
  const cancel = await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token, body: {} });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.paymentStatus, 'REFUND_PENDING');
  assert.equal((await inv(ctx.edition)).qtyReserved, before.qtyReserved - 1);
  const list = await api('GET', '/api/admin/refunds?status=AWAITING_APPROVAL', { token: ctx.adminToken });
  const refund = list.data.items.find((r) => r.orderId === order.orderId);
  assert.equal(refund.source, 'CANCEL');
  assert.equal((await api('POST', `/api/admin/refunds/${refund.refundId}/complete`, { token: ctx.staffToken, body: { bankTxnRef: 'X1' } })).status, 403);
  assert.equal((await api('POST', `/api/admin/refunds/${refund.refundId}/complete`, { token: ctx.adminToken, body: { bankTxnRef: 'FT123' } })).status, 200);
  assert.equal((await api('POST', `/api/admin/refunds/${refund.refundId}/complete`, { token: ctx.adminToken, body: { bankTxnRef: 'FT123' } })).status, 409);
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'REFUNDED');
});

test('tạo vận đơn sau khi thanh toán; không tạo trùng khi gọi lại', async () => {
  const { order } = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(order));
  const r = await ensureShipment(order.orderId);
  assert.equal(r.created, true);
  assert.equal((await ensureShipment(order.orderId)).created, false);
  const create = ghn.calls.filter((x) => x.path === '/v2/shipping-order/create');
  assert.equal(create.length, 1);
  assert.equal(create[0].body.cod_amount, 0);
  assert.equal(create[0].body.client_order_code, order.orderCode);
  const s = await shipRow(order.orderId);
  assert.equal(s.status, 'WAITING_PICKUP');
  assert.equal((await orderRow(order.orderId)).shippingStatus, 'WAITING_PICKUP');
});
