import { query, withTx } from '../../db.js';
import { uuid, randomOrderCode } from '../../utils/security.js';
import { audit } from '../../services/audit.js';
import { getInt } from '../../services/params.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { touchAddress } from '../address/address.service.js';
import { claimDiscountCode, recordDiscountUsage, releaseDiscountCode } from '../discount/discount.service.js';
import { buildQuote, applyFreeShipping } from './quote.service.js';
import { cancelWaybill, scheduleShipment } from '../shipment/shipment.service.js';
import { createRefund, refundAmountForOrder } from '../refund/refund.service.js';
import { reconcileVnpayOrder } from '../payment/vnpay.service.js';
import { getOrder } from './order.query.js';
import { sendOrderCreatedEmail, sendOrderClosedEmail } from './order.notify.js';

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKING'];
// Vận đơn đã rời kho / đã có kết quả giao => không còn hủy đơn được
const SHIPPED_STATUSES = ['DELIVERING', 'DELIVERED', 'FAILED', 'RETURNING', 'RETURNED', 'LOST', 'DAMAGED'];

// ---------------------------------------------------------------------------
// Giữ hàng / trả hàng giữ
// ---------------------------------------------------------------------------

/**
 * Trả hàng đã giữ cho đơn ĐÚNG MỘT LẦN (cờ Orders.stockRestoredAt, UPDATE có điều kiện => chỉ một lời gọi thắng).
 * Chỉ dùng khi hàng chưa giao cho GHN (hủy / hết hạn thanh toán): sau khi GHN lấy hàng, phần giữ đã được
 * chuyển thành xuất kho (mục 8) nên không được gọi hàm này nữa. Trả true nếu lần gọi này đã trả hàng.
 */
async function restoreReservation(conn, orderId) {
  const [res] = await conn.query('UPDATE Orders SET stockRestoredAt = NOW() WHERE orderId = ? AND stockRestoredAt IS NULL', [orderId]);
  if (res.affectedRows !== 1) return false;
  const items = await query('SELECT editionId, quantity FROM OrderItem WHERE orderId = ? ORDER BY editionId', [orderId], conn); // khóa theo thứ tự cố định => không deadlock
  for (const it of items) {
    await query('UPDATE Inventory SET qtyReserved = GREATEST(qtyReserved - ?, 0) WHERE editionId = ?', [it.quantity, it.editionId], conn);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tạo đơn
// ---------------------------------------------------------------------------

const findByIdempotencyKey = async (customerId, key, conn) =>
  (await query('SELECT orderId FROM Orders WHERE customerId = ? AND idempotencyKey = ?', [customerId, key], conn))[0];

/**
 * Tạo đơn MỘT LẦN DUY NHẤT cho mỗi (khách, idempotencyKey): gửi lại do lỗi mạng trả về đúng đơn đã tạo.
 * Mọi số tiền được tính lại ở server; `expectedTotal` là tổng khách đã thấy — khác thì 409 QUOTE_CHANGED kèm báo giá mới.
 * Trong MỘT transaction: khóa khách -> khóa tồn kho (theo thứ tự id) -> đối chiếu giá/giỏ -> trừ lượt mã -> ghi đơn
 * -> giữ hàng -> xóa dòng đã đặt khỏi giỏ -> xếp email xác nhận. Lỗi ở bất kỳ bước nào là hoàn tác toàn bộ.
 * COD: đơn xác nhận ngay (CONFIRMED). SePay/VNPay: chờ thanh toán PENDING_PAYMENT, hết hạn sau PAYMENT_TIMEOUT_MINUTES.
 */
export async function createOrder(customerId, d) {
  const replay = await findByIdempotencyKey(customerId, d.idempotencyKey);
  if (replay) return { order: await getOrder(replay.orderId, { customerId }), created: false };

  const quote = await buildQuote(customerId, d); // gồm gọi GHN: làm TRƯỚC transaction để không giữ khóa trong lúc chờ mạng
  const pm = quote.paymentMethods.find((m) => m.method === d.paymentMethod);
  if (!pm.available) throw unprocessable(pm.reason, pm.code);
  if (quote.total !== d.expectedTotal) {
    throw conflict('Giá hoặc phí vận chuyển đã thay đổi, vui lòng kiểm tra lại trước khi đặt', 'QUOTE_CHANGED', { quote });
  }
  const timeoutMin = await getInt('PAYMENT_TIMEOUT_MINUTES');
  const threshold = quote.freeShippingThreshold;
  const online = d.paymentMethod !== 'COD';

  const result = await withTx(async (conn) => {
    await query('SELECT customerId FROM Customer WHERE customerId = ? FOR UPDATE', [customerId], conn); // các đơn của cùng một khách chạy lần lượt
    const again = await findByIdempotencyKey(customerId, d.idempotencyKey, conn);
    if (again) return { orderId: again.orderId, created: false };

    const ids = quote.items.map((i) => i.editionId).sort();
    const inv = await query('SELECT editionId, qtyOnHand, qtyReserved FROM Inventory WHERE editionId IN (?) ORDER BY editionId FOR UPDATE', [ids], conn);
    const stock = new Map(inv.map((r) => [r.editionId, r]));

    // Giỏ / giá có thể đã đổi từ lúc báo giá
    const cur = new Map(
      (
        await query(
          `SELECT ci.editionId, ci.quantity, e.listPrice, e.salePrice, e.businessStatus
         FROM CartItem ci JOIN Edition e ON e.editionId = ci.editionId WHERE ci.customerId = ?`,
          [customerId],
          conn,
        )
      ).map((r) => [r.editionId, r]),
    );
    const same =
      cur.size === quote.items.length &&
      quote.items.every((q) => {
        const c = cur.get(q.editionId);
        return c && c.businessStatus === 'ON_SALE' && c.quantity === q.quantity && (c.salePrice ?? c.listPrice) === q.unitPrice;
      });
    if (!same) throw conflict('Giỏ hàng hoặc giá đã thay đổi, vui lòng kiểm tra lại', 'QUOTE_CHANGED');

    for (const q of quote.items) {
      const s = stock.get(q.editionId);
      const available = s ? s.qtyOnHand - s.qtyReserved : 0;
      if (q.quantity > available) throw conflict(`"${q.title}" chỉ còn ${available} cuốn`, 'INSUFFICIENT_STOCK', { editionId: q.editionId, available });
    }

    const subtotal = quote.subtotal;
    let discount = null;
    if (quote.discount) {
      discount = await claimDiscountCode(conn, {
        code: quote.discount.code,
        customerId,
        lines: quote.items.map(({ editionId, quantity, unitPrice, listPrice }) => ({ editionId, quantity, unitPrice, listPrice })),
      });
      if (discount.amount !== quote.discountAmount) throw conflict('Mức giảm giá đã thay đổi, vui lòng kiểm tra lại', 'QUOTE_CHANGED');
    }
    const discountAmount = discount?.amount ?? 0;
    const shippingFee = applyFreeShipping(subtotal - discountAmount, quote.ghnFee, threshold);
    const totalAmount = subtotal - discountAmount + shippingFee;
    if (totalAmount !== d.expectedTotal) throw conflict('Giá hoặc phí vận chuyển đã thay đổi, vui lòng kiểm tra lại', 'QUOTE_CHANGED');

    const a = quote.address;
    await query('UPDATE Customer SET phone = ? WHERE customerId = ? AND phone IS NULL', [a.phone, customerId], conn);
    const snapshot = {
      addressId: a.addressId,
      receiverName: a.receiverName,
      phone: a.phone,
      province: a.province,
      district: a.district,
      ward: a.ward,
      detail: a.detail,
      ghnProvinceId: a.ghnProvinceId,
      ghnDistrictId: a.ghnDistrictId,
      ghnWardCode: a.ghnWardCode,
    };
    const orderId = uuid();
    const paymentExpiresAt = online ? new Date(Date.now() + timeoutMin * 60_000) : null;

    let orderCode;
    for (let attempt = 0; ; attempt++) {
      orderCode = randomOrderCode();
      try {
        await query(
          `INSERT INTO Orders (orderId, orderCode, customerId, orderStatus, paymentStatus, shippingStatus, subtotal, discountAmount, shippingFee, totalAmount,
                               paymentMethod, discountCodeId, shippingAddressSnapshot, note, idempotencyKey, paymentExpiresAt, confirmedAt)
           VALUES (?,?,?,?, 'UNPAID', 'NOT_CREATED', ?,?,?,?, ?,?,?,?,?,?, ${online ? 'NULL' : 'NOW()'})`,
          [
            orderId,
            orderCode,
            customerId,
            online ? 'PENDING_PAYMENT' : 'CONFIRMED',
            subtotal,
            discountAmount,
            shippingFee,
            totalAmount,
            d.paymentMethod,
            discount?.discountCodeId ?? null,
            JSON.stringify(snapshot),
            d.note ?? null,
            d.idempotencyKey,
            paymentExpiresAt,
          ],
          conn,
        );
        break;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY' && /uq_order_code/.test(e.message) && attempt < 4) continue; // trùng mã đơn ngẫu nhiên: thử mã khác
        throw e;
      }
    }
    if (discount) await recordDiscountUsage(conn, { discountCodeId: discount.discountCodeId, customerId, orderId });

    await query(
      'INSERT INTO OrderItem (orderItemId, orderId, editionId, quantity, unitPrice, lineTotal) VALUES ?',
      [quote.items.map((q) => [uuid(), orderId, q.editionId, q.quantity, q.unitPrice, q.lineTotal])],
      conn,
    );
    for (const q of quote.items) {
      // ids đã sắp xếp; quote.items theo thứ tự giỏ nên khóa đã giữ ở trên
      await query('UPDATE Inventory SET qtyReserved = qtyReserved + ? WHERE editionId = ?', [q.quantity, q.editionId], conn);
    }
    await query('DELETE FROM CartItem WHERE customerId = ? AND editionId IN (?)', [customerId, ids], conn);
    await touchAddress(conn, a.addressId);

    await sendOrderCreatedEmail(conn, {
      orderId,
      orderCode,
      customerId,
      address: a,
      subtotal,
      discountAmount,
      shippingFee,
      totalAmount,
      online,
      paymentMethod: d.paymentMethod,
      paymentExpiresAt,
    });
    return { orderId, created: true };
  });
  if (result.created && !online) scheduleShipment(result.orderId);
  return { order: await getOrder(result.orderId, { customerId }), created: result.created };
}

// ---------------------------------------------------------------------------
// Hủy đơn / hết hạn
// ---------------------------------------------------------------------------

/**
 * Phần hủy trong transaction (đã khóa dòng Orders): đổi trạng thái, trả hàng giữ và lượt mã đúng một lần.
 * Đơn đã thanh toán => paymentStatus REFUND_PENDING + tạo bản ghi Refund.
 */
async function applyCancellation(conn, order, { status = 'CANCELLED', reason, shipmentCancelled = false }) {
  const refund = order.paymentStatus === 'PAID';
  const paymentStatus = refund ? 'REFUND_PENDING' : status === 'EXPIRED' ? 'EXPIRED' : order.paymentStatus;
  await query(
    `UPDATE Orders SET orderStatus = ?, paymentStatus = ?, cancelReason = ?, shippingStatus = ? WHERE orderId = ?`,
    [status, paymentStatus, reason ?? null, shipmentCancelled ? 'CANCELLED' : order.shippingStatus, order.orderId],
    conn,
  );
  if (refund) {
    const txn = await refundAmountForOrder(conn, order.orderId);
    await createRefund(conn, { order, transactionId: txn?.transactionId ?? null, source: 'CANCEL', amount: txn?.amount ?? order.totalAmount });
  }
  await restoreReservation(conn, order.orderId);
  await releaseDiscountCode(conn, order.orderId);
  await sendOrderClosedEmail(conn, { order, status, reason, refund });
  return { paymentStatus, refundPending: refund };
}

/**
 * Hủy đơn. actor = { customerId } (khách: chỉ khi GHN chưa lấy hàng) hoặc { accountId, staff: true } (nhân viên/admin,
 * bắt buộc có lý do — hàng thiếu/hỏng...). Có vận đơn GHN chưa lấy hàng thì hủy vận đơn trước; GHN lỗi => không hủy đơn.
 */
export async function cancelOrder(orderId, actor, reason) {
  const scope = actor.staff ? '' : 'AND customerId = ?';
  const [pre] = await query(`SELECT * FROM Orders WHERE orderId = ? ${scope}`, actor.staff ? [orderId] : [orderId, actor.customerId]);
  if (!pre) throw notFound('Không tìm thấy đơn hàng');
  assertCancellable(pre);

  const [ship] = await query(`SELECT shipmentId, ghnOrderCode, status, pickedUpAt FROM Shipment WHERE orderId = ? AND direction = 'FORWARD'`, [orderId]);
  if (ship && (ship.pickedUpAt || SHIPPED_STATUSES.includes(ship.status))) {
    throw conflict('Đơn hàng đã được giao cho đơn vị vận chuyển nên không thể hủy', 'ORDER_ALREADY_SHIPPED');
  }
  const toCancel = ship && ship.status !== 'CANCELLED' ? ship : null;
  if (toCancel?.ghnOrderCode) await cancelWaybill(toCancel.ghnOrderCode, orderId); // GHN lỗi => ném AppError, đơn giữ nguyên

  return withTx(async (conn) => {
    const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [orderId], conn);
    assertCancellable(o);
    // Đọc lại vận đơn khi đã khóa đơn: ensureShipment có thể vừa tạo/gắn vận đơn sau lần đọc ở trên
    const [now] = await query(
      `SELECT shipmentId, ghnOrderCode, status, pickedUpAt FROM Shipment WHERE orderId = ? AND direction = 'FORWARD' FOR UPDATE`,
      [orderId],
      conn,
    );
    if (now && now.status !== 'CANCELLED') {
      if (now.pickedUpAt || SHIPPED_STATUSES.includes(now.status))
        throw conflict('Đơn hàng đã được giao cho đơn vị vận chuyển nên không thể hủy', 'ORDER_ALREADY_SHIPPED');
      if (now.ghnOrderCode && now.ghnOrderCode !== toCancel?.ghnOrderCode) {
        throw conflict('Vận đơn vừa được tạo, vui lòng thử hủy lại', 'SHIPMENT_CHANGED'); // lần sau sẽ hủy vận đơn trước
      }
      await query(`UPDATE Shipment SET status = 'CANCELLED' WHERE shipmentId = ?`, [now.shipmentId], conn);
    }
    const shipmentCancelled = !!now && now.status !== 'CANCELLED';
    const finalReason = reason ?? (actor.staff ? null : 'Khách hàng hủy đơn');
    const r = await applyCancellation(conn, o, { reason: finalReason, shipmentCancelled });
    if (actor.staff) {
      await audit(conn, {
        actorId: actor.accountId,
        action: 'CANCEL',
        entityType: 'ORDER',
        entityId: orderId,
        oldValue: { orderStatus: o.orderStatus, paymentStatus: o.paymentStatus },
        newValue: { orderStatus: 'CANCELLED', paymentStatus: r.paymentStatus },
        reason: finalReason,
      });
    }
    return { orderId, orderCode: o.orderCode, orderStatus: 'CANCELLED', paymentStatus: r.paymentStatus, refundPending: r.refundPending };
  });
}

function assertCancellable(o) {
  if (!CANCELLABLE_STATUSES.includes(o.orderStatus)) {
    throw conflict('Đơn hàng ở trạng thái hiện tại không thể hủy', 'ORDER_NOT_CANCELLABLE', { orderStatus: o.orderStatus });
  }
}

/**
 * Job (mỗi phút): đơn thanh toán trực tuyến quá hạn (+ SEPAY_GRACE_MINUTES ân hạn cho chuyển khoản) => EXPIRED,
 * trả hàng đã giữ và lượt mã. Mỗi đơn một transaction riêng, kiểm tra lại điều kiện sau khi khóa dòng nên chạy đồng thời
 * với thanh toán / hủy tay vẫn đúng. Đơn VNPay được hỏi `QueryDR` trước khi hết hạn (IPN có thể bị lỡ).
 */
export async function expireUnpaidOrders() {
  const grace = await getInt('SEPAY_GRACE_MINUTES');
  const due = (paramSql) => `orderStatus = 'PENDING_PAYMENT' AND paymentExpiresAt IS NOT NULL
        AND paymentExpiresAt + INTERVAL (CASE WHEN paymentMethod = 'SEPAY' THEN ${paramSql} ELSE 0 END) MINUTE <= NOW()`;
  const rows = await query(`SELECT orderId, paymentMethod FROM Orders WHERE ${due('?')} ORDER BY paymentExpiresAt LIMIT 200`, [grace]);
  let expired = 0;
  for (const { orderId, paymentMethod } of rows) {
    try {
      if (paymentMethod === 'VNPAY') await reconcileVnpayOrder(orderId);
      const done = await withTx(async (conn) => {
        const [o] = await query(`SELECT * FROM Orders WHERE orderId = ? AND ${due('?')} FOR UPDATE`, [orderId, grace], conn);
        if (!o) return false; // đã thanh toán / hủy trong lúc chờ
        await applyCancellation(conn, o, { status: 'EXPIRED', reason: 'Quá hạn thanh toán' });
        return true;
      });
      if (done) expired++;
    } catch (e) {
      console.error('[job:expire-orders]', orderId, e.message);
    }
  }
  return { expired };
}
