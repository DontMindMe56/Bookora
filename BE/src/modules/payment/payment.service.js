import { query, withTx } from '../../db.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { uuid } from '../../utils/security.js';
import { getInt } from '../../services/params.js';
import { notifyOrder } from '../../services/notify.js';
import { logIntegration } from '../../services/integrationLog.js';
import { AppError, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { createRefund } from '../refund/refund.service.js';
import { scheduleShipment } from '../shipment/shipment.service.js';

const ORDER_CODE = /DH[A-Z0-9]{8}/;

export async function paymentInfo(customerId, orderId) {
  const [o] = await query(
    'SELECT orderId, orderCode, orderStatus, paymentStatus, paymentMethod, totalAmount, paymentExpiresAt FROM Orders WHERE orderId = ? AND customerId = ?',
    [orderId, customerId],
  );
  if (!o) throw notFound('Không tìm thấy đơn hàng');
  if (o.paymentMethod !== 'SEPAY') throw conflict('Đơn hàng không thanh toán qua chuyển khoản', 'NOT_SEPAY_ORDER');
  if (o.orderStatus !== 'PENDING_PAYMENT')
    throw conflict('Đơn hàng không còn chờ thanh toán', 'ORDER_NOT_PENDING_PAYMENT', { orderStatus: o.orderStatus, paymentStatus: o.paymentStatus });
  const { bank, accountNo, accountName } = config.sepay;
  if (!bank || !accountNo) throw new AppError(503, 'SEPAY_NOT_CONFIGURED', 'Chưa cấu hình tài khoản nhận tiền SePay');
  const qs = new URLSearchParams({ acc: accountNo, bank, amount: String(o.totalAmount), des: o.orderCode });
  return {
    orderCode: o.orderCode,
    amount: o.totalAmount,
    bank,
    accountNo,
    accountName,
    content: o.orderCode,
    expiresAt: o.paymentExpiresAt,
    qrUrl: `https://qr.sepay.vn/img?${qs}`,
  };
}

function checkSepayHmac(req) {
  const ts = req.get('x-sepay-timestamp') ?? '';
  const sig = (req.get('x-sepay-signature') ?? '').replace(/^sha256=/, '');
  const expected = createHmac('sha256', config.sepay.webhookSecret)
    .update(`${ts}.${req.rawBody ?? ''}`)
    .digest('hex');
  const a = Buffer.from(sig),
    b = Buffer.from(expected);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300 || a.length !== b.length || !timingSafeEqual(a, b))
    throw unauthorized('Chữ ký webhook không hợp lệ', 'INVALID_SIGNATURE');
}

function checkSepayKey(header = '') {
  const key = config.sepay.apiKey;
  if (!key) throw new AppError(503, 'SEPAY_NOT_CONFIGURED', 'Chưa cấu hình SEPAY_API_KEY');
  const m = /^Apikey\s+(.+)$/i.exec(header.trim());
  if (!m || m[1] !== key) throw unauthorized('API key không hợp lệ', 'INVALID_API_KEY');
}

/**
 * SePay gửi `Authorization: Apikey <key>` (cách README/Swagger mô tả). Chữ ký HMAC chỉ dùng khi request THỰC SỰ mang header chữ ký:
 * đặt SEPAY_WEBHOOK_SECRET không còn làm mọi webhook dùng API key bị 401. Request không mang thông tin xác thực nào hợp lệ => 401.
 */
function authenticateSepay(req) {
  const { apiKey, webhookSecret } = config.sepay;
  if (!apiKey && !webhookSecret) throw new AppError(503, 'SEPAY_NOT_CONFIGURED', 'Chưa cấu hình SEPAY_API_KEY hoặc SEPAY_WEBHOOK_SECRET');
  if (webhookSecret && req.get('x-sepay-signature')) return checkSepayHmac(req);
  if (apiKey && req.get('authorization')) return checkSepayKey(req.get('authorization'));
  throw unauthorized('Thiếu thông tin xác thực webhook', 'INVALID_API_KEY');
}

const bankTime = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}+07:00`) : new Date());

async function handleSepayWebhook(p) {
  if (p?.id == null || p.transferAmount == null) throw new AppError(400, 'BAD_PAYLOAD', 'Payload không hợp lệ');
  if (p.transferType && p.transferType !== 'in') return { ignored: true };
  const amount = Math.round(Number(p.transferAmount));
  if (!(amount > 0)) throw new AppError(400, 'BAD_PAYLOAD', 'Số tiền không hợp lệ');
  const providerTxnId = String(p.id);
  const content = String(p.content ?? p.description ?? '');
  const code = `${p.code ?? ''} ${content}`.toUpperCase().match(ORDER_CODE)?.[0];
  const at = bankTime(p.transactionDate);
  const grace = await getInt('SEPAY_GRACE_MINUTES');

  try {
    const out = await withTx(async (conn) => {
      let o = null;
      if (code) [o] = await query(`SELECT * FROM Orders WHERE orderCode = ? AND paymentMethod = 'SEPAY' FOR UPDATE`, [code], conn);
      const transactionId = uuid();
      const insert = (status) =>
        query(
          `INSERT INTO PaymentTransaction (transactionId, orderId, provider, providerTxnId, amount, status, transferContent, bankTxnAt, rawPayload) VALUES (?,?,?,?,?,?,?,?,?)`,
          [transactionId, o?.orderId ?? null, 'SEPAY', providerTxnId, amount, status, content.slice(0, 255), at, JSON.stringify(p)],
          conn,
        );

      if (!o) {
        await insert('SUCCESS');
        await query(
          `INSERT INTO ExceptionItem (exceptionId, type, refType, refId, detail, dueAt, autoCloseAt) VALUES (?, 'UNKNOWN_SEPAY_TXN', 'PAYMENT', ?, ?, NOW() + INTERVAL 3 DAY, NOW() + INTERVAL 30 DAY)`,
          [uuid(), transactionId, `Không xác định được đơn: ${content}`.slice(0, 500)],
          conn,
        );
        return { result: 'UNKNOWN' };
      }

      const refundWhole = async (source, reason) => {
        await insert('REFUND_PENDING');
        await createRefund(conn, { order: o, transactionId, source, amount });
        await notifyOrder(conn, o, 'REFUND_LATE', { amount, reason, dedupe: providerTxnId });
        return { result: source, orderId: o.orderId };
      };

      if (o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUND_PENDING' || o.paymentStatus === 'REFUNDED')
        return refundWhole('DUPLICATE', 'đơn đã được thanh toán');
      const inTime = o.orderStatus === 'PENDING_PAYMENT' && o.paymentExpiresAt && at.getTime() <= o.paymentExpiresAt.getTime() + grace * 60_000;
      if (!inTime) return refundWhole('LATE_PAYMENT', 'đơn đã hết hạn hoặc đã hủy');
      if (amount < o.totalAmount) return refundWhole('UNDERPAID', 'số tiền chuyển chưa đủ');

      await insert('SUCCESS');
      await query(`UPDATE Orders SET orderStatus='CONFIRMED', paymentStatus='PAID', confirmedAt=NOW() WHERE orderId=?`, [o.orderId], conn);
      if (amount > o.totalAmount) await createRefund(conn, { order: o, transactionId, source: 'OVERPAID', amount: amount - o.totalAmount });
      await notifyOrder(conn, o, 'PAID');
      return { result: 'PAID', orderId: o.orderId };
    });
    if (out.result === 'PAID') scheduleShipment(out.orderId);
    return out;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && /uq_pt_provider_txn/.test(e.message)) return { result: 'DUPLICATE_WEBHOOK' };
    throw e;
  }
}

export async function sepayWebhook(req) {
  const payload = req.body;
  const rec = { provider: 'SEPAY', direction: 'IN', endpoint: 'POST /api/webhooks/sepay', request: JSON.stringify(payload), referenceId: undefined };
  try {
    authenticateSepay(req);
    const r = await handleSepayWebhook(payload);
    await logIntegration({ ...rec, response: JSON.stringify(r), status: 200, success: true });
    return r;
  } catch (e) {
    await logIntegration({ ...rec, response: e.message, status: e.status ?? 500, success: false });
    throw e;
  }
}
