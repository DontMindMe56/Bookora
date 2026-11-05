import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setup, teardown, resetGhn, placeOrder, orderRow, api, config, query, ctx, sepayHook, sepayPayload } from './helpers.js';

const ENDPOINT = '/merchant_webapi/api/transaction';
const hmac = (parts) =>
  createHmac('sha512', config.vnpay.secret)
    .update(
      parts
        .map(String)
        .join('|')
        .replace(/undefined/g, ''),
    )
    .digest('hex');
const requestHash = (b) =>
  hmac([
    b.vnp_RequestId,
    b.vnp_Version,
    b.vnp_Command,
    b.vnp_TmnCode,
    b.vnp_TransactionType,
    b.vnp_TxnRef,
    b.vnp_Amount,
    b.vnp_TransactionNo,
    b.vnp_TransactionDate,
    b.vnp_CreateBy,
    b.vnp_CreateDate,
    b.vnp_IpAddr,
    b.vnp_OrderInfo,
  ]);
// VNPay ký phản hồi trên vnp_Amount gốc (x100); `legacyAmount` giả lập biến thể ký trên số đã chia 100.
const responseHash = (r, amount) =>
  hmac([
    r.vnp_ResponseId,
    r.vnp_Command,
    r.vnp_ResponseCode,
    r.vnp_Message,
    r.vnp_TmnCode,
    r.vnp_TxnRef,
    amount,
    r.vnp_BankCode,
    r.vnp_PayDate,
    r.vnp_TransactionNo,
    r.vnp_TransactionType,
    r.vnp_TransactionStatus,
    r.vnp_OrderInfo,
  ]);

const vnp = { calls: [], code: '00', httpStatus: 200, badSignature: false, delayMs: 0, legacyAmount: false, noHash: false };
const resetVnp = () => Object.assign(vnp, { calls: [], code: '00', httpStatus: 200, badSignature: false, delayMs: 0, legacyAmount: false, noHash: false });
let realFetch,
  seq = 0;

before(async () => {
  await setup();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith(config.vnpay.host + ENDPOINT)) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    vnp.calls.push({ ...body, signatureOk: body.vnp_SecureHash === requestHash(body) });
    if (vnp.delayMs) await new Promise((r) => setTimeout(r, vnp.delayMs));
    if (vnp.httpStatus !== 200) return new Response('lỗi', { status: vnp.httpStatus });
    const r = {
      vnp_ResponseId: `RS${++seq}`,
      vnp_Command: 'refund',
      vnp_ResponseCode: vnp.code,
      vnp_Message: vnp.code === '00' ? 'Refund Success' : 'Refund Failed',
      vnp_TmnCode: body.vnp_TmnCode,
      vnp_TxnRef: body.vnp_TxnRef,
      vnp_Amount: body.vnp_Amount,
      vnp_BankCode: 'NCB',
      vnp_PayDate: body.vnp_CreateDate,
      vnp_TransactionNo: String(15_000_000 + seq),
      vnp_TransactionType: body.vnp_TransactionType,
      vnp_TransactionStatus: '05',
      vnp_OrderInfo: body.vnp_OrderInfo,
    };
    r.vnp_SecureHash = vnp.badSignature ? 'x'.repeat(128) : responseHash(r, vnp.legacyAmount ? r.vnp_Amount / 100 : r.vnp_Amount);
    if (vnp.noHash) delete r.vnp_SecureHash;
    return new Response(JSON.stringify(r));
  };
});
beforeEach(() => {
  resetGhn();
  resetVnp();
});
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

/** Đơn VNPay đã thanh toán (qua IPN) rồi khách hủy => một Refund CANCEL gắn giao dịch VNPay. */
async function paidVnpayRefund() {
  const { c, order } = await placeOrder('VNPAY');
  const { txnRef } = (await api('POST', `/api/orders/${order.orderId}/vnpay`, { token: c.token })).data;
  const q = {
    vnp_Amount: String(order.totalAmount * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'Thanh toan',
    vnp_PayDate: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace(/[-:T]/g, ''),
    vnp_ResponseCode: '00',
    vnp_TmnCode: config.vnpay.tmnCode,
    vnp_TransactionNo: String(14_000_000 + ++seq + Math.floor(Math.random() * 1e6)), // ngẫu nhiên để chạy lại không cần DB sạch
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
  };
  const ipn = await api('GET', `/api/webhooks/vnpay/ipn?${new URLSearchParams({ ...q, vnp_SecureHash: sign(q) })}`);
  assert.equal(ipn.data.RspCode, '00');
  assert.equal((await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token, body: {} })).status, 200);
  const [refund] = await query('SELECT * FROM Refund WHERE orderId = ?', [order.orderId]);
  return { order, refund, txnRef, providerTxnId: q.vnp_TransactionNo };
}
const refundVia = (id, token = ctx.adminToken) => api('POST', `/api/admin/refunds/${id}/vnpay`, { token });
const refundRow = async (id) => (await query('SELECT * FROM Refund WHERE refundId = ?', [id]))[0];
const exceptions = (id) => query(`SELECT type, detail FROM ExceptionItem WHERE refId = ? AND type = 'REFUND_VNPAY_FAILED'`, [id]);

test('hoàn toàn phần: gọi VNPay đúng tham số, Refund và đơn thành REFUNDED, gọi lại => 409', async () => {
  const { order, refund, txnRef, providerTxnId } = await paidVnpayRefund();
  const r = await refundVia(refund.refundId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(vnp.calls.length, 1);
  const [call] = vnp.calls;
  assert.equal(call.signatureOk, true);
  assert.equal(call.vnp_TransactionType, '02');
  assert.equal(call.vnp_TxnRef, txnRef);
  assert.equal(call.vnp_Amount, order.totalAmount * 100);
  assert.equal(Number(call.vnp_TransactionNo), Number(providerTxnId));
  const done = await refundRow(refund.refundId);
  assert.deepEqual([done.status, done.method], ['REFUNDED', 'VNPAY_API']);
  assert.match(done.bankTxnRef, /^\d+$/);
  assert.equal((await orderRow(order.orderId)).paymentStatus, 'REFUNDED');
  const [t] = await query('SELECT refundStatus FROM PaymentTransaction WHERE txnRef = ?', [txnRef]);
  assert.equal(t.refundStatus, 'REFUNDED');
  assert.equal((await refundVia(refund.refundId)).status, 409);
  assert.equal(vnp.calls.length, 1);
});

test('chữ ký phản hồi ký trên số đã chia 100 (biến thể) vẫn được chấp nhận', async () => {
  vnp.legacyAmount = true;
  const { refund } = await paidVnpayRefund();
  assert.equal((await refundVia(refund.refundId)).status, 200);
  assert.equal((await refundRow(refund.refundId)).status, 'REFUNDED');
});

test('hoàn một phần: gửi loại giao dịch 03 và đúng số tiền', async () => {
  const { refund } = await paidVnpayRefund();
  const partial = refund.amount - 10000;
  await query('UPDATE Refund SET amount = ? WHERE refundId = ?', [partial, refund.refundId]);
  assert.equal((await refundVia(refund.refundId)).status, 200);
  assert.equal(vnp.calls[0].vnp_TransactionType, '03');
  assert.equal(vnp.calls[0].vnp_Amount, partial * 100);
});

test('VNPay từ chối: 502, Refund FAILED, tạo ngoại lệ; thử lại thành công thì REFUNDED', async () => {
  const { refund } = await paidVnpayRefund();
  vnp.code = '91';
  const r = await refundVia(refund.refundId);
  assert.equal(r.status, 502);
  assert.equal(r.data.error.code, 'VNPAY_REFUND_FAILED');
  assert.equal((await refundRow(refund.refundId)).status, 'FAILED');
  const [rej] = await exceptions(refund.refundId);
  assert.doesNotMatch(rej.detail, /KHÔNG RÕ KẾT QUẢ/); // bị từ chối rõ ràng => thử lại an toàn
  vnp.code = '00';
  assert.equal((await refundVia(refund.refundId)).status, 200);
  assert.equal((await refundRow(refund.refundId)).status, 'REFUNDED');
  assert.equal(vnp.calls.length, 2);
});

test('lỗi mạng/HTTP 500 từ VNPay và phản hồi sai chữ ký đều coi là thất bại, không đánh dấu đã hoàn', async () => {
  for (const setFailure of [() => (vnp.httpStatus = 500), () => (vnp.badSignature = true), () => (vnp.noHash = true)]) {
    resetVnp();
    setFailure();
    const { refund } = await paidVnpayRefund();
    assert.equal((await refundVia(refund.refundId)).status, 502);
    const row = await refundRow(refund.refundId);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.completedAt, null);
    const ex = await exceptions(refund.refundId);
    assert.equal(ex.length, 1);
    assert.match(ex[0].detail, /KHÔNG RÕ KẾT QUẢ/); // không rõ kết quả => cảnh báo kiểm tra trước khi thử lại
  }
});

test('hai yêu cầu đồng thời: chỉ một lần gọi VNPay (khóa bằng PROCESSING_BANK)', async () => {
  const { refund } = await paidVnpayRefund();
  vnp.delayMs = 300;
  const rs = await Promise.all([refundVia(refund.refundId), refundVia(refund.refundId)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(vnp.calls.length, 1);
  assert.equal((await refundRow(refund.refundId)).status, 'REFUNDED');
});

test('chỉ ADMIN; khoản không tồn tại => 404; khoản không gắn giao dịch VNPay => 409', async () => {
  const { refund } = await paidVnpayRefund();
  assert.equal((await refundVia(refund.refundId, ctx.staffToken)).status, 403);
  assert.equal((await refundVia(refund.refundId, null)).status, 401);
  assert.equal((await refundVia('00000000-0000-4000-8000-000000000000')).status, 404);

  const { c, order } = await placeOrder('SEPAY');
  assert.equal((await sepayHook(sepayPayload(order))).status, 200);
  assert.equal((await api('POST', `/api/orders/${order.orderId}/cancel`, { token: c.token, body: {} })).status, 200);
  const [sepayRefund] = await query('SELECT refundId FROM Refund WHERE orderId = ?', [order.orderId]);
  assert.equal((await refundVia(sepayRefund.refundId)).status, 409);
  assert.equal(vnp.calls.length, 0);
  assert.equal((await refundRow(refund.refundId)).status, 'AWAITING_APPROVAL');
});
