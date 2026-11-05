import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { notifyOrder } from '../../services/notify.js';
import { conflict, notFound } from '../../utils/errors.js';
import { uuid, randomOrderCode } from '../../utils/security.js';
import { limitOffset, paged } from '../../utils/pagination.js';
import { refundableAmount } from './amount.js';

const PAGE_SIZE = 20;

export async function createRefund(conn, { order, transactionId = null, source, amount }) {
  const [dup] = await query(
    'SELECT refundId FROM Refund WHERE orderId = ? AND source = ? AND transactionId <=> ?',
    [order.orderId, source, transactionId],
    conn,
  );
  if (dup) return dup.refundId;
  const refundId = uuid();
  await query(
    `INSERT INTO Refund (refundId, refundCode, orderId, transactionId, customerId, source, method, amount, status, needsAdminApproval)
     VALUES (?,?,?,?,?,?, 'BANK_TRANSFER', ?, 'AWAITING_APPROVAL', TRUE)`,
    [refundId, 'HT' + randomOrderCode().slice(2), order.orderId, transactionId, order.customerId, source, amount],
    conn,
  );
  if (transactionId) await query(`UPDATE PaymentTransaction SET refundStatus = 'REFUND_PENDING' WHERE transactionId = ?`, [transactionId], conn);
  return refundId;
}

/**
 * Giao dịch thanh toán chính của đơn (chỉ SUCCESS: các giao dịch REFUND_PENDING là khoản chuyển trùng/trễ đã có khoản hoàn riêng)
 * kèm số tiền còn hoàn được cho việc hủy / hoàn hàng (xem refundableAmount).
 */
export async function refundAmountForOrder(conn, orderId) {
  const [t] = await query(
    `SELECT t.transactionId, t.amount, o.totalAmount,
            (SELECT COALESCE(SUM(r.amount), 0) FROM Refund r WHERE r.transactionId = t.transactionId AND r.source = 'OVERPAID') AS overpaidRefunded
       FROM PaymentTransaction t JOIN Orders o ON o.orderId = t.orderId
      WHERE t.orderId = ? AND t.status = 'SUCCESS' AND t.provider <> 'COD' ORDER BY t.createdAt LIMIT 1`,
    [orderId],
    conn,
  );
  return t ? { transactionId: t.transactionId, amount: refundableAmount(t) } : null;
}

export async function listRefunds({ status, page }) {
  const where = status ? 'WHERE r.status = ?' : '',
    params = status ? [status] : [];
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM Refund r ${where}`, params);
  const items = await query(
    `SELECT r.refundId, r.refundCode, r.orderId, o.orderCode, r.source, r.method, r.amount, r.status, r.bankTxnRef, r.createdAt, r.completedAt
       FROM Refund r LEFT JOIN Orders o ON o.orderId = r.orderId ${where} ORDER BY r.createdAt DESC, r.refundId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(items, total, page, PAGE_SIZE);
}

export async function completeRefund(actor, refundId, { bankTxnRef, note }) {
  return withTx(async (conn) => {
    const [r] = await query('SELECT * FROM Refund WHERE refundId = ? FOR UPDATE', [refundId], conn);
    if (!r) throw notFound('Không tìm thấy khoản hoàn tiền');
    if (r.status === 'REFUNDED') throw conflict('Khoản hoàn tiền đã hoàn tất', 'REFUND_ALREADY_DONE');
    await query(
      `UPDATE Refund SET status='REFUNDED', transferredBy=?, transferredAt=NOW(), completedAt=NOW(), bankTxnRef=? WHERE refundId=?`,
      [actor.staffId, bankTxnRef, refundId],
      conn,
    );
    if (r.transactionId) await query(`UPDATE PaymentTransaction SET refundStatus='REFUNDED' WHERE transactionId=?`, [r.transactionId], conn);
    if (r.orderId) {
      const [{ open }] = await query(`SELECT COUNT(*) AS open FROM Refund WHERE orderId = ? AND status <> 'REFUNDED'`, [r.orderId], conn);
      const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [r.orderId], conn);
      if (!open && o.paymentStatus === 'REFUND_PENDING') await query(`UPDATE Orders SET paymentStatus='REFUNDED' WHERE orderId=?`, [r.orderId], conn);
      await notifyOrder(conn, o, 'REFUNDED', { amount: r.amount, bankTxnRef, dedupe: refundId });
    }
    await audit(conn, {
      actorId: actor.accountId,
      action: 'REFUND_DONE',
      entityType: 'REFUND',
      entityId: refundId,
      newValue: { bankTxnRef, amount: r.amount },
      reason: note ?? null,
    });
    return { refundId, status: 'REFUNDED' };
  });
}
