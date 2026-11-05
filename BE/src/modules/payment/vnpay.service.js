import { createHmac } from 'node:crypto';
import {
  VNPay,
  ignoreLogger,
  dateFormat,
  IpnSuccess,
  IpnFailChecksum,
  IpnOrderNotFound,
  IpnInvalidAmount,
  IpnUnknownError,
  InpOrderAlreadyConfirmed,
} from 'vnpay';
import { query, withTx } from '../../db.js';
import { config } from '../../config.js';
import { uuid } from '../../utils/security.js';
import { notifyOrder } from '../../services/notify.js';
import { logIntegration } from '../../services/integrationLog.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { createRefund, completeRefund } from '../refund/refund.service.js';
import { scheduleShipment } from '../shipment/shipment.service.js';

let client;
const vnpay = () => {
  const { tmnCode, secret, host } = config.vnpay;
  if (!tmnCode || !secret) throw new AppError(503, 'VNPAY_NOT_CONFIGURED', 'Chưa cấu hình VNPay (VNPAY_TMN_CODE, VNPAY_SECRET)');
  return (client ??= new VNPay({
    tmnCode,
    secureSecret: secret,
    vnpayHost: host,
    testMode: host.includes('sandbox'),
    enableLog: false,
    loggerFn: ignoreLogger,
  }));
};

/** VNPay nhận IPv4: `::1` và `::ffff:a.b.c.d` (Node khi chạy localhost / sau proxy) đổi về IPv4 tương ứng. */
const normalizeIp = (ip) => {
  const v = String(ip || '').replace(/^::ffff:/i, '');
  return !v || v === '::1' ? '127.0.0.1' : v;
};
const parseVnpDate = (s) => (s ? new Date(String(s).replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3T$4:$5:$6+07:00')) : new Date());

/** Mỗi lần khách bấm thanh toán là một lần thử: mã tham chiếu `vnp_TxnRef` riêng, tối đa `maxAttempts` lần cho mỗi đơn. */
export async function createVnpayPayment(customerId, orderId, ip) {
  const client = vnpay();
  return withTx(async (conn) => {
    const [o] = await query('SELECT * FROM Orders WHERE orderId = ? AND customerId = ? FOR UPDATE', [orderId, customerId], conn);
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    if (o.paymentMethod !== 'VNPAY') throw conflict('Đơn hàng không thanh toán qua VNPay', 'NOT_VNPAY_ORDER');
    if (o.orderStatus !== 'PENDING_PAYMENT' || !o.paymentExpiresAt || o.paymentExpiresAt <= new Date())
      throw conflict('Đơn hàng không còn chờ thanh toán', 'ORDER_NOT_PENDING_PAYMENT', { orderStatus: o.orderStatus });
    const [{ n }] = await query(`SELECT COUNT(*) AS n FROM PaymentTransaction WHERE orderId = ? AND provider = 'VNPAY'`, [orderId], conn);
    if (n >= config.vnpay.maxAttempts) throw conflict('Đã quá số lần thanh toán cho phép', 'VNPAY_MAX_ATTEMPTS');
    const txnRef = `${o.orderCode}T${n + 1}`;
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await query(
      `INSERT INTO PaymentTransaction (transactionId, orderId, provider, txnRef, amount, status, createdAt) VALUES (?,?, 'VNPAY', ?, ?, 'PENDING', ?)`,
      [uuid(), orderId, txnRef, o.totalAmount, createdAt],
      conn,
    );
    const paymentUrl = client.buildPaymentUrl({
      vnp_Amount: o.totalAmount,
      vnp_IpAddr: normalizeIp(ip),
      vnp_ReturnUrl: config.vnpay.returnUrl,
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: `Thanh toan don hang ${o.orderCode}`,
      vnp_CreateDate: dateFormat(createdAt),
      vnp_ExpireDate: dateFormat(o.paymentExpiresAt),
    });
    return { orderCode: o.orderCode, amount: o.totalAmount, txnRef, attempt: n + 1, expiresAt: o.paymentExpiresAt, paymentUrl };
  });
}

/** Ghi kết quả một lần thử đang PENDING (đã khóa dòng giao dịch). Đúng một lần nhờ trạng thái PENDING + unique (provider, providerTxnId). */
async function settle(conn, t, { success, providerTxnId, paidAt }) {
  if (!success) {
    await query(`UPDATE PaymentTransaction SET status='FAILED' WHERE transactionId=?`, [t.transactionId], conn);
    return { result: 'FAILED' };
  }
  const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [t.orderId], conn);
  const mark = (status) =>
    query(`UPDATE PaymentTransaction SET status=?, providerTxnId=?, bankTxnAt=? WHERE transactionId=?`, [status, providerTxnId, paidAt, t.transactionId], conn);
  const refundWhole = async (source, reason) => {
    await mark('REFUND_PENDING');
    await createRefund(conn, { order: o, transactionId: t.transactionId, source, amount: t.amount });
    await notifyOrder(conn, o, 'REFUND_LATE', { amount: t.amount, reason, dedupe: t.transactionId });
    return { result: source, orderId: o.orderId };
  };
  if (['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(o.paymentStatus)) return refundWhole('DUPLICATE', 'đơn đã được thanh toán');
  if (o.orderStatus !== 'PENDING_PAYMENT' || !o.paymentExpiresAt || paidAt > o.paymentExpiresAt)
    return refundWhole('LATE_PAYMENT', 'đơn đã hết hạn hoặc đã hủy');
  await mark('SUCCESS');
  await query(`UPDATE Orders SET orderStatus='CONFIRMED', paymentStatus='PAID', confirmedAt=NOW() WHERE orderId=?`, [o.orderId], conn);
  await notifyOrder(conn, o, 'PAID');
  return { result: 'PAID', orderId: o.orderId };
}

async function settleByTxnRef(txnRef, amount, { success, providerTxnId, paidAt }) {
  const out = await withTx(async (conn) => {
    const [t] = await query(`SELECT * FROM PaymentTransaction WHERE txnRef = ? AND provider = 'VNPAY' FOR UPDATE`, [txnRef], conn);
    if (!t) return { code: IpnOrderNotFound };
    if (Number(amount) !== Number(t.amount)) return { code: IpnInvalidAmount };
    if (t.status !== 'PENDING') return { code: InpOrderAlreadyConfirmed };
    return { code: IpnSuccess, ...(await settle(conn, t, { success, providerTxnId, paidAt })) };
  });
  if (out.result === 'PAID') scheduleShipment(out.orderId);
  return out;
}

/** IPN: nguồn xác nhận tiền duy nhất. Luôn trả mã RspCode theo quy định của VNPay. */
export async function handleVnpayIpn(q) {
  const rec = { provider: 'VNPAY', direction: 'IN', endpoint: 'GET /api/webhooks/vnpay/ipn', request: JSON.stringify(q) };
  let res = IpnUnknownError;
  try {
    const v = vnpay().verifyIpnCall(q);
    if (!v.isVerified) res = IpnFailChecksum;
    else {
      const out = await settleByTxnRef(v.vnp_TxnRef, v.vnp_Amount, {
        success: v.isSuccess,
        providerTxnId: String(q.vnp_TransactionNo ?? ''),
        paidAt: parseVnpDate(q.vnp_PayDate),
      });
      res = out.code;
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return InpOrderAlreadyConfirmed;
    await logIntegration({ ...rec, response: e.message, status: 500, success: false });
    return IpnUnknownError;
  }
  await logIntegration({ ...rec, response: JSON.stringify(res), status: 200, success: res === IpnSuccess });
  return res;
}

/** Return URL chỉ để hiển thị cho khách; không đổi trạng thái đơn. */
export async function vnpayReturn(q) {
  const v = vnpay().verifyReturnUrl(q);
  const [o] = v.isVerified
    ? await query(`SELECT o.orderCode, o.orderStatus, o.paymentStatus FROM PaymentTransaction t JOIN Orders o ON o.orderId = t.orderId WHERE t.txnRef = ?`, [
        q.vnp_TxnRef,
      ])
    : [];
  return { isVerified: v.isVerified, isSuccess: v.isSuccess, message: v.message, ...o };
}

/** QueryDR trước khi hết hạn: IPN có thể bị lỡ, hỏi VNPay các lần thử còn PENDING của đơn. */
export async function reconcileVnpayOrder(orderId) {
  const pending = await query(
    `SELECT txnRef, createdAt FROM PaymentTransaction WHERE orderId = ? AND provider = 'VNPAY' AND status = 'PENDING' ORDER BY createdAt`,
    [orderId],
  );
  for (const t of pending) {
    try {
      const r = await vnpay().queryDr({
        vnp_RequestId: uuid().replace(/-/g, '').slice(0, 32),
        vnp_TxnRef: t.txnRef,
        vnp_OrderInfo: `Truy van ${t.txnRef}`,
        vnp_TransactionDate: dateFormat(t.createdAt),
        vnp_CreateDate: dateFormat(new Date()),
        vnp_IpAddr: '127.0.0.1',
      });
      await logIntegration({
        provider: 'VNPAY',
        endpoint: 'POST querydr',
        request: JSON.stringify({ orderId, txnRef: t.txnRef }),
        response: JSON.stringify(r),
        success: Boolean(r.isVerified),
        referenceId: orderId,
      });
      if (!r.isVerified || String(r.vnp_ResponseCode) !== '00') continue;
      const paid = String(r.vnp_TransactionStatus) === '00';
      await settleByTxnRef(t.txnRef, r.vnp_Amount, { success: paid, providerTxnId: String(r.vnp_TransactionNo ?? ''), paidAt: parseVnpDate(r.vnp_PayDate) });
    } catch (e) {
      await logIntegration({
        provider: 'VNPAY',
        endpoint: 'POST querydr',
        request: JSON.stringify({ orderId, txnRef: t.txnRef }),
        response: e.message,
        success: false,
        referenceId: orderId,
      });
      console.error('[vnpay:querydr]', t.txnRef, e.message);
    }
  }
}

const REFUND_PATH = '/merchant_webapi/api/transaction';
const REFUND_TIMEOUT_MS = 15000;
const hmac512 = (secret, parts) =>
  createHmac('sha512', secret)
    .update(
      parts
        .map(String)
        .join('|')
        .replace(/undefined/g, ''),
    )
    .digest('hex');

/**
 * Gọi API hoàn tiền VNPay (không dùng `client.refund` của thư viện: thư viện chia `vnp_Amount` phản hồi cho 100
 * *trước* khi kiểm chữ ký, trong khi VNPay ký trên giá trị gốc (x100) => hoàn tiền thật thành công vẫn bị coi là
 * chưa xác thực). Ở đây kiểm chữ ký trên phản hồi thô; chấp nhận cả biến thể đã chia 100 để không phụ thuộc vào
 * cách VNPay ký, và bắt buộc phải có `vnp_SecureHash`.
 */
async function callVnpayRefund(p) {
  const { tmnCode, secret, host } = config.vnpay;
  const body = {
    vnp_RequestId: p.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: tmnCode,
    vnp_TransactionType: p.type,
    vnp_TxnRef: p.txnRef,
    vnp_Amount: p.amount * 100,
    vnp_OrderInfo: p.orderInfo,
    vnp_TransactionNo: p.transactionNo,
    vnp_TransactionDate: p.transactionDate,
    vnp_CreateBy: p.createBy,
    vnp_CreateDate: p.createDate,
    vnp_IpAddr: p.ip,
  };
  body.vnp_SecureHash = hmac512(secret, [
    body.vnp_RequestId,
    body.vnp_Version,
    body.vnp_Command,
    body.vnp_TmnCode,
    body.vnp_TransactionType,
    body.vnp_TxnRef,
    body.vnp_Amount,
    body.vnp_TransactionNo,
    body.vnp_TransactionDate,
    body.vnp_CreateBy,
    body.vnp_CreateDate,
    body.vnp_IpAddr,
    body.vnp_OrderInfo,
  ]);
  const resp = await fetch(host.replace(/\/+$/, '') + REFUND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REFUND_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
  const r = await resp.json();
  const sign = (amount) =>
    hmac512(secret, [
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
  const got = String(r.vnp_SecureHash ?? '');
  const isVerified = got !== '' && (got === sign(r.vnp_Amount) || (r.vnp_Amount != null && got === sign(r.vnp_Amount / 100)));
  return { ...r, isVerified };
}

/** Hoàn tiền toàn phần/một phần qua API VNPay cho khoản Refund gắn với giao dịch VNPay. */
export async function refundViaVnpay(actor, refundId, ip) {
  vnpay(); // kiểm tra đã cấu hình (503 nếu chưa)
  const { r, t } = await withTx(async (conn) => {
    const [r] = await query('SELECT * FROM Refund WHERE refundId = ? FOR UPDATE', [refundId], conn);
    if (!r) throw notFound('Không tìm thấy khoản hoàn tiền');
    const [t] = r.transactionId ? await query('SELECT * FROM PaymentTransaction WHERE transactionId = ?', [r.transactionId], conn) : [];
    if (!t || t.provider !== 'VNPAY' || !t.providerTxnId) throw conflict('Khoản hoàn tiền không gắn với giao dịch VNPay', 'NOT_VNPAY_REFUND');
    if (!['AWAITING_APPROVAL', 'AWAITING_ACCOUNT', 'FAILED'].includes(r.status))
      throw conflict('Khoản hoàn tiền không ở trạng thái có thể hoàn', 'REFUND_NOT_PENDING');
    await query(`UPDATE Refund SET status='PROCESSING_BANK', method='VNPAY_API' WHERE refundId=?`, [refundId], conn);
    return { r, t };
  });
  let res;
  try {
    res = await callVnpayRefund({
      requestId: uuid().replace(/-/g, '').slice(0, 32),
      type: Number(r.amount) === Number(t.amount) ? '02' : '03',
      txnRef: t.txnRef,
      amount: Number(r.amount),
      orderInfo: `Hoan tien ${t.txnRef}`,
      transactionNo: Number(t.providerTxnId),
      transactionDate: dateFormat(t.createdAt),
      createBy: actor.accountId,
      createDate: dateFormat(new Date()),
      ip: normalizeIp(ip),
    });
  } catch (e) {
    res = { isVerified: false, vnp_Message: e.message };
  }
  const ok = res.isVerified && String(res.vnp_ResponseCode) === '00';
  await logIntegration({
    provider: 'VNPAY',
    endpoint: 'POST refund',
    request: JSON.stringify({ refundId, txnRef: t.txnRef }),
    response: JSON.stringify(res),
    success: ok,
    referenceId: refundId,
  });
  if (!ok) {
    // Không xác thực được phản hồi (lỗi mạng, timeout, HTTP lỗi, sai/thiếu chữ ký): VNPay có thể đã hoàn tiền thật.
    const reason = res.isVerified
      ? `VNPay từ chối hoàn tiền: ${res.vnp_Message ?? res.vnp_ResponseCode}`
      : `KHÔNG RÕ KẾT QUẢ hoàn tiền (${res.vnp_Message ?? 'phản hồi không xác thực được'}) — kiểm tra trên cổng merchant VNPay trước khi thử lại để tránh hoàn hai lần; nếu đã hoàn thì dùng /complete`;
    await withTx(async (conn) => {
      await query(`UPDATE Refund SET status='FAILED' WHERE refundId=?`, [refundId], conn);
      await query(
        `INSERT INTO ExceptionItem (exceptionId, type, refType, refId, detail, dueAt, autoCloseAt) VALUES (?, 'REFUND_VNPAY_FAILED', 'REFUND', ?, ?, NOW() + INTERVAL 3 DAY, NOW() + INTERVAL 30 DAY)`,
        [uuid(), refundId, reason.slice(0, 500)],
        conn,
      );
    });
    throw new AppError(502, 'VNPAY_REFUND_FAILED', reason);
  }
  return completeRefund(actor, refundId, { bankTxnRef: String(res.vnp_TransactionNo || res.vnp_TxnRef) });
}
