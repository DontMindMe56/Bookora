import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setup, teardown, resetGhn, placeOrder, orderRow, api, config, query } from './helpers.js';

before(async () => {
  Object.assign(config.vnpay, { tmnCode: 'TMNTEST', secret: 'vnpay-secret' });
  await setup();
});
beforeEach(resetGhn);
after(teardown);

const sign = (o) =>
  createHmac('sha512', config.vnpay.secret)
    .update(
      Object.keys(o)
        .sort()
        .map((k) => `${k}=${encodeURIComponent(o[k]).replace(/%20/g, '+')}`)
        .join('&'),
    )
    .digest('hex');

let seq = 0;
const ipn = (txnRef, amount, over = {}) => {
  const q = {
    vnp_Amount: String(amount * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'Thanh toan',
    vnp_PayDate: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace(/[-:T]/g, ''),
    vnp_ResponseCode: '00',
    vnp_TmnCode: config.vnpay.tmnCode,
    vnp_TransactionNo: String(14_000_000 + ++seq + Math.floor(Math.random() * 1e6)),
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
    ...over,
  };
  return api('GET', `/api/webhooks/vnpay/ipn?${new URLSearchParams({ ...q, vnp_SecureHash: over.vnp_SecureHash ?? sign(q) })}`);
};
const pay = (c, order) => api('POST', `/api/orders/${order.orderId}/vnpay`, { token: c.token });

test('tạo URL thanh toán: mã tham chiếu mỗi lần thử, tối đa 5 lần, chỉ đơn VNPay của chính khách', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const r = await pay(c, order);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.paymentUrl, /vnp_SecureHash=/);
  assert.equal(new URL(r.data.paymentUrl).searchParams.get('vnp_IpAddr'), '127.0.0.1'); // ::1 / ::ffff:127.0.0.1 => IPv4
  assert.equal(r.data.txnRef, `${order.orderCode}T1`);
  assert.equal((await pay(c, order)).data.txnRef, `${order.orderCode}T2`);
  for (let i = 0; i < 3; i++) assert.equal((await pay(c, order)).status, 201);
  assert.equal((await pay(c, order)).status, 409);
  const cod = await placeOrder('COD');
  assert.equal((await pay(cod.c, cod.order)).status, 409);
  assert.equal((await pay(cod.c, order)).status, 404);
});

test('IPN: sai chữ ký => 97; sai số tiền => 04; mã lạ => 01', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await pay(c, order)).data;
  assert.equal((await ipn(txnRef, order.totalAmount, { vnp_SecureHash: 'x'.repeat(128) })).data.RspCode, '97');
  assert.equal((await ipn(txnRef, order.totalAmount - 1)).data.RspCode, '04');
  assert.equal((await ipn('KHONGCOMA', order.totalAmount)).data.RspCode, '01');
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'UNPAID');
});

test('IPN thành công: xác nhận đơn một lần; gọi lại => 02', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await pay(c, order)).data;
  const q = { vnp_TransactionNo: String(Date.now()) };
  const [a, b] = await Promise.all([ipn(txnRef, order.totalAmount, q), ipn(txnRef, order.totalAmount, q)]);
  assert.deepEqual([a.data.RspCode, b.data.RspCode].sort(), ['00', '02']);
  const o = await orderRow(order.orderId);
  assert.equal(o.orderStatus, 'CONFIRMED');
  assert.equal(o.paymentStatus, 'PAID');
  const [t] = await query('SELECT status, providerTxnId FROM PaymentTransaction WHERE txnRef = ?', [txnRef]);
  assert.deepEqual({ ...t }, { status: 'SUCCESS', providerTxnId: q.vnp_TransactionNo });
});

test('IPN thất bại (mã 24): lần thử FAILED, đơn vẫn chờ, thanh toán lại được', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await pay(c, order)).data;
  assert.equal((await ipn(txnRef, order.totalAmount, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })).data.RspCode, '00');
  assert.equal((await orderRow(order.orderId)).orderStatus, 'PENDING_PAYMENT');
  assert.equal((await pay(c, order)).status, 201);
});

test('hai lần thử đều thành công: lần sau tạo Refund DUPLICATE, đơn chỉ xác nhận một lần', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const t1 = (await pay(c, order)).data.txnRef;
  const t2 = (await pay(c, order)).data.txnRef;
  await ipn(t1, order.totalAmount);
  await ipn(t2, order.totalAmount);
  const refunds = await query('SELECT source FROM Refund WHERE orderId = ?', [order.orderId]);
  assert.deepEqual(
    refunds.map((r) => r.source),
    ['DUPLICATE'],
  );
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'PAID');
});

test('IPN đến muộn (đơn đã hết hạn) => hoàn toàn bộ', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await pay(c, order)).data;
  await query(`UPDATE Orders SET orderStatus='EXPIRED' WHERE orderId=?`, [order.orderId]);
  assert.equal((await ipn(txnRef, order.totalAmount)).data.RspCode, '00');
  const [r] = await query('SELECT source, amount FROM Refund WHERE orderId = ?', [order.orderId]);
  assert.equal(r.source, 'LATE_PAYMENT');
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'UNPAID');
});

test('trang Return chỉ hiển thị, không đổi trạng thái đơn', async () => {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await pay(c, order)).data;
  const q = {
    vnp_Amount: String(order.totalAmount * 100),
    vnp_OrderInfo: 'x',
    vnp_ResponseCode: '00',
    vnp_TmnCode: config.vnpay.tmnCode,
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
  };
  const r = await api('GET', `/api/webhooks/vnpay/return?${new URLSearchParams({ ...q, vnp_SecureHash: sign(q) })}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.isVerified, r.data.isSuccess, r.data.orderCode], [true, true, order.orderCode]);
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'UNPAID');
});
