import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rnd, setup, teardown, resetGhn, ghn, placeOrder, orderRow, shipRow, inv, sepayHook, sepayPayload, ghnHook, api, ctx, query } from './helpers.js';
import { ensureShipment, syncShipments, autoReceiveReturned, retryPendingShipments, ghnEventTime } from '../src/modules/shipment/shipment.service.js';
import { mapGhnStatus, shouldApply } from '../src/modules/shipment/ghnStatus.js';

before(setup);
beforeEach(resetGhn);
after(teardown);

const codOrder = async (qty = 2) => {
  const o = await placeOrder('COD', { qty });
  await ensureShipment(o.order.orderId);
  return { ...o, ship: await shipRow(o.order.orderId) };
};
const t = (sec) => new Date(Date.now() + sec * 1000);

test('hàm thuần: ánh xạ trạng thái GHN và chống lùi', () => {
  assert.equal(mapGhnStatus('delivery_fail'), 'FAILED');
  assert.equal(mapGhnStatus('scrap'), 'LOST');
  assert.equal(mapGhnStatus('return_sorting'), 'RETURNING');
  assert.equal(mapGhnStatus('???'), null);
  const at = new Date('2026-01-01T10:00:00Z'),
    old = new Date('2026-01-01T09:00:00Z');
  assert.equal(shouldApply({ current: 'DELIVERING', next: 'WAITING_PICKUP', lastEventAt: at, eventAt: old }), false);
  assert.equal(shouldApply({ current: 'FAILED', next: 'DELIVERING', lastEventAt: old, eventAt: at }), true);
  assert.equal(shouldApply({ current: 'DELIVERED', next: 'DELIVERING', lastEventAt: old, eventAt: at }), false);
});

test('tạo vận đơn lỗi: tự thử lại 3 lần; sau khi thất bại job thử tiếp', async () => {
  const { order } = await placeOrder('COD');
  ghn.createFail = 3;
  const r = await ensureShipment(order.orderId);
  assert.equal(r.created, false);
  assert.equal(ghn.calls.filter((x) => x.path === '/v2/shipping-order/create').length, 3);
  assert.equal((await shipRow(order.orderId)).ghnOrderCode, null);
  await query(`UPDATE Shipment SET lastSyncAt = NOW() - INTERVAL 5 MINUTE WHERE orderId = ?`, [order.orderId]);
  assert.equal((await ensureShipment(order.orderId)).created, true);
  assert.ok((await shipRow(order.orderId)).ghnOrderCode);
  assert.equal(typeof (await retryPendingShipments()).tried, 'number');
});

test('lần thử lại dùng mã đơn khách để tránh tạo trùng khi GHN đã tạo', async () => {
  const { order } = await placeOrder('COD');
  ghn.createFail = 1;
  ghn.clientLookup = { order_code: `EX${rnd}`, total_fee: 20000 };
  const r = await ensureShipment(order.orderId);
  assert.equal(r.ghnOrderCode, `EX${rnd}`);
  assert.equal(ghn.calls.filter((x) => x.path === '/v2/shipping-order/create').length, 1);
});

test('claim lại sau lần claim bị đứt giữa chừng: hỏi GHN theo mã đơn khách trước, không tạo trùng vận đơn', async () => {
  const { order } = await placeOrder('COD');
  ghn.createFail = 3; // lần đầu thất bại hết lượt thử => shipment đã từng được claim (lastSyncAt != NULL), chưa có mã GHN
  assert.equal((await ensureShipment(order.orderId)).created, false);
  const createsBefore = ghn.calls.filter((x) => x.path === '/v2/shipping-order/create').length;
  await query(`UPDATE Shipment SET lastSyncAt = NOW() - INTERVAL 5 MINUTE WHERE orderId = ?`, [order.orderId]);
  ghn.clientLookup = { order_code: `RC${rnd}`, total_fee: 21000 }; // GHN thực ra đã tạo vận đơn trước khi tiến trình cũ chết
  const r = await ensureShipment(order.orderId);
  assert.equal(r.ghnOrderCode, `RC${rnd}`);
  assert.equal(ghn.calls.filter((x) => x.path === '/v2/shipping-order/create').length, createsBefore); // không gọi create lần nữa
  assert.equal((await shipRow(order.orderId)).ghnOrderCode, `RC${rnd}`);
});

test('claim lại: vận đơn GHN cùng mã đơn khách nhưng đã hủy thì bỏ qua và tạo mới', async () => {
  const { order } = await placeOrder('COD');
  ghn.createFail = 3;
  await ensureShipment(order.orderId);
  await query(`UPDATE Shipment SET lastSyncAt = NOW() - INTERVAL 5 MINUTE WHERE orderId = ?`, [order.orderId]);
  ghn.clientLookup = { order_code: `OLD${rnd}`, status: 'cancel', total_fee: 1 };
  const r = await ensureShipment(order.orderId);
  assert.equal(r.created, true);
  assert.notEqual(r.ghnOrderCode, `OLD${rnd}`);
});

test('webhook GHN: sai token 401; đơn lạ bỏ qua', async () => {
  assert.equal((await api('POST', '/api/webhooks/ghn?token=sai', { body: { OrderCode: 'X', Status: 'picked' } })).status, 401);
  const r = await ghnHook('KHONGCO', 'picked');
  assert.equal(r.status, 200);
});

test('GHN lấy hàng: xuất kho đúng một lần, chốt giá vốn; COD giao xong => hoàn tất', async () => {
  await query('UPDATE Edition SET costPrice = 45000 WHERE editionId = ?', [ctx.edition]);
  const before = await inv(ctx.edition);
  const { order, ship } = await codOrder(2);
  const code = ship.ghnOrderCode;
  assert.equal(code.startsWith('GHN'), true);

  await ghnHook(code, 'picked', t(1));
  await ghnHook(code, 'picked', t(1));
  const mid = await inv(ctx.edition);
  assert.equal(mid.qtyOnHand, before.qtyOnHand - 2);
  assert.equal(mid.qtyReserved, before.qtyReserved);
  const [item] = await query('SELECT costPrice FROM OrderItem WHERE orderId = ?', [order.orderId]);
  assert.equal(item.costPrice, 45000);
  const [mv] = await query(`SELECT quantity FROM StockMovement WHERE referenceId = ? AND movementType = 'SALE'`, [order.orderId]);
  assert.equal(mv.quantity, -2);
  assert.equal((await orderRow(order.orderId)).shippingStatus, 'DELIVERING');

  await ghnHook(code, 'ready_to_pick', t(-60));
  assert.equal((await shipRow(order.orderId)).status, 'DELIVERING');

  await ghnHook(code, 'delivered', t(5));
  const o = await orderRow(order.orderId);
  assert.deepEqual([o.orderStatus, o.paymentStatus, o.shippingStatus], ['COMPLETED', 'COD_COLLECTED', 'DELIVERED']);
  assert.ok(o.deliveredAt && o.completedAt);
  await ghnHook(code, 'delivered', t(6));
  const [{ n }] = await query(`SELECT COUNT(*) n FROM PaymentTransaction WHERE orderId = ? AND provider = 'COD'`, [order.orderId]);
  assert.equal(n, 1);
  assert.equal((await inv(ctx.edition)).qtyOnHand, before.qtyOnHand - 2);
});

test('đơn đã thanh toán giao xong => hoàn tất, không đổi trạng thái thanh toán', async () => {
  const { order } = await placeOrder('SEPAY');
  await sepayHook(sepayPayload(order));
  await ensureShipment(order.orderId);
  const code = (await shipRow(order.orderId)).ghnOrderCode;
  await ghnHook(code, 'delivered', t(2));
  const o = await orderRow(order.orderId);
  assert.deepEqual([o.orderStatus, o.paymentStatus], ['COMPLETED', 'PAID']);
});

test('không hủy được sau khi GHN lấy hàng', async () => {
  const { c, order, ship } = await codOrder(1);
  await ghnHook(ship.ghnOrderCode, 'picked', t(1));
  const r = await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token, body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'ORDER_ALREADY_SHIPPED');
});

test('giao thất bại -> hoàn về -> kho xác nhận: hàng vào chờ kiểm; đơn trả trước được hoàn tiền', async () => {
  const before = await inv(ctx.edition);
  const { order } = await placeOrder('SEPAY', { qty: 1 });
  await sepayHook(sepayPayload(order));
  await ensureShipment(order.orderId);
  const code = (await shipRow(order.orderId)).ghnOrderCode;
  await ghnHook(code, 'picked', t(1));
  await ghnHook(code, 'delivery_fail', t(2));
  assert.equal((await orderRow(order.orderId)).shippingStatus, 'FAILED');
  await ghnHook(code, 'delivering', t(3));
  await ghnHook(code, 'delivery_fail', t(4));
  await ghnHook(code, 'waiting_to_return', t(5));
  assert.equal((await orderRow(order.orderId)).shippingStatus, 'RETURNING');
  await ghnHook(code, 'returned', t(6));
  assert.equal((await orderRow(order.orderId)).orderStatus, 'RETURNED');

  assert.equal((await api('POST', `/api/staff/orders/${order.orderId}/returned-received`, { token: ctx.staffToken })).status, 200);
  assert.equal((await api('POST', `/api/staff/orders/${order.orderId}/returned-received`, { token: ctx.staffToken })).status, 409);
  const o = await orderRow(order.orderId);
  assert.deepEqual([o.orderStatus, o.paymentStatus], ['RETURNED_TO_WAREHOUSE', 'REFUND_PENDING']);
  const after = await inv(ctx.edition);
  assert.equal(after.qtyPendingInspection, before.qtyPendingInspection + 1);
  assert.equal(after.qtyOnHand, before.qtyOnHand - 1);
  const [r] = await query(`SELECT source, amount FROM Refund WHERE orderId = ?`, [order.orderId]);
  assert.deepEqual([r.source, r.amount], ['RETURNED_TO_WAREHOUSE', order.totalAmount]);
});

test('đơn COD hoàn về: tự chuyển về kho sau hạn, không tạo Refund', async () => {
  const { order, ship } = await codOrder(1);
  await ghnHook(ship.ghnOrderCode, 'picked', t(1));
  await ghnHook(ship.ghnOrderCode, 'returned', t(2));
  await query(`UPDATE Shipment SET updatedAt = NOW() - INTERVAL 8 DAY WHERE orderId = ?`, [order.orderId]);
  await autoReceiveReturned();
  const o = await orderRow(order.orderId);
  assert.equal(o.orderStatus, 'RETURNED_TO_WAREHOUSE');
  assert.ok(o.completedAt);
  assert.equal((await query(`SELECT 1 FROM Refund WHERE orderId = ?`, [order.orderId])).length, 0);
});

test('đồng bộ định kỳ kéo trạng thái từ GHN', async () => {
  const { order, ship } = await codOrder(1);
  ghn.statuses[ship.ghnOrderCode] = 'delivering';
  await query(`UPDATE Shipment SET lastSyncAt = NOW() - INTERVAL 1 HOUR WHERE orderId = ?`, [order.orderId]);
  await syncShipments();
  assert.equal((await shipRow(order.orderId)).status, 'DELIVERING');
  assert.ok((await shipRow(order.orderId)).pickedUpAt);
});

test('đóng gói: quét ISBN, tự chuyển Đang đóng gói, báo thiếu/thừa', async () => {
  const { order } = await codOrder(2);
  const [{ isbn }] = await query('SELECT isbn FROM Edition WHERE editionId = ?', [ctx.edition]);
  const one = await api('POST', `/api/staff/orders/${order.orderId}/packing`, { token: ctx.staffToken, body: { isbns: [isbn] } });
  assert.equal(one.status, 200);
  assert.equal(one.data.complete, false);
  assert.equal((await orderRow(order.orderId)).orderStatus, 'PACKING');
  const mails = () => query(`SELECT COUNT(*) AS n FROM EmailOutbox WHERE dedupeKey = ?`, [`order-PACKING:${order.orderId}`]);
  assert.equal((await mails())[0].n, 1);
  const full = await api('POST', `/api/staff/orders/${order.orderId}/packing`, { token: ctx.staffToken, body: { isbns: [isbn, isbn] } });
  assert.equal(full.data.complete, true);
  const extra = await api('POST', `/api/staff/orders/${order.orderId}/packing`, { token: ctx.staffToken, body: { isbns: [isbn, isbn, '9786000000000'] } });
  assert.deepEqual(extra.data.unexpected, ['9786000000000']);
  assert.equal((await api('POST', `/api/staff/orders/${order.orderId}/packing`, { body: { isbns: [isbn] } })).status, 401);
});

test('GHN báo thất lạc: đơn trả trước => hủy + hoàn tiền + ngoại lệ; xuất kho một lần; webhook trùng không tạo thêm', async () => {
  const before = await inv(ctx.edition);
  const { order } = await placeOrder('SEPAY', { qty: 1 });
  await sepayHook(sepayPayload(order));
  await ensureShipment(order.orderId);
  const code = (await shipRow(order.orderId)).ghnOrderCode;
  await ghnHook(code, 'picked', t(1));
  await ghnHook(code, 'lost', t(2));
  await ghnHook(code, 'lost', t(3));
  const o = await orderRow(order.orderId);
  assert.deepEqual([o.orderStatus, o.paymentStatus, o.shippingStatus], ['CANCELLED', 'REFUND_PENDING', 'LOST']);
  const refunds = await query('SELECT source, amount FROM Refund WHERE orderId = ?', [order.orderId]);
  assert.deepEqual(
    refunds.map((r) => [r.source, r.amount]),
    [['CANCEL', order.totalAmount]],
  );
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ExceptionItem WHERE type = 'GHN_LOST' AND refId = ?`, [order.orderId]);
  assert.equal(n, 1);
  const after = await inv(ctx.edition);
  assert.deepEqual([after.qtyOnHand, after.qtyReserved], [before.qtyOnHand - 1, before.qtyReserved]);
});

test('GHN báo hư hỏng: đơn COD => hủy, không có Refund', async () => {
  const { order, ship } = await codOrder(1);
  await ghnHook(ship.ghnOrderCode, 'delivering', t(1));
  await ghnHook(ship.ghnOrderCode, 'damage', t(2));
  const o = await orderRow(order.orderId);
  assert.deepEqual([o.orderStatus, o.paymentStatus, o.shippingStatus], ['CANCELLED', 'UNPAID', 'DAMAGED']);
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM Refund WHERE orderId = ?', [order.orderId]);
  assert.equal(n, 0);
});

test('ghnEventTime: lấy thời điểm của log khớp trạng thái, rồi updated_date; không hợp lệ/tương lai => giờ hiện tại', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const d = {
    status: 'delivering',
    updated_date: '2026-01-01T09:50:00Z',
    log: [
      { status: 'picked', updated_date: '2026-01-01T08:00:00Z' },
      { status: 'delivering', updated_date: '2026-01-01T09:30:00Z' },
    ],
  };
  assert.equal(ghnEventTime(d, now).toISOString(), '2026-01-01T09:30:00.000Z');
  assert.equal(ghnEventTime({ status: 'delivering', updated_date: '2026-01-01T09:50:00Z' }, now).toISOString(), '2026-01-01T09:50:00.000Z');
  assert.equal(ghnEventTime({ status: 'delivering' }, now), now);
  assert.equal(ghnEventTime({ status: 'delivering', updated_date: 'khong-hop-le' }, now), now);
  assert.equal(ghnEventTime({ status: 'delivering', updated_date: '2026-01-01T12:00:00Z' }, now), now);
});

test('đồng bộ GHN dùng thời điểm do GHN ghi nhận: webhook muộn hơn nhưng vẫn trước giờ máy chủ không bị bỏ qua', async () => {
  const { order, ship } = await codOrder(1);
  const code = ship.ghnOrderCode;
  ghn.statuses[code] = 'delivering';
  ghn.detailExtra[code] = { updated_date: new Date(Date.now() - 600_000).toISOString() }; // GHN ghi nhận cách đây 10 phút
  await query(`UPDATE Shipment SET lastSyncAt = NOW() - INTERVAL 1 HOUR WHERE orderId = ?`, [order.orderId]);
  await syncShipments();
  assert.equal((await shipRow(order.orderId)).status, 'DELIVERING');
  const r = await ghnHook(code, 'delivered', t(-60)); // sự kiện giao xong cách đây 1 phút: sau lần đồng bộ, trước giờ máy chủ
  assert.equal(r.status, 200);
  assert.equal((await orderRow(order.orderId)).orderStatus, 'COMPLETED');
});

test('GHN hủy vận đơn từ phía GHN khi đơn còn xử lý: ghi ngoại lệ GHN_CANCELLED, báo nhân viên, đơn giữ nguyên và vẫn hủy được', async () => {
  const { order, c, ship } = await codOrder(1);
  const r = await ghnHook(ship.ghnOrderCode, 'cancel', t(1));
  assert.equal(r.status, 200);
  assert.equal((await shipRow(order.orderId)).status, 'CANCELLED');
  assert.equal((await orderRow(order.orderId)).orderStatus, 'CONFIRMED');
  const ex = await query(`SELECT type, status FROM ExceptionItem WHERE refId = ? AND type = 'GHN_CANCELLED'`, [order.orderId]);
  assert.equal(ex.length, 1);
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM EmailOutbox WHERE dedupeKey LIKE ?`, [`ghn-cancelled:${order.orderId}:%`]);
  assert.ok(n >= 2); // ít nhất admin + nhân viên của bộ test
  await ghnHook(ship.ghnOrderCode, 'cancel', t(2)); // gửi lại: không tạo thêm
  assert.equal((await query(`SELECT 1 FROM ExceptionItem WHERE refId = ? AND type = 'GHN_CANCELLED'`, [order.orderId])).length, 1);
  const cancel = await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
});

test('hủy đơn bằng API của ta rồi GHN gửi webhook hủy: không tạo ngoại lệ GHN_CANCELLED', async () => {
  const { order, c, ship } = await codOrder(1);
  assert.equal((await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token })).status, 200);
  await ghnHook(ship.ghnOrderCode, 'cancel', t(1));
  assert.equal((await query(`SELECT 1 FROM ExceptionItem WHERE refId = ? AND type = 'GHN_CANCELLED'`, [order.orderId])).length, 0);
});
