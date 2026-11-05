import { query } from '../../db.js';
import { audit } from '../../services/audit.js';
import { notifyOrder } from '../../services/notify.js';
import { uuid } from '../../utils/security.js';
import { createRefund, refundAmountForOrder } from '../refund/refund.service.js';
import { releaseDiscountCode } from '../discount/discount.service.js';

const WHY = { LOST: 'GHN làm thất lạc hàng', DAMAGED: 'GHN làm hư hỏng hàng' };

export async function handleShipmentLoss(conn, order, status) {
  if (!['CONFIRMED', 'PACKING'].includes(order.orderStatus)) return;
  const paid = order.paymentStatus === 'PAID';
  await query(
    `UPDATE Orders SET orderStatus='CANCELLED', paymentStatus=?, cancelReason=? WHERE orderId=?`,
    [paid ? 'REFUND_PENDING' : order.paymentStatus, WHY[status], order.orderId],
    conn,
  );
  if (paid) {
    const txn = await refundAmountForOrder(conn, order.orderId);
    await createRefund(conn, { order, transactionId: txn?.transactionId ?? null, source: 'CANCEL', amount: txn?.amount ?? order.totalAmount });
  }
  await releaseDiscountCode(conn, order.orderId); // lỗi do bên vận chuyển: khách không mất lượt mã
  await query(
    `INSERT INTO ExceptionItem (exceptionId, type, refType, refId, detail, dueAt, autoCloseAt) VALUES (?, 'GHN_LOST', 'ORDER', ?, ?, NOW() + INTERVAL 3 DAY, NOW() + INTERVAL 30 DAY)`,
    [uuid(), order.orderId, `${WHY[status]} — cần yêu cầu GHN bồi thường`],
    conn,
  );
  await notifyOrder(conn, order, 'SHIPMENT_LOST', { refund: paid, reason: WHY[status] });
  await audit(conn, { actorId: null, action: `SHIPMENT_${status}`, entityType: 'ORDER', entityId: order.orderId, reason: WHY[status] });
}
