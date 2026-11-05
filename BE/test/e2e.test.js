import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, resetGhn, placeOrder, orderRow, shipRow, inv, sepayHook, sepayPayload, ghnHook, api, ctx, query } from './helpers.js';

before(setup);
beforeEach(resetGhn);
after(teardown);

const t = (sec) => new Date(Date.now() + sec * 1000);
const staff = (method, path, body) => api(method, `/api/staff/orders/${path}`, { token: ctx.staffToken, body });
const isbnOf = async () => (await query('SELECT isbn FROM Edition WHERE editionId = ?', [ctx.edition]))[0].isbn;

test('luồng chính SePay: đặt hàng → thanh toán → đóng gói → vận đơn → giao → hoàn tất → đánh giá → báo cáo', async () => {
  const before = await inv(ctx.edition);
  const { c, order } = await placeOrder('SEPAY', { qty: 2 });
  assert.deepEqual([order.orderStatus, order.paymentStatus], ['PENDING_PAYMENT', 'UNPAID']);
  assert.equal((await inv(ctx.edition)).qtyReserved, before.qtyReserved + 2);

  assert.equal((await sepayHook(sepayPayload(order))).status, 200);
  assert.deepEqual([(await orderRow(order.orderId)).orderStatus, (await orderRow(order.orderId)).paymentStatus], ['CONFIRMED', 'PAID']);

  const isbn = await isbnOf();
  assert.equal((await staff('POST', `${order.orderId}/packing`, { isbns: [isbn, isbn] })).data.complete, true);
  assert.equal((await staff('POST', `${order.orderId}/shipment`)).status, 200);
  const code = (await shipRow(order.orderId)).ghnOrderCode;
  assert.ok(code);

  for (const [i, s] of ['picked', 'delivering', 'delivered'].entries()) assert.equal((await ghnHook(code, s, t(i + 1))).status, 200);
  const done = await orderRow(order.orderId);
  assert.deepEqual([done.orderStatus, done.paymentStatus, done.shippingStatus], ['COMPLETED', 'PAID', 'DELIVERED']);
  const after = await inv(ctx.edition);
  assert.deepEqual([after.qtyOnHand, after.qtyReserved], [before.qtyOnHand - 2, before.qtyReserved]);

  const mine = await api('GET', `/api/orders/${order.orderId}`, { token: c.token });
  assert.equal(mine.data.orderStatus, 'COMPLETED');
  assert.equal(
    (await api('POST', '/api/reviews', { token: c.token, body: { editionId: ctx.edition, rating: 5, comment: 'Giao nhanh, sách đẹp' } })).status,
    201,
  );
  assert.equal((await api('GET', '/api/admin/reports/overview', { token: ctx.adminToken })).status, 200);
});

test('luồng COD giao thất bại: giao lỗi → hoàn về → kho xác nhận → hàng vào chờ kiểm, không tạo Refund', async () => {
  const before = await inv(ctx.edition);
  const { order } = await placeOrder('COD', { qty: 1 });
  assert.equal((await orderRow(order.orderId)).orderStatus, 'CONFIRMED');
  assert.equal((await staff('POST', `${order.orderId}/shipment`)).status, 200);
  const code = (await shipRow(order.orderId)).ghnOrderCode;
  for (const [i, s] of ['picked', 'delivery_fail', 'returning', 'returned'].entries()) await ghnHook(code, s, t(i + 1));
  assert.equal((await staff('POST', `${order.orderId}/returned-received`)).status, 200);
  const o = await orderRow(order.orderId);
  assert.equal(o.orderStatus, 'RETURNED_TO_WAREHOUSE');
  assert.equal((await query('SELECT 1 FROM Refund WHERE orderId = ?', [order.orderId])).length, 0);
  const after = await inv(ctx.edition);
  assert.equal(after.qtyPendingInspection, before.qtyPendingInspection + 1);
});

test('khách hủy đơn COD trước khi đóng gói: trả hàng giữ, đơn Đã hủy', async () => {
  const before = await inv(ctx.edition);
  const { c, order } = await placeOrder('COD', { qty: 1 });
  assert.equal((await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token, body: { reason: 'Đổi ý' } })).status, 200);
  assert.equal((await orderRow(order.orderId)).orderStatus, 'CANCELLED');
  assert.equal((await inv(ctx.edition)).qtyReserved, before.qtyReserved);
});
