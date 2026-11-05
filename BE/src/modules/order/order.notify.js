import { query } from '../../db.js';
import { enqueueEmail } from '../../services/mailer.js';
import { vnd, formatDateTime } from '../../utils/format.js';

async function customerContact(conn, customerId) {
  const [r] = await query('SELECT a.email, c.fullName FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE c.customerId = ?', [customerId], conn);
  return r;
}

export async function sendOrderCreatedEmail(
  conn,
  { orderId, orderCode, customerId, address: a, subtotal, discountAmount, shippingFee, totalAmount, online, paymentMethod, paymentExpiresAt },
) {
  const who = await customerContact(conn, customerId);
  await enqueueEmail(conn, {
    dedupeKey: `order-created:${orderId}`,
    to: who.email,
    subject: `Xác nhận đơn hàng ${orderCode}`,
    body: [
      `Xin chào ${who.fullName},`,
      '',
      `Cảm ơn bạn đã đặt hàng. Mã đơn: ${orderCode}`,
      `Tiền hàng: ${vnd(subtotal)}`,
      ...(discountAmount ? [`Giảm giá: -${vnd(discountAmount)}`] : []),
      `Phí vận chuyển: ${vnd(shippingFee)}`,
      `Tổng thanh toán: ${vnd(totalAmount)}`,
      '',
      `Giao tới: ${a.receiverName}, ${a.phone}, ${a.detail}, ${a.ward}${a.district ? `, ${a.district}` : ''}, ${a.province}`,
      '',
      online
        ? `Vui lòng thanh toán trước ${formatDateTime(paymentExpiresAt)} (${paymentMethod === 'SEPAY' ? 'chuyển khoản' : 'VNPay'}); quá hạn đơn sẽ tự hủy.`
        : `Bạn thanh toán ${vnd(totalAmount)} khi nhận hàng.`,
    ].join('\n'),
  });
}

export async function sendOrderClosedEmail(conn, { order, status, reason, refund }) {
  const who = await customerContact(conn, order.customerId);
  await enqueueEmail(conn, {
    dedupeKey: `order-${status === 'EXPIRED' ? 'expired' : 'cancelled'}:${order.orderId}`,
    to: who.email,
    subject: status === 'EXPIRED' ? `Đơn hàng ${order.orderCode} đã hết hạn thanh toán` : `Đơn hàng ${order.orderCode} đã được hủy`,
    body: [
      `Xin chào ${who.fullName},`,
      '',
      status === 'EXPIRED'
        ? `Đơn hàng ${order.orderCode} đã bị hủy vì quá hạn thanh toán. Hàng đã được giữ cho đơn được trả lại kho.`
        : `Đơn hàng ${order.orderCode} đã được hủy${reason ? `. Lý do: ${reason}` : ''}.`,
      ...(refund ? ['', 'Chúng tôi sẽ hoàn lại số tiền bạn đã thanh toán và thông báo khi có cập nhật.'] : []),
    ].join('\n'),
  });
}
