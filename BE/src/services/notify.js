import { query } from '../db.js';
import { enqueueEmail } from './mailer.js';
import { vnd } from '../utils/format.js';

const TEMPLATES = {
  PAID: (o) => ['Thanh toán thành công', `Chúng tôi đã nhận ${vnd(o.totalAmount)} cho đơn ${o.orderCode}. Đơn hàng đã được xác nhận và đang chuẩn bị.`],
  PACKING: (o) => ['Đơn hàng đang được đóng gói', `Đơn ${o.orderCode} đang được đóng gói.`],
  DELIVERING: (o) => ['Đơn hàng đang được giao', `Đơn ${o.orderCode} đã bàn giao cho đơn vị vận chuyển và đang trên đường giao tới bạn.`],
  COMPLETED: (o) => ['Giao hàng thành công', `Đơn ${o.orderCode} đã được giao thành công. Cảm ơn bạn đã mua hàng.`],
  DELIVERY_FAILED: (o) => [
    'Giao hàng không thành công',
    `Đơn ${o.orderCode} giao chưa thành công. Đơn vị vận chuyển sẽ liên hệ giao lại hoặc hoàn hàng về kho.`,
  ],
  RETURNING: (o) => ['Đơn hàng đang hoàn về', `Đơn ${o.orderCode} đang được hoàn về cửa hàng.`],
  RETURNED: (o, x) => [
    'Đơn hàng đã hoàn về kho',
    `Đơn ${o.orderCode} đã hoàn về kho.${x?.refund ? ' Chúng tôi sẽ hoàn lại tiền cho bạn và thông báo khi có cập nhật.' : ''}`,
  ],
  SHIPMENT_LOST: (o, x) => [
    'Đơn hàng không thể giao',
    `Rất tiếc, đơn ${o.orderCode} gặp sự cố trong quá trình vận chuyển (${x.reason}) và đã bị hủy.${x.refund ? ' Chúng tôi sẽ hoàn lại toàn bộ số tiền bạn đã thanh toán.' : ' Bạn không bị thu tiền cho đơn này.'}`,
  ],
  REFUNDED: (o, x) => ['Đã hoàn tiền', `Chúng tôi đã hoàn ${vnd(x.amount)} cho đơn ${o.orderCode}${x.bankTxnRef ? ` (mã giao dịch ${x.bankTxnRef})` : ''}.`],
  REFUND_LATE: (o, x) => [
    'Giao dịch thanh toán cần hoàn tiền',
    `Khoản ${vnd(x.amount)} bạn chuyển cho đơn ${o.orderCode} không thể áp dụng cho đơn (${x.reason}). Chúng tôi sẽ hoàn lại tiền.`,
  ],
};

export async function notifyOrder(conn, order, event, extra) {
  const [row] = await query(
    'SELECT a.email, c.fullName FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE c.customerId = ?',
    [order.customerId],
    conn,
  );
  if (!row) return;
  const [subject, text] = TEMPLATES[event](order, extra);
  await enqueueEmail(conn, {
    dedupeKey: `order-${event}:${order.orderId}${extra?.dedupe ? `:${extra.dedupe}` : ''}`,
    to: row.email,
    subject: `${subject} - ${order.orderCode}`,
    body: `Xin chào ${row.fullName},\n\n${text}`,
  });
}
